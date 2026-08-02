'use strict'

const path = require('node:path')
const { WebContentsView, shell } = require('electron')

const spoof = require('./spoof')
const { partition } = require('./session')

const CHROME_HEIGHT = 84
const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page.js')

let nextId = 1

class Tab {
  constructor (manager, url) {
    this.id = nextId++
    this.manager = manager
    this.view = new WebContentsView({
      webPreferences: {
        partition: partition(),
        preload: PAGE_PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: true
      }
    })
    this.contents = this.view.webContents
    this.title = 'New tab'
    this.url = url
    this.favicon = ''
    this.loading = false
    this.error = ''
    this.priming = false

    this.contents.setWindowOpenHandler(({ url: target, disposition }) => {
      if (disposition === 'new-window' || disposition === 'foreground-tab' || disposition === 'background-tab') {
        this.manager.create(target, { activate: disposition !== 'background-tab' })
        return { action: 'deny' }
      }
      return { action: 'deny' }
    })

    this.wire()
    if (url) this.open(url)
  }

  // The identity has to be in place before the first real navigation, so the
  // tab spends a moment on about:blank getting itself sorted out first.
  open (url) {
    this.priming = true
    spoof.primeContents(this.contents, this.manager.getIdentity())
      .catch(() => {})
      .then(() => {
        this.priming = false
        if (this.contents.isDestroyed()) return
        // clear() keeps the current entry, so this has to happen once the
        // real page is the current one - otherwise Back leads to about:blank
        this.contents.once('did-stop-loading', () => {
          try { this.contents.navigationHistory.clear() } catch { /* nothing to clear */ }
          this.manager.broadcast()
        })
        this.contents.loadURL(url)
      })
  }

  wire () {
    const push = () => this.manager.broadcast()
    const c = this.contents

    // about:blank during priming is an implementation detail, so none of it
    // reaches the address bar or the tab title
    const settling = () => this.priming || c.getURL() === 'about:blank'

    c.on('page-title-updated', (_e, title) => { if (!settling()) { this.title = title; push() } })
    c.on('page-favicon-updated', (_e, icons) => { this.favicon = icons[0] || ''; push() })
    c.on('did-start-loading', () => { if (!settling()) { this.loading = true; this.error = ''; push() } })
    c.on('did-stop-loading', () => {
      if (settling()) return
      this.loading = false
      this.url = c.getURL()
      push()
    })
    c.on('did-navigate', (_e, url) => { if (!settling()) { this.url = url; push() } })
    c.on('did-navigate-in-page', (_e, url) => { if (!settling()) { this.url = url; push() } })
    c.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 is an aborted load, normal
      this.error = `${description} (${code})`
      push()
    })
    // every main frame navigation, since a cross site one gets a fresh
    // renderer and the override does not follow it
    c.on('did-start-navigation', (_e, _url, isInPage, isMainFrame) => {
      if (isMainFrame && !isInPage) this.manager.applyIdentity(c)
    })
    c.on('render-process-gone', () => {
      this.error = 'the page crashed'
      this.loading = false
      push()
    })

    // devtools takes the target off us, so put the overrides back after
    c.on('devtools-closed', () => this.manager.applyIdentity(c))

    c.on('will-navigate', (event, url) => {
      if (/^(mailto|tel|magnet):/i.test(url)) {
        event.preventDefault()
        shell.openExternal(url).catch(() => {})
      }
    })
  }

  serialise () {
    return {
      id: this.id,
      title: this.error ? 'Problem loading page' : (this.title || 'New tab'),
      url: this.url || '',
      favicon: this.favicon,
      loading: this.loading,
      error: this.error,
      active: this.manager.activeId === this.id,
      canGoBack: !this.contents.isDestroyed() && this.contents.navigationHistory.canGoBack(),
      canGoForward: !this.contents.isDestroyed() && this.contents.navigationHistory.canGoForward()
    }
  }

  destroy () {
    try {
      if (this.contents.debugger.isAttached()) this.contents.debugger.detach()
    } catch { /* already gone */ }
    this.view.webContents.close()
  }
}

class TabManager {
  constructor (win, { shellView, getIdentity, settings }) {
    this.win = win
    this.shellView = shellView
    this.getIdentity = getIdentity
    this.settings = settings
    this.tabs = []
    this.activeId = null
  }

  applyIdentity (contents) {
    spoof.applyToContents(contents, this.getIdentity()).catch((err) => {
      console.error('[tabs] identity not applied:', err.message)
    })
  }

  // Chromium will not let DevTools and a remote debugger hold the same
  // target, so we stand down for as long as the panel is open. The overrides
  // go back on via the devtools-closed handler.
  toggleDevTools (tab) {
    if (!tab || tab.contents.isDestroyed()) return
    const contents = tab.contents
    if (contents.isDevToolsOpened()) {
      contents.closeDevTools()
      return
    }
    try {
      if (contents.debugger.isAttached()) contents.debugger.detach()
    } catch { /* not attached, nothing to give up */ }
    spoof.forget(contents)
    contents.openDevTools({ mode: 'bottom' })
  }

  // Called when the user changes profile - every open tab picks it up.
  refreshIdentity () {
    for (const tab of this.tabs) {
      if (!tab.contents.isDestroyed()) this.applyIdentity(tab.contents)
    }
  }

  get active () {
    return this.tabs.find((t) => t.id === this.activeId) || null
  }

  byId (id) {
    return this.tabs.find((t) => t.id === id) || null
  }

  create (url, { activate = true } = {}) {
    const target = url || this.settings.get('general.homepage')
    const tab = new Tab(this, target)
    this.tabs.push(tab)
    if (activate || this.tabs.length === 1) this.select(tab.id)
    else this.broadcast()
    return tab
  }

  select (id) {
    const tab = this.byId(id)
    if (!tab) return
    const current = this.active
    if (current && current !== tab) this.win.contentView.removeChildView(current.view)
    this.activeId = id
    if (!this.win.contentView.children.includes(tab.view)) {
      this.win.contentView.addChildView(tab.view)
    }
    this.layout()
    this.broadcast()
    tab.contents.focus()
  }

  close (id) {
    const index = this.tabs.findIndex((t) => t.id === id)
    if (index === -1) return
    const [tab] = this.tabs.splice(index, 1)
    if (this.win.contentView.children.includes(tab.view)) {
      this.win.contentView.removeChildView(tab.view)
    }
    tab.destroy()

    if (this.activeId === id) {
      const next = this.tabs[index] || this.tabs[index - 1]
      this.activeId = null
      if (next) this.select(next.id)
      else this.create()
    } else {
      this.broadcast()
    }
  }

  layout () {
    const [width, height] = this.win.getContentSize()
    this.shellView.setBounds({ x: 0, y: 0, width, height: CHROME_HEIGHT })
    const tab = this.active
    if (tab) {
      tab.view.setBounds({ x: 0, y: CHROME_HEIGHT, width, height: Math.max(0, height - CHROME_HEIGHT) })
    }
  }

  broadcast () {
    if (this.shellView.webContents.isDestroyed()) return
    this.shellView.webContents.send('tabs:state', {
      tabs: this.tabs.map((t) => t.serialise()),
      activeId: this.activeId
    })
  }

  destroy () {
    for (const tab of this.tabs) tab.destroy()
    this.tabs = []
  }
}

module.exports = { TabManager, CHROME_HEIGHT }
