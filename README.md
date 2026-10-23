# 网易云音乐（Linux 桌面应用）

网易云音乐网页版（`music.163.com/st/webplayer`）的 Linux 桌面外壳。非官方项目；
应用名、窗口标题、托盘与 MPRIS 标识统一显示为「网易云音乐」，图标取自网络上的
网易云品牌图标（仅用于本地桌面识别）。

不是重写客户端，也不改任何业务逻辑：**Tauri 壳 + 官方网页版 + 自实现 MPRIS/托盘**。
和 Spotify 桌面端「CEF 壳 + 同一个 web UI + 原生桥」是同一种结构，只是我们用的是
Tauri（Rust + 系统 WebKitGTK），而不是 Electron（自带 Chromium）。

```
┌──────────────────────────────────────────────────────────────┐
│  native shell (Rust, Tauri v2)                                │
│   窗口/单实例/窗口状态   MPRIS2 (mpris-server/zbus)   Tray    │
│                     ▲             │                          │
│            media:state│            │shell:command (eval)       │
│                     │             ▼                          │
│  page-hook.js (页面世界)  ←→  bridge.js (Tauri IPC 适配)      │
│                     ▲                          │             │
│                     └── window.postMessage ─────┘             │
├──────────────────────────────────────────────────────────────┤
│  WebKitGTK 渲染： music.163.com/st/webplayer （官方线上资源）   │
└──────────────────────────────────────────────────────────────┘
```

## 状态

已完成并实测（KDE Plasma Wayland / webkit2gtk-4.1 2.54 / Tauri 2.12）：

- 打开即加载官方网页版，扫码登录，重启保持登录（WebKitGTK cookie store）
- **MPRIS2 全量接口**：`PlaybackStatus / Metadata（标题/艺人/专辑/封面/时长）/ Position / Volume`，
  方法 `PlayPause / Play / Pause / Next / Previous / Seek / SetPosition`，属性变化会发 `PropertiesChanged`
  → KDE/GNOME 的键盘媒体键、耳机按键、锁屏播放器、`playerctl` 全部可用
- 托盘图标 + 播放/暂停/上一首/下一首/显示/退出；关窗进托盘（无托盘时关窗即退出）
- 切歌**不发**系统通知（按需求关闭；MPRIS 元数据已包含曲目信息）
- 单实例；第二次启动会唤起已有窗口
- 窗口位置/尺寸/最大化持久化（逻辑像素，越界自动重置）
- 外部链接交给系统浏览器；`target="_blank"` 弹窗被拦截，站内导航限制在
  `*.163.com / *.126.net / *.qq.com` 等域名
- 空格键 = 播放/暂停（页面世界的 page-hook 实现，见下）

## 构建与分发

```bash
./tools/build-linux-tauri.sh              # deb + rpm + AppImage
./tools/build-linux-tauri.sh deb rpm      # 只出指定目标
./tools/build-pacman-tauri.sh             # pacman（PKGBUILD + makepkg）
```

产物在 `dist/`（统一带 `-tauri` 标记，区分于 Electron 版的 `-electron`）：

```
netcloud-music-0.1.0-tauri-amd64.deb
netcloud-music-0.1.0-tauri-x86_64.rpm
netcloud-music-0.1.0-tauri-amd64.AppImage
netcloud-music-0.1.0-tauri-x64.pacman
```

- deb/rpm 需要 `dpkg-deb` / `rpmbuild`；本机（Arch）没有时脚本会自动用 pacman 下载
  到 `~/.cache/netcloud-music/pkg-tools`（无需 root）。AppImage 的工具由 tauri bundler
  自动下载。pacman 走 `packaging/pacman/PKGBUILD`（Tauri bundler 不支持 pacman target）。
- Tauri CLI：`pnpm install` 后 `pnpm exec tauri build`，或直接用上面的脚本。

### 系统依赖

运行时依赖（deb/rpm/pacman 已声明）：

- `webkit2gtk-4.1` —— WebKit 渲染
- `gst-plugins-good` —— **必需**，提供 `autoaudiosink` 音频输出；缺失则播放失败
  并伴随 `GLib-GObject-CRITICAL`（Electron 无此问题因为 Chromium 自带音频栈）
- `gst-plugins-base-libs` / `gst-libav`（MP3/AAC/FLAC 解码）/ `gst-plugin-pipewire`（输出）
- `libayatana-appindicator` —— 托盘
- `gtk3`、`hicolor-icon-theme`、`xdg-utils`

开发/无 root 环境可用 `tools/setup-gst.sh` 把音频插件下载解压到用户目录，
`tools/dev-run-tauri.sh` 和程序启动逻辑会自动接上。

## 开发

```bash
pnpm install
./tools/dev-run-tauri.sh          # cargo build + 运行（自动处理音频插件）
NETCLOUD_VERBOSE=1 ./tools/dev-run-tauri.sh   # debug 级日志
```

日志：stderr（`NETCLOUD_VERBOSE=1` 打开 `[cmd]`/`[page]` 等 debug 级）。

## 空格键 = 播放/暂停

网页版自己**没有**全局播放快捷键：空格在主页是翻页。page-hook 把它改成桌面端手感：
焦点在程序内任意位置时空格切换播放/暂停（输入框、`contenteditable`、修饰键组合除外）。
开关在 `src-tauri/assets/page-hook.js` 的 `SPACE_TOGGLES_PLAYBACK` 常量。

## 它是怎么拿到播放状态的

官方网页版**没有**暴露播放状态 API，只有两条线索，两条都用上了：

1. `navigator.mediaSession.metadata` —— 站点每次切歌都会 `new MediaMetadata({...})`，
   page-hook 劫持 `MediaSession.prototype.metadata` 的 setter 拿到标题/艺人/专辑/封面。
2. `<audio>` 元素 —— 站点用 howler.js `html5: true` 播放，元素**不挂到 DOM 上**，
   page-hook 在 `Document.prototype.createElement` 和 `HTMLMediaElement.prototype.play`
   处捕获元素本体，直接绑事件拿 `status / position / duration / volume`。

控制方向（MPRIS → 页面）按可靠性降级：

1. 站点自己注册的 mediaSession action handler（网页版在 WebKitGTK 下会注册，直接调用）
2. `<audio>.play() / pause() / currentTime`
3. 点击播放条控件（`svg[aria-label="play"|"pause"|"next"|"pre"]`）
4. 失败以 `command-miss` 写进日志

页面 → 壳用 `window.postMessage` → bridge.js → Tauri IPC（`invoke`）；壳 → 页面用
`webview.eval()` 直接调 page-hook 暴露的 `window.__netcloudCommand`（WebKitGTK 的
`run_javascript` 发出的 postMessage 不派发 message 事件，故不用 postMessage 反向）。

## WebKitGTK 适配（chrome-spoof.js）

WebKitGTK 渲染网易云网页版需要三处适配，都在 `src-tauri/assets/chrome-spoof.js`（最先注入）：

1. **伪造 Chrome 身份**：`window.chrome` 缺失、`navigator.vendor="Apple Computer, Inc."`
   会暴露 WebKit 身份，站点嗅探走错误分支 → 补 `window.chrome` + `navigator.vendor` +
   `navigator.userAgentData`。
2. **polyfill `requestIdleCallback`**：Chromium 专有，WebKitGTK 没有。站点桌面音频引擎
   （rudio）调用它抛 ReferenceError → 初始化中断、React 不挂载（白屏）。用 setTimeout 实现。
3. 页面跳转登录页是正常行为（未登录时站点自己跳 `#/login`）。

## 边界

- **不做**去广告、不做 VIP/版权绕过、不下载付费内容，也不伪装成官方客户端；壳只负责系统集成。
- 没有 Widevine：网页版音乐是普通 MP3/FLAC 直链，不需要它。
- 音量：MPRIS 设音量直接改 `<audio>.volume`，站点自己的音量状态不知道；page-hook 会在
  切歌时重新套用最近一次 MPRIS 音量。
- 媒体键走 MPRIS 而不是全局快捷键（Wayland 下更可靠，也不会抢别的播放器）。

## 目录结构

```
src-tauri/                 Rust 壳
  src/                     window / media / mpris / tray / menu / command / config / logger
  assets/                  page-hook.js（页面世界） bridge.js（IPC 适配） chrome-spoof.js（适配） tray.png
  capabilities/            Tauri 2 ACL（远程 URL 的 IPC 授权）
frontend/                  本地错误页
build/                     图标 / tray.png / .desktop（共享资源）
packaging/pacman/          PKGBUILD
tools/                     dev-run-tauri / build-linux-tauri / build-pacman-tauri / setup-gst / rename-tauri-bundles
docs/                      计划与调查记录
```

## 回退 Electron 版

Electron 版完整保留在 `legacy/electron` 分支（tag `electron-v0.1.0-baseline`）：

```bash
git checkout legacy/electron     # 回到 Electron 版代码
```

## 相关文档

- `docs/PLAN.md` —— 计划与现状
- `docs/findings.md` —— 对网页版的逆向调查记录（为什么这么做可行）+ WebKitGTK 适配结论
