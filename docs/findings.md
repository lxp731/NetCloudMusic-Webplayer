# 调查记录：`music.163.com/st/webplayer` 是什么

写这个壳之前先确认了「它能不能被包成桌面应用」，以及「官方桌面端是不是同一套东西」。
下面是实测结论，附证据来源，方便以后再改版时快速复现。

## 1. 它不是"网站里顺手做的一个播放器"，而是官方桌面端的 H5 层

主 bundle：`https://s5.music.126.net/static_public/<build>/hybrid/app.<hash>.js`
（`<build>` 每次发版变，从 `https://music.163.com/st/webplayer` 的 HTML 里抓 `<script src>`）。

bundle 里带一整套 **H5 ↔ 原生 jsbridge**：

```js
// 收消息：{ type: "jsbridge", seq, method: "namespace.verb", params }
if (n === 'jsbridge') { const [ns, verb] = method.split('.'); listeners[ns]?.[verb]?.(params, reply) }
```

命名空间与能力（节选，均为 bundle 里出现的方法名）：

| 命名空间 | 方法 | 说明 |
|---|---|---|
| `audioplayer.*` | `load/play/pause/seek/onPlayProgress/onPlayState/onVolume` | 官方桌面端用**原生播放器**放音 |
| `app.*` | `setAutoRun` `registerDefaultClient` `scanMusicFile` `recognizeMusic` `setAutoRun` | 自启、默认客户端、本地曲库、听歌识曲 |
| `storage.*` | `execsql` `exectransaction` `savetofile` `offlineTrack` `scanDirectory` | 原生 SQLite / 文件系统 / 离线缓存 |
| `player.*` | `renderLRCImage` `setTotalTime` `setVolume` `setLikeMark` | 桌面歌词、进度同步 |
| `winhelper.*` | `popupMenu` `setWindowPosition` `setWindowSizeLimit` | 原生右键菜单、窗口约束 |

结论：官方 PC 端 = 原生壳 + 这个 H5 + jsbridge。Linux 用户只拿到了 H5 那一层，
于是它在普通浏览器里退化成 HTML5 音频（bundle 里 `isWeb` 分支）。

所以我们**不需要实现这些桥**，只要补壳；反过来也不要去"假装"桥存在，
因为 H5 一旦认为自己在桌面端就会去调 `storage.execsql`、`audioplayer.*` 等全套能力，
半吊子实现会白屏。

## 2. 播放状态只有两条可信来源

`grep` 主 bundle 得到的播放器实现（howler.js 包装）：

```js
class Audio {
  createAudio (e) { return new Howl({ src: [e.src], format: zy(e.src), html5: true, preload: false, ... }) }
  setMediaSession (e) {                       // ← 切歌时调用
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: e.songName, artist: e.artistName, album: e.albumName,
        artwork: [{ src: e.url, sizes: '128x128' }]
      })
    }
  }
  play (e, t) { ... this.audio.play(); this.setMediaSession(this.playInfo) }
}
```

- **mediaSession.metadata** 干净地给出 标题/艺人/专辑/封面 —— 壳里劫持 setter 即可。
- **`<audio>` 元素不挂在 DOM 上**（howler `html5: true` 只 `createElement` 不 append），
  所以 document 级事件监听和 `querySelectorAll('audio')` 都拿不到。正确做法是 patch
  `Document.prototype.createElement` 和 `HTMLMediaElement.prototype.play` 去捕获元素本体，
  然后在元素上直接监听 `play/pause/timeupdate/...`。

## 3. 登录行为

未登录时 `/st/webplayer` 会主动跳到：

```
https://music.163.com/login?targetUrl=<encoded 当前地址>   →   https://music.163.com/#/login?targetUrl=...
```

这是站点自己的逻辑，不是壳的 bug。登录成功后回跳 `targetUrl`，cookie（`MUSIC_U` 等）
落在 webview 的 cookie store。

## 4. 与 WebKitGTK / Tauri 相关的一些坑

Electron（Chromium）无这些问题的原因在于 Chromium 自带完整 Web 平台实现和音频栈。
WebKitGTK 需要逐项适配（都在 `src-tauri/assets/chrome-spoof.js` 和启动逻辑里处理）：

- **白屏**：WebKitGTK 缺 `requestIdleCallback`（Chromium 专有）。站点桌面音频引擎 rudio
  调用它抛 `ReferenceError` → 初始化 reject → React 不挂载（`#root` 空、`innerText` 空）。
  → polyfill：`setTimeout` 实现。
- **身份嗅探**：即使 UA 伪装成 Chrome，`window.chrome` 缺失 + `navigator.vendor =
  "Apple Computer, Inc."` 仍暴露 WebKit。→ 补 `window.chrome` + `navigator.vendor` +
  `navigator.userAgentData`（Client Hints）。
- **播放失败 + `GLib-GObject-CRITICAL`**：WebKitGTK 播放走系统 GStreamer，`playbin` 用
  `autoaudiosink` 选音频输出；系统缺 `gst-plugins-good` 时该元素不存在，管线建不起来。
  → 装 `gst-plugins-good`，或 `tools/setup-gst.sh` 把插件解包到用户目录用 `GST_PLUGIN_PATH` 接上。
- **远程 URL 的 IPC 被拒**：Tauri 2 默认只让 bundled 代码调 IPC，远程 URL 调自定义
  command 报 `not allowed. Plugin not found`。→ `build.rs` 用 `AppManifest::commands`
  注册命令 + `capabilities/default.json` 里 `remote.urls` 授权。
- **`eval` 的 postMessage 不派发**：WebKitGTK `run_javascript` 里发 `window.postMessage`
  不会派发 message 事件给页面世界的监听器。→ 壳 → 页面方向改用 `eval` 直接调
  page-hook 暴露的 `window.__netcloudCommand`；页面 → 壳方向仍用 postMessage + bridge。
- **窗口尺寸单位**：`WindowEvent::Resized/Moved` 给物理像素，直接当逻辑像素恢复会让
  高 DPI 下窗口比屏幕大。→ 保存时用 `scale_factor` 转逻辑像素，加载时越界重置。
- **target=_blank**：Tauri 默认放行新窗口 → 一堆 about:blank 弹窗。→ `on_new_window` 拦截。

## 5. 复现与诊断

```bash
# 抓当前 bundle 地址
curl -s https://music.163.com/st/webplayer | grep -oE 'src="[^"]*app\.[a-f0-9]+\.js"' | head
curl -s <app.js url> -o app.js
grep -o 'setMediaSession' app.js | wc -l
grep -oE '"(audioplayer|app|storage|player|winhelper)\.[a-zA-Z]+"' app.js | sort -u
```

页面内诊断（WebKitGTK 的 JS console 不暴露）：在初始化脚本里用
`window.addEventListener('error'/'unhandledrejection')` 把错误收进全局数组，再用
Rust 侧 `webview.eval_with_callback(...)` 把 `JSON.stringify` 的页面状态（`innerText`
长度、`#root` 内容、错误数组）拉回日志。这是定位「白屏/前端崩溃」的关键手段。
