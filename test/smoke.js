'use strict'

// Integration check, run under electron rather than node: boots the real
// session, loads a page from a local server and asserts on what the server
// received and what the page can see. The unit tests cover the derivation,
// this covers the wiring - CDP overrides, the header hook and the preload.
//
//   npm run smoke        (xvfb-run -a npm run smoke on a headless box)

const assert = require('node:assert')
const http = require('node:http')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const settings = require('../src/main/store')
const { applyHardeningSwitches } = require('../src/main/switches')
const useragent = require('../src/main/useragent')
const sessions = require('../src/main/session')
const spoof = require('../src/main/spoof')
const fingerprint = require('../src/main/fingerprint')

const SAMSUNG = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36'

// a scratch profile, so running this never touches real settings
app.setPath('userData', path.join(app.getPath('temp'), 'opsecium-smoke-' + process.pid))

settings.load()
settings.patch({
  useragent: { profile: 'custom', custom: SAMSUNG, spoofClientHints: true, emulateDevice: true },
  vpn: { mode: 'off' },
  privacy: { timezone: 'Asia/Tokyo', resistFingerprinting: true, spoofWebglRenderer: true, httpsOnly: false }
})

applyHardeningSwitches(app, settings)
sessions.registerSchemePrivileges()

const checks = []
function check (name, fn) {
  try {
    fn()
    checks.push(`ok    ${name}`)
  } catch (err) {
    checks.push(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const PROBE = `(() => {
  const digest = (s) => {
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h.toString(16)
  }
  const draw = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 200; canvas.height = 50
    const ctx = canvas.getContext('2d')
    ctx.textBaseline = 'top'; ctx.font = '16px Arial'
    ctx.fillStyle = '#f60'; ctx.fillRect(2, 2, 90, 24)
    ctx.fillStyle = '#069'; ctx.fillText('opsecium', 4, 26)
    return canvas.toDataURL()
  }
  let renderer = null
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null
  } catch (err) { renderer = null }
  return {
    ua: navigator.userAgent,
    platform: navigator.platform,
    touch: navigator.maxTouchPoints,
    cores: navigator.hardwareConcurrency,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    uaData: navigator.userAgentData ? navigator.userAgentData.toJSON() : null,
    dnt: navigator.doNotTrack,
    gpc: navigator.globalPrivacyControl,
    canvasA: digest(draw()),
    canvasB: digest(draw()),
    renderer,
    nativeLooking: HTMLCanvasElement.prototype.toDataURL.toString()
  }
})()`

app.whenReady().then(async () => {
  const identity = useragent.resolve(settings)

  sessions.registerInternalPages()
  sessions.setupSession({ settings, vpn: { trafficAllowed: true }, getIdentity: () => identity })
  ipcMain.on('opsecium:page-config', (event) => {
    event.returnValue = {
      ...spoof.pageShimConfig(identity),
      fingerprint: fingerprint.configFor(identity, settings)
    }
  })

  let seen = null
  const server = http.createServer((req, res) => {
    seen = req.headers
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<!doctype html><html><body>ok</body></html>')
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}/`

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: sessions.PARTITION,
      preload: path.join(__dirname, '..', 'src', 'preload', 'page.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.webContents.on('did-start-navigation', (_e, _url, isInPage, isMainFrame) => {
    if (isMainFrame && !isInPage) spoof.applyToContents(win.webContents, identity)
  })

  // same order the browser uses: settle the identity on about:blank, then go
  await spoof.primeContents(win.webContents, identity)
  await win.loadURL(origin)
  const page = await win.webContents.executeJavaScript(PROBE)

  check('the user agent header is the one we asked for', () => {
    assert.strictEqual(seen['user-agent'], SAMSUNG)
  })

  check('client hints agree with the string', () => {
    assert.match(seen['sec-ch-ua'], /Samsung Internet";v="27"/)
    assert.strictEqual(seen['sec-ch-ua-mobile'], '?1')
    assert.strictEqual(seen['sec-ch-ua-platform'], '"Android"')
    assert.strictEqual(seen['sec-ch-ua-platform-version'], '"10"')
    assert.strictEqual(seen['sec-ch-ua-model'], '"K"')
  })

  check('no real chromium version survives in the hints', () => {
    const real = process.versions.chrome.split('.')[0]
    assert.ok(!seen['sec-ch-ua'].includes(`"${real}"`), `found the real version ${real}`)
  })

  check('accept-language is sent once and unmangled', () => {
    assert.strictEqual(seen['accept-language'], 'en-US,en;q=0.9')
  })

  check('privacy headers are attached and the chrome fingerprint header is not', () => {
    assert.strictEqual(seen.dnt, '1')
    assert.strictEqual(seen['sec-gpc'], '1')
    assert.strictEqual(seen['x-client-data'], undefined)
  })

  check('the page sees the same identity as the wire', () => {
    assert.strictEqual(page.ua, SAMSUNG)
    assert.strictEqual(page.platform, 'Linux armv81')
    assert.strictEqual(page.touch, 5)
    assert.strictEqual(page.uaData.platform, 'Android')
    assert.strictEqual(page.uaData.mobile, true)
  })

  check('navigator agrees with the privacy headers', () => {
    assert.strictEqual(page.dnt, '1', 'a DNT header without navigator.doNotTrack is a tell')
    assert.strictEqual(page.gpc, true)
  })

  check('the timezone override lands', () => {
    assert.strictEqual(page.timezone, 'Asia/Tokyo')
  })

  check('canvas noise is stable across reads', () => {
    assert.strictEqual(page.canvasA, page.canvasB, 'a hash that moves every read is worse than none')
  })

  check('the gpu matches the platform being claimed', () => {
    assert.match(page.renderer, /Adreno|Mali/)
  })

  check('cores are plausible for the device claimed', () => {
    assert.ok(page.cores >= 4 && page.cores <= 8, `got ${page.cores}`)
  })

  check('patched methods still look native', () => {
    assert.match(page.nativeLooking, /\[native code\]/)
  })

  console.log(checks.join('\n'))
  console.log(process.exitCode ? '\nsmoke failed' : `\n${checks.length} checks passed`)

  server.close()
  app.exit(process.exitCode || 0)
}).catch((err) => {
  console.error('smoke crashed:', err)
  app.exit(1)
})
