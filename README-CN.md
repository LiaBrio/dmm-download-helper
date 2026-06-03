# DMM Download Helper

<p align="center">
<img src="public/logo-128.png" alt="Logo" width="128">
</p>

<p align="center">
  <strong>一款自动捕获 EME 加密流并下载 DMM/FANZA 视频的桌面应用</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README-JP.md">日本語</a> | 简体中文
</p>

---

## 项目简介

**DMM Download Helper** 是一款基于 Electron 的桌面应用，内置浏览器直接浏览 DMM/FANZA，自动捕获视频播放时的加密媒体流（MPD + Widevine 密钥），并使用 [N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE) 进行下载。

> [!NOTE]
> 本项目仅供学习和研究用途，请遵守相关法律法规。

## 功能特性

- **内置浏览器** — 直接在应用中浏览 DMM/FANZA，无需安装浏览器扩展。
- **自动 EME 捕获** — 实时拦截 MPD 清单 URL 和 Widevine/ClearKey 解密密钥。
- **自动下载** — 捕获到 MPD 和密钥后自动开始下载，播放弹窗自动关闭。
- **集成解密** — 使用 mp4decrypt 或 shaka-packager 解密受保护的流媒体。
- **跨平台** — 支持 macOS (arm64) 和 Windows (x64)。

## 下载安装

从 [Releases](https://github.com/ianho7/dmm-download-helper/releases) 页面下载最新版本：

| 平台 | 文件 |
| :--- | :--- |
| macOS (Apple Silicon) | `DMM Download Helper-x.x.x-arm64.dmg` |
| Windows (x64) | `DMM Download Helper x.x.x.exe`（便携版） |

## 前置要求

使用前需安装以下工具并添加到系统 PATH：

### 1. N_m3u8DL-RE（必需）

从 [N_m3u8DL-RE Releases](https://github.com/nilaoda/N_m3u8DL-RE/releases) 下载，放到 PATH 目录中。

### 2. 解密工具（DRM 内容必需）

安装以下**任一**工具：

- [shaka-packager](https://github.com/shaka-project/shaka-packager/releases)（推荐）
- [mp4decrypt (Bento4)](https://www.bento4.com/downloads/)

### 3. 代理（必需）

DMM 有地域限制（仅限日本），需要能访问 DMM 的代理。启动时设置上游代理：

```bash
DMM_HELPER_UPSTREAM_PROXY=http://127.0.0.1:7897 bun run desktop
```

或在系统中设置 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量。

## 使用方法

1. 启动应用
2. 在内置浏览器中访问 DMM/FANZA 并登录
3. 进入已购买的视频页面，点击播放
4. 视频在弹窗中打开 — 应用自动捕获 EME 数据
5. 捕获到 MPD + 密钥后，自动开始下载并关闭弹窗
6. 等待下载完成 — 输出为 MP4 文件，保存在下载目录中

## 从源码构建

```bash
# 安装依赖
bun install

# 开发模式运行
DMM_HELPER_UPSTREAM_PROXY=http://127.0.0.1:7897 bun run desktop

# 打包
bun run desktop:build:mac   # macOS DMG + ZIP
bun run desktop:build:win   # Windows 便携版 + ZIP
bun run desktop:build       # 全平台
```

## 环境变量

| 变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `DMM_HELPER_UPSTREAM_PROXY` | DMM 访问代理 | — |
| `DL_BIN` | N_m3u8DL-RE 二进制文件路径 | `N_m3u8DL-RE`（从 PATH 查找） |
| `DOWNLOAD_DIR` | 下载输出目录 | 系统下载目录 |
| `DMM_HELPER_DECRYPTION_ENGINE` | 解密引擎偏好（`SHAKA_PACKAGER` 或 `MP4DECRYPT`） | `SHAKA_PACKAGER` |
| `DMM_HELPER_SELECT_VIDEO` | N_m3u8DL-RE 视频流筛选器 | `best`（自动选择） |
| `DMM_HELPER_SELECT_AUDIO` | N_m3u8DL-RE 音频流筛选器 | `best`（自动选择） |

## 技术栈

- **框架**: Electron 41
- **EME 拦截**: 通过 webview preload 注入原生 JavaScript
- **下载引擎**: N_m3u8DL-RE
- **解密**: mp4decrypt / shaka-packager
- **构建工具**: electron-builder

## 开源协议

本项目使用 [MIT License](LICENSE) 许可。

## 免责声明

1. 本项目仅供**技术研究和教育**用途。
2. 使用者必须遵守当地法律和相关平台的服务条款。
3. 作者不提供任何受版权保护的内容，不对因使用本工具产生的任何法律纠纷承担责任。
