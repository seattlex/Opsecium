'use strict'

const test = require('node:test')
const assert = require('node:assert')

const useragent = require('../src/main/useragent')

const SAMSUNG = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'

test('samsung internet string produces matching client hints', () => {
  const meta = useragent.metadataFor(SAMSUNG)

  assert.strictEqual(meta.platform, 'Android')
  assert.strictEqual(meta.platformVersion, '10')
  assert.strictEqual(meta.mobile, true)
  assert.strictEqual(meta.model, 'K')
  assert.strictEqual(meta.navigatorPlatform, 'Linux armv81')
  assert.strictEqual(meta.architecture, 'arm')

  const brands = meta.brands.map((b) => b.brand)
  assert.ok(brands.includes('Samsung Internet'), 'samsung brand is advertised')
  assert.ok(brands.includes('Chromium'), 'chromium brand is kept')
  assert.ok(!brands.includes('Google Chrome'), 'not also chrome, real builds pick one')

  const samsung = meta.brands.find((b) => b.brand === 'Samsung Internet')
  assert.strictEqual(samsung.version, '27')
})

test('windows chrome reports the version hints send, not the NT number', () => {
  const meta = useragent.metadataFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')

  assert.strictEqual(meta.platform, 'Windows')
  assert.strictEqual(meta.platformVersion, '15.0.0')
  assert.strictEqual(meta.navigatorPlatform, 'Win32')
  assert.strictEqual(meta.mobile, false)
  assert.strictEqual(meta.maxTouchPoints, 0)
})

test('edge and opera are named instead of chrome', () => {
  const edge = useragent.metadataFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0')
  assert.ok(edge.brands.some((b) => b.brand === 'Microsoft Edge'))
})

test('a branded browser reports its own full version, not chromium\'s', () => {
  const meta = useragent.metadataFor(SAMSUNG)
  const full = Object.fromEntries(meta.fullVersionList.map((b) => [b.brand, b.version]))

  assert.strictEqual(full['Samsung Internet'], '27.0.0.0', 'not 125.0.0.0')
  assert.strictEqual(full.Chromium, '125.0.0.0')
  assert.strictEqual(meta.fullVersion, '125.0.0.0', 'the engine version stays the engine version')

  // every entry is the four part form client hints use
  for (const entry of meta.fullVersionList) {
    assert.match(entry.version, /^\d+\.\d+\.\d+\.\d+$/, `${entry.brand} is padded`)
  }
})

test('engines without client hints do not get a brand list', () => {
  const firefox = useragent.metadataFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0')
  assert.strictEqual(firefox.supportsClientHints, false)
  assert.deepStrictEqual(firefox.brands, [])
  assert.strictEqual(firefox.vendor, '')

  const safari = useragent.metadataFor('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')
  assert.strictEqual(safari.supportsClientHints, false)
  assert.strictEqual(safari.platform, 'iOS')
  assert.strictEqual(safari.platformVersion, '17.5')
  assert.strictEqual(safari.navigatorPlatform, 'iPhone')
})

test('every built in profile parses into something usable', () => {
  for (const profile of useragent.PROFILES) {
    const meta = useragent.metadataFor(profile.ua)
    assert.strictEqual(typeof meta.mobile, 'boolean')
    assert.ok(meta.navigatorPlatform, `${profile.id} has a navigator.platform`)
    // a string we cannot place must not go on to claim a platform in the
    // hints - saying "Unknown" out loud is worse than saying nothing
    if (meta.platform === 'Unknown') {
      assert.strictEqual(meta.supportsClientHints, false, `${profile.id} sends no hints`)
    }
  }
})

test('resolve prefers a custom string only when one is set', () => {
  const settings = (values) => ({ get: (key, fallback) => (key in values ? values[key] : fallback) })

  const empty = useragent.resolve(settings({
    'useragent.profile': 'custom',
    'useragent.custom': '   ',
    'useragent.emulateDevice': true
  }))
  assert.strictEqual(empty.id, 'default', 'falls back rather than sending an empty UA')

  const custom = useragent.resolve(settings({
    'useragent.profile': 'custom',
    'useragent.custom': SAMSUNG,
    'useragent.emulateDevice': true,
    'useragent.spoofClientHints': true
  }))
  assert.strictEqual(custom.id, 'custom')
  assert.strictEqual(custom.ua, SAMSUNG)
  assert.ok(custom.device, 'a mobile string turns on device emulation')
})

test('device emulation is dropped when the setting is off', () => {
  const identity = useragent.resolve({
    get: (key) => ({
      'useragent.profile': 'samsung-android',
      'useragent.emulateDevice': false
    })[key]
  })
  assert.strictEqual(identity.device, null)
})
