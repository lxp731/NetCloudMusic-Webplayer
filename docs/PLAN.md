# netcloud-music — 把 `music.163.com/st/webplayer` 包成真正的 Linux 桌面应用

> **实施状态（2026-10-22）**：P0 + P1 + P2 已完成并实测通过（仓库 `~/workspace/netcloud-music`）。
> 需求变更：**不使用系统通知**（P1 里的"切歌通知"已移除）；应用名统一为「网易云音乐」；
> 使用品牌图标（圆形裁切）并安装了 `.desktop` + hicolor 图标；空格键始终切换播放/暂停。
> **P2 已交付**：AppImage / deb / rpm / pacman 四格式（`tools/build-linux.sh` 一键构建，
> 构建工具自动下载到 `~/.cache/netcloud-music/pkg-tools`）+ AUR `netcloud-music-bin`（`aur/`）。
> 下方 P2–P5 尚未开始。实测结论与实现细节见仓库 `README.md` 与 `docs/findings.md`。

## 0. 结论与前提

网易云 PC 客户端本身就是「原生壳 + `st/webplayer` 这同一个 H5 + jsbridge」的三层结构（bundle 里
`audioplayer.* / app.* / storage.* / player.* / winhelper.*` 就是那套桥）。所以我们不重写业务，
只补「壳」：**Electron + 官方 webplayer + 自实现 MPRIS/托盘/媒体键/深链接**。

已实测（本机 electron42 v42.11.18）：

- `https://music.163.com/st/webplayer` 在 Electron 里正常渲染（标题/导航/侧栏全部出来）
- `libffmpeg.so` 含 H.264/AAC，`canPlayType` 全为 `probably` → MV/视频可用
- UA 伪装成 Chrome 后无 Electron 降级路径
- 官方 H5 走 `isWeb` 分支时用 HTML5 `<audio>`，无需 native 播放器

**约束（不可越过）**：不做去广告、不做 VIP/版权绕过、不下载付费内容、不伪装成官方客户端；
壳只提供 OS 集成能力。图标/名称使用自有素材，不套用网易云商标。

## 1. 目标产物

| 项 | 内容 |
|---|---|
| 包名 / 可执行 | `netcloud-music`，appId `io.github.lxp731.netcloudmusic` |
| 安装形态 | AppImage + deb + rpm + pacman(tar.zst) + Flatpak manifest + AUR PKGBUILD |
| 体积预期 | ~110 MB（Electron 42，可分架构） |
| 仓库位置 | `~/workspace/netcloud-music`（当前 `/tmp/netcloud-music` 只是 spike，/tmp 会清） |

## 2. 架构

```
src/
├── main/
│   ├── index.js          生命周期、单实例、协议注册、异常兜底
│   ├── window.js         BrowserWindow、窗口状态持久化、UA、zoom、frameless(可选)
│   ├── session.js        persist:netease 分区、代理、缓存、权限白名单
│   ├── tray.js           Tray + 动态菜单（当前曲目/播放暂停/上一首/下一首/显示/退出）
│   ├── mpris.js          org.mpris.MediaPlayer2(+Player) via dbus-next
│   ├── media.js          接收 preload 上报的媒体状态，广播给 MPRIS/tray/通知
│   ├── notify.js         切歌桌面通知（可关）
│   ├── menu.js           应用菜单 + 右键菜单（复制链接、重新加载、DevTools 隐藏项）
│   ├── protocol.js       orpheus:// netease:// music.163:// 深链接 → 页内路由
│   ├── updater.js        electron-updater（仅 AppImage 生效）
│   └── logger.js         本地日志（~/.local/state/netcloud-music/）
├── preload/
│   ├── index.js          contextBridge 暴露最小 API；webFrame 注入页面世界脚本
│   └── page-hook.js      在**页面世界**运行：劫持 navigator.mediaSession
│                         （metadata setter + setActionHandler + MediaMetadata）
│                         与 HTMLMediaElement.prototype.play/pause/timeupdate
│                         → 上报 {title,artist,album,artwork,duration,position,status}
└── renderer/
    ├── splash.html       本地启动页（logo + 进度）
    └── error.html        离线/加载失败 + 重试
```

### 2.1 MPRIS 数据来源（关键设计）

优先级：
1. **mediaSession 钩子**（首选）：H5 已注册 `navigator.mediaSession.setActionHandler`，
   说明它使用 MediaSession API；同时拦截 `MediaMetadata` 构造与 `mediaSession.metadata` 赋值，
   即可拿到 title/artist/album/artwork，`setActionHandler` 则直接把 Play/Pause/Next/Prev 反控回去。
2. **HTMLMediaElement 钩子**：`play/pause/ended/timeupdate` → PlaybackStatus + Position 近似值。
3. **兜底 DOM 探测**：`document.title` 与底部播放条文本（网易云 class 是哈希化的
   `BottomLeft_b1q046nr`，只作兜底，不做主要依赖）。

> 待验证（P1 第一个任务）：登录后确认 H5 是否真的写 `mediaSession.metadata`。
> 若没有，改为「hook `/weapi/song/enhance/player/url` 等 XHR + DOM 探测」方案，工作量 +0.5 天。

### 2.2 媒体键

KDE(Wayland) 与 GNOME 的媒体键都走 **MPRIS**，因此主路径是 MPRIS，不用 `globalShortcut`
（`globalShortcut` 在 Wayland 下不可靠，且全局抢占会干扰用户其他播放器）。
仅在用户显式开启「自定义快捷键」时才注册 `globalShortcut`，注册失败静默降级。

### 2.3 安全基线

`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；
页面世界注入只做 mediaSession 钩子（通过 `webFrame.executeJavaScript`，不暴露 node）。
所有外链走 `shell.openExternal` + 域名白名单；`will-navigate` 限制在 `*.music.163.com` /
`*.126.net` / 登录域名；禁止 `window.open` 弹新窗（改 internal 窗口）。

## 3. 分阶段交付

### P0 骨架（0.5 天）— 能跑起来
- `pnpm init` + electron 42（本机已有 `/usr/lib/electron42`，开发期可直接用）
- 主进程加载 webplayer，`persist:netease` 分区，UA 固定 Chrome 主线
- 扫码登录 → 播放一首 → 出第一张截图证据
- 验收：`electron .` 打开就是完整可用界面，重启保持登录

### P1 桌面集成（1–2 天）— 变成"桌面应用"
- MPRIS（先 metadata 探测，再实现）+ `playerctl -l` 能列出并控制
- Tray（播放/暂停/上一首/下一首/显示/退出），KDE 需 AppIndicator 兼容
- 单实例 + 关窗到托盘（可配）+ 窗口位置/尺寸/最大化持久化
- 切歌通知（Notification API，去重）
- 验收：KDE 媒体键/耳机按键能控制；关窗后托盘可见可恢复

### P2 打包与分发（1 天）
- electron-builder：AppImage / deb / rpm / pacman；`.desktop` 带 `StartupWMClass`
- Flatpak manifest（network + pulseaudio + wayland/x11 + dri）
- AUR `PKGBUILD`（`-bin` 型，指向 GitHub Release）
- electron-updater（仅 AppImage）
- 验收：干净环境 `--appimage-extract-and-run` 能起，deb 在容器里能装

### P3 体验补全（1–2 天）
- 本地启动页 / 离线页 / 加载失败重试 / 网络恢复自动 reload
- 深链接协议（浏览器点 `orpheus://song/xxx` 唤起并跳转）
- 设置面板（本地页面）：代理、关闭行为、通知开关、缩放、缓存清理、重新登录
- 日志与崩溃兜底（`render-process-gone`、`child-process-gone` 自动重载）

### P4 可选增强（各自独立，按需）
- 迷你播放器窗口（小窗 + 无边框 + always-on-top）
- 桌面歌词（透明置顶窗口，数据来源：mediaSession + 歌词接口）
- 自启 / 默认客户端（等价于 native 的 `app.setAutoRun` / `registerDefaultClient`）
- 全局快捷键自定义

### P5 实验（高风险，单独分支）
注入**半实现的 jsbridge** 让 H5 进"桌面端模式"（拿托盘/歌词/迷你条的原生入口）。
风险：H5 会期待 `storage.execsql`、`audioplayer.*` 等完整实现，半吊子会白屏。
默认**不做**，只在 P4 之后按需试探。

## 4. 已知风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 网易云改版 / 加 UA 或风控 | 页面功能降级/白屏 | URL 与 UA 可配置；`did-fail-load` 兜底页；版本嗅探后提示更新壳 |
| 未登录几乎无内容 | 首启体验差 | onboarding 一页引导扫码；登录态持久化 |
| Cookie 失效 / 多端登录限制 | 需要重登 | 设置里"重新登录"，一键清分区 |
| Electron 无 Widevine | 未来若上 DRM 内容会失败 | 明确提示不可用；不尝试绕过 |
| Wayland 下 `globalShortcut` 失效 | 自定义快捷键不生效 | 以 MPRIS 为主，快捷键注册失败静默 |
| 打包后 userData 路径变化 | 重复登录 | 固定 `app.setPath('userData')`，版本间迁移 |
| 媒体进度抖动 | MPRIS Position 跳变 | 本地插值 + 每次 timeupdate 校准 |
| 商标/协议 | 分发风险 | 自有名称与图标，README 声明非官方 |

## 5. 验收清单（v1.0）

- [ ] AppImage 双击启动，首次可扫码登录，能播放/切歌/音量
- [ ] `playerctl -l` 列出 `netcloud-music`，`playerctl play-pause/next/metadata` 全部生效
- [ ] KDE 键盘媒体键与耳机按键控制生效
- [ ] 托盘菜单完整；关窗到托盘可恢复；退出干净（无残留进程）
- [ ] 重启后窗口位置/尺寸/登录态/音量保持
- [ ] 离线启动显示本地错误页并可重试
- [ ] `systemd-run --user` 与 `.desktop` 启动一致（无环境变量依赖）
- [ ] deb/rpm/AppImage 三形态安装后可正常启动

## 6. 开发期验证命令（可复用）

```bash
# 开发运行（本机 electron42）
DISPLAY=:0 XAUTHORITY=/run/user/1000/xauth_* XDG_RUNTIME_DIR=/run/user/1000 \
  electron42 . --no-sandbox --disable-dev-shm-usage

# MPRIS 验证
busctl --user introspect netcloud.music /org/mpris/MediaPlayer2
playerctl -l && playerctl -p netcloud-music metadata

# 打包
pnpm build && ls dist/
```
