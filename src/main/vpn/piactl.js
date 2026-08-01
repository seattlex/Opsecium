'use strict'

// Private Internet Access ships a CLI (piactl) with the desktop client on
// every platform. We drive that instead of reimplementing the tunnel: the
// daemon already owns routing, DNS and its own kill switch, and shelling out
// to it means we never touch the user's credentials.

const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const CANDIDATES = {
  linux: [
    '/opt/piavpn/bin/piactl',
    '/usr/local/bin/piactl',
    '/usr/bin/piactl'
  ],
  darwin: [
    '/Applications/Private Internet Access.app/Contents/MacOS/piactl',
    '/usr/local/bin/piactl'
  ],
  win32: [
    'C:\\Program Files\\Private Internet Access\\piactl.exe',
    'C:\\Program Files (x86)\\Private Internet Access\\piactl.exe'
  ]
}

function locate (override) {
  if (override) {
    return fs.existsSync(override) ? override : null
  }
  for (const candidate of (CANDIDATES[process.platform] || [])) {
    if (fs.existsSync(candidate)) return candidate
  }
  // last resort, maybe it is on PATH
  const dirs = (process.env.PATH || '').split(path.delimiter)
  const name = process.platform === 'win32' ? 'piactl.exe' : 'piactl'
  for (const dir of dirs) {
    if (!dir) continue
    const full = path.join(dir, name)
    if (fs.existsSync(full)) return full
  }
  return null
}

function run (binary, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const message = (stderr || err.message || '').trim()
        reject(new Error(message || `piactl ${args.join(' ')} failed`))
        return
      }
      resolve(String(stdout).trim())
    })
  })
}

class PiaControl {
  constructor (settings) {
    this.settings = settings
    this.binary = null
  }

  resolveBinary () {
    this.binary = locate(this.settings.get('vpn.pia.binary'))
    return this.binary
  }

  get available () {
    return !!(this.binary || this.resolveBinary())
  }

  async exec (...args) {
    const binary = this.binary || this.resolveBinary()
    if (!binary) throw new Error('piactl not found - is the PIA desktop client installed?')
    return run(binary, args)
  }

  // piactl reports: Disconnected, Connecting, StillConnecting, Connected,
  // Interrupted, Reconnecting, StillReconnecting, DisconnectingToReconnect,
  // Disconnecting
  async state () {
    const raw = await this.exec('get', 'connectionstate')
    return raw
  }

  async connect () {
    // background mode keeps the tunnel up without the GUI running
    await this.exec('background', 'enable').catch(() => {})
    const region = this.settings.get('vpn.pia.region')
    if (region && region !== 'auto') {
      await this.exec('set', 'region', region).catch(() => {})
    }
    return this.exec('connect')
  }

  async disconnect () {
    return this.exec('disconnect')
  }

  async vpnIp () {
    const ip = await this.exec('get', 'vpnip').catch(() => '')
    return ip && ip !== 'Unknown' ? ip : ''
  }

  async region () {
    return this.exec('get', 'region').catch(() => '')
  }

  async regions () {
    const raw = await this.exec('get', 'regions').catch(() => '')
    return raw.split('\n').map((r) => r.trim()).filter(Boolean)
  }
}

module.exports = { PiaControl, locate }
