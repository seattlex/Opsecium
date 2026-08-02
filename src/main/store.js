'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { EventEmitter } = require('node:events')

const vault = require('./vault')

const DEFAULTS = {
  general: {
    homepage: 'opsecium://newtab',
    searchEngine: 'https://duckduckgo.com/?q=%s',
    restoreSession: false
  },
  useragent: {
    // id of a built in profile, or 'custom'
    profile: 'default',
    custom: '',
    // keep navigator.userAgentData / client hints in sync with the string
    spoofClientHints: true,
    // resize + touch emulation when the profile is a phone
    emulateDevice: true,
    acceptLanguage: 'en-US,en;q=0.9'
  },
  vpn: {
    // 'off' | 'pia' | 'proxy'
    mode: 'off',
    // refuse to load anything while the tunnel is down
    killSwitch: true,
    autoConnect: false,
    pia: {
      region: 'auto',
      binary: ''
    },
    proxy: {
      // socks5://host:port or http://host:port
      url: '',
      bypass: '<local>'
    }
  },
  privacy: {
    blockTelemetryHosts: true,
    blockWebrtcLeaks: true,
    disableSpellcheck: true,
    clearOnExit: true,
    doNotTrack: true,
    disableHardwareAcceleration: false,
    trimReferrers: true,
    extraBlockedHosts: [],
    // canvas, audio and text metric noise, per session and per origin
    resistFingerprinting: true,
    spoofWebglRenderer: true,
    // 'auto' keeps the real one, anything else is an IANA zone
    timezone: 'auto',
    // upgrade http to https and refuse if that fails
    httpsOnly: true,
    // strip the referrer on cross origin requests entirely
    stripCrossOriginReferrer: true,
    // '' uses the system resolver, otherwise a DoH template
    dohTemplate: '',
    // nothing touches the disk: no cookie jar, no cache, no history
    ephemeral: false,
    // ask the compositor to keep this window out of screen captures
    blockScreenCapture: true,
    // minutes of no input before the window locks, 0 is off. needs a passphrase
    lockAfterMinutes: 0,
    // wipe the clipboard when locking, wiping or quitting
    clearClipboard: true
  }
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function merge (base, override) {
  const out = clone(base)
  if (!override || typeof override !== 'object') return out
  for (const key of Object.keys(override)) {
    const value = override[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = merge(out[key], value)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

class Store extends EventEmitter {
  constructor () {
    super()
    this.data = clone(DEFAULTS)
    this.file = null
    // held only while the app is running, never written anywhere
    this.passphrase = null
    this.encrypted = false
    this.locked = false
  }

  // Synchronous, because the startup switches need settings before the app is
  // ready. An encrypted store cannot be read here - it reports locked and the
  // caller unlocks it once there is a window to ask in.
  load () {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    let raw
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[store] unreadable settings file, using defaults:', err.message)
      this.data = clone(DEFAULTS)
      return this.data
    }

    if (vault.isVault(raw)) {
      this.encrypted = true
      this.locked = true
      this.sealed = raw
      // defaults until unlocked, and the defaults are the careful ones
      this.data = clone(DEFAULTS)
      return this.data
    }

    try {
      this.data = merge(DEFAULTS, JSON.parse(raw))
    } catch (err) {
      console.error('[store] settings file is not valid json, using defaults:', err.message)
      this.data = clone(DEFAULTS)
    }
    return this.data
  }

  async unlock (passphrase) {
    if (!this.locked) return true
    const plaintext = await vault.open(this.sealed, passphrase)
    this.data = merge(DEFAULTS, JSON.parse(plaintext))
    this.passphrase = passphrase
    this.locked = false
    this.sealed = null
    this.emit('changed', null, this.data)
    return true
  }

  // Turning a passphrase on rewrites the file encrypted; passing null takes
  // it back off. Either way the old file is replaced, not left beside it.
  async setPassphrase (passphrase) {
    this.passphrase = passphrase || null
    this.encrypted = !!passphrase
    await this.saveAsync()
    return this.encrypted
  }

  save () {
    // An encrypted store cannot be written synchronously - scrypt is
    // deliberately slow and blocking the main process for it would freeze the
    // window on every keystroke in settings.
    if (this.encrypted) {
      this.saveAsync().catch((err) => console.error('[store] could not seal settings:', err.message))
      return
    }
    this.writeFile(JSON.stringify(this.data, null, 2))
  }

  async saveAsync () {
    if (!this.file) return
    const plaintext = JSON.stringify(this.data, null, 2)
    if (!this.encrypted || !this.passphrase) {
      this.writeFile(plaintext)
      return
    }
    this.writeFile(await vault.seal(plaintext, this.passphrase))
  }

  writeFile (contents) {
    if (!this.file) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      // write beside it and rename, so a crash mid write cannot leave a
      // half sealed file that will never open again
      const temporary = this.file + '.tmp'
      fs.writeFileSync(temporary, contents, { mode: 0o600 })
      fs.renameSync(temporary, this.file)
    } catch (err) {
      console.error('[store] could not write settings:', err.message)
    }
  }

  get (keyPath, fallback) {
    const parts = keyPath.split('.')
    let node = this.data
    for (const part of parts) {
      if (node == null || typeof node !== 'object') return fallback
      node = node[part]
    }
    return node === undefined ? fallback : node
  }

  set (keyPath, value) {
    const parts = keyPath.split('.')
    const last = parts.pop()
    let node = this.data
    for (const part of parts) {
      if (!node[part] || typeof node[part] !== 'object') node[part] = {}
      node = node[part]
    }
    node[last] = value
    this.save()
    this.emit('changed', keyPath, value)
  }

  patch (partial) {
    this.data = merge(this.data, partial)
    this.save()
    this.emit('changed', null, this.data)
  }

  all () {
    return clone(this.data)
  }

  reset () {
    this.data = clone(DEFAULTS)
    this.save()
    this.emit('changed', null, this.data)
  }
}

module.exports = new Store()
module.exports.DEFAULTS = DEFAULTS
