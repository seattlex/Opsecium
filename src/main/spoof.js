'use strict'

// Applies a resolved identity to a webContents. Three layers, because any one
// of them on its own leaves a hole:
//
//   1. CDP Emulation.setUserAgentOverride - the only way to make Chromium
//      generate matching sec-ch-ua headers instead of its real ones.
//   2. Header rewriting - covers requests the override misses and strips the
//      hints entirely for a UA that would never send them (Safari, Firefox).
//   3. A page side shim in the preload, for navigator.* reads.

const useragent = require('./useragent')

const attached = new WeakSet()

// A webContents has no CDP target until it starts navigating, and commands
// sent before that do not fail cleanly - some reject with "No target
// available", some never settle at all. Nothing here is allowed to leave a
// caller hanging, so every command gets a deadline and resolves either way.
const COMMAND_TIMEOUT = 3000

function send (contents, method, params) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(err || null)
    }
    const timer = setTimeout(() => finish(new Error('timed out')), COMMAND_TIMEOUT)
    try {
      contents.debugger.sendCommand(method, params).then(() => finish(), finish)
    } catch (err) {
      finish(err)
    }
  })
}

function ensureDebugger (contents) {
  if (attached.has(contents)) return true
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    attached.add(contents)
    contents.once('destroyed', () => attached.delete(contents))
    return true
  } catch (err) {
    console.error('[spoof] could not attach debugger:', err.message)
    return false
  }
}

// DevTools and our debugger cannot both hold the target, so the tab layer
// detaches around it. Tell us when that happens or we will think we are
// still attached and skip the reattach.
function forget (contents) {
  attached.delete(contents)
}

async function applyToContents (contents, identity) {
  if (!contents || contents.isDestroyed()) return

  contents.setUserAgent(identity.ua)

  if (!ensureDebugger(contents)) return

  const params = {
    userAgent: identity.ua,
    acceptLanguage: identity.acceptLanguage,
    platform: identity.meta.navigatorPlatform
  }

  if (identity.spoofClientHints && identity.meta.supportsClientHints) {
    params.userAgentMetadata = {
      brands: identity.meta.brands,
      fullVersionList: identity.meta.fullVersionList,
      fullVersion: identity.meta.fullVersion,
      platform: identity.meta.platform,
      platformVersion: identity.meta.platformVersion,
      architecture: identity.meta.architecture,
      model: identity.meta.model,
      mobile: identity.meta.mobile,
      bitness: identity.meta.bitness,
      wow64: identity.meta.wow64
    }
  }

  const failed = await send(contents, 'Emulation.setUserAgentOverride', params)
  if (failed) {
    // older targets only expose the Network domain version
    await send(contents, 'Network.setUserAgentOverride', params)
  }

  await applyDeviceMetrics(contents, identity)
  await applyLocale(contents, identity)
}

// A machine in UTC claiming an Asia/Jakarta user agent is a contradiction that
// costs nothing to check - Date and Intl both give it away.
async function applyLocale (contents, identity) {
  if (identity.timezone && identity.timezone !== 'auto') {
    await send(contents, 'Emulation.setTimezoneOverride', { timezoneId: identity.timezone })
  } else {
    await send(contents, 'Emulation.setTimezoneOverride', { timezoneId: '' })
  }

  const locale = (identity.acceptLanguage || '').split(',')[0].split(';')[0].trim()
  if (locale) {
    await send(contents, 'Emulation.setLocaleOverride', { locale })
  }
}

async function applyDeviceMetrics (contents, identity) {
  const device = identity.device
  if (!device) {
    await send(contents, 'Emulation.clearDeviceMetricsOverride')
    await send(contents, 'Emulation.setTouchEmulationEnabled', { enabled: false })
    return
  }
  await send(contents, 'Emulation.setDeviceMetricsOverride', {
    width: device.width,
    height: device.height,
    deviceScaleFactor: device.scale,
    mobile: true,
    screenWidth: device.width,
    screenHeight: device.height
  })
  await send(contents, 'Emulation.setTouchEmulationEnabled', {
    enabled: !!device.touch,
    maxTouchPoints: identity.meta.maxTouchPoints || 5
  })
}

// A fresh webContents has no CDP target, and applying the identity from
// did-start-navigation is a race: the commands are async, so the timezone or
// device metrics can land after the document has already read them. Loading
// about:blank first creates the target for nothing, which lets everything be
// in place before the real navigation starts.
async function primeContents (contents, identity) {
  try {
    await contents.loadURL('about:blank')
  } catch {
    return // destroyed or superseded, the navigation hook will cover it
  }
  if (contents.isDestroyed()) return
  await applyToContents(contents, identity)
}

// Client hints Chromium may still attach on its own.
const HINT_HEADERS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-arch',
  'sec-ch-ua-model',
  'sec-ch-ua-bitness',
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-wow64'
]

function quoted (value) {
  return `"${String(value).replace(/"/g, '')}"`
}

function brandList (brands) {
  return brands.map((b) => `${quoted(b.brand)};v=${quoted(b.version)}`).join(', ')
}

function hintHeadersFor (identity) {
  const meta = identity.meta
  if (!identity.spoofClientHints || !meta.supportsClientHints) return null
  const headers = {
    'sec-ch-ua': brandList(meta.brands),
    'sec-ch-ua-mobile': meta.mobile ? '?1' : '?0',
    'sec-ch-ua-platform': quoted(meta.platform)
  }
  // high entropy hints are only sent once the site asks for them, but if
  // Chromium decided to send its own we replace rather than delete
  headers['sec-ch-ua-platform-version'] = quoted(meta.platformVersion)
  headers['sec-ch-ua-arch'] = quoted(meta.architecture)
  headers['sec-ch-ua-bitness'] = quoted(meta.bitness)
  headers['sec-ch-ua-model'] = quoted(meta.model)
  headers['sec-ch-ua-full-version-list'] = brandList(meta.fullVersionList)
  return headers
}

// Returns a mutator used by the session's onBeforeSendHeaders hook.
function headerMutator (getIdentity) {
  return (headers) => {
    const identity = getIdentity()
    if (!identity) return headers

    const spoofed = hintHeadersFor(identity)

    // Header names are not case sensitive and Chromium is not consistent about
    // them, so drop every casing before writing our own.
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase()
      if (HINT_HEADERS.includes(lower) || lower === 'user-agent' || lower === 'accept-language') {
        delete headers[name]
      }
    }

    headers['User-Agent'] = identity.ua
    // the CDP override appends its own q value to whatever we hand it, so the
    // final say on this header belongs here
    headers['Accept-Language'] = identity.acceptLanguage

    if (spoofed) {
      for (const [name, value] of Object.entries(spoofed)) {
        if (value !== '""') headers[name] = value
      }
    }
    return headers
  }
}

// Shipped to the preload so navigator reads line up with the headers.
function pageShimConfig (identity) {
  return {
    ua: identity.ua,
    chromiumBased: identity.meta.supportsClientHints,
    platform: identity.meta.navigatorPlatform,
    vendor: identity.meta.vendor,
    maxTouchPoints: identity.meta.maxTouchPoints,
    language: identity.acceptLanguage.split(',')[0] || 'en-US',
    languages: identity.acceptLanguage.split(',').map((l) => l.split(';')[0].trim()).filter(Boolean),
    uaData: identity.spoofClientHints && identity.meta.supportsClientHints
      ? {
          brands: identity.meta.brands,
          mobile: identity.meta.mobile,
          platform: identity.meta.platform,
          highEntropy: {
            architecture: identity.meta.architecture,
            bitness: identity.meta.bitness,
            brands: identity.meta.brands,
            fullVersionList: identity.meta.fullVersionList,
            model: identity.meta.model,
            mobile: identity.meta.mobile,
            platform: identity.meta.platform,
            platformVersion: identity.meta.platformVersion,
            wow64: identity.meta.wow64
          }
        }
      : null
  }
}

module.exports = {
  applyToContents,
  applyDeviceMetrics,
  applyLocale,
  primeContents,
  forget,
  headerMutator,
  hintHeadersFor,
  pageShimConfig,
  HINT_HEADERS
}
