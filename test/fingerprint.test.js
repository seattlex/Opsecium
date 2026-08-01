'use strict'

const test = require('node:test')
const assert = require('node:assert')

const fingerprint = require('../src/main/fingerprint')
const useragent = require('../src/main/useragent')
const urls = require('../src/main/urls')

const SAMSUNG = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function settingsWith (values = {}) {
  const defaults = { 'privacy.resistFingerprinting': true, 'privacy.spoofWebglRenderer': true }
  const merged = { ...defaults, ...values }
  return { get: (key, fallback) => (key in merged ? merged[key] : fallback) }
}

function identityFor (ua) {
  return { ua, meta: useragent.metadataFor(ua) }
}

test('the gpu reported fits the platform being claimed', () => {
  const android = fingerprint.configFor(identityFor(SAMSUNG), settingsWith())
  assert.ok(/Adreno|Mali/.test(android.webgl.renderer), `phone gpu, got ${android.webgl.renderer}`)
  assert.ok(!/Direct3D|Mesa/.test(android.webgl.renderer), 'not a desktop renderer')

  const windows = fingerprint.configFor(identityFor(WINDOWS), settingsWith())
  assert.ok(/Direct3D/.test(windows.webgl.renderer), `windows gpu, got ${windows.webgl.renderer}`)
})

test('core count and memory stay plausible for a phone', () => {
  const config = fingerprint.configFor(identityFor(SAMSUNG), settingsWith())
  assert.ok(config.hardwareConcurrency >= 4 && config.hardwareConcurrency <= 8, 'phones do not have 32 threads')
  assert.ok(config.deviceMemory <= 8)
})

test('the same seed gives the same answers, a new one does not', () => {
  const identity = identityFor(WINDOWS)
  const before = fingerprint.configFor(identity, settingsWith())
  const again = fingerprint.configFor(identity, settingsWith())
  assert.deepStrictEqual(before, again, 'stable while the session lasts')

  const seed = fingerprint.rotateSeed()
  const after = fingerprint.configFor(identity, settingsWith())
  assert.notStrictEqual(after.seed, before.seed)
  assert.strictEqual(after.seed, seed)
})

test('the noise can be turned off without losing the matching gpu', () => {
  const config = fingerprint.configFor(identityFor(WINDOWS), settingsWith({ 'privacy.resistFingerprinting': false }))
  assert.strictEqual(config.enabled, false)
  assert.strictEqual(config.noise.canvas, false)
  assert.ok(config.webgl, 'the renderer still follows the profile')
})

test('an unknown platform still gets a usable gpu rather than nothing', () => {
  const bot = fingerprint.configFor(identityFor('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), settingsWith())
  assert.ok(bot.webgl && bot.webgl.renderer)
  assert.ok(bot.hardwareConcurrency > 0)
})

// https only

test('http is upgraded to https', () => {
  assert.strictEqual(urls.upgradeToHttps('http://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.strictEqual(urls.upgradeToHttps('http://example.com:80/'), 'https://example.com/', 'port 80 is dropped')
  assert.strictEqual(urls.upgradeToHttps('http://example.com:8080/'), 'https://example.com:8080/', 'other ports are kept')
})

test('already secure and unroutable urls are left alone', () => {
  assert.strictEqual(urls.upgradeToHttps('https://example.com'), null)
  assert.strictEqual(urls.upgradeToHttps('opsecium://newtab'), null)
  assert.strictEqual(urls.upgradeToHttps('http://localhost:3000/'), null)
  assert.strictEqual(urls.upgradeToHttps('http://127.0.0.1:8080/'), null)
  assert.strictEqual(urls.upgradeToHttps('http://nzh3fv6jc6jskki3.onion/'), null, 'onion services are http by design')
  assert.strictEqual(urls.upgradeToHttps('http://printer.local/'), null)
  assert.strictEqual(urls.upgradeToHttps('not a url'), null)
})

test('cross origin referrers are spotted, same origin ones are not', () => {
  assert.strictEqual(urls.isCrossOrigin('https://a.com/page', 'https://b.com/asset.js'), true)
  assert.strictEqual(urls.isCrossOrigin('https://a.com/page', 'https://a.com/asset.js'), false)
  assert.strictEqual(urls.isCrossOrigin('https://a.com/page', 'http://a.com/asset.js'), true, 'scheme counts')
  assert.strictEqual(urls.isCrossOrigin('', 'https://a.com/'), false)
  assert.strictEqual(urls.isCrossOrigin('garbage', 'https://a.com/'), false)
})
