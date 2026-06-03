'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Detect context: webview (sendToHost available) vs BrowserWindow (use send)
const isWebview = typeof ipcRenderer.sendToHost === 'function';

function sendSessions(sessions) {
  try {
    if (isWebview) {
      ipcRenderer.sendToHost('dmm:sessions', sessions);
    }
    // Always also send via ipcRenderer.send so the main process can forward to the main window
    ipcRenderer.send('popup:sessions', sessions);
  } catch (_) {}
}

// Bridge: page context → preload
contextBridge.exposeInMainWorld('dmmHelperBridge', {
  sendSessions,
});

// ─── Inject EME Interceptor into page context ────────────────────────────────

function injectInterceptor() {
  const script = `
(function() {
  'use strict';
  if (window.__dmmHelperInjected) return;
  window.__dmmHelperInjected = true;

  let sessions = [];
  let pendingMPD = null;
  let pendingKeys = null;
  let mpdTimer = null;
  let keysTimer = null;
  const MPD_DEBOUNCE_TIME = 300;
  const KEYS_DEBOUNCE_TIME = 300;
  const MAX_WAIT_TIME = 2000;
  let processedUrls = new Map();
  const MAX_PROCESSED_URLS = 500;
  const URL_DEBOUNCE_TIME = 100;

  const base64ToHex = (str) => {
    try {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(b64);
      return Array.from(raw).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toLowerCase();
    } catch (e) { return ''; }
  };

  const formatRawTo0x = (data) => {
    const buf = new Uint8Array(data);
    let r = '[\\n  ';
    for (let i = 0; i < buf.length; i++) {
      r += '0x' + buf[i].toString(16).padStart(2, '0') + ', ';
      if ((i + 1) % 16 === 0) r += '\\n  ';
    }
    return r + '\\n]';
  };

  const getTime = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const getCoreUrl = (url) => { try { return new URL(url).pathname; } catch { return url.split('?')[0]; } };

  const getVideoQuality = () => {
    try {
      const el = document.querySelector('#quality-menu-expanded .submenu[role="menu"] div[role="menuitemradio"][aria-checked="true"] .menuitem-label');
      return el ? el.textContent.trim() : 'Unknown';
    } catch { return 'Unknown'; }
  };

  function notifyUpdate() {
    const msg = { type: 'DMM_UPDATE_SESSIONS', sessions: JSON.parse(JSON.stringify(sessions)) };
    window.postMessage(msg, '*');
    // Also notify via bridge if available
    if (window.dmmHelperBridge && window.dmmHelperBridge.sendSessions) {
      try { window.dmmHelperBridge.sendSessions(sessions); } catch(_) {}
    }
  }

  function tryMatchPending() {
    if (pendingMPD && pendingKeys) {
      clearTimeout(mpdTimer); clearTimeout(keysTimer);
      createCompleteSession(pendingMPD, pendingKeys);
      pendingMPD = null; pendingKeys = null;
      return true;
    }
    return false;
  }

  function createCompleteSession(mpdData, keysData) {
    sessions.unshift({
      id: sessions.length + 1,
      time: getTime(),
      timestamp: Date.now(),
      quality: getVideoQuality(),
      mpd: mpdData.cleanUrl,
      fullMpd: mpdData.fullUrl,
      keys: keysData.parsedKeys,
      raw0x: keysData.raw0x,
    });
    notifyUpdate();
  }

  function processMPD(url) {
    if (!url || typeof url !== 'string') return;
    if (!url.includes('.mpd') && !(url.includes('/dash/') && url.includes('manifest'))) return;
    const now = Date.now();
    const last = processedUrls.get(url);
    if (last && (now - last) < URL_DEBOUNCE_TIME) return;
    processedUrls.set(url, now);
    if (processedUrls.size > MAX_PROCESSED_URLS) {
      const keep = Array.from(processedUrls.entries()).filter(([_, t]) => (now - t) < 10000);
      processedUrls = new Map(keep);
    }

    const cleanUrl = url.split('?')[0];
    const coreUrl = getCoreUrl(url);

    if (pendingKeys) {
      createCompleteSession({ cleanUrl, fullUrl: url, coreUrl }, pendingKeys);
      pendingKeys = null;
      if (keysTimer) { clearTimeout(keysTimer); keysTimer = null; }
      return;
    }

    let target = sessions.find(s => s.mpd === null && s.keys.length > 0 && (now - s.timestamp) < 10000);
    if (target) { target.mpd = cleanUrl; target.fullMpd = url; target.timestamp = now; notifyUpdate(); return; }

    if (sessions.length > 0) {
      const latest = sessions[0];
      if (latest.mpd && getCoreUrl(latest.mpd) === coreUrl) {
        latest.mpd = cleanUrl; latest.fullMpd = url; notifyUpdate(); return;
      }
    }

    if (mpdTimer) clearTimeout(mpdTimer);
    pendingMPD = { cleanUrl, fullUrl: url, coreUrl, timestamp: now };

    mpdTimer = setTimeout(() => {
      if (!pendingMPD) return;
      let t = sessions.find(s => s.mpd === null && s.keys.length > 0 && (Date.now() - s.timestamp) < 10000);
      if (t) { t.mpd = pendingMPD.cleanUrl; t.fullMpd = pendingMPD.fullUrl; }
      else {
        sessions.unshift({ id: sessions.length + 1, time: getTime(), timestamp: Date.now(), quality: getVideoQuality(), mpd: pendingMPD.cleanUrl, fullMpd: pendingMPD.fullUrl, keys: [], raw0x: null });
      }
      pendingMPD = null;
      notifyUpdate();
    }, MPD_DEBOUNCE_TIME);
  }

  function processKey(data) {
    try {
      const json = JSON.parse(new TextDecoder().decode(data));
      if (!json.keys) return;
      const parsedKeys = json.keys.map(k => ({
        kid: base64ToHex(k.kid),
        k: base64ToHex(k.k),
        k32: base64ToHex(k.k).substring(0, 32),
      }));

      if (keysTimer) clearTimeout(keysTimer);
      pendingKeys = { parsedKeys, raw0x: formatRawTo0x(data), timestamp: Date.now() };
      scanPerformance();
      if (tryMatchPending()) return;

      keysTimer = setTimeout(() => {
        if (!pendingKeys) return;
        let t = sessions.find(s => s.keys.length === 0 && s.mpd !== null && (Date.now() - s.timestamp) < 10000);
        if (t) { t.keys = pendingKeys.parsedKeys; t.raw0x = pendingKeys.raw0x; t.timestamp = Date.now(); }
        else {
          sessions.unshift({ id: sessions.length + 1, time: getTime(), timestamp: Date.now(), quality: getVideoQuality(), mpd: null, fullMpd: null, keys: pendingKeys.parsedKeys, raw0x: pendingKeys.raw0x });
        }
        pendingKeys = null;
        notifyUpdate();
      }, KEYS_DEBOUNCE_TIME);
    } catch (_) {}
  }

  // Safety valve
  setInterval(() => {
    const now = Date.now();
    if (pendingMPD && (now - pendingMPD.timestamp) > MAX_WAIT_TIME) {
      clearTimeout(mpdTimer); mpdTimer = null;
      setTimeout(() => { if (pendingMPD) processMPD(pendingMPD.fullUrl); }, 0);
    }
    if (pendingKeys && (now - pendingKeys.timestamp) > MAX_WAIT_TIME) {
      if (keysTimer) { clearTimeout(keysTimer); keysTimer = null; }
      sessions.unshift({ id: sessions.length + 1, time: getTime(), timestamp: Date.now(), quality: getVideoQuality(), mpd: null, fullMpd: null, keys: pendingKeys.parsedKeys, raw0x: pendingKeys.raw0x });
      pendingKeys = null;
      notifyUpdate();
    }
  }, 500);

  // Interceptors
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    processMPD(url.toString());
    return origOpen.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = async function() {
    const url = (typeof arguments[0] === 'string') ? arguments[0] : (arguments[0]?.url || '');
    processMPD(url);
    return origFetch.apply(this, arguments);
  };

  const origUpdate = MediaKeySession.prototype.update;
  MediaKeySession.prototype.update = function(data) {
    processKey(data);
    return origUpdate.apply(this, arguments);
  };

  let lastPerfCheck = 0;
  function scanPerformance() {
    const entries = performance.getEntriesByType('resource');
    entries.slice(lastPerfCheck).forEach(e => { if (e.name.includes('.mpd')) processMPD(e.name); });
    lastPerfCheck = entries.length;
  }
  setInterval(scanPerformance, 300);
  setInterval(() => {
    if (performance.getEntriesByType('resource').length > 200) {
      performance.clearResourceTimings();
      lastPerfCheck = 0;
    }
  }, 60000);

  console.log('[DMM Helper] EME interceptor installed');
})();
`;

  // Inject into page context using executeJavaScript equivalent for preload
  const scriptEl = document.createElement('script');
  scriptEl.textContent = script;
  (document.head || document.documentElement).appendChild(scriptEl);
  scriptEl.remove();
}

// Wait for DOM to be available
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectInterceptor, { once: true });
} else {
  injectInterceptor();
}
