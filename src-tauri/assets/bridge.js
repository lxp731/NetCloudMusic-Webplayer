// Tauri bridge (initialization script, main world).
//
// Runs alongside page-hook.js in the site's page world. page-hook.js talks over
// `window.postMessage` exactly as it did under Electron; this script is the
// adapter that forwards those messages to the Rust core through Tauri's IPC.
//
// It deliberately depends on nothing but the global `__TAURI__` / the internal
// `__TAURI_INTERNALS__`, both of which Tauri injects for us because
// `withGlobalTauri` is on and this origin is allow-listed in capabilities.
(() => {
  if (window.__netcloudBridgeHooked) return
  window.__netcloudBridgeHooked = true

  // Capture early JS errors for diagnostics (WebKitGTK console isn't exposed).
  window.__netcloudErrors = []
  window.addEventListener('error', function (e) {
    try {
      window.__netcloudErrors.push(String(e.message) + ' @' + (e.filename || '') + ':' + (e.lineno || 0))
    } catch (_) {}
  })
  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason
      var info
      if (r && r.message) info = 'msg=' + r.message + ' name=' + (r.name || '')
      else if (typeof r === 'string') info = r
      else info = JSON.stringify(r).slice(0, 600)
      window.__netcloudErrors.push('rejection: ' + info + '\n' + String(r && r.stack || '').slice(0, 400))
    } catch (_) {}
  })

  var CHANNEL = '__netcloud'

  function invoke (cmd, payload) {
    var p = null
    try {
      var T = window.__TAURI__
      if (T && T.core && typeof T.core.invoke === 'function') {
        p = T.core.invoke(cmd, { payload: payload })
      }
    } catch (e) { window.__netcloudLastErr = 'T1:' + String(e) }
    if (!p) {
      try {
        var I = window.__TAURI_INTERNALS__
        if (I && typeof I.invoke === 'function') {
          p = I.invoke(cmd, { payload: payload })
        } else {
          window.__netcloudLastErr = 'NO_INTERNALS_INVOKE'
        }
      } catch (e) { window.__netcloudLastErr = 'T2:' + String(e) }
    }
    if (p && typeof p.catch === 'function') {
      p.catch(function (e) {
        window.__netcloudLastErr = 'REJECT:' + String(e && (e.message || e))
      })
    }
    return p
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data[CHANNEL] !== true) return
    try {
      if (data.kind === 'state') {
        invoke('media_state', data.payload)
      } else if (data.kind === 'event') {
        invoke('page_event', data.payload)
      } else if (data.kind === 'probe') {
        invoke('page_probe', data.payload)
      }
    } catch (_) {}
  })
})()
