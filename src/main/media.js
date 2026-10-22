'use strict'

const { EventEmitter } = require('node:events')
const crypto = require('node:crypto')

// Single source of truth for "what is playing". Fed by the page hook through
// IPC, consumed by MPRIS and the tray.
//
// The page only reports the position every ~250ms (timeupdate). Between those
// reports we extrapolate locally so MPRIS clients see a smooth Position.

const DEFAULT_STATE = {
  status: 'Stopped', // Playing | Paused | Stopped
  title: '',
  artist: '',
  album: '',
  artwork: '',
  duration: 0, // seconds
  position: 0, // seconds, as of positionAt
  volume: 1,
  canNext: true,
  canPrev: true,
  canPlay: true,
  canSeek: true,
  trackKey: '',
  source: 'none' // metadata source, for diagnostics
}

class MediaStore extends EventEmitter {
  constructor () {
    super()
    this.state = { ...DEFAULT_STATE }
    this.positionAt = Date.now()
    this.volumeAt = Date.now()
  }

  get snapshot () {
    return { ...this.state, position: this.currentPosition() }
  }

  currentPosition () {
    const s = this.state
    if (s.status !== 'Playing' || !s.duration) return s.position
    const elapsed = (Date.now() - this.positionAt) / 1000
    return Math.min(s.duration, s.position + Math.max(0, elapsed))
  }

  trackId () {
    // MPRIS wants a stable object path per track
    const key = this.state.trackKey || `${this.state.title}|${this.state.artist}`
    if (!key.trim()) return '/org/mpris/MediaPlayer2/Track/none'
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)
    return `/org/mpris/MediaPlayer2/Track/${hash}`
  }

  update (patch) {
    if (!patch || typeof patch !== 'object') return
    const prev = this.state
    const next = { ...prev }
    let positionChanged = false

    for (const key of Object.keys(patch)) {
      if (!(key in DEFAULT_STATE)) continue
      const value = patch[key]
      if (value === undefined || value === null) continue
      if (key === 'position') {
        const num = Number(value)
        if (!Number.isFinite(num)) continue
        // A jump larger than 2s means a real seek, not progress; keep it exact.
        if (Math.abs(num - prev.position) > 0.01) positionChanged = true
        next.position = num
      } else if (key === 'duration' || key === 'volume') {
        const num = Number(value)
        if (!Number.isFinite(num)) continue
        next[key] = num
      } else {
        next[key] = value
      }
    }

    // track identity: whenever title/artist change, rebuild the key
    const idChanged = next.title !== prev.title || next.artist !== prev.artist
    if (idChanged || !next.trackKey) {
      next.trackKey = `${next.title}|${next.artist}|${next.album}`
    }

    this.state = next
    if (positionChanged || idChanged || next.status !== prev.status) {
      this.positionAt = Date.now()
    }

    const changed = Object.keys(next).filter((k) => next[k] !== prev[k])
    if (changed.length === 0) return

    this.emit('change', this.state, changed, prev)
    if (idChanged) this.emit('track', this.state, prev)
  }

  status () {
    return this.state.status
  }
}

module.exports = { MediaStore, DEFAULT_STATE }
