'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron');

// ─── Constants ───────────────────────────────────────────────────────────────

const BROWSER_PARTITION = 'persist:dmm-helper-browser';
const TASK_TEMP_DIR_PATTERN = /^\d{8}_\d{6}\.tmp$/;
const DEFAULT_MIN_FREE_SPACE_BYTES = 4 * 1024 * 1024 * 1024;

// ─── State ───────────────────────────────────────────────────────────────────

const downloadTasks = new Map();
const windows = new Set();
const popupWindows = new Map();
let mainWindow = null;

// ─── Utility ─────────────────────────────────────────────────────────────────

function generateSaveName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `${y}${m}${d}_${h}${mi}${s}`;
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');
}

function resolveDownloaderBin() {
  if (process.env.DL_BIN) return process.env.DL_BIN;
  const platform = process.platform;
  const arch = process.arch;
  let subdir;
  if (platform === 'darwin') {
    subdir = arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  } else if (platform === 'win32') {
    subdir = 'win-x64';
  } else {
    subdir = 'linux-x64';
  }
  const bundled = path.join(__dirname, '..', 'bin', subdir, 'N_m3u8DL-RE');
  if (fs.existsSync(bundled)) return bundled;
  return 'N_m3u8DL-RE'; // fallback to PATH
}

function resolveDecryptionConfig() {
  const engine = (process.env.DMM_HELPER_DECRYPTION_ENGINE || 'SHAKA_PACKAGER').toUpperCase();
  const candidates = engine === 'MP4DECRYPT'
    ? ['mp4decrypt']
    : ['shaka-packager', 'packager', 'mp4decrypt'];
  for (const name of candidates) {
    try {
      const { execSync } = require('node:child_process');
      const fullPath = execSync(`which ${name}`, { encoding: 'utf8' }).trim();
      return { engine: name === 'mp4decrypt' ? 'MP4DECRYPT' : 'SHAKA_PACKAGER', binaryPath: fullPath };
    } catch (_) { /* not found */ }
  }
  // Check env override
  if (process.env.DMM_HELPER_DECRYPTION_BINARY_PATH) {
    return { engine, binaryPath: process.env.DMM_HELPER_DECRYPTION_BINARY_PATH };
  }
  return null;
}

// ─── Task Model ──────────────────────────────────────────────────────────────

function createTask(url, saveName, keys) {
  const id = randomUUID();
  const task = {
    id,
    url,
    saveName: saveName || generateSaveName(),
    keys: Array.isArray(keys) ? keys : [],
    status: 'queued',        // queued | running | converting | done | failed | cancelled
    progress: 0,
    error: '',
    output: '',
    downloadDir: '',
    createdAt: Date.now(),
    startedAt: 0,
    endedAt: 0,
    exitCode: null,
    child: null,
    progressTimer: null,
    _streamBuffer: '',
    _fatalErrorDetected: false,
  };
  downloadTasks.set(id, task);
  return task;
}

function serializeTask(task) {
  return {
    id: task.id,
    url: task.url,
    saveName: task.saveName,
    keys: task.keys,
    status: task.status,
    progress: task.progress,
    error: task.error,
    output: task.output.slice(-2000),
    downloadDir: task.downloadDir,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
  };
}

function emitTaskUpdate(task) {
  const data = serializeTask(task);
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('task:updated', data);
    }
  }
}

// ─── Fatal Error Detection ───────────────────────────────────────────────────

function checkFatalDownloadErrors(task, line) {
  if (task._fatalErrorDetected) return true;
  const fatalPatterns = [
    { pattern: /The retry attempts have been exhausted/i, message: '分片下载重试耗尽，下载失败。请检查代理配置和网络连接。' },
    { pattern: /No space left on device/i, message: '磁盘空间不足，请释放空间后重试。' },
    { pattern: /Unable to open Web request/i, message: '网络请求失败，请检查代理配置和网络连接。' },
    { pattern: /Unhandled exception:\s*System\.[A-Z]/i, message: '下载器内部异常崩溃，请检查网络后重试。' },
    { pattern: /Unhandled exception:/i, message: '下载器异常崩溃，请重试。' },
  ];
  for (const { pattern, message } of fatalPatterns) {
    if (pattern.test(line)) {
      task._fatalErrorDetected = true;
      if (task.progressTimer) { clearInterval(task.progressTimer); task.progressTimer = null; }
      if (task.child && !task.child.killed) {
        try { task.child.kill('SIGTERM'); } catch (_) {}
      }
      task.status = 'failed';
      task.error = message;
      task.endedAt = Date.now();
      emitTaskUpdate(task);
      return true;
    }
  }
  return false;
}

// ─── Output Parser ───────────────────────────────────────────────────────────

function appendOutput(task, chunk) {
  const text = stripAnsi(chunk.toString());
  const normalizedForDisplay = text.replace(/\r/g, '\n');
  const merged = `${task.output}\n${normalizedForDisplay}`.trim();
  task.output = merged.slice(-4000);

  const buffer = `${task._streamBuffer}${text}`;
  const parts = buffer.split(/\r\n|\n|\r/g);
  task._streamBuffer = /[\r\n]$/.test(buffer) ? '' : (parts.pop() || '');

  for (const rawLine of parts) {
    const line = rawLine.trim();
    if (!line) continue;
    if (checkFatalDownloadErrors(task, line)) break;

    // Parse progress from N_m3u8DL-RE output
    const progressMatch = line.match(/(\d+\.\d+)%/);
    if (progressMatch) {
      const p = parseFloat(progressMatch[1]);
      if (p > task.progress && p <= 100) {
        task.progress = Math.min(99, Math.round(p));
      }
    }
  }
  emitTaskUpdate(task);
}

// ─── Output File Resolution ──────────────────────────────────────────────────

function resolveOutputFilePath(task) {
  const downloadDir = task.downloadDir || app.getPath('downloads');
  const mediaExts = ['.mp4', '.mkv', '.webm', '.ts', '.m4a', '.mp3', '.aac', '.flac', '.wav'];
  const directCandidates = mediaExts.map(ext => `${task.saveName}${ext}`);
  directCandidates.push(task.saveName);

  for (const candidate of directCandidates) {
    const fullPath = path.join(downloadDir, candidate);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }

  // Scan download dir for files starting with saveName (skip .tmp dirs)
  try {
    const match = fs.readdirSync(downloadDir)
      .filter(entry => entry.startsWith(task.saveName) && !entry.endsWith('.tmp'))
      .map(entry => path.join(downloadDir, entry))
      .find(entry => fs.existsSync(entry) && fs.statSync(entry).isFile());
    if (match) return match;
  } catch (_) {}

  // Scan workDir
  const workDir = path.join(downloadDir, `${task.saveName}.tmp`);
  if (fs.existsSync(workDir) && fs.statSync(workDir).isDirectory()) {
    try {
      const workFile = fs.readdirSync(workDir)
        .filter(entry => mediaExts.includes(path.extname(entry).toLowerCase()))
        .map(entry => path.join(workDir, entry))
        .find(entry => fs.statSync(entry).isFile());
      if (workFile) return workFile;
    } catch (_) {}
  }
  return '';
}

// ─── HEVC Tag Fix ────────────────────────────────────────────────────────────

function ensureHevcTagCompatible(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !filePath.endsWith('.mp4')) return Promise.resolve(filePath);
  return new Promise((resolve) => {
    const probe = spawn('ffprobe', ['-v', 'quiet', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,codec_tag_string', '-of', 'csv=p=0', filePath]);
    let probeOut = '';
    probe.stdout.on('data', d => { probeOut += d.toString(); });
    probe.on('error', () => resolve(filePath));
    probe.on('exit', (code) => {
      if (code !== 0) return resolve(filePath);
      const lines = probeOut.trim().split('\n');
      const firstStream = lines[0] || '';
      if (!firstStream.includes('hevc') && !firstStream.includes('hev1')) return resolve(filePath);
      if (firstStream.includes('hvc1')) return resolve(filePath);

      // Need to re-tag
      const tmpOut = filePath.replace(/\.mp4$/, '.hvc1.mp4');
      const ff = spawn('ffmpeg', ['-y', '-i', filePath, '-c', 'copy', '-tag:v', 'hvc1', tmpOut]);
      ff.on('error', () => resolve(filePath));
      ff.on('exit', (c) => {
        if (c === 0 && fs.existsSync(tmpOut)) {
          try { fs.unlinkSync(filePath); fs.renameSync(tmpOut, filePath); } catch (_) {}
        } else {
          try { fs.unlinkSync(tmpOut); } catch (_) {}
        }
        resolve(filePath);
      });
    });
  });
}

// ─── Download Engine ─────────────────────────────────────────────────────────

async function getCookiesForDownload(url) {
  const ses = session.fromPartition(BROWSER_PARTITION);
  const allCookies = [];
  // Get cookies specifically for the download URL
  if (url) {
    try {
      const cookies = await ses.cookies.get({ url });
      allCookies.push(...cookies);
    } catch (_) {}
  }
  // Fallback: get cookies for common DMM domains
  if (allCookies.length === 0) {
    const domains = ['dmm.co.jp', 'dmm.com', 'fanza.com'];
    for (const domain of domains) {
      try {
        const cookies = await ses.cookies.get({ domain });
        allCookies.push(...cookies);
      } catch (_) {}
    }
  }
  // Deduplicate by name
  const seen = new Set();
  const unique = [];
  for (const c of allCookies) {
    if (!seen.has(c.name)) {
      seen.add(c.name);
      unique.push(c);
    }
  }
  return unique.map(c => `${c.name}=${c.value}`).join('; ');
}

async function startDownload(task) {
  const downloaderBin = resolveDownloaderBin();
  const downloadDir = task.downloadDir || process.env.DOWNLOAD_DIR || app.getPath('downloads');
  task.downloadDir = downloadDir;
  const decryption = task.keys.length > 0 ? resolveDecryptionConfig() : null;
  const selectVideo = process.env.DMM_HELPER_SELECT_VIDEO || 'best';
  const selectAudio = process.env.DMM_HELPER_SELECT_AUDIO || 'best';
  const userAgent = process.env.DMM_HELPER_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const referer = process.env.DMM_HELPER_REFERER || 'https://www.dmm.co.jp/';
  const upstreamProxy = process.env.DMM_HELPER_UPSTREAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

  if (task.keys.length > 0 && !decryption?.binaryPath) {
    task.status = 'failed';
    task.startedAt = Date.now();
    task.endedAt = Date.now();
    task.error = '未找到解密工具。请安装 shaka-packager 或 mp4decrypt。';
    emitTaskUpdate(task);
    return;
  }

  // Collect cookies from browser session for authentication
  const cookieHeader = await getCookiesForDownload(task.url);

  const args = [
    task.url,
    '--save-name', task.saveName,
    '--save-dir', downloadDir,
    '--header', `User-Agent: ${userAgent}`,
    '--header', `Referer: ${referer}`,
    '--auto-select',
    '--no-log',
    '--tmp-dir', downloadDir,
    '-M', 'format=mp4',
  ];

  // Only add --select-video/--select-audio when user provides specific filters
  if (selectVideo && selectVideo !== 'best') {
    args.push('--select-video', selectVideo);
  }
  if (selectAudio && selectAudio !== 'best') {
    args.push('--select-audio', selectAudio);
  }

  if (cookieHeader) {
    args.push('--header', `Cookie: ${cookieHeader}`);
  }

  if (decryption && task.keys.length > 0) {
    args.push('--decryption-engine', decryption.engine);
    args.push('--decryption-binary-path', decryption.binaryPath);
    for (const key of task.keys) {
      const kid = key.kid || '';
      const k = key.k32 || key.k || '';
      if (kid && k) args.push('--key', `${kid}:${k}`);
    }
  }

  if (upstreamProxy) {
    args.push('--custom-proxy', upstreamProxy);
  }

  const env = { ...process.env };
  if (upstreamProxy) {
    env.HTTP_PROXY = upstreamProxy;
    env.HTTPS_PROXY = upstreamProxy;
  }

  task.status = 'running';
  task.startedAt = Date.now();
  emitTaskUpdate(task);

  const child = spawn(downloaderBin, args, { env, cwd: downloadDir });
  task.child = child;

  child.stdout.on('data', (chunk) => { appendOutput(task, chunk); });
  child.stderr.on('data', (chunk) => { appendOutput(task, chunk); });

  child.on('error', (err) => {
    task.status = 'failed';
    task.error = `无法启动下载器: ${err.message}`;
    task.endedAt = Date.now();
    emitTaskUpdate(task);
  });

  child.on('exit', async (code) => {
    if (task.progressTimer) clearInterval(task.progressTimer);
    task.exitCode = code;
    task.endedAt = Date.now();
    task.child = null;

    if (task._fatalErrorDetected) {
      emitTaskUpdate(task);
      return;
    }

    if (task.status === 'cancelled') {
      emitTaskUpdate(task);
      return;
    }

    // Verify output file exists
    const outputPath = resolveOutputFilePath(task);
    if (!outputPath) {
      task.status = 'failed';
      task.error = code === 0
        ? '下载器退出但未找到输出文件。可能分片下载失败导致合并未完成。'
        : `下载器退出码 ${code}，未生成输出文件。`;
      emitTaskUpdate(task);
      return;
    }

    // Post-processing: HEVC tag fix
    task.status = 'converting';
    task.progress = 100;
    emitTaskUpdate(task);

    try {
      await ensureHevcTagCompatible(outputPath);
    } catch (_) {}

    task.status = 'done';
    emitTaskUpdate(task);
  });
}

// ─── Popup Window Management ─────────────────────────────────────────────────

function createPopupWindow(url, partition) {
  const popup = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'DMM Player',
    webPreferences: {
      preload: path.join(__dirname, 'webview-preload.cjs'),
      partition: partition || BROWSER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  popupWindows.set(popup.id, popup);

  popup.webContents.on('did-finish-load', () => {
    console.log('[desktop] Popup loaded:', popup.webContents.getURL().substring(0, 100));
  });

  popup.on('closed', () => {
    popupWindows.delete(popup.id);
  });

  if (url) popup.loadURL(url);
  return popup;
}

// ─── Window Management ───────────────────────────────────────────────────────

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DMM Download Helper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Allow webview to use the preload script and handle popups
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.preload = path.join(__dirname, 'webview-preload.cjs');
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
  });

  // Intercept popups opened from webview guest contents
  win.webContents.on('did-attach-webview', (event, webviewWebContents) => {
    webviewWebContents.setWindowOpenHandler(({ url }) => {
      console.log('[desktop] Webview popup request:', url.substring(0, 120));
      // Open in a new BrowserWindow with EME capture
      createPopupWindow(url, BROWSER_PARTITION);
      return { action: 'deny' }; // We handle it ourselves
    });
  });

  win.loadFile(path.join(__dirname, 'renderer.html'));
  windows.add(win);
  mainWindow = win;

  win.on('closed', () => {
    windows.delete(win);
    mainWindow = null;
  });

  return win;
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

function registerIpcHandlers() {
  ipcMain.handle('downloader:submit', async (_, payload) => {
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!url) return { ok: false, error: 'URL is required' };

    const saveName = typeof payload?.saveName === 'string' && payload.saveName.trim()
      ? payload.saveName.trim()
      : generateSaveName();
    const keys = Array.isArray(payload?.keys) ? payload.keys : [];
    const downloadDir = typeof payload?.downloadDir === 'string' && payload.downloadDir.trim()
      ? payload.downloadDir.trim()
      : (process.env.DOWNLOAD_DIR || app.getPath('downloads'));

    const task = createTask(url, saveName, keys);
    task.downloadDir = downloadDir;
    startDownload(task); // async, runs in background
    return { ok: true, data: serializeTask(task) };
  });

  ipcMain.handle('tasks:list', () => {
    return Array.from(downloadTasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeTask);
  });

  ipcMain.handle('tasks:cancel', (_, taskId) => {
    const task = downloadTasks.get(taskId);
    if (!task) return { ok: false, error: 'Task not found' };
    if (task.status === 'running' || task.status === 'queued') {
      task.status = 'cancelled';
      task.endedAt = Date.now();
      if (task.child && !task.child.killed) {
        try { task.child.kill('SIGTERM'); } catch (_) {}
      }
      emitTaskUpdate(task);
    }
    return { ok: true };
  });

  ipcMain.handle('download-dir:choose', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择下载目录',
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('app:open-external', (_, url) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url);
    }
    return { ok: true };
  });

  ipcMain.handle('app:open-path', (_, filePath) => {
    if (typeof filePath === 'string' && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
    }
    return { ok: true };
  });

  // Popup window creation from webview
  ipcMain.handle('popup:open', (_, url) => {
    if (typeof url === 'string' && url.startsWith('http')) {
      createPopupWindow(url, BROWSER_PARTITION);
      return { ok: true };
    }
    return { ok: false };
  });

  // Forward captured sessions from popup windows to main window
  ipcMain.on('popup:sessions', (event, sessions) => {
    if (mainWindow && !mainWindow.isDestroyed() && Array.isArray(sessions)) {
      mainWindow.webContents.send('popup:sessions', sessions);
    }
  });

  // Close all popup windows (called after auto-download triggered)
  ipcMain.handle('popup:close-all', () => {
    for (const [id, popup] of popupWindows) {
      if (!popup.isDestroyed()) popup.close();
    }
    popupWindows.clear();
    return { ok: true };
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Kill all running downloads
  for (const task of downloadTasks.values()) {
    if (task.child && !task.child.killed) {
      try { task.child.kill('SIGTERM'); } catch (_) {}
    }
  }
});
