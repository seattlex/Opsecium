'use strict'

const { Menu, app, clipboard, dialog } = require('electron')

const windows = require('./window')
const sessions = require('./session')
const fingerprint = require('./fingerprint')
const lock = require('./lock')

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
          label: 'New identity',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: async () => {
            fingerprint.rotateSeed()
            await sessions.clearBrowsingData()
            const manager = tabs()
            if (manager) for (const tab of manager.tabs.slice()) manager.close(tab.id)
          }
        },
        {
          label: 'Leak check',
          click: () => tabs()?.create('opsecium://leaks')
        },
        {
          label: 'Lock now',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            if (!lock.lockNow(settings)) {
              dialog.showMessageBox({
                type: 'info',
                title: 'No passphrase set',
                message: 'Locking needs a passphrase.',
                detail: 'Set one under Confidentiality in settings. Without it there would be nothing to unlock with.'
              })
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Clear browsing data',
          click: async () => { await sessions.clearBrowsingData() }
        },
        {
          label: 'Wipe and quit',
          accelerator: 'CmdOrCtrl+Shift+Backspace',
          click: async () => {
            try {
              await sessions.clearBrowsingData()
            } finally {
              clipboard.clear()
              app.exit(0)
            }
          }
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
