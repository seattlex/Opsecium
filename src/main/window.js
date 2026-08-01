'use strict'

const path = require('node:path')
const { BaseWindow, WebContentsView, BrowserWindow } = require('electron')

const { TabManager, CHROME_HEIGHT } = require('./tabs')

const SHELL_PRELOAD = path.join(__dirname, '..', 'preload', 'shell.js')
const SHELL_HTML = path.join(__dirname, '..', 'renderer', 'shell.html')
const SETTINGS_HTML = path.join(__dirname, '..', 'renderer', 'settings.html')

let mainWindow = null
let tabManager = null
let settingsWindow = null

function createWindow ({ settings, getIdentity }) {
  const win = new BaseWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    title: 'Opsecium',
    backgroundColor: '#12141a',
    show: false
  })

  const shellView = new WebContentsView({
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.contentView.addChildView(shellView)
  shellView.webContents.loadFile(SHELL_HTML)

  tabManager = new TabManager(win, { shellView, getIdentity, settings })

  shellView.webContents.once('did-finish-load', () => {
    tabManager.create(settings.get('general.homepage'))
    win.show()
  })

  win.on('resize', () => tabManager.layout())
  win.on('closed', () => {
    tabManager.destroy()
    tabManager = null
    mainWindow = null
  })

  mainWindow = win
  return { win, shellView, tabManager }
}

function openSettings () {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return settingsWindow
  }
  settingsWindow = new BrowserWindow({
    width: 780,
    height: 720,
    title: 'Opsecium settings',
    backgroundColor: '#12141a',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  settingsWindow.setMenuBarVisibility(false)
  settingsWindow.loadFile(SETTINGS_HTML)
  settingsWindow.on('closed', () => { settingsWindow = null })
  return settingsWindow
}

function getTabManager () {
  return tabManager
}

function getMainWindow () {
  return mainWindow
}

function broadcastAll (channel, payload) {
  const targets = []
  if (tabManager && !tabManager.shellView.webContents.isDestroyed()) targets.push(tabManager.shellView.webContents)
  if (settingsWindow && !settingsWindow.isDestroyed()) targets.push(settingsWindow.webContents)
  for (const contents of targets) contents.send(channel, payload)
}

module.exports = { createWindow, openSettings, getTabManager, getMainWindow, broadcastAll, CHROME_HEIGHT }
