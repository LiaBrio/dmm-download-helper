# DMM Download Helper

<p align="center">
<img src="public/logo-128.png" alt="Logo" width="128">
</p>

<p align="center">
  <strong>A desktop app for downloading DMM/FANZA videos with automatic EME capture and decryption</strong>
</p>

<p align="center">
  English | <a href="README-JP.md">日本語</a> | <a href="README-CN.md">简体中文</a>
</p>

---

## Overview

**DMM Download Helper** is an Electron-based desktop application that provides a built-in browser to browse DMM/FANZA, automatically captures encrypted media streams (MPD + Widevine keys) during video playback, and downloads them using [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE).

> [!NOTE]
> This project is intended for educational and research purposes only. Please comply with relevant laws and regulations.

## Features

- **Built-in Browser** — Browse DMM/FANZA directly within the app, no separate browser extension needed.
- **Automatic EME Capture** — Intercepts MPD manifest URLs and Widevine/ClearKey decryption keys in real-time.
- **Auto Download** — Automatically starts downloading when both MPD and keys are captured. The player popup closes automatically once download begins.
- **Integrated Decryption** — Uses mp4decrypt or shaka-packager to decrypt protected streams.
- **Cross-platform** — Supports macOS (arm64) and Windows (x64).

## Download

Download the latest release from the [Releases](https://github.com/ianho7/dmm-download-helper/releases) page:

| Platform | File |
| :--- | :--- |
| macOS (Apple Silicon) | `DMM Download Helper-x.x.x-arm64.dmg` |
| Windows (x64) | `DMM Download Helper x.x.x.exe` (Portable) |

## Prerequisites

Before using the app, you need the following tools installed and available in your system PATH:

### 1. N_m3u8DL-RE (Required)

Download from [N_m3u8DL-RE Releases](https://github.com/nilaoda/N_m3u8DL-RE/releases) and place the binary in your PATH.

### 2. Decryption Tool (Required for DRM content)

Install **one** of the following:

- [shaka-packager](https://github.com/shaka-project/shaka-packager/releases) (recommended)
- [mp4decrypt (Bento4)](https://www.bento4.com/downloads/)

### 3. Proxy (Required)

DMM has regional restrictions (Japan only). You need a proxy that can access DMM. Set the upstream proxy when launching:

```bash
DMM_HELPER_UPSTREAM_PROXY=http://127.0.0.1:7897 bun run desktop
```

Or set the environment variable `HTTPS_PROXY` / `HTTP_PROXY` in your system.

## Usage

1. Launch the app
2. Browse to DMM/FANZA and log in
3. Navigate to a purchased video and click play
4. The video opens in a popup window — the app automatically captures EME data
5. Once MPD + Keys are captured, download starts automatically and the popup closes
6. Wait for the download to complete — the output is an MP4 file in your Downloads folder

## Building from Source

```bash
# Install dependencies
bun install

# Run in development mode
DMM_HELPER_UPSTREAM_PROXY=http://127.0.0.1:7897 bun run desktop

# Build packages
bun run desktop:build:mac   # macOS DMG + ZIP
bun run desktop:build:win   # Windows Portable + ZIP
bun run desktop:build       # Both platforms
```

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DMM_HELPER_UPSTREAM_PROXY` | HTTP proxy for DMM access | — |
| `DL_BIN` | Path to N_m3u8DL-RE binary | `N_m3u8DL-RE` (from PATH) |
| `DOWNLOAD_DIR` | Download output directory | System Downloads folder |
| `DMM_HELPER_DECRYPTION_ENGINE` | Preferred decryption engine (`SHAKA_PACKAGER` or `MP4DECRYPT`) | `SHAKA_PACKAGER` |
| `DMM_HELPER_SELECT_VIDEO` | Video stream filter for N_m3u8DL-RE | `best` (auto-select) |
| `DMM_HELPER_SELECT_AUDIO` | Audio stream filter for N_m3u8DL-RE | `best` (auto-select) |
| `DMM_HELPER_USER_AGENT` | Custom User-Agent header | Chrome UA |
| `DMM_HELPER_REFERER` | Custom Referer header | `https://www.dmm.co.jp/` |

## Technology Stack

- **Framework**: Electron 41
- **EME Interception**: Native JavaScript injection via webview preload
- **Download Engine**: N_m3u8DL-RE
- **Decryption**: mp4decrypt / shaka-packager
- **Build Tool**: electron-builder

## License

This project is licensed under the [MIT License](LICENSE).

## Disclaimer

1. This project is for **technical research and educational purposes** only.
2. Users must comply with local laws and the Terms of Service of the respective platforms.
3. The author does not provide any copyrighted content and is not responsible for any legal disputes resulting from the use of this tool.
