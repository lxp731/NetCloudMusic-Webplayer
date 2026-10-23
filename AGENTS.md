# AGENTS.md — 开发指南（面向 AI 编码代理 / 维护者）

本文件是给 AI agent 和后续维护者的技术手册，聚焦「怎么改、坑在哪、怎么验证」。
面向人类用户的简介见 `README.md`。

## 项目概述

网易云音乐网页版（`music.163.com/st/webplayer`）的 Linux 桌面外壳。**不重写业务逻辑**，
只补「壳」：Tauri v2（Rust + 系统 WebKitGTK）+ 官方网页版 + 自实现 MPRIS/托盘/媒体键。

Electron 版已迁移到 Tauri，Electron 代码完整保留在 `legacy/electron` 分支
（tag `electron-v0.1.0-baseline`，另有 `~/backups/` tar）。回退 = `git checkout legacy/electron`。

## 技术栈

- **壳**：Rust（edition 2021），Tauri 2.12，webkit2gtk-4.1 2.54
- **MPRIS**：`mpris-server` 0.10（features=`tokio`）+ `zbus` 5
- **托盘**：tauri 内置 `TrayIconBuilder`（Linux 走 libayatana-appindicator）
- **单实例**：`tauri-plugin-single-instance`
- **日志**：`log` + `env_logger`（stderr，`NETCLOUD_VERBOSE=1` 开 debug）
- **前端**：无本地前端构建；webview 直接加载远程 `music.163.com/st/webplayer`，
  `frontend/index.html` 只是本地错误页

## 架构与数据流

```
Rust 壳 (src-tauri/src/*)
  window.rs   窗口/导航限制/新窗口拦截/窗口状态
  media.rs    MediaStore：媒体状态单一来源（position 本地外推）
  mpris.rs    MPRIS2 服务（mpris-server）
  tray.rs     托盘 + 动态菜单
  menu.rs     应用菜单栏
  command.rs  Command 类型 + 下发到页面
  lib.rs      生命周期、命令注册、audio 插件兜底、菜单事件

页面世界 (src-tauri/assets/*，作为 initialization_script 注入，早于站点 bundle)
  chrome-spoof.js  伪造 Chrome + polyfill（必须先于 page-hook/bridge 注入）
  page-hook.js     劫持 mediaSession/audio、空格键、执行命令
  bridge.js        页面 → 壳：postMessage → Tauri IPC
```

**通信方向**：

- **页面 → 壳**：page-hook 用 `window.postMessage({__netcloud:true, kind, payload}, '*')`
  → bridge.js 监听 message → `window.__TAURI__.core.invoke('media_state'|'page_event'|'page_probe', ...)`
  → Rust `#[tauri::command]`。
- **壳 → 页面**：`webview.eval("(window.__netcloudCommand || ...)(<json>)")` 直接调
  page-hook 暴露的 `window.__netcloudCommand`。

⚠️ **不要用 postMessage 做壳→页面方向**：WebKitGTK 的 `run_javascript` 里发
`window.postMessage` 不会派发 message 事件给页面世界的监听器（实测）。这是 WebKitGTK
与 Chromium 的关键差异。

## 页面 hook 的实现细节（page-hook.js）

播放状态只有两条可信来源（`docs/findings.md` 有完整逆向记录）：

1. `navigator.mediaSession.metadata` —— 劫持 `MediaSession.prototype.metadata` 的 setter。
2. `<audio>` 元素 —— howler.js `html5:true`，元素**不挂 DOM**；在
   `Document.prototype.createElement` 和 `HTMLMediaElement.prototype.play` 处捕获。

控制方向（MPRIS → 页面）降级顺序：
1. 站点注册的 mediaSession action handler（网页版在 WebKitGTK 下会注册 play/pause/next/prev）
2. `el.play()/pause()/currentTime`
3. 点击播放条控件（`svg[aria-label="play"|"pause"|"next"|"pre"]`，优先底部固定条）
4. 失败记 `command-miss` 日志

空格键 = 播放/暂停（输入框/contenteditable/修饰键除外），开关在 page-hook.js 的
`SPACE_TOGGLES_PLAYBACK`。

## WebKitGTK 适配（重要坑，改动前必读）

见 `src-tauri/assets/chrome-spoof.js` 与 `docs/findings.md` 第 4 节。核心：

| 坑 | 根因 | 处理 |
|---|---|---|
| 页面白屏 | WebKitGTK 缺 `requestIdleCallback`（Chromium 专有），站点音频引擎 rudio 抛 ReferenceError → React 不挂载 | chrome-spoof.js polyfill（setTimeout） |
| 站点嗅探走错分支 | `window.chrome` 缺失、`navigator.vendor="Apple Computer, Inc."` | chrome-spoof.js 补 `window.chrome` + vendor + userAgentData |
| 播放失败 + `GLib-GObject-CRITICAL` | 缺 `autoaudiosink`（gst-plugins-good） | 系统装包，或 `tools/setup-gst.sh` 本地插件 + `GST_PLUGIN_PATH`；`lib.rs::ensure_audio_plugins()` 启动时兜底 |
| 远程 URL 调 IPC 被拒 `Plugin not found` | Tauri 2 默认拒远程 invoke | `build.rs` 用 `AppManifest::commands` 注册 + `capabilities/default.json` 的 `remote.urls` |
| about:blank 弹窗 | Tauri 默认 Allow 新窗口 | `on_new_window` 拦截：同站导航主窗口，外链交 xdg-open |
| 窗口比屏幕大 | Resized/Moved 给物理像素，被当逻辑像素恢复 | 保存时 `to_logical(scale_factor)` + 加载时越界重置 |

## Tauri 2 配置要点

- **远程 URL + IPC**：自定义 command 必须在 `src-tauri/build.rs` 用
  `tauri_build::AppManifest::new().commands(&["media_state","page_event","page_probe","shell_retry","shell_info"])`
  注册（生成 `allow-*` 权限），并在 `capabilities/default.json` 的 `permissions` 引用、
  `remote.urls` 列出允许域名。漏了会报 `not allowed. Plugin not found`。
- **`withGlobalTauri: true`**（`app` 下）让页面世界能访问 `window.__TAURI__`。
- **`app.security.csp: null`**：远程页面有自己的 CSP，不注入默认 CSP。
- **窗口手动创建**（`app.windows: []`）：`WebviewWindowBuilder` 在 setup 里建，因为
  initialization_script 必须在 webview 创建时注入（conf 声明窗口则太晚）。
- **`bundle.category`**：Tauri 枚举无 `AudioVideo`，用 `Music`（映射 freedesktop
  `AudioVideo;Audio;Music`）。用 `AudioVideo` 会报 `invalid category`。
- **产物命名**：Tauri bundler 不支持自定义 artifactName，产物名固定
  `netcloud-music_<ver>_<arch>.{deb,AppImage}` / `netcloud-music-<ver>-<release>.<arch>.rpm`。
  `tools/rename-tauri-bundles.sh` 统一重命名为 `netmusic-webplayer-<ver>-<arch>.<ext>`。
- **AUR（Arch）**：pacman 包不在本仓库构建，由独立的 AUR 包
  `netmusic-webplayer-bin`（仓库 ~/workspace/aur-netmusic-webplayer）提供，其 PKGBUILD
  从 GitHub Release 下载 deb 包再解包安装。

## 系统依赖

运行时必需（deb/rpm 已声明，AUR 的 PKGBUILD 也声明）：
`webkit2gtk-4.1`（渲染）、`gst-plugins-good`（**autoaudiosink**，缺了播不了）、
`gst-plugins-base-libs` + `gst-libav`（MP3/AAC/FLAC 解码）+ `gst-plugin-pipewire`（输出）、
`libayatana-appindicator`（托盘）、`gtk3`、`hicolor-icon-theme`、`xdg-utils`。

无 root 兜底：`tools/setup-gst.sh` 用 `pacman -Sp` + curl 下载插件解包到
`~/.local/share/netcloud-music/gst-plugins`，运行时设 `GST_PLUGIN_PATH`。

## 构建与打包

```bash
./tools/dev-run-tauri.sh              # dev：cargo build + 运行（自动处理音频插件）
./tools/build-linux-tauri.sh          # deb + rpm + AppImage（自动下载 dpkg-deb/rpmbuild）
./tools/build-linux-tauri.sh deb rpm  # 指定目标
```

产物在 `dist/` 和 `src-tauri/target/release/bundle/`，统一命名：
`netmusic-webplayer-<ver>-{amd64,x86_64}.{deb,rpm,AppImage}`。

版本号唯一来源：`src-tauri/Cargo.toml` 的 `version`（tauri.conf.json 和 CI 都从这读）。

## 诊断手段

- **日志**：stderr。`NETCLOUD_VERBOSE=1` 看 `[cmd]`/`[page]`/`[media]` debug 级。
- **页面状态拉取**：WebKitGTK 的 JS console 不暴露。用
  `webview.eval_with_callback(js, |r| log::info!(...))` 把 `JSON.stringify(...)` 的页面
  状态（`innerText` 长度、`#root` 内容）拉回 Rust 日志。
- **前端错误捕获**：bridge.js 里 `window.addEventListener('error'/'unhandledrejection')`
  已把错误收进 `window.__netcloudErrors`，可用 eval_with_callback 读回。定位白屏/前端
  崩溃时先看这个。
- **MPRIS 验证**：`busctl --user status org.mpris.MediaPlayer2.netcloud_music`；
  调方法 `busctl --user call ... org.mpris.MediaPlayer2.Player PlayPause`。
- **本地音频隔离测试**：`NETCLOUD_URL=http://127.0.0.1:PORT/test.html` 指向最小
  `<audio>` 页可区分「WebKitGTK 播放问题」vs「站点 JS 问题」；但 localhost 不在
  `is_allowed_url` 白名单，测试时需临时放行 `config.rs`（on_navigation 会拦初始 URL）。

## 目录结构

```
src-tauri/          Rust 壳（src/ + assets/ + capabilities/ + icons/ + tauri.conf.json）
frontend/index.html 本地错误页
tools/              dev-run-tauri / build-linux-tauri / setup-gst / rename-tauri-bundles
docs/               PLAN.md（现状+路线）+ findings.md（逆向+坑）
```

## 约定与边界

- **不可越过**：不做去广告、VIP/版权绕过、不下载付费内容、不伪装成官方客户端。
- 应用标识统一：窗口标题/托盘/MPRIS Identity = 「网易云音乐」；`WM_CLASS`/app_id =
  `netcloud-music`；MPRIS bus 名 = `org.mpris.MediaPlayer2.netcloud_music`。
- 资源（page-hook.js/bridge.js/chrome-spoof.js/tray.png）用 `include_str!`/`include_bytes!`
  编译进二进制，改这些文件需 `cargo build` 才生效（cargo 会跟踪 include 的文件变化）。
- 图标源在 `src-tauri/icons/`；AUR 仓库（~/workspace/aur-netmusic-webplayer）有自己的图标副本。
- 登录态存在 WebKitGTK 的 cookie store（`~/.local/share/io.github.lxp731.netcloudmusic`），
  与 Electron 的 Chromium store 不通用，换引擎需重新扫码一次。

## 回退 Electron

```bash
git checkout legacy/electron        # 完整 Electron 版（含 src/、electron-builder.yml 等）
# 或 tag electron-v0.1.0-baseline / ~/backups/netcloud-music-electron-*.tar.gz
```
