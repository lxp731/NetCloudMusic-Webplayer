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
│            media:state│            │shell:command             │
│                     │             ▼                          │
│  page-hook.js (页面世界)  ←→  bridge.js (Tauri IPC 适配)      │
├──────────────────────────────────────────────────────────────┤
│  WebKitGTK 渲染： music.163.com/st/webplayer （官方线上资源）   │
└──────────────────────────────────────────────────────────────┘
```

## 状态

已完成并实测（KDE Plasma Wayland / webkit2gtk-4.1 2.54 / Tauri 2.12）：

- 打开即加载官方网页版，扫码登录，重启保持登录
- **MPRIS2 全量接口**（PlaybackStatus / Metadata / Position / Volume / Seek / SetPosition）
  → KDE/GNOME 键盘媒体键、耳机按键、锁屏播放器、`playerctl` 全部可用
- 托盘（播放/暂停/上一首/下一首/显示/退出）；关窗进托盘
- 单实例、窗口状态持久化、空格键播放/暂停
- 外部链接交系统浏览器；站内导航限制在 `*.163.com` 等域名；`target=_blank` 弹窗已拦截
- 切歌**不发**系统通知（按需求关闭）

## 构建与分发

```bash
./tools/build-linux-tauri.sh              # deb + rpm + AppImage
./tools/build-linux-tauri.sh deb rpm      # 只出指定目标
./tools/build-pacman-tauri.sh             # pacman（PKGBUILD + makepkg）
```

产物在 `dist/`：

```
netcloud-music-0.1.0-amd64.deb
netcloud-music-0.1.0-x86_64.rpm
netcloud-music-0.1.0-amd64.AppImage
netcloud-music-0.1.0-x64.pacman
```

deb/rpm 构建工具（dpkg-deb/rpmbuild）缺失时脚本会自动用 pacman 下载（无需 root）。

### 系统依赖

运行时需要（deb/rpm/pacman 已声明）：`webkit2gtk-4.1`、`gst-plugins-good`（音频输出，
**必需**）、`gst-libav`（解码）、`gst-plugin-pipewire`、`libayatana-appindicator`、`gtk3`。
无 root 环境可用 `tools/setup-gst.sh` 兜底。

## 开发

```bash
pnpm install
./tools/dev-run-tauri.sh              # cargo build + 运行（自动处理音频插件）
NETCLOUD_VERBOSE=1 ./tools/dev-run-tauri.sh   # debug 级日志
```

## 边界

- **不做**去广告、VIP/版权绕过、不下载付费内容、不伪装成官方客户端。
- 没有 Widevine（网页版音乐是普通 MP3/FLAC 直链，不需要）。
- 媒体键走 MPRIS 而不是全局快捷键（Wayland 下更可靠，不抢别的播放器）。

## 回退 Electron

Electron 版完整保留在 `legacy/electron` 分支（tag `electron-v0.1.0-baseline`）：

```bash
git checkout legacy/electron
```

## 文档

- `AGENTS.md` —— 开发技术手册（架构、页面通信、WebKitGTK 坑、诊断手段、目录结构）
- `docs/PLAN.md` —— 计划与现状
- `docs/findings.md` —— 对网页版的逆向调查记录
