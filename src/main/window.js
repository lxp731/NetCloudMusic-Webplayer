'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, shell } = require('electron')

const { PARTITION, PLAYER_URL, USER_AGENT, isAllowedUrl } = require('../shared/config')
const log = require('./logger')

const HOOK_PATH = path.join(__dirname, '..', 'preload', 'page-hook.js')
const PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'index.js')
const ERROR_PAGE = path.join(__dirname, '..', 'renderer', 'error.html')

const DEFAULTS = { width: 1280, height: 820 }

let win = null
let hookSource = null
let quitting = false
let saveTimer = null
let trayAvailable = false

function statePath () {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadState () {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    if (typeof raw.width === 'number' && typeof raw.height === 'number') return raw
  } catch {}
  return { ...DEFAULTS, maximized: false }
}

function saveState () {
  if (!win || win.isDestroyed()) return
  const wasMaximized = win.isMaximized()
  const bounds = wasMaximized ? (win.__normalBounds || win.getNormalBounds()) : win.getBounds()
  const data = { ...bounds, maximized: wasMaximized }
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(data))
  } catch (err) {
    log.warn('[window] cannot save state:', err.message)
  }
}

function scheduleSave () {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveState, 400)
}

function getHookSource () {
  if (hookSource == null) {
    try {
      hookSource = fs.readFileSync(HOOK_PATH, 'utf8')
    } catch (err) {
      log.error('[window] cannot read page hook:', err.message)
      hookSource = ''
    }
  }
  return hookSource
}

function createMainWindow () {
  const state = loadState()

  win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 900,
    minHeight: 600,
    title: 'NetCloud Music',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  win.__normalBounds = { width: state.width, height: state.height, x: state.x, y: state.y }

  if (state.maximized) win.maximize()

  win.once('ready-to-show', () => {
    win.show()
    log.info('[window] shown')
  })

  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', scheduleSave)
  win.on('unmaximize', scheduleSave)

  win.on('close', (event) => {
    if (!quitting && trayAvailable) {
      event.preventDefault()
      win.hide()
      log.info('[window] hidden to tray')
    } else {
      saveState()
    }
  })

  win.webContents.on('dom-ready', () => {
    const src = getHookSource()
    if (!src) return
    win.webContents.executeJavaScript(src, true).catch((err) => {
      log.warn('[window] hook injection failed:', err.message)
    })
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ERR_ABORTED */) return
    log.error('[window] load failed', code, desc, url)
    win.loadFile(ERROR_PAGE, {
      query: { code: String(code), desc: desc || '', url: url || PLAYER_URL }
    }).catch(() => {})
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('[window] renderer gone:', details.reason)
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      win.loadURL(PLAYER_URL).catch(() => {})
    }, 1200)
  })

  // Popups: never open a second Electron window for site content.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      // Same-site popups (share dialogs etc.) are navigations in disguise.
      win.webContents.loadURL(url).catch(() => {})
    } else {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })

  // Keep the app inside the allowed hosts; anything else goes to the browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return
    event.preventDefault()
    log.info('[window] external navigation blocked:', url)
    shell.openExternal(url).catch(() => {})
  })

  win.webContents.setUserAgent(USER_AGENT)
  win.loadURL(PLAYER_URL).catch((err) => {
    // -3/ERR_ABORTED is the normal "the page redirected itself" case
    if (!/ERR_ABORTED/.test(err.message)) log.error('[window] loadURL:', err.message)
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents
      .executeJavaScript(
        `({ title: document.title, chars: (document.body.innerText || '').length, hash: location.hash.slice(0, 80) })`
      )
      .then((info) => log.info('[window] loaded:', JSON.stringify(info)))
      .catch(() => {})
  })

  win.webContents.on('did-navigate', (_e, url) => log.info('[window] navigate:', url))
  win.webContents.on('did-navigate-in-page', (_e, url) => log.info('[window] in-page:', url))

  win.webContents.on('page-title-updated', (_e, title) => {
    win.setTitle(title && title !== '网易云音乐' ? `${title} · NetCloud Music` : 'NetCloud Music')
  })

  return win
}

function getWindow () {
  return win
}

function showWindow () {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow () {
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) win.hide()
  else showWindow()
}

function markQuitting () {
  quitting = true
}

function setTrayAvailable (available) {
  trayAvailable = !!available
}

function reload () {
  if (!win || win.isDestroyed()) return
  win.loadURL(PLAYER_URL).catch(() => {})
}

module.exports = {
  createMainWindow,
  setTrayAvailable,
  getWindow,
  showWindow,
  toggleWindow,
  markQuitting,
  reload,
  saveState
}
