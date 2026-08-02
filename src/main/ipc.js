'use strict'

const { ipcMain, app, clipboard } = require('electron')

const useragent = require('./useragent')
const spoof = require('./spoof')
const fingerprint = require('./fingerprint')
const lock = require('./lock')
const urls = require('./urls')
const sessions = require('./session')
const windows = require('./window')

// The unlock window comes up before the rest of the app exists, so its one
// handler is registered on its own first.
let lockRegistered = false
function registerLockOnly () {
  if (lockRegistered) return
  lockRegistered = true
  ipcMain.handle('lock:attempt', (_e, passphrase) => lock.attempt(passphrase))
}

function register ({ settings, vpn, getIdentity, refreshIdentity }) {
  const tabs = () => windows.getTabManager()

  // The page preload asks for this synchronously so the shim is in place
  // before any page script runs.
  ipcMain.on('opsecium:page-config', (event) => {
    const identity = getIdentity()
    event.returnValue = {
      ...spoof.pageShimConfig(identity),
      fingerprint: fingerprint.configFor(identity, settings)
    }
  })

  ipcMain.handle('tabs:new', (_e, url) => { tabs()?.create(url); return true })
  ipcMain.handle('tabs:close', (_e, id) => { tabs()?.close(id); return true })
  ipcMain.handle('tabs:select', (_e, id) => { tabs()?.select(id); return true })
  ipcMain.handle('tabs:state', () => {
    const manager = tabs()
    if (!manager) return { tabs: [], activeId: null }
    return { tabs: manager.tabs.map((t) => t.serialise()), activeId: manager.activeId }
  })

  ipcMain.handle('nav:load', (_e, input) => {
    const manager = tabs()
    const tab = manager?.active
    if (!tab) return false
    const url = urls.normalise(input, settings.get('general.searchEngine'))
    if (!url) return false
    tab.contents.loadURL(url)
    return true
  })

  ipcMain.handle('nav:action', (_e, action) => {
    const manager = tabs()
    const tab = manager?.active
    if (!tab || tab.contents.isDestroyed()) return false
    const history = tab.contents.navigationHistory
    switch (action) {
      case 'back': if (history.canGoBack()) history.goBack(); break
      case 'forward': if (history.canGoForward()) history.goForward(); break
      case 'reload': tab.contents.reload(); break
      case 'hard-reload': tab.contents.reloadIgnoringCache(); break
      case 'stop': tab.contents.stop(); break
      case 'home': tab.contents.loadURL(settings.get('general.homepage')); break
      case 'devtools': manager.toggleDevTools(tab); break
      default: return false
    }
    return true
  })

  ipcMain.handle('ua:list', () => ({
    profiles: useragent.PROFILES.map(({ id, label, ua }) => ({ id, label, ua })),
    current: getIdentity()
  }))

  ipcMain.handle('ua:preview', (_e, ua) => {
    const string = String(ua || '').trim()
    if (!string) return null
    return { ua: string, meta: useragent.metadataFor(string), device: useragent.guessDevice(string) }
  })

  ipcMain.handle('ua:set', (_e, { profile, custom }) => {
    if (profile) settings.set('useragent.profile', profile)
    if (custom !== undefined) settings.set('useragent.custom', custom)
    const identity = refreshIdentity()
    tabs()?.refreshIdentity()
    return identity
  })

  ipcMain.handle('settings:get', () => ({
    settings: settings.all(),
    identity: getIdentity(),
    vpn: vpn.status,
    blocked: sessions.blockedCount(),
    version: app.getVersion(),
    chromium: process.versions.chrome
  }))

  ipcMain.handle('settings:patch', async (_e, partial) => {
    settings.patch(partial)
    const identity = refreshIdentity()
    await sessions.reapplySession(settings)
    tabs()?.refreshIdentity()
    await vpn.refresh()
    windows.broadcastAll('settings:changed', settings.all())
    return { settings: settings.all(), identity, vpn: vpn.status }
  })

  ipcMain.handle('settings:reset', async () => {
    settings.reset()
    refreshIdentity()
    await sessions.reapplySession(settings)
    tabs()?.refreshIdentity()
    windows.broadcastAll('settings:changed', settings.all())
    return settings.all()
  })

  ipcMain.handle('settings:open', () => { windows.openSettings(); return true })

  ipcMain.handle('vpn:status', () => vpn.status)
  ipcMain.handle('vpn:toggle', async () => {
    try {
      await vpn.toggle()
    } catch (err) {
      return { ...vpn.status, state: 'error', detail: err.message }
    }
    return vpn.status
  })
  ipcMain.handle('vpn:connect', async () => {
    try {
      await vpn.connect()
    } catch (err) {
      return { ...vpn.status, state: 'error', detail: err.message }
    }
    return vpn.status
  })
  ipcMain.handle('vpn:disconnect', async () => {
    try {
      await vpn.disconnect()
    } catch (err) {
      return { ...vpn.status, state: 'error', detail: err.message }
    }
    return vpn.status
  })
  ipcMain.handle('vpn:regions', () => vpn.listRegions())

  ipcMain.handle('privacy:clear', async () => {
    await sessions.clearBrowsingData()
    return true
  })

  // Everything that ties this session to the last one, in one action: storage
  // gone, fingerprint seed rotated, open tabs replaced.
  ipcMain.handle('privacy:new-identity', async () => {
    fingerprint.rotateSeed()
    await sessions.clearBrowsingData()
    const manager = tabs()
    if (manager) {
      for (const tab of manager.tabs.slice()) manager.close(tab.id)
    }
    windows.broadcastAll('identity:changed', getIdentity())
    return true
  })

  ipcMain.handle('privacy:timezones', () => fingerprint.TIMEZONES)

  // Panic. Clears the session and the clipboard, then quits. It does not
  // touch your settings - losing those is not what anyone means by panic.
  ipcMain.handle('privacy:wipe-and-quit', async () => {
    try {
      await sessions.clearBrowsingData()
    } finally {
      clipboard.clear()
      app.exit(0)
    }
    return true
  })

  registerLockOnly()
  ipcMain.handle('lock:now', () => lock.lockNow(settings))
  ipcMain.handle('lock:state', () => ({
    locked: lock.isLocked(),
    canLock: lock.canLock(),
    encrypted: settings.encrypted
  }))

  ipcMain.handle('lock:set-passphrase', async (_e, { current, next }) => {
    // changing or removing one has to prove you know the old one
    if (lock.canLock()) {
      const check = await lock.attempt(current)
      if (!check.ok) return { ok: false, error: 'the current passphrase is wrong' }
    }
    try {
      await settings.setPassphrase(next || null)
      await lock.rememberVerifier(next || null)
      return { ok: true, encrypted: settings.encrypted }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })
}

module.exports = { register, registerLockOnly }
