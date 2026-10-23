// Chrome identity spoof (initialization script, runs before the site's bundle).
//
// WebKitGTK renders the page fine, but its `navigator.vendor` ("Apple Computer,
// Inc.") and missing `window.chrome` object give it away as a non-Chrome
// browser. The official web player sniffs these and — on a browser it doesn't
// recognise — its desktop audio engine (rudio) rejects during init and React
// never mounts, leaving a blank window. Pretending to be Chrome fixes it.
;(function () {
  if (window.__netcloudSpoofed) return
  window.__netcloudSpoofed = true

  function def (obj, key, value) {
    try {
      Object.defineProperty(obj, key, {
        value: value,
        configurable: true,
        writable: true
      })
    } catch (_) {
      try { obj[key] = value } catch (_) {}
    }
  }

  if (!window.chrome) {
    def(window, 'chrome', {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: { isInstalled: false },
      webstore: {}
    })
  }

  def(Navigator.prototype, 'vendor', 'Google Inc.')
  def(Navigator.prototype, 'platform', 'Linux x86_64')

  if (!navigator.userAgentData) {
    def(Navigator.prototype, 'userAgentData', {
      brands: [
        { brand: 'Chromium', version: '142' },
        { brand: 'Google Chrome', version: '142' },
        { brand: 'Not.A/Brand', version: '8' }
      ],
      mobile: false,
      platform: 'Linux',
      getHighEntropyValues: function () {
        return Promise.resolve({ platform: 'Linux', platformVersion: '6.0.0' })
      }
    })
  }

  // requestIdleCallback is Chromium-only; WebKitGTK lacks it. The web player's
  // desktop audio engine (rudio) calls it and dies with a ReferenceError.
  if (!window.requestIdleCallback) {
    def(window, 'requestIdleCallback', function (cb, options) {
      var start = Date.now()
      return setTimeout(function () {
        cb({
          didTimeout: false,
          timeRemaining: function () {
            return Math.max(0, 50 - (Date.now() - start))
          }
        })
      }, (options && options.timeout) || 1)
    })
  }
  if (!window.cancelIdleCallback) {
    def(window, 'cancelIdleCallback', function (id) { clearTimeout(id) })
  }
})()
