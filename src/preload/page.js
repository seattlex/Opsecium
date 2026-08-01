'use strict'

// Runs in every page, isolated world. The CDP override already fixes the
// headers and navigator.userAgent, but a few reads are generated from the real
// build regardless, so we patch them in the main world before page scripts get
// a turn. webFrame.executeJavaScript is what crosses the world boundary.
//
// Sandboxed preloads cannot require relative files, so both shims live in this
// one file and are shipped across as source.

const { ipcRenderer, webFrame } = require('electron')

let config = null
try {
  config = ipcRenderer.sendSync('opsecium:page-config')
} catch {
  config = null
}

if (config) {
  const source = `(${identityShim.toString()})(${JSON.stringify(config)});` +
                 `(${fingerprintShim.toString()})(${JSON.stringify(config.fingerprint || {})});`
  webFrame.executeJavaScript(source)
    .catch(() => { /* page died before we got there, nothing to do */ })
}

function identityShim (cfg) {
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

  if (cfg.doNotTrack) {
    define(navigator, 'doNotTrack', '1')
    define(navigator, 'globalPrivacyControl', true)
  }

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

  // window.chrome is there on every Chrome platform, desktop and Android
  // alike. It should only disappear when we are claiming to be a different
  // engine altogether.
  if (!cfg.chromiumBased) {
    try { delete window.chrome } catch { /* frozen */ }
  }
}

function fingerprintShim (cfg) {
  if (!cfg || (!cfg.enabled && !cfg.webgl && !cfg.hardwareConcurrency)) return

  // Per session and per origin. One site gets one stable answer for as long
  // as the identity lasts, and two sites cannot line their answers up.
  const material = String(cfg.seed) + '|' + (location.origin || 'null')
  let base = 2166136261 >>> 0
  for (let i = 0; i < material.length; i++) {
    base ^= material.charCodeAt(i)
    base = Math.imul(base, 16777619) >>> 0
  }

  // Deterministic by index, and it does not advance any state - reading the
  // same canvas twice has to give the same bytes both times.
  const noiseAt = (index) => {
    let x = (base ^ Math.imul(index + 1, 2654435761)) >>> 0
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    return x / 4294967296
  }

  const nativeLooking = new WeakMap()

  const patch = (target, name, wrapper) => {
    if (!target || typeof target[name] !== 'function') return
    const original = target[name]
    const replacement = function (...args) {
      return wrapper.call(this, original, ...args)
    }
    // keep toString() looking like a native function, since checking that is
    // the first thing a fingerprinting script does
    try {
      Object.defineProperty(replacement, 'name', { value: name, configurable: true })
      Object.defineProperty(replacement, 'length', { value: original.length, configurable: true })
    } catch { /* not worth failing over */ }
    nativeLooking.set(replacement, original)
    try { target[name] = replacement } catch { /* frozen prototype */ }
  }

  const originalToString = Function.prototype.toString
  Function.prototype.toString = function () {
    const original = nativeLooking.get(this)
    return originalToString.call(original || this)
  }
  nativeLooking.set(Function.prototype.toString, originalToString)

  const define = (target, prop, value) => {
    try {
      Object.defineProperty(target, prop, { get: () => value, configurable: true, enumerable: true })
    } catch { /* already locked */ }
  }

  if (cfg.hardwareConcurrency) define(navigator, 'hardwareConcurrency', cfg.hardwareConcurrency)
  if (cfg.deviceMemory) define(navigator, 'deviceMemory', cfg.deviceMemory)

  // --- canvas ---------------------------------------------------------

  if (cfg.noise && cfg.noise.canvas && typeof CanvasRenderingContext2D !== 'undefined') {
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

    // A bounded number of samples, so a 4000x4000 canvas costs the same as a
    // 200x200 one. Changing a few hundred pixels by one is enough to move any
    // hash and not enough for an eye to catch.
    const perturb = (image) => {
      const data = image.data
      const pixels = data.length / 4
      if (!pixels) return image
      const samples = Math.min(pixels, 512)
      const stride = Math.max(1, Math.floor(pixels / samples))
      for (let i = 0, p = 0; p < pixels; p += stride, i++) {
        const offset = p * 4
        const delta = noiseAt(i) < 0.5 ? -1 : 1
        data[offset] = clamp(data[offset] + delta)
        data[offset + 1] = clamp(data[offset + 1] + delta)
        data[offset + 2] = clamp(data[offset + 2] + delta)
      }
      return image
    }

    patch(CanvasRenderingContext2D.prototype, 'getImageData', function (original, ...args) {
      return perturb(original.apply(this, args))
    })

    const noisyCopy = (canvas) => {
      if (!canvas.width || !canvas.height) return canvas
      const copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      const context = copy.getContext('2d')
      context.drawImage(canvas, 0, 0)
      // getImageData is patched above, so this is where the noise lands
      context.putImageData(context.getImageData(0, 0, copy.width, copy.height), 0, 0)
      return copy
    }

    patch(HTMLCanvasElement.prototype, 'toDataURL', function (original, ...args) {
      try {
        return original.apply(noisyCopy(this), args)
      } catch {
        return original.apply(this, args)
      }
    })

    patch(HTMLCanvasElement.prototype, 'toBlob', function (original, ...args) {
      try {
        return original.apply(noisyCopy(this), args)
      } catch {
        return original.apply(this, args)
      }
    })
  }

  // --- webgl ----------------------------------------------------------

  if (cfg.webgl) {
    const UNMASKED_VENDOR = 0x9245
    const UNMASKED_RENDERER = 0x9246
    const VENDOR = 0x1f00
    const RENDERER = 0x1f01

    const override = function (original, parameter) {
      switch (parameter) {
        case UNMASKED_VENDOR: return cfg.webgl.vendor
        case UNMASKED_RENDERER: return cfg.webgl.renderer
        case VENDOR: return 'WebKit'
        case RENDERER: return 'WebKit WebGL'
        default: return original.call(this, parameter)
      }
    }

    if (typeof WebGLRenderingContext !== 'undefined') {
      patch(WebGLRenderingContext.prototype, 'getParameter', override)
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      patch(WebGL2RenderingContext.prototype, 'getParameter', override)
    }
  }

  // --- audio ----------------------------------------------------------

  if (cfg.noise && cfg.noise.audio && typeof AudioBuffer !== 'undefined') {
    const touched = new WeakSet()

    patch(AudioBuffer.prototype, 'getChannelData', function (original, ...args) {
      const data = original.apply(this, args)
      if (!touched.has(data)) {
        touched.add(data)
        const stride = Math.max(1, Math.floor(data.length / 256))
        for (let i = 0, p = 0; p < data.length; p += stride, i++) {
          data[p] += (noiseAt(i) - 0.5) * 1e-7
        }
      }
      return data
    })

    if (typeof AnalyserNode !== 'undefined') {
      patch(AnalyserNode.prototype, 'getFloatFrequencyData', function (original, array) {
        original.call(this, array)
        const stride = Math.max(1, Math.floor(array.length / 128))
        for (let i = 0, p = 0; p < array.length; p += stride, i++) {
          array[p] += (noiseAt(i) - 0.5) * 1e-4
        }
      })
    }
  }

  // --- text metrics ---------------------------------------------------

  // Font enumeration works by measuring strings and comparing widths. The
  // perturbation has to be far below a pixel or it starts breaking layout.
  if (cfg.noise && cfg.noise.text && typeof CanvasRenderingContext2D !== 'undefined') {
    patch(CanvasRenderingContext2D.prototype, 'measureText', function (original, text) {
      const metrics = original.call(this, text)
      const scale = 1 + (noiseAt(String(text).length) - 0.5) * 1e-5
      try {
        Object.defineProperty(metrics, 'width', {
          value: metrics.width * scale,
          configurable: true
        })
      } catch { /* read only in this engine */ }
      return metrics
    })
  }
}
