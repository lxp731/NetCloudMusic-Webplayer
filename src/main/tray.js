'use strict'

const path = require('node:path')
const { app, Tray, Menu, nativeImage } = require('electron')

const { PRODUCT_NAME } = require('../shared/config')
const log = require('./logger')

const ICON = path.join(__dirname, '..', 'assets', 'tray.png')

// Tray icon + a menu that mirrors the current playback state.
// On KDE the tray is a StatusNotifierItem; Plasma's applet renders it natively.
module.exports = function createTray ({ store, onCommand, onShow, onQuit }) {
  let image = nativeImage.createFromPath(ICON)
  if (image.isEmpty()) {
    log.warn('[tray] icon missing at', ICON)
    image = nativeImage.createEmpty()
  } else {
    image = image.resize({ width: 22, height: 22 })
  }

  let tray
  try {
    tray = new Tray(image)
  } catch (err) {
    log.error('[tray] cannot create tray:', err.message)
    return null
  }

  tray.setToolTip(PRODUCT_NAME)

  const build = () => {
    const s = store.state
    const playing = s.status === 'Playing'
    const title = s.title ? `${s.title}${s.artist ? ' — ' + s.artist : ''}` : '未在播放'
    const items = [
      { label: truncate(title, 60), enabled: false },
      { type: 'separator' },
      {
        label: playing ? '暂停' : '播放',
        click: () => onCommand({ type: 'playpause' })
      },
      { label: '上一首', click: () => onCommand({ type: 'prev' }) },
      { label: '下一首', click: () => onCommand({ type: 'next' }) },
      { type: 'separator' },
      { label: '显示主窗口', click: () => onShow() },
      { type: 'separator' },
      { label: '退出', click: () => onQuit() }
    ]
    return Menu.buildFromTemplate(items)
  }

  tray.setContextMenu(build())
  tray.on('click', () => onShow())

  let pending = null
  const refresh = () => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      try {
        tray.setContextMenu(build())
      } catch (err) {
        log.debug('[tray] refresh failed:', err.message)
      }
    }, 300)
  }

  if (app.dock) app.dock.setIcon(image)

  return { tray, refresh, destroy: () => { try { tray.destroy() } catch {} } }
}

function truncate (str, n) {
  return str.length > n ? str.slice(0, n - 1) + '…' : str
}
