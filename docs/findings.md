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
  所以 document 级事件监听和 `querySelectorAll('audio')` 都拿不到（实测 `media: []`）。
  正确做法是 patch `Document.prototype.createElement` 和 `HTMLMediaElement.prototype.play`
  去捕获元素本体，然后在元素上直接监听 `play/pause/timeupdate/...`。

`navigator.mediaSession.setActionHandler` 只在**桌面端热键通道**里注册（`subscribeHotKey`，
把播放控制转发给 native），网页版模式不会注册。所以控制方向不能依赖它，只能：

1. `el.play() / el.pause() / el.currentTime`（有元素时最可靠）
2. 点击播放条控件。播放条的图标是 `<svg role="img" aria-label="{type}" class="cmd-icon cmd-icon-{type}">`，
   实测 bottom bar 的 aria-label 为：`pre` `pause` `next` `loop` `volume` `playlist`
   （注意是 `pre` 不是 `prev`）。

## 3. 登录行为

未登录时 `/st/webplayer` 会主动跳到：

```
https://music.163.com/login?targetUrl=<encoded 当前地址>   →  https://music.163.com/#/login?targetUrl=...
```

这是站点自己的逻辑（bundle 里有构造该 URL 的 helper），不是壳的 bug。
登录成功后回跳 `targetUrl`，cookie（`MUSIC_U` 等）落在 `persist:netease` 分区。

## 4. 与 Electron 相关的一些坑

- Electron 42 的 `libffmpeg.so` 带 H.264/AAC（`canPlayType` 全为 `probably`），MV/视频可用。
- UA 需要伪装成普通 Chrome，Electron 默认 UA 会让站点走未知分支。
- Electron 的 `app.setName()` **不会**改 `userData` 路径（由 package.json 的 `productName` 决定），
  必须 `app.setPath('userData', …)`。
- `webPreferences.backgroundThrottling: false` + `autoplayPolicy: 'no-user-gesture-required'`
  保证托盘隐藏时继续播放、合成点击也能起播。
- 窗口隐藏（`show: false`）时站点的登录/鉴权逻辑可能不跑，会停在 SPA 骨架；
  测试时不要用隐藏窗口判断"页面是否正常"。

## 5. 复现用命令

```bash
curl -s https://music.163.com/st/webplayer | grep -oE 'src="[^"]*app\.[a-f0-9]+\.js"' | head
# 然后直接 grep 关键实现
curl -s <app.js url> -o app.js
grep -o 'setMediaSession' app.js | wc -l
grep -oE '"(audioplayer|app|storage|player|winhelper)\.[a-zA-Z]+"' app.js | sort -u
```

运行中的壳也可以直接 dump 页面状态：

```bash
kill -USR1 <main-pid>   # 日志里出现 [dump] {...}
```
