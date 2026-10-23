# netcloud-music — 计划与现状

> **实施状态（2026-10-23）**：Tauri 迁移完成并实测通过（仓库 `~/workspace/netcloud-music`，
> `feature/tauri` 分支）。Electron 版完整保留在 `legacy/electron` 分支 / tag
> `electron-v0.1.0-baseline` / `~/backups/` tar。四种分发包（deb/rpm/AppImage/pacman）全部
> 可构建，产物名带 `-tauri` 标记。

## 0. 结论与前提

网易云 PC 客户端本身就是「原生壳 + `st/webplayer` 这同一个 H5 + jsbridge」的三层结构。
所以我们不重写业务，只补「壳」：**Tauri（Rust + WebKitGTK）+ 官方 webplayer + 自实现
MPRIS/托盘/媒体键**。

壳的选择：Electron → Tauri。Electron 自带 Chromium（磁盘 ~180MB、内存 ~400-500MB），
Tauri 用系统 WebKitGTK（二进制 6.4MB、内存 ~336MB），代价是要适配 WebKitGTK 与
Chromium 的差异（见下）。

**约束（不可越过）**：不做去广告、不做 VIP/版权绕过、不下载付费内容、不伪装成官方客户端；
壳只提供 OS 集成能力。图标/名称使用自有素材，不套用网易云商标。

## 1. 架构

```
src-tauri/
├── src/
│   ├── lib.rs            生命周期、单实例、菜单事件、audio 插件兜底、命令注册
│   ├── window.rs         窗口创建、导航限制、target=_blank 拦截、窗口状态持久化
│   ├── media.rs          MediaStore：媒体状态单一来源（position 本地外推）
│   ├── mpris.rs          org.mpris.MediaPlayer2(+Player) via mpris-server/zbus
│   ├── tray.rs           托盘 + 动态菜单（当前曲目/播放暂停/上一首/下一首/显示/退出）
│   ├── menu.rs           应用菜单栏
│   ├── command.rs        Command 类型 + eval 下发到页面
│   ├── config.rs         常量 + 域名白名单
│   └── logger.rs         env_logger
├── assets/
│   ├── chrome-spoof.js   伪造 Chrome 身份 + polyfill requestIdleCallback（先于页面 bundle 注入）
│   ├── page-hook.js      页面世界：劫持 mediaSession.metadata + 捕获 <audio> + 空格键
│   ├── bridge.js         postMessage → Tauri IPC 适配（页面 → 壳方向）
│   └── tray.png
├── capabilities/default.json  Tauri 2 ACL（remote URLs 授权自定义命令）
├── tauri.conf.json       bundle 配置（deb/rpm/appimage，category=Music）
└── icons/
frontend/index.html       本地错误页
packaging/pacman/PKGBUILD pacman 打包
```

## 2. 已完成（实测）

- 网页版在 WebKitGTK 2.54 下正常渲染（需 chrome-spoof.js 适配）
- MPRIS2 全量接口 + 媒体键（`busctl --user` 实测 PlayPause/Next/Seek 闭环）
- 托盘、单实例、窗口状态持久化、空格键播放暂停
- 登录态保持（WebKitGTK cookie store，与 Electron 不通用，需重新扫码一次）
- 四种分发包：deb / rpm / AppImage / pacman（pacman 走 PKGBUILD）

## 3. WebKitGTK 适配记录（关键，见 findings.md）

| 问题 | 根因 | 修复 |
|---|---|---|
| 页面白屏 | 缺 `requestIdleCallback`（Chromium 专有），rudio 初始化 ReferenceError，React 不挂载 | chrome-spoof.js polyfill |
| 播放失败 + `GLib-GObject-CRITICAL` | 缺 `autoaudiosink`（gst-plugins-good） | 系统装包 / setup-gst.sh 本地插件兜底 |
| `about:blank` 弹窗 | Tauri 默认 Allow 新窗口 | `on_new_window` 拦截，同站导航/外链交系统浏览器 |
| 窗口比屏幕大 | 物理像素当逻辑像素存 | Resized/Moved 转逻辑像素 + 越界重置 |
| 远程 URL IPC 被拒 | Tauri 2 默认拒远程 invoke | build.rs AppManifest::commands + capability remote.urls |

## 4. 后续

- P3：启动页、深链接（`orpheus://`）、设置面板（代理/关闭行为/清理缓存/重新登录）
- P4：迷你播放器、桌面歌词、自启与默认客户端
- P5（实验）：注入半实现的 jsbridge 让网页进「桌面端模式」，风险高，默认不做
- 打包：CI（`.github/workflows`）迁移到 Tauri 构建
