<p align="center">
	<img src="https://i.stack.imgur.com/TOfqL.png" height="120px"/>
	<h1 align="center">Xtreme Download Manager — Enhanced Edition</h1>
</p>

<p align="center">
	<strong>Free, open-source, IDM-level YouTube download experience</strong>
</p>

<p align="center">
	<a href="https://github.com/jinran3/xdm-Enhanced/releases"><img src="https://img.shields.io/github/v/release/jinran3/xdm-Enhanced?color=red&label=release" alt="Release"/></a>
	<a href="https://github.com/jinran3/xdm-Enhanced/releases"><img src="https://img.shields.io/github/downloads/jinran3/xdm-Enhanced/total?color=blue" alt="Downloads"/></a>
	<a href="LICENSE"><img src="https://img.shields.io/badge/license-OSS-lightgrey" alt="License"/></a>
</p>

---

**Xtreme Download Manager (XDM)** is an open-source alternative to commercial download managers. This repository is an **enhanced fork** built on top of the [official XDM project](https://github.com/subhra74/xdm), focused on bringing the modern YouTube download experience up to — and beyond — the level of IDM (Internet Download Manager).

> **Core value:** Free YouTube 4K download, no subscription, no feature-gating. Just install and go.

---

## 🎯 Why This Fork Exists

IDM is a great tool, but its YouTube functionality is becoming increasingly restricted — protocol changes break downloads, 4K support gets gated behind paid features, and users are forced to keep paying for what should be a basic download capability.

This project solves that with a **zero-cost, fully verifiable** alternative:

- ✅ **YouTube 4K (2160p) real download** — files land on disk, verified with `ffprobe`
- ✅ **IDM-style floating panel** — click the button, pick a resolution, done
- ✅ **No breaking changes to XDM** — plug-in architecture, core untouched
- ✅ **Open source & verifiable** — you can read every line of code

---

## ✨ What's New in This Fork

### 🎬 IDM-Level YouTube Download

| Feature | Description |
|---|---|
| **Instant floating panel** | Click the in-page button → quality list renders immediately from the player, swaps in backend data on reply. No more long waits. |
| **Two-level format → quality panel** | Pick a video codec (H.264 / VP9 / AV1 / H.265) first, then the exact resolution you want. |
| **4K / up to 2160p** | Codec name and container extension shown directly in the list. |
| **Playlist download-all** | One click queues every video in a YouTube playlist through XDM. |

### 🔊 Multi-Audio-Track Selection

When a video ships with multiple audio tracks, the floating panel shows a track picker so you download the **correct language** (e.g. the Mandarin track instead of the English default).

### 📝 Subtitle Download

Rich subtitle language list (including **auto captions**), with a picker between **SRT** and **VTT** formats. Subtitle jobs go through the same download queue as media — you get progress and history, not a silent file drop.

### 🎨 YouTube Red Theme + Client/Extension Sync

An optional **YouTube red** theme, switchable from the client settings. The browser-extension floating panel **inherits the client's theme automatically** — choose once, both desktop app and widget stay in sync.

### 🖱️ Polished Extension Interactions

- Scroll wheel steers long lists **inside** the floating panel (subtitles, audio tracks, resolutions) instead of leaking to the page underneath.
- Per-tab monitoring toggle with action-icon state.
- Draggable, player-anchored floating button with persistent seat across visits.

### 🛡️ Reliability & Bug Fixes

- Fixed start-up crash when IPC port 8597 was stuck in `CLOSE_WAIT` from a force-killed instance.
- "Delete local file" action now reliably removes the file from disk.
- Hard-coded accent colors replaced with theme brushes for consistent theming.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────┐
│                   YouTube Page                       │
│                                                      │
│  ┌──────────────┐   chrome.runtime   ┌────────────┐ │
│  │  float.js     │ ──────────────────▶│  app.js    │ │
│  │ (content)     │   sendMessage()    │ (service   │ │
│  │ 悬浮面板      │                    │  worker)   │ │
│  └──────────────┘                    └─────┬──────┘ │
│                                            │        │
│                                    fetch() │        │
└────────────────────────────────────────────┼────────┘
                                             │
                                    HTTP POST │
                                    127.0.0.1:8597
                                             │
┌────────────────────────────────────────────┼────────┐
│               XDM Desktop App              │        │
│                                            ▼        │
│  ┌──────────────────────────────────────────────┐   │
│  │  IpcHttpMessageProcessor                    │   │
│  │  case "/youtube": OnYoutubeMessage()        │   │
│  └──────────────────────┬───────────────────────┘   │
│                         │                           │
│                         ▼                           │
│  ┌──────────────────────────────────────────────┐   │
│  │  YouTubeDownloadService                      │   │
│  │  ├─ List()  → yt-dlp -J → qualities[]       │   │
│  │  ├─ Download() → StartDownload() → 落盘     │   │
│  │  └─ Fetch()  → yt-dlp 解析 + 内存缓存       │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  下载文件 → 你的下载目录                              │
└──────────────────────────────────────────────────────┘
```

### Key Components

| Component | Path | Role |
|---|---|---|
| `YouTubeDownloadService.cs` | `XDM.Core/` | Core service: list qualities, download, yt-dlp parsing |
| `IpcHttpMessageProcessor.cs` | `XDM.Core/BrowserMonitoring/` | HTTP endpoint `/youtube` with CORS preflight |
| `float.js` | `chrome-extension/` | Floating button + dark quality panel (content script) |
| `youtube.js` | `chrome-extension/` | `YoutubeBridge` — fetch to `127.0.0.1:8597/youtube` |
| `app.js` | `chrome-extension/` | Service worker: routes `youtube-list` / `youtube-grab-dl` messages |
| `manifest.json` | `chrome-extension/` | MV3, `service_worker: main.js`, `host_permissions: ["*://*/*"]` |

---

## 📊 Verification Status (Honest)

We take testing seriously. Here's exactly what's been verified and what hasn't.

| Test | Status | Notes |
|---|---|---|
| Backend `/youtube` list + real 4K download | ✅ **Verified** | Real network, real yt-dlp, files on disk |
| Extension injects + 2160p option appears | ✅ **Verified** | Real Chromium browser |
| Build + offline core E2E (fake yt-dlp) | ✅ **Verified** | Verified offline (fake yt-dlp) |
| Panel UI E2E (real clicks, mock bridge) | ✅ **Verified** | Headed UI E2E (mock bridge) |
| Real YouTube backend E2E | ✅ **Verified** | Direct HTTP, real network |
| **Real extension + real click → 4K download** | ⚠️ **In Progress** | Code works; human-pointer verification closing |

> **What this means:** The backend, extension, and download pipeline are all proven with real data. The final "real browser → real click → real download" E2E chain is code-complete; the last end-to-end verification is being finalized. We're not hiding this — we're publishing it so you can judge for yourself.

---

## 📦 Installation

### Option 1: Download Release

Download the latest release from the [Releases](https://github.com/jinran3/xdm-Enhanced/releases) page.

- **Windows:** Install the `.msi` (or portable `.zip`), follow the on-screen browser-integration wizard.
- **Browser extension:** Monitors Chromium-based browsers (Chrome / Edge / Opera / Vivaldi / Brave) and Firefox.

### Option 2: Build from Source

**Prerequisites:**
- .NET Framework 4.7.2 developer pack
- Visual Studio 2019/2022 (or .NET SDK with `net472` targeting pack)
- `yt-dlp` (bundled in portable build, or install separately)

```powershell
# Build
dotnet build app/XDM/XDM.Wpf.UI/XDM.Wpf.UI.csproj -c Release
```

### Quick Start

1. Run `xdm-app.exe` (starts listening on `127.0.0.1:8597`)
2. Load the `chrome-extension/` as unpacked extension in your browser
3. Navigate to any YouTube video
4. Click the floating **"下载视频"** button → select resolution → download

---

## 🗂 Repository Layout

```
app/
  XDM/
    XDM.Core/               # Shared download engine, YouTubeDownloadService
    XDM.Wpf.UI/            # Windows desktop UI (WPF)
    XDM.Gtk.UI/            # Linux desktop UI (GTK)
    chrome-extension/       # Browser extension (MV3)
    Lang/                   # UI language resources
    Translations/
```

---

## 📄 License

This fork is distributed under an open-source license compatible with the upstream XDM project. See the [LICENSE](LICENSE) file for details. All credits for the original download engine, media parsers, and browser integration go to the [upstream XDM authors](https://github.com/subhra74/xdm).

---

## ❤️ Contributing

Feedback, bug reports, and improvements are welcome. Open an issue for anything that behaves unexpectedly, or submit a pull request.

**Development rules:**
- Commit messages in English, documentation in Chinese
- Each feature gets its own branch and commit
- Never fabricate test results — if it doesn't pass, say so
- Never delete user files — only clean up test artifacts