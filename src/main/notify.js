'use strict'

const { app, Notification, nativeImage, net } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const log = require('./logger')

const CACHE_DIR_NAME = 'artwork-cache'

// Desktop notification on track change. Artwork is downloaded once per URL and
// cached on disk, because KDE/GNOME want a local file/NativeImage.
module.exports = function createNotifier ({ store }) {
  const cacheDir = path.join(app.getPath('userData'), CACHE_DIR_NAME)
  fs.mkdirSync(cacheDir, { recursive: true })

  let lastKey = ''
  let lastNotifiedAt = 0
  let artworkCache = { url: '', image: null }

  async function artworkFor (url) {
    if (!url) return null
    if (artworkCache.url === url) return artworkCache.image
    try {
      const file = path.join(cacheDir, crypto.createHash('sha1').update(url).digest('hex'))
      if (fs.existsSync(file)) {
        const img = nativeImage.createFromPath(file)
        if (!img.isEmpty()) {
          artworkCache = { url, image: img }
          return img
        }
      }
      const res = await net.fetch(url, { cache: 'no-store' })
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null
      fs.writeFileSync(file, buf)
      const img = nativeImage.createFromBuffer(buf)
      artworkCache = { url, image: img }
      return img
    } catch (err) {
      log.debug('[notify] artwork failed:', err.message)
      return null
    }
  }

  return async function onTrack (state) {
    if (!Notification.isSupported()) return
    const key = `${state.title}|${state.artist}`
    if (!state.title || key === lastKey) return
    // don't spam when the user is skipping through a playlist
    if (Date.now() - lastNotifiedAt < 1500) {
      lastKey = key
      return
    }
    lastKey = key
    lastNotifiedAt = Date.now()

    let icon = null
    try {
      icon = await artworkFor(state.artwork)
    } catch {}

    try {
      const n = new Notification({
        title: state.title,
        body: [state.artist, state.album].filter(Boolean).join(' — '),
        icon: icon || undefined,
        silent: true // never make the shell beep over the music
      })
      n.on('click', () => {
        const { showWindow } = require('./window')
        showWindow()
      })
      n.show()
    } catch (err) {
      log.debug('[notify] show failed:', err.message)
    }
  }
}
