'use strict'

const dbus = require('dbus-next')
const { Interface, ACCESS_READ } = dbus.interface
const { Variant } = dbus

const { MPRIS_NAME, MPRIS_PATH, DESKTOP_ENTRY, PRODUCT_NAME } = require('../shared/config')
const log = require('./logger')

// MPRIS2 implementation.
//
// Why MPRIS instead of globalShortcut: on Wayland `globalShortcut` cannot grab
// media keys reliably, and grabbing them globally would also steal them from
// other players. KDE/GNOME route the keyboard/headset media keys through MPRIS,
// so a correct MPRIS service gets media keys for free.

const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player'
const ROOT_IFACE = 'org.mpris.MediaPlayer2'

function artistList (artist) {
  return String(artist || '')
    .split(/[,，/、&]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

class RootInterface extends Interface {
  constructor (ctx) {
    super(ROOT_IFACE)
    this.ctx = ctx
  }

  get Identity () { return PRODUCT_NAME }
  get DesktopEntry () { return DESKTOP_ENTRY }
  get CanQuit () { return true }
  get CanRaise () { return true }
  get HasTrackList () { return false }
  get CanSetFullscreen () { return false }
  get Fullscreen () { return false }
  set Fullscreen (_value) { /* ignored: CanSetFullscreen is false */ }
  get SupportedUriSchemes () { return ['https', 'http'] }
  get SupportedMimeTypes () { return [] }

  Raise () { this.ctx.raise() }
  Quit () { this.ctx.quit() }
}

RootInterface.configureMembers({
  properties: {
    Identity: { signature: 's', access: ACCESS_READ },
    DesktopEntry: { signature: 's', access: ACCESS_READ },
    CanQuit: { signature: 'b', access: ACCESS_READ },
    CanRaise: { signature: 'b', access: ACCESS_READ },
    HasTrackList: { signature: 'b', access: ACCESS_READ },
    CanSetFullscreen: { signature: 'b', access: ACCESS_READ },
    Fullscreen: { signature: 'b' },
    SupportedUriSchemes: { signature: 'as', access: ACCESS_READ },
    SupportedMimeTypes: { signature: 'as', access: ACCESS_READ }
  },
  methods: {
    Raise: { inSignature: '', outSignature: '' },
    Quit: { inSignature: '', outSignature: '' }
  }
})

class PlayerInterface extends Interface {
  constructor (ctx) {
    super(PLAYER_IFACE)
    this.ctx = ctx
    this.loopStatus = 'None'
    this.shuffle = false
    this.rate = 1
  }

  get store () { return this.ctx.store }
  get state () { return this.ctx.store.state }

  get PlaybackStatus () {
    const s = this.state.status
    if (s === 'Playing' || s === 'Paused') return s
    return 'Stopped'
  }

  get LoopStatus () { return this.loopStatus }
  set LoopStatus (value) {
    if (!['None', 'Track', 'Playlist'].includes(value)) return
    this.loopStatus = value
    this.ctx.command({ type: 'loop', value })
    this.ctx.changed({ LoopStatus: value })
  }

  get Rate () { return this.rate }
  set Rate (value) {
    if (typeof value === 'number' && value > 0) {
      this.rate = value
      this.ctx.changed({ Rate: value })
    }
  }

  get Shuffle () { return this.shuffle }
  set Shuffle (value) {
    this.shuffle = !!value
    this.ctx.command({ type: 'shuffle', value: this.shuffle })
    this.ctx.changed({ Shuffle: this.shuffle })
  }

  get Metadata () { return this.ctx.metadata() }

  get Volume () { return Number(this.state.volume) || 0 }
  set Volume (value) {
    const v = Math.min(1, Math.max(0, Number(value) || 0))
    // optimistically reflect it; the page will confirm via volumechange
    this.store.update({ volume: v })
    this.ctx.command({ type: 'volume', value: v })
    this.ctx.changed({ Volume: v })
  }

  get Position () { return Math.round(this.store.currentPosition() * 1e6) }
  get MinimumRate () { return 1 }
  get MaximumRate () { return 1 }
  get CanGoNext () { return true }
  get CanGoPrevious () { return true }
  get CanPlay () { return true }
  get CanPause () { return true }
  get CanSeek () { return true }
  get CanControl () { return true }

  Next () { this.ctx.command({ type: 'next' }) }
  Previous () { this.ctx.command({ type: 'prev' }) }
  Pause () { this.ctx.command({ type: 'pause' }) }
  PlayPause () { this.ctx.command({ type: 'playpause' }) }
  Stop () { this.ctx.command({ type: 'pause' }) }
  Play () { this.ctx.command({ type: 'play' }) }

  Seek (offset) {
    const target = Math.max(0, this.store.currentPosition() + Number(offset) / 1e6)
    this.ctx.command({ type: 'seek', value: Math.min(target, this.state.duration || target) })
  }

  SetPosition (trackId, position) {
    if (trackId && trackId !== this.store.trackId()) return
    this.ctx.command({ type: 'seek', value: Math.max(0, Number(position) / 1e6) })
  }

  OpenUri (uri) {
    this.ctx.command({ type: 'open', value: uri })
  }

  Seeked (position) {
    return Math.round(Number(position) || 0)
  }
}

PlayerInterface.configureMembers({
  properties: {
    PlaybackStatus: { signature: 's', access: ACCESS_READ },
    LoopStatus: { signature: 's' },
    Rate: { signature: 'd' },
    Shuffle: { signature: 'b' },
    Metadata: { signature: 'a{sv}', access: ACCESS_READ },
    Volume: { signature: 'd' },
    Position: { signature: 'x', access: ACCESS_READ },
    MinimumRate: { signature: 'd', access: ACCESS_READ },
    MaximumRate: { signature: 'd', access: ACCESS_READ },
    CanGoNext: { signature: 'b', access: ACCESS_READ },
    CanGoPrevious: { signature: 'b', access: ACCESS_READ },
    CanPlay: { signature: 'b', access: ACCESS_READ },
    CanPause: { signature: 'b', access: ACCESS_READ },
    CanSeek: { signature: 'b', access: ACCESS_READ },
    CanControl: { signature: 'b', access: ACCESS_READ }
  },
  methods: {
    Next: { inSignature: '', outSignature: '' },
    Previous: { inSignature: '', outSignature: '' },
    Pause: { inSignature: '', outSignature: '' },
    PlayPause: { inSignature: '', outSignature: '' },
    Stop: { inSignature: '', outSignature: '' },
    Play: { inSignature: '', outSignature: '' },
    Seek: { inSignature: 'x', outSignature: '' },
    SetPosition: { inSignature: 'ox', outSignature: '' },
    OpenUri: { inSignature: 's', outSignature: '' }
  },
  signals: {
    Seeked: { signature: 'x' }
  }
})

class MprisService {
  constructor ({ store, onCommand, raise, quit }) {
    this.store = store
    this.rawCommand = onCommand
    this.doRaise = raise
    this.doQuit = quit
    this.bus = null
    this.player = null
    this.root = null
    this.ready = false
    this.pending = []
  }

  async start () {
    const ctx = {
      store: this.store,
      raise: () => this.doRaise && this.doRaise(),
      quit: () => this.doQuit && this.doQuit(),
      command: (cmd) => this.emitCommand(cmd),
      changed: (props) => this.emitChanged(props),
      metadata: () => this.buildMetadata()
    }

    try {
      this.bus = dbus.sessionBus({ busAddress: resolveBusAddress() })
      this.root = new RootInterface(ctx)
      this.player = new PlayerInterface(ctx)

      const reply = await this.bus.requestName(MPRIS_NAME, 0)
      // 1 = primary owner, 2 = queued/in-queue, 3 = exists, 4 = already owner
      if (reply !== 1 && reply !== 4) {
        log.warn('[mpris] requestName returned', reply, '- another instance may own the name')
      }
      // dbus-next's export() takes exactly one interface per call
      this.bus.export(MPRIS_PATH, this.root)
      this.bus.export(MPRIS_PATH, this.player)
      this.ready = true
      while (this.pending.length) this.emitChanged(this.pending.shift())
      log.info('[mpris] exported', MPRIS_NAME, 'at', MPRIS_PATH)
    } catch (err) {
      log.error('[mpris] failed to start:', err.message)
    }
  }

  emitCommand (cmd) {
    try {
      this.rawCommand && this.rawCommand(cmd)
    } catch (err) {
      log.error('[mpris] command failed:', err.message)
    }
  }

  emitChanged (props) {
    if (!this.player) return
    if (!this.ready) {
      this.pending.push(props)
      return
    }
    try {
      Interface.emitPropertiesChanged(this.player, props, [])
    } catch (err) {
      log.warn('[mpris] emitPropertiesChanged failed:', err.message)
    }
  }

  // Called by the media store on every meaningful state change.
  sync (state, changed) {
    const props = {}
    if (changed.includes('status')) props.PlaybackStatus = state.status
    if (changed.includes('title') || changed.includes('artist') || changed.includes('album') ||
        changed.includes('artwork') || changed.includes('duration') || changed.includes('trackKey')) {
      props.Metadata = this.buildMetadata()
    }
    if (changed.includes('volume')) props.Volume = Number(state.volume) || 0
    if (Object.keys(props).length) this.emitChanged(props)
  }

  seeked (positionSec) {
    if (!this.player || !this.ready) return
    try {
      this.player.Seeked(Math.round(positionSec * 1e6))
    } catch (err) {
      log.warn('[mpris] Seeked failed:', err.message)
    }
  }

  buildMetadata () {
    const s = this.store.state
    const md = {
      'mpris:trackid': new Variant('o', this.store.trackId()),
      'mpris:length': new Variant('x', Math.round((Number(s.duration) || 0) * 1e6))
    }
    if (s.title) md['xesam:title'] = new Variant('s', s.title)
    const artists = artistList(s.artist)
    if (artists.length) md['xesam:artist'] = new Variant('as', artists)
    if (s.album) md['xesam:album'] = new Variant('s', s.album)
    if (s.artwork) md['mpris:artUrl'] = new Variant('s', s.artwork)
    return md
  }
}

function resolveBusAddress () {
  if (process.env.DBUS_SESSION_BUS_ADDRESS) return process.env.DBUS_SESSION_BUS_ADDRESS
  const uid = process.getuid ? process.getuid() : 1000
  return `unix:path=/run/user/${uid}/bus`
}

module.exports = { MprisService }
