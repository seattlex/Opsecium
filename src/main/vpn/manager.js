'use strict'

const { EventEmitter } = require('node:events')
const { PiaControl } = require('./piactl')

const POLL_MS = 4000

const CONNECTED_STATES = new Set(['Connected'])
const BUSY_STATES = new Set([
  'Connecting',
  'StillConnecting',
  'Reconnecting',
  'StillReconnecting',
  'DisconnectingToReconnect'
])

// Owns "is traffic allowed to leave right now". Two backends:
//   pia    - drive the PIA daemon over piactl
//   proxy  - point every session at a SOCKS5/HTTP endpoint (any provider, or
//            a WireGuard box you run yourself)
// With the kill switch on, anything other than a healthy tunnel blocks loads.
class VpnManager extends EventEmitter {
  constructor (settings) {
    super()
    this.settings = settings
    this.pia = new PiaControl(settings)
    this.timer = null
    this.status = {
      mode: settings.get('vpn.mode'),
      state: 'off',
      detail: '',
      ip: '',
      region: '',
      available: false,
      killSwitch: !!settings.get('vpn.killSwitch'),
      blocking: false
    }
  }

  get mode () {
    return this.settings.get('vpn.mode')
  }

  // The one question the request filter asks.
  get trafficAllowed () {
    if (!this.settings.get('vpn.killSwitch')) return true
    const mode = this.mode
    if (mode === 'off') return true
    if (mode === 'proxy') return !!this.settings.get('vpn.proxy.url')
    return CONNECTED_STATES.has(this.status.state)
  }

  async start () {
    if (this.mode === 'pia' && this.settings.get('vpn.autoConnect')) {
      this.connect().catch((err) => this.fail(err))
    }
    await this.refresh()
    this.timer = setInterval(() => { this.refresh().catch(() => {}) }, POLL_MS)
    if (this.timer.unref) this.timer.unref()
  }

  stop () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  fail (err) {
    this.update({ state: 'error', detail: err.message })
  }

  update (partial) {
    const next = { ...this.status, ...partial, mode: this.mode, killSwitch: !!this.settings.get('vpn.killSwitch') }
    next.blocking = !this.trafficAllowedFor(next)
    const changed = JSON.stringify(next) !== JSON.stringify(this.status)
    this.status = next
    if (changed) this.emit('status', this.status)
  }

  trafficAllowedFor (status) {
    if (!status.killSwitch) return true
    if (status.mode === 'off') return true
    if (status.mode === 'proxy') return !!this.settings.get('vpn.proxy.url')
    return CONNECTED_STATES.has(status.state)
  }

  async refresh () {
    const mode = this.mode

    if (mode === 'off') {
      this.update({ state: 'off', detail: '', ip: '', region: '', available: true })
      return this.status
    }

    if (mode === 'proxy') {
      const url = this.settings.get('vpn.proxy.url')
      this.update({
        state: url ? 'connected' : 'error',
        detail: url ? `proxy ${url}` : 'no proxy configured',
        ip: '',
        region: '',
        available: !!url
      })
      return this.status
    }

    if (!this.pia.available) {
      this.update({
        state: 'unavailable',
        detail: 'piactl not found - install the PIA client or set the binary path in settings',
        available: false
      })
      return this.status
    }

    try {
      const state = await this.pia.state()
      const connected = CONNECTED_STATES.has(state)
      const [ip, region] = connected
        ? await Promise.all([this.pia.vpnIp(), this.pia.region()])
        : ['', await this.pia.region()]
      this.update({
        state: connected ? 'connected' : (BUSY_STATES.has(state) ? 'connecting' : 'disconnected'),
        detail: state,
        ip,
        region,
        available: true
      })
    } catch (err) {
      this.fail(err)
    }
    return this.status
  }

  async connect () {
    if (this.mode !== 'pia') throw new Error('VPN mode is not set to PIA')
    this.update({ state: 'connecting', detail: 'Connecting' })
    await this.pia.connect()
    return this.refresh()
  }

  async disconnect () {
    if (this.mode !== 'pia') throw new Error('VPN mode is not set to PIA')
    await this.pia.disconnect()
    return this.refresh()
  }

  async toggle () {
    if (this.mode !== 'pia') return this.refresh()
    return CONNECTED_STATES.has(this.status.state) ? this.disconnect() : this.connect()
  }

  async listRegions () {
    if (!this.pia.available) return []
    return this.pia.regions()
  }
}

module.exports = { VpnManager }
