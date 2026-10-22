'use strict'

const { app, session, shell } = require('electron')

const { PARTITION, USER_AGENT, isAllowedUrl } = require('../shared/config')
const log = require('./logger')

// Browser-side setup for the site: UA, permissions, proxy, spellchecker.
// Everything persistent lives in one partition so "log out" == wipe partition.

function getSession () {
  return session.fromPartition(PARTITION)
}

function setupSession ({ proxy } = {}) {
  const sess = getSession()

  // The site serves a different (worse) build to unknown UAs and some features
  // only light up for a plain Chrome UA.
  sess.setUserAgent(USER_AGENT, 'zh-CN,zh;q=0.9,en;q=0.8')

  // Deny by default. The page asks for notifications (song change) and
  // microphone (听歌识曲); everything else has no business here.
  const allowed = new Set(['notifications', 'media', 'clipboard-sanitized-write'])
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    const grant = allowed.has(permission)
    log.debug('[session] permission', permission, grant ? 'granted' : 'denied')
    callback(grant)
  })
  sess.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))

  sess.setSpellCheckerEnabled(false)

  if (proxy && proxy !== 'system') {
    sess.setProxy({ proxyRules: proxy }).catch((err) => log.warn('[session] proxy failed:', err.message))
  } else {
    sess.setProxy({ mode: 'system' }).catch(() => {})
  }

  // Any download the page initiates is a user action inside the official web
  // player; let Chromium handle it but log the destination.
  sess.on('will-download', (_event, item) => {
    log.info('[session] download:', item.getFilename())
  })

  log.info('[session] ready partition=' + PARTITION + ' ua=' + USER_AGENT)
  return sess
}

async function clearSiteData () {
  const sess = getSession()
  await sess.clearStorageData()
  await sess.clearCache()
  log.info('[session] site data cleared')
}

function openExternal (url) {
  if (!isAllowedUrl(url)) return false
  shell.openExternal(url)
  return true
}

module.exports = { getSession, setupSession, clearSiteData, openExternal }
