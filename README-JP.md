# DMM Download Helper

<p align="center">
<img src="public/logo-128.png" alt="Logo" width="128">
</p>

<p align="center">
  <strong>EME暗号化ストリームを自動キャプチャしDMM/FANZAの動画をダウンロードするデスクトップアプリ</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | 日本語 | <a href="README-CN.md">简体中文</a>
</p>

---

## 概要

**DMM Download Helper** はElectronベースのデスクトップアプリケーションです。内蔵ブラウザでDMM/FANZAを直接閲覧し、動画再生時の暗号化メディアストリーム（MPD + Widevineキー）を自動的にキャプチャし、[N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE)でダウンロードします。

> [!NOTE]
> 本プロジェクトは教育・研究目的のみです。関連法規を遵守してください。

## 機能

- **内蔵ブラウザ** — アプリ内で直接DMM/FANZAを閲覧可能。ブラウザ拡張機能のインストール不要。
- **自動EMEキャプチャ** — MPDマニフェストURLとWidevine/ClearKey復号キーをリアルタイムで傍受。
- **自動ダウンロード** — MPDとキーがキャプチャされ次第、自動的にダウンロードを開始。プレーヤーポップアップは自動的に閉じます。
- **統合復号** — mp4decryptまたはshaka-packagerで保護されたストリームを復号。
- **クロスプラットフォーム** — macOS (arm64) と Windows (x64) をサポート。

## ダウンロード

[Releases](https://github.com/ianho7/dmm-download-helper/releases)ページから最新版をダウンロード：

| プラットフォーム | ファイル |
| :--- | :--- |
| macOS (Apple Silicon) | `DMM Download Helper-x.x.x-arm64.dmg` |
| Windows (x64) | `DMM Download Helper x.x.x.exe`（ポータブル版） |

## 前提条件

使用前に以下のツールをインストールし、システムPATHに追加してください：

### 1. N_m3u8DL-RE（必須）

[N_m3u8DL-RE Releases](https://github.com/nilaoda/N_m3u8DL-RE/releases)からダウンロードし、PATHに配置。

### 2. 復号ツール（DRMコンテンツに必須）

以下の**いずれか**をインストール：

- [shaka-packager](https://github.com/shaka-project/shaka-packager/releases)（推奨）
- [mp4decrypt (Bento4)](https://www.bento4.com/downloads/)

### 3. プロキシ（必須）

DMMには地域制限（日本のみ）があります。DMMにアクセスできるプロキシが必要です：

```bash
DMM_HELPER_UPSTREAM_PROXY=http://127.0.0.1:7897 bun run desktop
```

または、システムで `HTTPS_PROXY` / `HTTP_PROXY` 環境変数を設定してください。

## 使い方

1. アプリを起動
2. 内蔵ブラウザでDMM/FANZAにアクセスしてログイン
3. 購入済みの動画ページに移動し、再生をクリック
4. 動画がポップアップで開く — アプリが自動的にEMEデータをキャプチャ
5. MPD + キーがキャプチャされ次第、自動的にダウンロード開始、ポップアップが閉じる
6. ダウンロード完了を待つ — MP4ファイルとしてダウンロードフォルダに保存

## ソースからビルド

```bash
# 依存関係をインストール
bun install

# 開発モードで実行
DMM_HELPER_UPSTREAM_PROXY=http://127.0.0.1:7897 bun run desktop

# パッケージビルド
bun run desktop:build:mac   # macOS DMG + ZIP
bun run desktop:build:win   # Windows ポータブル + ZIP
bun run desktop:build       # 全プラットフォーム
```

## 環境変数

| 変数 | 説明 | デフォルト |
| :--- | :--- | :--- |
| `DMM_HELPER_UPSTREAM_PROXY` | DMMアクセス用プロキシ | — |
| `DL_BIN` | N_m3u8DL-REバイナリのパス | `N_m3u8DL-RE`（PATHから検索） |
| `DOWNLOAD_DIR` | ダウンロード出力ディレクトリ | システムのダウンロードフォルダ |
| `DMM_HELPER_DECRYPTION_ENGINE` | 復号エンジン（`SHAKA_PACKAGER` または `MP4DECRYPT`） | `SHAKA_PACKAGER` |
| `DMM_HELPER_SELECT_VIDEO` | N_m3u8DL-RE 映像ストリームフィルタ | `best`（自動選択） |
| `DMM_HELPER_SELECT_AUDIO` | N_m3u8DL-RE 音声ストリームフィルタ | `best`（自動選択） |

## 技術スタック

- **フレームワーク**: Electron 41
- **EMEインターセプト**: webview preload経由のネイティブJavaScriptインジェクション
- **ダウンロードエンジン**: N_m3u8DL-RE
- **復号**: mp4decrypt / shaka-packager
- **ビルドツール**: electron-builder

## ライセンス

本プロジェクトは [MIT License](LICENSE) の下で公開されています。

## 免責事項

1. 本プロジェクトは**技術研究・教育目的**のみです。
2. 利用者は現地の法律および関連プラットフォームの利用規約を遵守する必要があります。
3. 著者は著作権で保護されたコンテンツを提供せず、本ツールの使用に起因する法的紛争について責任を負いません。
