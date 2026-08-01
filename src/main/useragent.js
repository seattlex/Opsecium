'use strict'

// A user agent string on its own does not disguise anything anymore. Chromium
// also ships User-Agent Client Hints (sec-ch-ua*, navigator.userAgentData) and
// those are generated from the real build, not from whatever string you set.
// So every profile here carries the string *and* the matching hint metadata,
// and we derive that metadata automatically for custom strings.

const PROFILES = [
  {
    id: 'default',
    label: 'Opsecium default (desktop Chrome, Windows)',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  },
  {
    id: 'samsung-android',
    label: 'Samsung Internet 27 (Android 10)',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
    device: { width: 412, height: 915, scale: 2.625, touch: true }
  },
  {
    id: 'chrome-android',
    label: 'Chrome 125 (Android 13, Pixel 7)',
    ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    device: { width: 412, height: 915, scale: 2.625, touch: true }
  },
  {
    id: 'chrome-macos',
    label: 'Chrome 125 (macOS 14)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  },
  {
    id: 'chrome-linux',
    label: 'Chrome 125 (Linux)',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  },
  {
    id: 'edge-windows',
    label: 'Edge 125 (Windows 11)',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0'
  },
  {
    id: 'safari-ios',
    label: 'Safari (iOS 17, iPhone)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    device: { width: 393, height: 852, scale: 3, touch: true }
  },
  {
    id: 'safari-macos',
    label: 'Safari 17 (macOS)',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  },
  {
    id: 'firefox-windows',
    label: 'Firefox 127 (Windows)',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0'
  },
  {
    id: 'googlebot',
    label: 'Googlebot',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  }
]

const NOT_A_BRAND = { brand: 'Not/A)Brand', version: '99' }

function pick (re, ua, group = 1) {
  const match = ua.match(re)
  return match ? match[group] : null
}

// Chromium sends platformVersion as a three part number. These are the values
// a real build reports, so a mismatch here is as good as a tell.
function windowsVersion (ua) {
  const nt = pick(/Windows NT ([\d.]+)/, ua)
  if (nt === '10.0') return '15.0.0' // win11 also reports NT 10.0, hints split them
  if (nt === '6.3') return '8.0.0'
  if (nt === '6.2') return '7.0.0'
  if (nt === '6.1') return '0.3.0'
  return '15.0.0'
}

function detectPlatform (ua) {
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/CrOS/i.test(ua)) return 'Chrome OS'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS'
  if (/Linux|X11/i.test(ua)) return 'Linux'
  return 'Unknown'
}

function platformVersion (ua, platform) {
  switch (platform) {
    case 'Android':
      return pick(/Android ([\d.]+)/i, ua) || '10.0.0'
    case 'iOS':
      return (pick(/OS ([\d_]+) like Mac/i, ua) || '17_5').replace(/_/g, '.')
    case 'Windows':
      return windowsVersion(ua)
    case 'macOS':
      return (pick(/Mac OS X ([\d_.]+)/i, ua) || '10_15_7').replace(/_/g, '.')
    default:
      return ''
  }
}

// navigator.platform is a separate legacy value and scripts still cross check it
function navigatorPlatform (platform, ua) {
  switch (platform) {
    case 'Android': return 'Linux armv81'
    case 'iOS': return /iPad/i.test(ua) ? 'iPad' : 'iPhone'
    case 'Windows': return 'Win32'
    case 'macOS': return 'MacIntel'
    case 'Chrome OS': return 'Linux x86_64'
    case 'Linux': return 'Linux x86_64'
    default: return 'Win32'
  }
}

// Client hints carry two versions per brand: a major for sec-ch-ua and a four
// part one for the full version list. A branded browser reports its own
// version in both, not the Chromium version it is built on.
function padVersion (version) {
  const parts = String(version).split('.')
  while (parts.length < 4) parts.push('0')
  return parts.slice(0, 4).join('.')
}

function brandsFor (ua) {
  const chrome = pick(/Chrom(?:e|ium)\/([\d.]+)/i, ua)
  if (!chrome) return [] // Firefox and Safari do not send UA-CH at all

  const major = chrome.split('.')[0]
  const brands = [
    { brand: NOT_A_BRAND.brand, version: NOT_A_BRAND.version, full: '99.0.0.0' },
    { brand: 'Chromium', version: major, full: padVersion(chrome) }
  ]

  const samsung = pick(/SamsungBrowser\/([\d.]+)/i, ua)
  const edge = pick(/Edg\/([\d.]+)/i, ua)
  const opera = pick(/OPR\/([\d.]+)/i, ua)

  if (samsung) brands.push({ brand: 'Samsung Internet', version: samsung.split('.')[0], full: padVersion(samsung) })
  else if (edge) brands.push({ brand: 'Microsoft Edge', version: edge.split('.')[0], full: padVersion(edge) })
  else if (opera) brands.push({ brand: 'Opera', version: opera.split('.')[0], full: padVersion(opera) })
  else brands.push({ brand: 'Google Chrome', version: major, full: padVersion(chrome) })

  return brands
}

function deviceModel (ua, platform) {
  if (platform !== 'Android') return ''
  // "Linux; Android 10; K)" -> K, "Android 13; Pixel 7)" -> Pixel 7
  const model = pick(/Android [\d.]+;\s*([^;)]+)\)/i, ua)
  if (!model) return ''
  return model.replace(/\s+Build\/.*$/i, '').trim()
}

// Everything a page can ask for through getHighEntropyValues(), derived from
// the string so a hand typed UA stays internally consistent.
function metadataFor (ua) {
  const platform = detectPlatform(ua)
  const mobile = /Mobile|Android|iPhone|iPod/i.test(ua)
  const chrome = pick(/Chrom(?:e|ium)\/([\d.]+)/i, ua) || ''
  const branded = brandsFor(ua)
  const arch = platform === 'Android' || platform === 'iOS' ? 'arm' : 'x86'

  return {
    brands: branded.map(({ brand, version }) => ({ brand, version })),
    fullVersionList: branded.map(({ brand, full }) => ({ brand, version: full })),
    fullVersion: chrome ? padVersion(chrome) : '',
    platform,
    platformVersion: platformVersion(ua, platform),
    architecture: arch,
    bitness: '64',
    model: deviceModel(ua, platform),
    mobile,
    wow64: false,
    // not part of UA-CH, used by the page side shim
    navigatorPlatform: navigatorPlatform(platform, ua),
    vendor: /Firefox/i.test(ua) ? '' : 'Google Inc.',
    maxTouchPoints: mobile ? 5 : 0,
    supportsClientHints: branded.length > 0
  }
}

function guessDevice (ua) {
  if (!/Mobile|Android|iPhone|iPod/i.test(ua)) return null
  if (/iPad/i.test(ua)) return { width: 820, height: 1180, scale: 2, touch: true }
  return { width: 412, height: 915, scale: 2.625, touch: true }
}

function byId (id) {
  return PROFILES.find((p) => p.id === id) || null
}

// Resolves the settings block into the single object the rest of the app uses.
function resolve (settings) {
  const custom = String(settings.get('useragent.custom') || '').trim()
  // an empty custom box means fall back to the default, never an empty UA
  const useCustom = settings.get('useragent.profile') === 'custom' && custom.length > 0
  const profile = byId(settings.get('useragent.profile')) || byId('default')

  const ua = useCustom ? custom : profile.ua
  const meta = metadataFor(ua)
  const device = useCustom ? guessDevice(ua) : (profile.device || null)

  return {
    id: useCustom ? 'custom' : profile.id,
    label: useCustom ? 'Custom' : profile.label,
    ua,
    meta,
    device: settings.get('useragent.emulateDevice') ? device : null,
    spoofClientHints: !!settings.get('useragent.spoofClientHints'),
    acceptLanguage: settings.get('useragent.acceptLanguage') || 'en-US,en;q=0.9'
  }
}

module.exports = { PROFILES, metadataFor, resolve, byId, guessDevice, detectPlatform }
