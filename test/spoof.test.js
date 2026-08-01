'use strict'

const test = require('node:test')
const assert = require('node:assert')

const spoof = require('../src/main/spoof')
const useragent = require('../src/main/useragent')
const { Blocklist } = require('../src/main/blocklist')

const SAMSUNG = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'

function identityFor (ua, spoofClientHints = true) {
  return {
    ua,
    meta: useragent.metadataFor(ua),
    spoofClientHints,
    acceptLanguage: 'en-US,en;q=0.9',
    device: null
  }
}

// What Chromium would have sent on its own, before we touch it.
function realHeaders () {
  return {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="130", "Not?A_Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
    'X-Client-Data': 'CIa2yQEIpLbJAQ==',
    Accept: '*/*'
  }
}

test('the real client hints are replaced, not just the user agent', () => {
  const mutate = spoof.headerMutator(() => identityFor(SAMSUNG))
  const headers = mutate(realHeaders())

  assert.strictEqual(headers['User-Agent'], SAMSUNG)
  assert.strictEqual(headers['sec-ch-ua-mobile'], '?1')
  assert.strictEqual(headers['sec-ch-ua-platform'], '"Android"')
  assert.ok(headers['sec-ch-ua'].includes('Samsung Internet'))
  assert.ok(!headers['sec-ch-ua'].includes('130'), 'the real chromium version is gone')
  assert.strictEqual(headers['sec-ch-ua-platform-version'], '"10"')
  assert.strictEqual(headers['sec-ch-ua-model'], '"K"')
  assert.strictEqual(headers.Accept, '*/*', 'unrelated headers are left alone')
})

test('hints are stripped for an engine that would never send them', () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const headers = spoof.headerMutator(() => identityFor(safari))(realHeaders())

  assert.strictEqual(headers['User-Agent'], safari)
  for (const name of Object.keys(headers)) {
    assert.ok(!name.toLowerCase().startsWith('sec-ch-ua'), `${name} should not survive`)
  }
})

test('turning hint spoofing off still removes the ones that would give us away', () => {
  const headers = spoof.headerMutator(() => identityFor(SAMSUNG, false))(realHeaders())
  assert.strictEqual(headers['User-Agent'], SAMSUNG)
  assert.strictEqual(headers['sec-ch-ua'], undefined)
  assert.strictEqual(headers['sec-ch-ua-platform'], undefined)
})

test('accept-language is written once, whatever casing chromium used', () => {
  const real = realHeaders()
  real['accept-language'] = 'en-US,en;q=0.9;q=0.9' // what the CDP override leaves behind
  const headers = spoof.headerMutator(() => identityFor(SAMSUNG))(real)

  const names = Object.keys(headers).filter((n) => n.toLowerCase() === 'accept-language')
  assert.deepStrictEqual(names, ['Accept-Language'], 'exactly one, canonically cased')
  assert.strictEqual(headers['Accept-Language'], 'en-US,en;q=0.9')
})

test('a lower cased user-agent from chromium does not survive alongside ours', () => {
  const real = realHeaders()
  delete real['User-Agent']
  real['user-agent'] = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0'
  const headers = spoof.headerMutator(() => identityFor(SAMSUNG))(real)

  const names = Object.keys(headers).filter((n) => n.toLowerCase() === 'user-agent')
  assert.deepStrictEqual(names, ['User-Agent'])
  assert.strictEqual(headers['User-Agent'], SAMSUNG)
})

test('an empty model is not sent as an empty string', () => {
  const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  const headers = spoof.headerMutator(() => identityFor(desktop))(realHeaders())
  assert.strictEqual(headers['sec-ch-ua-model'], undefined)
})

test('the page shim carries the same values as the headers', () => {
  const identity = identityFor(SAMSUNG)
  const config = spoof.pageShimConfig(identity)

  assert.strictEqual(config.ua, SAMSUNG)
  assert.strictEqual(config.platform, 'Linux armv81')
  assert.strictEqual(config.maxTouchPoints, 5)
  assert.deepStrictEqual(config.languages, ['en-US', 'en'])
  assert.strictEqual(config.uaData.mobile, true)
  assert.strictEqual(config.uaData.highEntropy.platformVersion, '10')
})

test('no client hints means no navigator.userAgentData either', () => {
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
  assert.strictEqual(spoof.pageShimConfig(identityFor(firefox)).uaData, null)
})

// blocklist

function settingsWith (values) {
  return {
    get: (key, fallback) => (key in values ? values[key] : fallback),
    on () {}
  }
}

test('telemetry hosts are blocked including subdomains', () => {
  const list = new Blocklist(settingsWith({
    'privacy.blockTelemetryHosts': true,
    'privacy.extraBlockedHosts': []
  }))

  assert.ok(list.matches('https://www.google-analytics.com/collect'))
  assert.ok(list.matches('https://cdn.segment.com/analytics.js'))
  assert.ok(list.matches('https://o123.ingest.sentry.io/api/1/store/'), 'subdomains too')
  assert.ok(!list.matches('https://news.ycombinator.com/'))
  assert.ok(!list.matches('https://www.google.com/search?q=x'), 'search itself still works')
})

test('user supplied hosts are honoured and telemetry blocking can be turned off', () => {
  const list = new Blocklist(settingsWith({
    'privacy.blockTelemetryHosts': false,
    'privacy.extraBlockedHosts': ['tracker.example.com', '# a comment', 'example.org/beacon']
  }))

  assert.ok(list.matches('https://tracker.example.com/x.gif'))
  assert.ok(list.matches('https://example.org/beacon/hit'), 'path rules work')
  assert.ok(!list.matches('https://www.google-analytics.com/collect'))
  assert.ok(!list.matches('https://example.org/index.html'))
})

test('a request that will not parse is not blocked by accident', () => {
  const list = new Blocklist(settingsWith({ 'privacy.blockTelemetryHosts': true }))
  assert.strictEqual(list.matches('not a url'), false)
})
