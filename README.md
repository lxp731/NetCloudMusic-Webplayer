# 网易云音乐（Linux 桌面外壳）

网易云音乐网页版（`music.163.com/st/webplayer`）的 Linux 桌面外壳。非官方项目；
应用名、窗口标题、托盘与 MPRIS 标识统一显示为「网易云音乐」，图标取自网络上的
网易云品牌图标（仅用于本地桌面识别）。

不是重写客户端，也不改任何业务逻辑：**Electron 壳 + 官方网页版 + 自实现 MPRIS/托盘/通知**，
和 Spotify 桌面端「CEF 壳 + 同一个 web UI + 原生桥」是同一种结构，只是我们用的是 Electron。

```
┌──────────────────────────────────────────────────────────────┐
│  native shell (Electron main, Node)                          │
│   窗口/单实例/窗口状态   MPRIS2 (dbus-next)   Tray           │
│                     ▲             │                          │
│            media:state│            │shell:command             │
│                     │             ▼                          │
│  preload (contextIsolation, sandbox)  ←→  page hook (页面世界) │
│                     ▲                          │             │
│                     └── window.postMessage ─────┘             │
├──────────────────────────────────────────────────────────────┤
│  Chromium 渲染： music.163.com/st/webplayer （官方线上资源）    │
└──────────────────────────────────────────────────────────────┘
```

## 状态

P0 + P1 已实现并在 KDE Plasma(Wayland) / Electron 42 上实测：

- 打开即加载官方网页版，扫码登录，重启保持登录（`persist:netease` 分区）
- **MPRIS2 全量接口**：`PlaybackStatus / Metadata（标题/艺人/专辑/封面/时长）/ Position / Volume`，
  方法 `PlayPause / Play / Pause / Next / Previous / Seek / SetPosition`，属性变化会发 `PropertiesChanged`
  → KDE/GNOME 的键盘媒体键、耳机按键、锁屏播放器、`playerctl` 全部可用
- 托盘图标 + 播放/暂停/上一首/下一首/显示/退出；关窗进托盘（无托盘时关窗即退出）
- 切歌**不发**系统通知（按需求关闭；MPRIS 元数据已包含曲目信息）
- 单实例；第二次启动会唤起已有窗口
- 窗口位置/尺寸/最大化持久化
- 本地错误页（断网/加载失败可重试）
- 外部链接交给系统浏览器，站内导航限制在 `*.163.com / *.126.net / *.qq.com` 等域名

已验证的实测记录（本机）：

```
$ busctl --user introspect org.mpris.MediaPlayer2.netcloud_music /org/mpris/MediaPlayer2
org.mpris.MediaPlayer2.Player  ...  PlaybackStatus / Metadata / Position / Volume / Seek / SetPosition
$ busctl --user call ... PlayPause      → PlaybackStatus "Playing"
$ busctl --user call ... Next           → Metadata: 海屿你 — 马也_Crabbit
$ busctl --user call ... Previous       → Metadata: 一半一半 — Top Barry, INDEcompany
$ busctl --user call ... Seek x 30000000 → Position 前进 30s
```

## 开发

```bash
pnpm install
./bin/netcloud-music          # 等同下面那条（.desktop 里用的也是它）
./tools/dev-run.sh            # 用当前桌面会话启动（注入 DISPLAY/XAUTHORITY/DBUS）
./tools/dev-run.sh --dev      # 同上，另开 DevTools 菜单项
NETCLOUD_MUTE=1 ./tools/dev-run.sh   # 静音启动，方便自动化测试
```

开发用信号（仅在 `--dev` / 未打包时生效）：

```bash
kill -USR1 <main-pid>   # 把当前页面的 DOM/媒体元素/控件/媒体会话元数据 dump 到日志
kill -USR2 <main-pid>   # 开关 DevTools
```

日志：`~/.config/netcloud-music/logs/netcloud-music.log`（`NETCLOUD_VERBOSE=1` 打开 debug 级）。

桌面集成（开发期已装好，P2 打包时会换成正式安装）：

```bash
~/.local/share/applications/netcloud-music.desktop      # Name=网易云音乐, Exec→仓库 bin/netcloud-music
~/.local/share/icons/hicolor/*/apps/netcloud-music.png  # 32–512px 品牌图标
# 验证窗口属性
WAYLAND_DEBUG=client ./tools/dev-run.sh 2>&1 | grep -E 'set_app_id|set_title'
#   → set_app_id("netcloud-music") / set_title("网易云音乐")
```

## 空格键 = 播放/暂停

网页版自己**没有**全局播放快捷键：空格在主页是翻页，只有在点了播放键、焦点落在按钮上时
才会"激活那个按钮"。这个壳把它改成桌面端的手感：

| 场景 | 空格行为 |
|---|---|
| 焦点在程序内任意位置（首页 / 播放页 / 播放中 / 暂停中 / 刚启动） | **播放 / 暂停**；事件被吞掉，页面不翻页，焦点控件也不会被"空格激活" |
| 还没播过任何歌 | 空格直接起播（优先点播放条，其次点第一个可见的播放按钮） |
| 光标在输入框 / textarea / contenteditable（搜索、重命名歌单…） | 输入空格（唯一例外，否则搜索没法用） |
| 按住 Ctrl/Alt/Shift | 不拦截，交给页面 |

翻页改用 `PageDown` / `PageUp` / 方向键。开关在 `src/preload/page-hook.js` 的
`SPACE_TOGGLES_PLAYBACK` 常量。

切换本身优先走 `<audio>.play()/pause()`；万一站点把元素换掉了导致 `play()` 无效，
450ms 后检测到状态没变会自动退回"点播放条按钮"，并且 `play()` 被拒绝时也会立刻回退。

## 它是怎么拿到播放状态的

官方网页版**没有**把播放状态暴露成任何 API，只有两条线索，两条都被用上了：

1. `navigator.mediaSession.metadata` —— 站点每次切歌都会
   `new MediaMetadata({title, artist, album, artwork})`（在 `setMediaSession()` 里），
   页面世界的 hook 劫持 `MediaSession.prototype.metadata` 的 setter 拿到它。
2. `<audio>` 元素 —— 站点用 howler.js `html5: true` 播放，元素**不挂到 DOM 上**，
   所以 `querySelectorAll` / document 级事件都看不到。hook 改为在
   `Document.prototype.createElement` 和 `HTMLMediaElement.prototype.play` 处捕获元素本体，
   直接绑事件拿 `status / position / duration / volume`。

控制方向（MPRIS → 页面）按可靠性降级：

1. `<audio>.play() / pause() / currentTime`（播放/暂停/进度，最可靠）
2. 站点自己注册的 mediaSession action handler（若存在则直接调用）
3. 点击播放条控件：`svg[aria-label="play"|"pause"|"next"|"pre"|"loop"]`，优先取窗口底部固定条的候选
4. 失败会以 `command-miss` 写进日志，便于后续调选择器

## 边界

- **不做**去广告、不做 VIP/版权绕过、不下载付费内容，也不伪装成官方客户端；壳只负责系统集成。
- 没有 Widevine：网页版音乐是普通 MP3/FLAC 直链，不需要它；若将来引入 DRM 内容会明确失败。
- 音量：MPRIS 设音量是直接改 `<audio>.volume`，站点自己的音量状态并不知道；切歌时 hook 会
  重新套用最近一次 MPRIS 音量，但如果用户在网页里拖动音量条，则以网页为准。
- 站点的键盘快捷键依赖原生桥（`handleHotkey` 由 native 喂），网页版本身没有全局快捷键，
  所以媒体键走 MPRIS 而不是 `globalShortcut`（Wayland 下更可靠，也不会抢别的播放器）。

## 后续（P2+，见 docs/PLAN.md）

- P2：electron-builder 出 AppImage / deb / rpm / pacman + Flatpak + AUR，自动更新
- P3：启动页、深链接（`orpheus://`）、设置面板（代理/关闭行为/清理缓存/重新登录）
- P4：迷你播放器、桌面歌词、自启与默认客户端
- P5（实验）：注入半实现的 jsbridge 让网页进「桌面端模式」，风险高，默认不做

## 相关文档

- `docs/PLAN.md` —— 完整计划书（架构、分阶段、风险）
- `docs/findings.md` —— 对这个网页版的逆向调查记录（为什么这么做是可行的）
