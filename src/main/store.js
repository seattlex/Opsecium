'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')
const { EventEmitter } = require('node:events')

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
    dohTemplate: ''
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
  }

  load () {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      this.data = merge(DEFAULTS, JSON.parse(raw))
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('[store] unreadable settings file, using defaults:', err.message)
      this.data = clone(DEFAULTS)
    }
    return this.data
  }

  save () {
    if (!this.file) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 })
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
