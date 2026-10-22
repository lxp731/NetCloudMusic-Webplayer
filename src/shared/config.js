'use strict'

// Shared constants. Keep this file free of Electron imports so it can be reused
// by tooling and tests.

const APP_NAME = 'netcloud-music' // used for paths (no spaces)
const PRODUCT_NAME = 'NetCloud Music'
const APP_ID = 'io.github.lxp731.netcloudmusic'
const DESKTOP_ENTRY = 'netcloud-music'

const MPRIS_NAME = 'org.mpris.MediaPlayer2.netcloud_music'
const MPRIS_PATH = '/org/mpris/MediaPlayer2'

// Cookies / localStorage / caches for the site live in their own partition so a
// "log out" is a clean partition wipe.
const PARTITION = 'persist:netease'

const PLAYER_URL = process.env.NETCLOUD_URL || 'https://music.163.com/st/webplayer'

// Hosts the shell is allowed to navigate to / open inside the window.
// Includes the third-party login hops (QQ / WeChat) so the QR flows keep
// working in-app; anything else is handed to the system browser.
const ALLOWED_HOSTS = [
  /(^|\.)music\.163\.com$/,
  /(^|\.)163\.com$/,
  /(^|\.)126\.net$/,
  /(^|\.)127\.net$/,
  /(^|\.)163yun\.com$/,
  /(^|\.)netease\.com$/,
  /(^|\.)qq\.com$/,
  /(^|\.)weixin\.qq\.com$/
]

// Present ourselves as plain Chrome. The site sniffs the UA and only enables
// some paths for "known" browsers; Electron's default UA is never useful here.
const CHROME_MAJOR = process.versions.chrome || '142.0.0.0'
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${CHROME_MAJOR} Safari/537.36`

function isAllowedUrl (url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

module.exports = {
  APP_NAME,
  PRODUCT_NAME,
  APP_ID,
  DESKTOP_ENTRY,
  MPRIS_NAME,
  MPRIS_PATH,
  PARTITION,
  PLAYER_URL,
  USER_AGENT,
  ALLOWED_HOSTS,
  isAllowedUrl
}
