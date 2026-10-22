'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app, ipcMain } = require('electron')

const config = require('../shared/config')
const log = require('./logger')
const { MediaStore } = require('./media')
const { MprisService } = require('./mpris')
const sessionSetup = require('./session')
const windows = require('./window')
const createTray = require('./tray')
const buildMenu = require('./menu')

const argv = process.argv.slice(1)
const isDev = argv.includes('--dev') || !app.isPackaged
const probeMode = argv.includes('--probe')

const store = new MediaStore()
let mpris = null
let tray = null

// A second launch focuses the running window instead of starting a new player.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap () {
  // Make the window's WM_CLASS / Wayland app_id match the .desktop file so the
  // taskbar picks up our icon and the entry instead of a generic Electron one.
  app.commandLine.appendSwitch('class', config.APP_NAME)
  configurePaths()
  app.setName(config.APP_NAME)
  if (process.platform === 'linux') {
    app.setDesktopName?.(`${config.DESKTOP_ENTRY}.desktop`)
  }
  app.setAppUserModelId(config.APP_ID)

  app.on('second-instance', () => windows.showWindow())
  app.on('window-all-closed', () => {
    // tray keeps the app alive; only an explicit quit ends it
  })

  app.whenReady().then(onReady).catch((err) => {
    log.error('[main] startup failed:', err && err.stack ? err.stack : err)
    app.exit(1)
  })
}

async function onReady () {
  log.init(app.getPath('logs'))
  log.info('starting', config.PRODUCT_NAME, app.getVersion(), 'electron', process.versions.electron, 'dev=' + isDev)
  if (probeMode) log.info('[main] probe mode enabled')

  sessionSetup.setupSession({})
  wireIpc()

  windows.createMainWindow()

  const win = windows.getWindow()
  // Dev/testing: start muted so automated playback checks don't blast audio.
  if (process.env.NETCLOUD_MUTE === '1') {
    win.webContents.setAudioMuted(true)
    log.info('[main] window muted (NETCLOUD_MUTE)')
  }

  // MPRIS
  mpris = new MprisService({
    store,
    onCommand: (cmd) => sendCommand(cmd),
    raise: () => windows.showWindow(),
    quit: () => quit()
  })
  await mpris.start()

  // Tray
  tray = createTray({
    store,
    onCommand: (cmd) => sendCommand(cmd),
    onShow: () => windows.showWindow(),
    onQuit: () => quit()
  })
  windows.setTrayAvailable(!!tray)
  log.info('[tray] ' + (tray ? 'created' : 'unavailable (close will quit the app)'))

  // Menu
  buildMenu({
    isDev,
    onReload: () => windows.reload(),
    onLogout: async () => {
      await sessionSetup.clearSiteData()
      windows.reload()
    }
  })

  // Store -> integrations
  store.on('change', (state, changed) => {
    if (mpris) mpris.sync(state, changed)
    if (tray) tray.refresh()
  })
  store.on('track', (state) => {
    log.info('[media] track:', state.title, '—', state.artist, '(' + state.source + ')')
  })

  if (probeMode) {
    setTimeout(() => win.webContents.send('shell:probe'), 6000)
  }

  log.info('[main] ready')
}

function wireIpc () {
  ipcMain.on('media:state', (_event, payload) => {
    if (payload && typeof payload === 'object') {
      store.update(payload)
      log.debug('[media] state', payload.status, payload.title, payload.position)
    }
  })

  ipcMain.on('page:event', (_event, payload) => {
    if (!payload) return
    if (payload.kind === 'command-miss' || payload.kind === 'command-click' || payload.kind === 'command-error') {
      log.info('[page]', payload.kind, JSON.stringify(payload).slice(0, 300))
    } else {
      log.info('[page]', payload.kind, JSON.stringify(payload).slice(0, 200))
    }
  })

  ipcMain.on('page:probe', (_event, payload) => {
    log.info('[probe] ' + JSON.stringify(payload, null, 1))
    console.log('[probe] ' + JSON.stringify(payload, null, 1))
  })

  ipcMain.on('shell:retry', () => windows.reload())

  ipcMain.handle('shell:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    state: store.snapshot
  }))
}

// MPRIS/tray commands are forwarded to the page world through the preload.
function sendCommand (cmd) {
  const win = windows.getWindow()
  if (!win || win.isDestroyed()) return
  log.debug('[cmd]', JSON.stringify(cmd))
  win.webContents.send('shell:command', cmd)
}

// Electron derives userData from package.json (productName) and app.setName()
// does not move it, so pin it explicitly. Migrate the first-run directory so an
// existing login survives the change.
function configurePaths () {
  const target = path.join(app.getPath('appData'), config.APP_NAME)
  const legacy = path.join(app.getPath('appData'), config.LEGACY_DIR_NAME)
  try {
    if (!fs.existsSync(target) && fs.existsSync(legacy)) {
      fs.renameSync(legacy, target)
    }
  } catch (err) {
    console.error('[paths] migration failed:', err.message)
  }
  app.setPath('userData', target)
}

function quit () {
  windows.markQuitting()
  windows.saveState()
  try {
    if (tray) tray.destroy()
  } catch {}
  app.quit()
}

// Dev conveniences: `kill -USR1 <pid>` dumps the live page, `kill -USR2` opens
// DevTools. Both are no-ops in packaged builds unless --dev is passed.
if (isDev) {
  process.on('SIGUSR1', async () => {
    const win = windows.getWindow()
    if (!win || win.isDestroyed()) return
    try {
      const info = await win.webContents.executeJavaScript(`(() => {
        const media = [...document.querySelectorAll('audio,video')].map((el) => ({
          tag: el.tagName, src: String(el.currentSrc || el.src || '').slice(0, 100),
          paused: el.paused, t: el.currentTime, dur: el.duration, vol: el.volume
        }));
        const all = [...document.querySelectorAll('svg[aria-label],[role="button"],button,[class*="cmd-icon"]')]
          .filter((el) => el.getClientRects().length)
          .map((el) => ({ label: (el.getAttribute('aria-label') || el.getAttribute('title') || String(el.className)).slice(0, 50), top: Math.round(el.getBoundingClientRect().top) }))
          .sort((a, b) => a.top - b.top);
        const controls = all.filter((c) => c.top > innerHeight * 0.6).length
          ? all.filter((c) => c.top > innerHeight * 0.6)
          : all.slice(0, 40);
        return {
          href: location.href, title: document.title,
          text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
          mediaSession: navigator.mediaSession && navigator.mediaSession.metadata
            ? { title: navigator.mediaSession.metadata.title, artist: navigator.mediaSession.metadata.artist }
            : null,
          media, controls,
          inputs: document.querySelectorAll('input').length,
          hooks: !!window.__netcloudHooked,
          iframes: [...document.querySelectorAll('iframe')].map((f) => f.src).slice(0, 8),
          frameMedia: (() => {
            const out = []
            for (let i = 0; i < window.frames.length; i++) {
              try {
                const d = window.frames[i].document
                const els = d.querySelectorAll('audio,video')
                if (els.length) out.push({ i, url: window.frames[i].location.href.slice(0, 80), n: els.length,
                  src: String(els[0].currentSrc || els[0].src || '').slice(0, 80), paused: els[0].paused })
              } catch (e) { out.push({ i, error: 'cross-origin' }) }
            }
            return out
          })(),
          dialogs: [...document.querySelectorAll('[role="dialog"],[class*="modal" i],[class*="dialog" i]')]
            .slice(0, 4).map((el) => (el.innerText || '').replace(/\s+/g, ' ').slice(0, 80))
        };
      })()`)
      log.info('[dump] ' + JSON.stringify(info, null, 1))
    } catch (err) {
      log.error('[dump] failed:', err.message)
    }
  })
  process.on('SIGUSR2', () => {
    const win = windows.getWindow()
    if (win && !win.isDestroyed()) win.webContents.toggleDevTools()
  })
}

// Keep the app usable if something explodes in the main process.
process.on('uncaughtException', (err) => {
  log.error('[main] uncaught exception:', err && err.stack ? err.stack : err)
})
process.on('unhandledRejection', (reason) => {
  log.error('[main] unhandled rejection:', reason && reason.stack ? reason.stack : reason)
})
