'use strict'

const { app, session } = require('electron')

const settings = require('./store')
const { applyHardeningSwitches } = require('./switches')
const useragent = require('./useragent')
const sessions = require('./session')
const windows = require('./window')
const ipc = require('./ipc')
const menu = require('./menu')
const lock = require('./lock')
const { VpnManager } = require('./vpn/manager')

settings.load()
applyHardeningSwitches(app, settings)
sessions.registerSchemePrivileges()

// Cached so every tab, header hook and preload sees exactly the same values.
let identity = useragent.resolve(settings)
const getIdentity = () => identity
function refreshIdentity () {
  identity = useragent.resolve(settings)
  const ses = sessions.browsingSession()
  ses.setUserAgent(identity.ua, identity.acceptLanguage)
  windows.broadcastAll('identity:changed', identity)
  return identity
}

const vpn = new VpnManager(settings)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = windows.getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    // A sealed settings file has to open before anything else happens. The
    // startup switches above already ran on defaults, which are the careful
    // ones, so nothing unsafe is in force while we wait.
    if (settings.locked) {
      ipc.registerLockOnly()
      await lock.requireUnlock()
      if (settings.locked) return // the window was closed, we are quitting
      identity = useragent.resolve(settings)
    }

    sessions.registerInternalPages()
    sessions.setupSession({ settings, vpn, getIdentity })

    vpn.on('status', (status) => windows.broadcastAll('vpn:status', status))
    await vpn.start()

    ipc.register({ settings, vpn, getIdentity, refreshIdentity })
    menu.build({ settings, vpn })
    windows.createWindow({ settings, getIdentity })

    // Locking hides every window; unlocking brings them back.
    lock.watchIdle(settings, (isLocked) => windows.setHidden(isLocked))

    app.on('activate', () => {
      if (!windows.getMainWindow()) windows.createWindow({ settings, getIdentity })
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  vpn.stop()
  if (settings.get('privacy.clearOnExit') && !app.__opseciumCleared) {
    event.preventDefault()
    app.__opseciumCleared = true
    try {
      await sessions.clearBrowsingData()
    } catch (err) {
      console.error('[exit] could not clear browsing data:', err.message)
    }
    app.quit()
  }
})

// Nothing in this browser needs to open a native window from a page, and a
// permissive default here is how a compromised renderer gets out.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

process.on('uncaughtException', (err) => {
  console.error('[fatal]', err)
})

// Never let Chromium fall back to a remote resolver we did not ask for.
app.on('ready', () => {
  session.defaultSession.setProxy({ mode: 'direct' }).catch(() => {})
})
