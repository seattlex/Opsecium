'use strict'

const { Menu, app } = require('electron')

const windows = require('./window')
const sessions = require('./session')

function build ({ settings, vpn }) {
  const tabs = () => windows.getTabManager()
  const active = () => tabs()?.active

  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New tab', accelerator: 'CmdOrCtrl+T', click: () => tabs()?.create() },
        { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => { const t = active(); if (t) tabs().close(t.id) } },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => windows.openSettings() },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => active()?.contents.reload() },
        { label: 'Reload ignoring cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => active()?.contents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(active(), 0.5) },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => zoom(active(), -0.5) },
        { label: 'Reset zoom', accelerator: 'CmdOrCtrl+0', click: () => { const t = active(); if (t) t.contents.setZoomLevel(0) } },
        { type: 'separator' },
        { label: 'Developer tools', accelerator: 'F12', click: () => tabs()?.toggleDevTools(active()) }
      ]
    },
    {
      label: 'Privacy',
      submenu: [
        {
          label: 'Clear browsing data',
          click: async () => { await sessions.clearBrowsingData() }
        },
        {
          label: 'Kill switch',
          type: 'checkbox',
          checked: !!settings.get('vpn.killSwitch'),
          click: (item) => {
            settings.set('vpn.killSwitch', item.checked)
            vpn.refresh().catch(() => {})
          }
        },
        { type: 'separator' },
        { label: 'User agent and VPN settings', click: () => windows.openSettings() }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function zoom (tab, delta) {
  if (!tab || tab.contents.isDestroyed()) return
  tab.contents.setZoomLevel(tab.contents.getZoomLevel() + delta)
}

module.exports = { build }
