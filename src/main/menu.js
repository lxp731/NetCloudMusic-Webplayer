'use strict'

const { Menu, shell, app, dialog } = require('electron')

const { PRODUCT_NAME } = require('../shared/config')
const log = require('./logger')

// Minimal menu: the app is a music player, not an editor. Menu bar is
// auto-hidden (Alt reveals it) so the web UI starts at the top of the window.

module.exports = function buildMenu ({ onReload, onLogout, isDev }) {
  const template = [
    {
      label: PRODUCT_NAME,
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: onReload },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(isDev ? [{ role: 'toggleDevTools', label: '开发者工具' }] : [])
      ]
    },
    {
      label: '账户',
      submenu: [
        {
          label: '退出登录（清除本机数据）',
          click: async () => {
            const { response } = await dialog.showMessageBox({
              type: 'warning',
              buttons: ['取消', '退出登录'],
              defaultId: 0,
              cancelId: 0,
              message: '退出登录将清除本机的登录状态与缓存，确定继续？'
            })
            if (response === 1) onLogout()
          }
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '网易云音乐网页版',
          click: () => shell.openExternal('https://music.163.com/')
        },
        {
          label: '查看日志',
          click: () => shell.openPath(require('./logger').getFile() || '')
        },
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox({
              type: 'info',
              title: '关于',
              message: PRODUCT_NAME,
              detail: [
                `版本 ${app.getVersion()}`,
                `Electron ${process.versions.electron} / Chromium ${process.versions.chrome}`,
                '',
                '非官方 Linux 桌面外壳，界面与内容来自网易云音乐网页版。'
              ].join('\n')
            })
          }
        }
      ]
    }
  ]

  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } catch (err) {
    log.warn('[menu] failed:', err.message)
  }
}
