'use strict'

const { ipcMain, app } = require('electron')

const useragent = require('./useragent')
const spoof = require('./spoof')
const fingerprint = require('./fingerprint')
const urls = require('./urls')
const sessions = require('./session')
const windows = require('./window')

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
}

module.exports = { register }
