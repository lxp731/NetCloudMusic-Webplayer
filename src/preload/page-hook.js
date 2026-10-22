/* Page-world hook.
 *
 * Injected into the site's main world by src/main/window.js via
 * webContents.executeJavaScript(). Runs isolated from the shell's preload; the
 * only channel back is `window.postMessage` (preload listens on the same DOM
 * window).
 *
 * Responsibilities:
 *   1. observe navigator.mediaSession.metadata (the site sets it per track:
 *      `new MediaMetadata({title, artist, album, artwork})`)
 *   2. observe the <audio> element (play/pause/seek/volume/progress)
 *   3. accept shell commands (MPRIS/tray) and drive the page
 *
 * Nothing here is allowed to throw into the page: every entry point is wrapped.
 */
(() => {
  if (window.__netcloudHooked) return
  window.__netcloudHooked = true

  var CHANNEL = '__netcloud'
  var hookedAt = Date.now()
  var meta = null
  var media = null
  var handlers = Object.create(null)
  var lastSentAt = 0
  var sendTimer = null

  function post (kind, payload) {
    try {
      var msg = {}
      msg[CHANNEL] = true
      msg.kind = kind
      msg.payload = payload
      window.postMessage(msg, '*')
    } catch (_) {}
  }

  // ---------------------------------------------------------------- metadata

  function artworkOf (md) {
    try {
      if (!md || !md.artwork || !md.artwork.length) return ''
      return md.artwork[md.artwork.length - 1].src || ''
    } catch (_) {
      return ''
    }
  }

  function hookMediaSession () {
    try {
      var proto = window.MediaSession && window.MediaSession.prototype
      if (!proto) return
      var desc = Object.getOwnPropertyDescriptor(proto, 'metadata')
      if (!desc || !desc.set) return
      Object.defineProperty(proto, 'metadata', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { return desc.get.call(this) },
        set: function (value) {
          desc.set.call(this, value)
          try {
            if (value) {
              meta = {
                title: value.title || '',
                artist: value.artist || '',
                album: value.album || '',
                artwork: artworkOf(value)
              }
              scheduleSend(true)
            }
          } catch (_) {}
        }
      })

      // The desktop build registers mediaSession handlers; the web build may
      // not, but if it does we can drive it directly.
      var ms = navigator.mediaSession
      if (ms && ms.setActionHandler) {
        var orig = ms.setActionHandler.bind(ms)
        ms.setActionHandler = function (action, cb) {
          try { if (typeof cb === 'function') handlers[action] = cb } catch (_) {}
          return orig(action, cb)
        }
      }
    } catch (_) {}
  }

  // ------------------------------------------------------------ media element

  var MEDIA_EVENTS = [
    'play', 'playing', 'pause', 'ended', 'timeupdate', 'durationchange',
    'loadedmetadata', 'volumechange', 'waiting', 'emptied', 'seeked', 'canplay'
  ]

  // The player is howler.js with `html5: true`: it creates an <audio> element
  // but keeps it *detached* from the document, so document-level listeners and
  // querySelectorAll never see it. We therefore bind straight to the element,
  // catching it both at creation time and on first play().
  var bound = typeof WeakSet === 'function' ? new WeakSet() : null

  // The site (howler) owns its own volume state and resets element.volume on
  //每 track. When the user changes volume through MPRIS we remember it and
  // re-apply it, otherwise the next song would snap back to the site's volume.
  var forcedVolume = null

  function applyForcedVolume (el) {
    if (forcedVolume === null || !el) return
    try {
      if (Math.abs(el.volume - forcedVolume) > 0.01) el.volume = forcedVolume
    } catch (_) {}
  }

  function onMediaEvent (event) {
    try {
      var t = event.target
      if (t && (t.tagName === 'AUDIO' || t.tagName === 'VIDEO')) {
        media = t
        if (event.type === 'play' || event.type === 'loadedmetadata' || event.type === 'canplay') {
          applyForcedVolume(t)
        }
        scheduleSend(event.type !== 'timeupdate')
      }
    } catch (_) {}
  }

  function bindElement (el) {
    try {
      if (!el || (el.tagName !== 'AUDIO' && el.tagName !== 'VIDEO')) return el
      if (bound) {
        if (bound.has(el)) return el
        bound.add(el)
      }
      media = el
      MEDIA_EVENTS.forEach(function (name) {
        try { el.addEventListener(name, onMediaEvent, false) } catch (_) {}
      })
      scheduleSend(true)
    } catch (_) {}
    return el
  }

  // fallback for elements that reach the document normally
  MEDIA_EVENTS.forEach(function (name) {
    try { document.addEventListener(name, onMediaEvent, true) } catch (_) {}
  })

  function hookMediaCreation () {
    try {
      var proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype
      if (proto) {
        ['play', 'load'].forEach(function (name) {
          var orig = proto[name]
          if (typeof orig !== 'function') return
          proto[name] = function () {
            bindElement(this)
            return orig.apply(this, arguments)
          }
        })
      }
      var doc = window.Document && window.Document.prototype
      if (doc && doc.createElement) {
        var origCreate = doc.createElement
        doc.createElement = function (tag) {
          var el = origCreate.apply(this, arguments)
          if (typeof tag === 'string' && (tag.toLowerCase() === 'audio' || tag.toLowerCase() === 'video')) {
            // howler configures the element right after creation
            setTimeout(function () { bindElement(el) }, 0)
          }
          return el
        }
      }
      if (typeof window.Audio === 'function') {
        var OrigAudio = window.Audio
        var Patched = function () {
          var el = Reflect.construct(OrigAudio, Array.prototype.slice.call(arguments))
          bindElement(el)
          return el
        }
        Patched.prototype = OrigAudio.prototype
        window.Audio = Patched
      }
    } catch (_) {}
  }

  // --------------------------------------------------------------- title hook

  function hookTitle () {
    try {
      var desc = Object.getOwnPropertyDescriptor(Document.prototype, 'title')
      if (!desc || !desc.set) return
      Object.defineProperty(document, 'title', {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () { return desc.get.call(this) },
        set: function (value) {
          desc.set.call(this, value)
          scheduleSend(false)
        }
      })
    } catch (_) {}
  }

  // ------------------------------------------------------------------- state

  function parseTitle () {
    var raw = ''
    try { raw = String(document.title || '') } catch (_) {}
    raw = raw.replace(/\s*-\s*网易云音乐\s*$/, '').trim()
    if (!raw || raw === '网易云音乐') return null
    var parts = raw.split(' - ')
    if (parts.length >= 2) return { title: parts[0], artist: parts.slice(1).join(' - ') }
    return { title: raw, artist: '' }
  }

  function snapshot () {
    var el = media
    var duration = el && isFinite(el.duration) ? Number(el.duration) : 0
    var position = el ? Number(el.currentTime) || 0 : 0
    var hasSrc = !!(el && (el.currentSrc || el.src))
    var status = 'Stopped'
    if (el && hasSrc) status = el.paused ? (el.ended ? 'Stopped' : 'Paused') : 'Playing'

    var title = meta && meta.title ? meta.title : ''
    var artist = meta && meta.artist ? meta.artist : ''
    var album = meta && meta.album ? meta.album : ''
    var artwork = meta ? meta.artwork : ''
    var source = meta && meta.title ? 'mediaSession' : 'none'

    if (!title) {
      var parsed = parseTitle()
      if (parsed) {
        title = parsed.title
        artist = artist || parsed.artist
        source = 'document.title'
      }
    }

    return {
      status: status,
      title: title,
      artist: artist,
      album: album,
      artwork: artwork,
      duration: duration,
      position: position,
      volume: el && typeof el.volume === 'number' ? el.volume : 1,
      source: source
    }
  }

  function scheduleSend (immediate) {
    if (immediate) {
      if (sendTimer) { clearTimeout(sendTimer); sendTimer = null }
      sendState()
      return
    }
    if (sendTimer) return
    var wait = Math.max(0, 200 - (Date.now() - lastSentAt))
    sendTimer = setTimeout(function () {
      sendTimer = null
      sendState()
    }, wait)
  }

  function sendState () {
    try {
      lastSentAt = Date.now()
      post('state', snapshot())
    } catch (_) {}
  }

  // ---------------------------------------------------------------- controls

  var SYNONYMS = {
    play: [/^play$/, /cmd-icon-play($|-)/, /播放/],
    pause: [/^pause$/, /cmd-icon-pause($|-)/, /暂停/],
    playpause: [/^play$/, /^pause$/, /cmd-icon-play($|-)/, /cmd-icon-pause($|-)/],
    next: [/^next$/, /^nexttrack$/, /cmd-icon-next($|-)/, /下一首|下一曲/],
    prev: [/^prev$/, /^pre$/, /^previous$/, /^previoustrack$/, /cmd-icon-pre(v|-|$)/, /上一首|上一曲/],
    loop: [/^loop$/, /^playmode$/, /^mode$/, /cmd-icon-(loop|mode|order|single)($|-)/, /播放模式|单曲循环|列表循环/],
    shuffle: [/^shuffle$/, /^random$/, /cmd-icon-(shuffle|random)($|-)/, /随机播放/]
  }

  function labelOf (el) {
    var bits = []
    try {
      bits.push(el.getAttribute('aria-label') || '')
      bits.push(el.getAttribute('title') || '')
      bits.push(typeof el.className === 'string' ? el.className : '')
      bits.push(el.getAttribute('data-testid') || '')
    } catch (_) {}
    return bits.filter(Boolean).join(' ')
  }

  function collectControls () {
    var out = []
    var nodes
    try {
      nodes = document.querySelectorAll(
        'svg[aria-label],[role="button"],button,[class*="cmd-icon"],[class*="PlayButton"],[class*="playButton"]'
      )
    } catch (_) {
      return out
    }
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      try {
        if (!el.getClientRects().length) continue // not rendered
        var rect = el.getBoundingClientRect()
        if (rect.width < 6 || rect.height < 6) continue
        var style = window.getComputedStyle(el)
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue
        out.push({
          el: el,
          label: labelOf(el),
          top: rect.top,
          left: rect.left,
          // the transport bar is the fixed strip at the bottom of the window
          inBar: rect.top > window.innerHeight - 150,
          bottomArea: rect.top > window.innerHeight * 0.55
        })
      } catch (_) {}
    }
    return out
  }

  function scoreControl (candidate, type) {
    var patterns = SYNONYMS[type] || []
    var label = candidate.label.toLowerCase()
    var score = 0
    for (var i = 0; i < patterns.length; i++) {
      var re = patterns[i]
      var raw = candidate.label
      if (re.test(label) || re.test(raw)) {
        score = Math.max(score, re.source.length > 3 ? 90 : 100)
      }
    }
    if (score === 0) return 0
    if (candidate.inBar) score += 60 // strongly prefer the transport bar
    else if (candidate.bottomArea) score += 15
    return score
  }

  function clickElement (el) {
    var rect = el.getBoundingClientRect()
    var opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }
    try { el.dispatchEvent(new PointerEvent('pointerdown', opts)) } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', opts)) } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', opts)) } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', opts)) } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('click', opts)) } catch (_) {}
    // some handlers sit on the wrapper instead of the icon
    try {
      if (el.parentElement && el.parentElement !== document.body) el.parentElement.click()
    } catch (_) {}
  }

  function clickControl (type) {
    var best = null
    var bestScore = 0
    var list = collectControls()
    for (var i = 0; i < list.length; i++) {
      var s = scoreControl(list[i], type)
      if (s > bestScore) { bestScore = s; best = list[i] }
    }
    if (!best || bestScore < 50) {
      post('event', { kind: 'command-miss', type: type, candidates: list.length })
      return false
    }
    clickElement(best.el)
    post('event', { kind: 'command-click', type: type, label: best.label.slice(0, 80), score: bestScore })
    return true
  }

  function allMedia () {
    var out = []
    try {
      out = Array.prototype.slice.call(document.querySelectorAll('audio,video'))
    } catch (_) {}
    if (media && out.indexOf(media) === -1) out.unshift(media)
    return out
  }

  function setVolume (value) {
    var v = Math.min(1, Math.max(0, Number(value) || 0))
    forcedVolume = v
    allMedia().forEach(function (el) {
      try { el.volume = v } catch (_) {}
    })
    scheduleSend(true)
    return true
  }

  function seekTo (seconds) {
    var el = media || allMedia()[0]
    if (!el) return false
    var target = Math.max(0, Number(seconds) || 0)
    if (isFinite(el.duration) && target > el.duration) target = el.duration
    try {
      el.currentTime = target
      scheduleSend(true)
      return true
    } catch (_) {
      return false
    }
  }

  // Toggling through the media element is the most reliable path, but the site
  // occasionally swaps/unloads the element behind our back, in which case
  // play() silently does nothing. Verify the result and fall back to clicking
  // the transport-bar control.
  function elementToggle (el, wantPlay) {
    var before = el.paused
    post('event', { kind: 'toggle', via: 'element', wantPlay: wantPlay, beforePaused: before })
    try {
      if (wantPlay) {
        var promise = el.play()
        if (promise && typeof promise.catch === 'function') {
          promise.catch(function (err) {
            post('event', { kind: 'play-rejected', message: String(err && err.name) })
            clickControl('play')
          })
        }
      } else {
        el.pause()
      }
      scheduleSend(true)
    } catch (err) {
      post('event', { kind: 'element-toggle-error', message: String(err && err.message) })
      clickControl(wantPlay ? 'play' : 'pause')
      return
    }
    setTimeout(function () {
      try {
        if (el.paused === before) {
          post('event', { kind: 'element-toggle-stalled', wantPlay: wantPlay })
          clickControl(wantPlay ? 'play' : 'pause')
        }
      } catch (_) {}
    }, 450)
  }

  var ACTION_OF = { play: 'play', pause: 'pause', next: 'nexttrack', prev: 'previoustrack' }

  function mediaSessionHandler (type) {
    if (type === 'playpause') {
      var cb = handlers.pause || handlers.play
      if (cb) { try { cb(); return true } catch (_) {} }
      return false
    }
    var fn = handlers[ACTION_OF[type]]
    if (fn) {
      try { fn(); return true } catch (_) {}
    }
    return false
  }

  function command (cmd) {
    if (!cmd || !cmd.type) return
    try {
      var type = cmd.type
      if (type === 'volume') return void setVolume(cmd.value)
      if (type === 'seek') return void seekTo(cmd.value)
      if (type === 'loop' || type === 'shuffle') {
        return void clickControl(type === 'loop' ? 'loop' : 'shuffle')
      }
      if (mediaSessionHandler(type)) return

      if (type === 'play' || type === 'pause' || type === 'playpause') {
        var el = media || allMedia()[0]
        if (el && (el.currentSrc || el.src)) {
          var wantPlay = type === 'play' ? true : type === 'pause' ? false : el.paused
          elementToggle(el, wantPlay)
          return
        }
        clickControl('play')
        return
      }

      if (type === 'next' || type === 'prev') {
        clickControl(type)
        return
      }

      if (type === 'probe') {
        post('probe', probe())
      }
    } catch (err) {
      post('event', { kind: 'command-error', type: cmd && cmd.type, message: String(err && err.message) })
    }
  }

  // ------------------------------------------------------------ space key

  // The web player has no global playback shortcut: Space either scrolls the
  // page or (after clicking a control) re-activates whatever has focus. Desktop
  // clients use Space as play/pause, so we take it over — but only when it is
  // unambiguous:
  //   * never while typing (search box, rename dialogs, …)
  //   * never while an interactive control has focus (the browser's own
  //     Space-activates-focus behaviour is what the user expects there)
  //   * never before anything has been loaded (keep page scrolling on first run)
  //   * never with modifiers (Ctrl/Alt/Shift/Space belong to the page)
  var SPACE_TOGGLES_PLAYBACK = true

  function isTextEntry (el) {
    try {
      if (!el) return false
      var tag = String(el.tagName || '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      if (el.closest && el.closest('[contenteditable=""],[contenteditable="true"]')) return true
    } catch (_) {}
    return false
  }

  function hasInteractiveFocus (el) {
    try {
      if (!el || !el.closest) return false
      return !!el.closest(
        'button,[role="button"],a[href],summary,label,[tabindex]:not([tabindex="-1"])'
      )
    } catch (_) {
      return false
    }
  }

  function hookSpaceKey () {
    if (!SPACE_TOGGLES_PLAYBACK) return
    try {
      window.addEventListener('keydown', function (event) {
        try {
          var isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
          if (!isSpace) return
          if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
          if (event.defaultPrevented) return
          if (event.isComposing) return
          if (isTextEntry(event.target)) return
          if (hasInteractiveFocus(event.target)) return
          var list = allMedia()
          if (!list.length) return // nothing loaded yet: let Space scroll
          var el = media || list[0]
          if (!(el.currentSrc || el.src)) return
          event.preventDefault()
          if (event.repeat) return
          command({ type: 'playpause' })
        } catch (_) {}
      }, true)
    } catch (_) {}
  }

  window.addEventListener('message', function (event) {
    try {
      var data = event.data
      if (!data || data[CHANNEL] !== true) return
      if (data.kind === 'command') command(data.cmd)
    } catch (_) {}
  })

  // -------------------------------------------------------------- diagnostics

  function probe () {
    var list = collectControls()
    return {
      hookedAt: hookedAt,
      title: document.title,
      meta: meta,
      media: allMedia().map(function (el) {
        return {
          tag: el.tagName,
          src: String(el.currentSrc || el.src || '').slice(0, 120),
          paused: el.paused,
          currentTime: el.currentTime,
          duration: el.duration,
          volume: el.volume
        }
      }),
      handlers: Object.keys(handlers),
      controls: list.slice(0, 40).map(function (c) {
        return { label: c.label.slice(0, 60), bottom: c.bottomArea, top: Math.round(c.top) }
      }),
      state: snapshot()
    }
  }

  window.__netcloudProbe = probe

  hookMediaSession()
  hookMediaCreation()
  hookTitle()
  hookSpaceKey()
  setTimeout(function () { scheduleSend(true) }, 1500)
  post('event', { kind: 'hooked', at: hookedAt })
})()
