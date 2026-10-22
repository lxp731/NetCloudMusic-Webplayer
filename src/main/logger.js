'use strict'

const fs = require('node:fs')
const path = require('node:path')

// Tiny logger: file + stderr. The file lives in the Electron logs dir so the
// user can attach it to a bug report without hunting through the terminal.
let stream = null
let filePath = null

function init (logsDir) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
    filePath = path.join(logsDir, 'netcloud-music.log')
    // keep the last run's log around instead of growing forever
    try {
      const st = fs.statSync(filePath)
      if (st.size > 2 * 1024 * 1024) fs.renameSync(filePath, filePath + '.1')
    } catch {}
    stream = fs.createWriteStream(filePath, { flags: 'a' })
  } catch (err) {
    console.error('[logger] cannot open log file:', err.message)
  }
}

function write (level, args) {
  const line = `${new Date().toISOString()} ${level} ${args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ')}`
  if (level === 'ERROR') console.error(line)
  else if (process.env.NETCLOUD_VERBOSE) console.error(line)
  if (stream) stream.write(line + '\n')
}

function safeStringify (v) {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

module.exports = {
  init,
  getFile: () => filePath,
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
  debug: (...a) => (process.env.NETCLOUD_VERBOSE ? write('DEBUG', a) : undefined)
}
