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

产物（4 种格式）：

```
netmusic-webplayer-0.1.0-amd64.deb
netmusic-webplayer-0.1.0-x86_64.rpm
netmusic-webplayer-0.1.0-amd64.AppImage
netmusic-webplayer-0.1.0-x64.pacman
```

安装预编译包时，运行时依赖（webkit2gtk、gst-plugins-good 等）由包管理器自动解析，
**无需手动装**。下面按发行版说明「安装预编译包 / 从源码构建 / 安装依赖」三条路。

### Arch Linux

```bash
# 安装（依赖自动解决）
sudo pacman -U netmusic-webplayer-<ver>-x64.pacman

# 从源码构建：先装构建依赖
sudo pacman -S --needed rust base-devel nodejs pnpm \
  webkit2gtk-4.1 libayatana-appindicator \
  gst-plugins-good gst-plugins-base-libs gst-libav gst-plugin-pipewire

# 构建 pacman 包（makepkg）
./tools/build-pacman-tauri.sh
# 或构建 deb/rpm/AppImage（脚本会自动下载 dpkg/rpm 工具）
./tools/build-linux-tauri.sh
```

### Debian / Ubuntu

```bash
# 安装（依赖自动解决）
sudo apt install ./netmusic-webplayer-<ver>-amd64.deb

# 从源码构建：先装构建依赖
sudo apt install -y \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  build-essential curl wget file libssl-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-base gstreamer1.0-libav gstreamer1.0-pipewire \
  rpm libarchive-tools
# 另需 rust（rustup）与 nodejs/pnpm

# 构建 deb/rpm/AppImage
./tools/build-linux-tauri.sh
```

### Fedora / RHEL

```bash
# 安装（依赖自动解决）
sudo dnf install ./netmusic-webplayer-<ver>-x86_64.rpm

# 从源码构建：先装构建依赖
sudo dnf install -y \
  webkit2gtk4.1-devel libayatana-appindicator-devel librsvg2-devel \
  gcc gcc-c++ curl wget file openssl-devel \
  gstreamer1-plugins-good gstreamer1-plugins-base gstreamer1-libav gstreamer1-plugin-pipewire \
  rpm-build
# 另需 rust 与 nodejs/pnpm

# 构建 deb/rpm/AppImage
./tools/build-linux-tauri.sh
```

### 其他发行版（AppImage）

AppImage 自包含运行时，无需安装：

```bash
chmod +x netmusic-webplayer-<ver>-amd64.AppImage
./netmusic-webplayer-<ver>-amd64.AppImage
```

### 从源码构建（所有发行版通用）

装好上面的构建依赖后：

```bash
pnpm install
./tools/build-linux-tauri.sh              # deb + rpm + AppImage
./tools/build-linux-tauri.sh deb rpm      # 只出指定目标
./tools/build-pacman-tauri.sh             # pacman（仅 Arch，需 makepkg）
```

无 root 环境（容器/CI 之外）的音频插件可用 `tools/setup-gst.sh` 下载解包到用户目录兜底。

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
