'use strict'

// Locking is only worth anything if the passphrase is not sitting in memory
// while the window is locked. So on lock we drop it and keep a verifier - a
// small sealed blob holding a known token. Unlocking means deriving the key
// again and opening that. Wrong passphrase, no token, no way back in.

const { BrowserWindow, powerMonitor, clipboard, app } = require('electron')
const path = require('node:path')

const vault = require('./vault')
const store = require('./store')

const TOKEN = 'opsecium-lock-token'
const POLL_MS = 15000

const LOCK_HTML = path.join(__dirname, '..', 'renderer', 'lock.html')
const SHELL_PRELOAD = path.join(__dirname, '..', 'preload', 'shell.js')

let verifier = null
let lockWindow = null
let timer = null
let locked = false
let pending = null
let onStateChange = () => {}

function isLocked () {
  return locked
}

// Called whenever we hold a good passphrase: after unlocking at startup, and
// after the user sets one in settings.
async function rememberVerifier (passphrase) {
  verifier = passphrase ? await vault.seal(TOKEN, passphrase) : null
  return !!verifier
}

function canLock () {
  return !!verifier
}

function createLockWindow (mode) {
  if (lockWindow && !lockWindow.isDestroyed()) {
    lockWindow.focus()
    return lockWindow
  }
  lockWindow = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Opsecium',
    backgroundColor: '#12141a',
    webPreferences: {
      preload: SHELL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  lockWindow.setMenuBarVisibility(false)
  // the passphrase field should not turn up in a screen recording either
  lockWindow.setContentProtection(true)
  lockWindow.loadFile(LOCK_HTML, { query: { mode } })
  return lockWindow
}

function closeLockWindow () {
  if (lockWindow && !lockWindow.isDestroyed()) lockWindow.destroy()
  lockWindow = null
}

// Startup: the settings file on disk is sealed and nothing can proceed until
// it opens. Quitting is the only other way out.
function requireUnlock () {
  return new Promise((resolve) => {
    const win = createLockWindow('startup')
    win.on('closed', () => {
      if (store.locked) app.quit()
    })
    pending = { resolve, mode: 'startup' }
  })
}

async function attempt (passphrase) {
  try {
    if (store.locked) {
      await store.unlock(passphrase)
      await rememberVerifier(passphrase)
      locked = false
      closeLockWindow()
      if (pending) {
        const { resolve } = pending
        pending = null
        resolve(true)
      }
      onStateChange(false)
      return { ok: true }
    }

    if (!verifier) return { ok: false, error: 'no passphrase is set' }
    const token = await vault.open(verifier, passphrase)
    if (token !== TOKEN) return { ok: false, error: 'wrong passphrase' }

    store.passphrase = passphrase
    locked = false
    closeLockWindow()
    onStateChange(false)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function lockNow (settings) {
  if (locked || !canLock()) return false
  locked = true
  // the passphrase leaves memory for as long as we are locked
  store.passphrase = null
  if (settings && settings.get('privacy.clearClipboard')) clipboard.clear()
  onStateChange(true)
  createLockWindow('locked')
  return true
}

function watchIdle (settings, stateChange) {
  onStateChange = stateChange || (() => {})
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    const minutes = Number(settings.get('privacy.lockAfterMinutes')) || 0
    if (!minutes || locked || !canLock()) return
    let idle = 0
    try {
      idle = powerMonitor.getSystemIdleTime()
    } catch {
      return // not available on this platform, leave it alone
    }
    if (idle >= minutes * 60) lockNow(settings)
  }, POLL_MS)
  if (timer.unref) timer.unref()

  // a locked screen the moment the machine sleeps, whatever the idle timer says
  try {
    powerMonitor.on('suspend', () => { if (canLock()) lockNow(settings) })
    powerMonitor.on('lock-screen', () => { if (canLock()) lockNow(settings) })
  } catch { /* not everywhere */ }
}

function stop () {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = { requireUnlock, attempt, lockNow, isLocked, canLock, rememberVerifier, watchIdle, stop }
