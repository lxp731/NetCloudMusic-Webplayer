'use strict'

// Preload: the only bridge between the site's page world and the main process.
// Runs with `sandbox: true`, so it deliberately requires nothing but electron.
const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL = '__netcloud'

// page world -> main
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data[CHANNEL] !== true) return
  try {
    if (data.kind === 'state') {
      ipcRenderer.send('media:state', data.payload)
    } else if (data.kind === 'event') {
      ipcRenderer.send('page:event', data.payload)
    } else if (data.kind === 'probe') {
      ipcRenderer.send('page:probe', data.payload)
    }
  } catch (_) {}
})

// main -> page world
ipcRenderer.on('shell:command', (_event, cmd) => {
  window.postMessage({ [CHANNEL]: true, kind: 'command', cmd }, '*')
})

ipcRenderer.on('shell:probe', () => {
  window.postMessage({ [CHANNEL]: true, kind: 'command', cmd: { type: 'probe' } }, '*')
})

// A tiny, inert API so the local pages (error screen) can talk to the shell.
// It intentionally exposes nothing about the page itself.
contextBridge.exposeInMainWorld('netcloud', {
  retry: () => ipcRenderer.send('shell:retry'),
  version: process.env.NETCLOUD_VERSION || ''
})
