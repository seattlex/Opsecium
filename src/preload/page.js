'use strict'

// Runs in every page, isolated world. The CDP override already fixes the
// headers and navigator.userAgent, but a few reads are generated from the real
// build regardless, so we patch them in the main world before page scripts get
// a turn. webFrame.executeJavaScript is what crosses the world boundary.

const { ipcRenderer, webFrame } = require('electron')

let config = null
try {
  config = ipcRenderer.sendSync('opsecium:page-config')
} catch {
  config = null
}

if (config) {
  webFrame.executeJavaScript(`(${shim.toString()})(${JSON.stringify(config)})`)
    .catch(() => { /* page died before we got there, nothing to do */ })
}

function shim (cfg) {
  const define = (target, prop, value) => {
    try {
      Object.defineProperty(target, prop, {
        get: () => value,
        configurable: true,
        enumerable: true
      })
    } catch { /* locked down by the page already */ }
  }

  define(navigator, 'userAgent', cfg.ua)
  define(navigator, 'appVersion', cfg.ua.replace(/^Mozilla\//, ''))
  define(navigator, 'platform', cfg.platform)
  define(navigator, 'vendor', cfg.vendor)
  define(navigator, 'maxTouchPoints', cfg.maxTouchPoints)
  define(navigator, 'language', cfg.language)
  define(navigator, 'languages', Object.freeze(cfg.languages.slice()))

  if (cfg.uaData) {
    const data = {
      brands: cfg.uaData.brands.map((b) => ({ brand: b.brand, version: b.version })),
      mobile: cfg.uaData.mobile,
      platform: cfg.uaData.platform,
      getHighEntropyValues (hints) {
        const out = {}
        for (const hint of (hints || [])) {
          if (hint in cfg.uaData.highEntropy) out[hint] = cfg.uaData.highEntropy[hint]
        }
        // these three are always returned, hinted or not
        out.brands = out.brands || cfg.uaData.brands
        out.mobile = cfg.uaData.mobile
        out.platform = cfg.uaData.platform
        return Promise.resolve(out)
      },
      toJSON () {
        return { brands: cfg.uaData.brands, mobile: cfg.uaData.mobile, platform: cfg.uaData.platform }
      }
    }
    define(navigator, 'userAgentData', Object.freeze(data))
  } else {
    // a UA that would never send client hints should not expose the API
    try { delete navigator.userAgentData } catch { /* non configurable */ }
    define(navigator, 'userAgentData', undefined)
  }

  // Chromium exposes this only on Windows builds, and it is a cheap way to
  // catch a Windows string coming out of a Linux binary.
  if (!/Windows/i.test(cfg.ua)) {
    try { delete window.chrome } catch { /* frozen */ }
  }
}
