'use strict'

// Hosts that exist to collect, not to serve. Anything a page needs to render
// stays off this list on purpose - this is not an ad blocker, it is a gag on
// the browser's own reporting plus the obvious analytics beacons.

const TELEMETRY_HOSTS = [
  // Chromium / Google service endpoints
  'clients1.google.com',
  'clients2.google.com',
  'clients3.google.com',
  'clients4.google.com',
  'clients5.google.com',
  'clients6.google.com',
  'update.googleapis.com',
  'safebrowsing.googleapis.com',
  'safebrowsing.google.com',
  'sb-ssl.google.com',
  'accounts.google.com/ListAccounts',
  'content-autofill.googleapis.com',
  'optimizationguide-pa.googleapis.com',
  'chromewebstore.googleapis.com',
  'redirector.gvt1.com',
  'www.gstatic.com/chrome/config',
  'ssl.gstatic.com/safebrowsing',
  // generic analytics beacons
  'www.google-analytics.com',
  'ssl.google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'stats.g.doubleclick.net',
  'app.adjust.com',
  'api.mixpanel.com',
  'api.amplitude.com',
  'api2.amplitude.com',
  'browser.sentry-cdn.com',
  'sentry.io',
  'in.hotjar.com',
  'script.hotjar.com',
  'static.hotjar.com',
  'cdn.segment.com',
  'api.segment.io',
  'events.launchdarkly.com',
  'telemetry.mozilla.org',
  'incoming.telemetry.mozilla.org',
  'vortex.data.microsoft.com',
  'browser.events.data.microsoft.com',
  'self.events.data.microsoft.com',
  'settings-win.data.microsoft.com'
]

function normaliseHost (host) {
  return String(host || '').toLowerCase().replace(/^www\./, '')
}

class Blocklist {
  constructor (settings) {
    this.settings = settings
    this.blocked = 0
    this.rebuild()
    settings.on('changed', () => this.rebuild())
  }

  rebuild () {
    const extra = this.settings.get('privacy.extraBlockedHosts', []) || []
    const all = this.settings.get('privacy.blockTelemetryHosts')
      ? TELEMETRY_HOSTS.concat(extra)
      : extra.slice()

    this.exact = new Set()
    this.paths = []
    for (const entry of all) {
      const trimmed = String(entry).trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (trimmed.includes('/')) this.paths.push(trimmed.toLowerCase())
      else this.exact.add(normaliseHost(trimmed))
    }
  }

  matches (url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    const host = normaliseHost(parsed.hostname)
    if (this.exact.has(host)) return true

    // subdomains of a listed host
    for (const entry of this.exact) {
      if (host.endsWith('.' + entry)) return true
    }

    const full = (parsed.hostname + parsed.pathname).toLowerCase()
    return this.paths.some((p) => full.includes(p))
  }

  count (url) {
    if (!this.matches(url)) return false
    this.blocked += 1
    return true
  }
}

module.exports = { Blocklist, TELEMETRY_HOSTS }
