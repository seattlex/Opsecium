'use strict'

const api = window.opsecium
const $ = (id) => document.getElementById(id)

let current = null
let saving = false

function debounce (fn, ms) {
  let timer = null
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

async function boot () {
  const info = await api.settings.get()
  current = info.settings

  $('version').textContent = `${info.version} · Chromium ${info.chromium}`
  $('blocked-count').textContent = `${info.blocked} requests blocked this session`

  const { profiles } = await api.ua.list()
  const select = $('ua-profile')
  for (const profile of profiles) {
    const option = document.createElement('option')
    option.value = profile.id
    option.textContent = profile.label
    select.append(option)
  }
  const custom = document.createElement('option')
  custom.value = 'custom'
  custom.textContent = 'Custom string'
  select.append(custom)

  fill(current)
  renderVpn(info.vpn)
  await preview()
  loadRegions()
}

function fill (s) {
  $('ua-profile').value = s.useragent.profile
  $('ua-custom').value = s.useragent.custom
  $('ua-hints').checked = s.useragent.spoofClientHints
  $('ua-device').checked = s.useragent.emulateDevice
  $('ua-lang').value = s.useragent.acceptLanguage

  $('vpn-mode').value = s.vpn.mode
  $('vpn-killswitch').checked = s.vpn.killSwitch
  $('vpn-autoconnect').checked = s.vpn.autoConnect
  $('pia-binary').value = s.vpn.pia.binary
  $('proxy-url').value = s.vpn.proxy.url
  $('proxy-bypass').value = s.vpn.proxy.bypass

  $('p-telemetry').checked = s.privacy.blockTelemetryHosts
  $('p-webrtc').checked = s.privacy.blockWebrtcLeaks
  $('p-spellcheck').checked = s.privacy.disableSpellcheck
  $('p-dnt').checked = s.privacy.doNotTrack
  $('p-clear').checked = s.privacy.clearOnExit
  $('p-hwaccel').checked = s.privacy.disableHardwareAcceleration
  $('p-hosts').value = (s.privacy.extraBlockedHosts || []).join('\n')

  $('g-home').value = s.general.homepage
  $('g-search').value = s.general.searchEngine

  toggleGroups()
}

function toggleGroups () {
  const mode = $('vpn-mode').value
  $('pia-group').classList.toggle('visible', mode === 'pia')
  $('proxy-group').classList.toggle('visible', mode === 'proxy')
  $('custom-row').style.display = $('ua-profile').value === 'custom' ? 'block' : 'none'
}

function collect () {
  return {
    useragent: {
      profile: $('ua-profile').value,
      custom: $('ua-custom').value.trim(),
      spoofClientHints: $('ua-hints').checked,
      emulateDevice: $('ua-device').checked,
      acceptLanguage: $('ua-lang').value.trim() || 'en-US,en;q=0.9'
    },
    vpn: {
      mode: $('vpn-mode').value,
      killSwitch: $('vpn-killswitch').checked,
      autoConnect: $('vpn-autoconnect').checked,
      pia: {
        region: $('pia-region').value || 'auto',
        binary: $('pia-binary').value.trim()
      },
      proxy: {
        url: $('proxy-url').value.trim(),
        bypass: $('proxy-bypass').value.trim() || '<local>'
      }
    },
    privacy: {
      blockTelemetryHosts: $('p-telemetry').checked,
      blockWebrtcLeaks: $('p-webrtc').checked,
      disableSpellcheck: $('p-spellcheck').checked,
      doNotTrack: $('p-dnt').checked,
      clearOnExit: $('p-clear').checked,
      disableHardwareAcceleration: $('p-hwaccel').checked,
      extraBlockedHosts: $('p-hosts').value.split('\n').map((l) => l.trim()).filter(Boolean)
    },
    general: {
      homepage: $('g-home').value.trim() || 'opsecium://newtab',
      searchEngine: $('g-search').value.trim() || 'https://duckduckgo.com/?q=%s'
    }
  }
}

async function save () {
  if (saving) return
  saving = true
  try {
    const result = await api.settings.patch(collect())
    current = result.settings
    renderVpn(result.vpn)
    await preview()
  } finally {
    saving = false
  }
}

const saveSoon = debounce(save, 400)

async function preview () {
  const profile = $('ua-profile').value
  const string = profile === 'custom'
    ? $('ua-custom').value.trim()
    : (await api.ua.list()).profiles.find((p) => p.id === profile)?.ua

  const box = $('ua-preview')
  if (!string) {
    box.textContent = 'No user agent set - the built in default will be used.'
    return
  }

  const result = await api.ua.preview(string)
  const m = result.meta
  const lines = [
    `User-Agent: ${result.ua}`,
    '',
    `platform        ${m.platform} ${m.platformVersion}`,
    `navigator       ${m.navigatorPlatform} · touch points ${m.maxTouchPoints}`,
    `mobile          ${m.mobile ? 'yes' : 'no'}`
  ]
  if (m.model) lines.push(`model           ${m.model}`)
  if (m.supportsClientHints) {
    lines.push(`sec-ch-ua       ${m.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')}`)
  } else {
    lines.push('sec-ch-ua       not sent (this engine has no client hints)')
  }
  if (result.device && $('ua-device').checked) {
    lines.push(`viewport        ${result.device.width}x${result.device.height} @${result.device.scale}x`)
  }
  box.textContent = lines.join('\n')
}

function renderVpn (status) {
  if (!status) return
  const box = $('vpn-status')
  box.classList.remove('ok', 'bad')

  if (status.mode === 'off') {
    box.textContent = 'VPN is off. Traffic goes out over your normal connection.'
    return
  }
  if (status.state === 'connected') {
    box.classList.add('ok')
    box.textContent = status.mode === 'pia'
      ? `Connected${status.region ? ' · ' + status.region : ''}${status.ip ? ' · ' + status.ip : ''}`
      : `Routing through ${$('proxy-url').value.trim()}`
    return
  }
  box.classList.add('bad')
  box.textContent = status.detail || status.state
  if (status.blocking) box.textContent += ' — kill switch is holding traffic'
}

async function loadRegions () {
  const regions = await api.vpn.regions().catch(() => [])
  const select = $('pia-region')
  const chosen = current.vpn.pia.region
  for (const region of regions) {
    if (region === 'auto') continue
    const option = document.createElement('option')
    option.value = region
    option.textContent = region
    select.append(option)
  }
  select.value = regions.includes(chosen) ? chosen : 'auto'
}

// wiring

for (const id of ['ua-hints', 'ua-device', 'vpn-killswitch', 'vpn-autoconnect', 'p-telemetry',
  'p-webrtc', 'p-spellcheck', 'p-dnt', 'p-clear', 'p-hwaccel']) {
  $(id).addEventListener('change', save)
}

for (const id of ['ua-lang', 'pia-binary', 'proxy-url', 'proxy-bypass', 'p-hosts', 'g-home', 'g-search']) {
  $(id).addEventListener('input', saveSoon)
}

$('ua-profile').addEventListener('change', async () => { toggleGroups(); await save() })
$('ua-custom').addEventListener('input', () => { preview(); saveSoon() })
$('vpn-mode').addEventListener('change', async () => { toggleGroups(); await save() })
$('pia-region').addEventListener('change', save)

$('vpn-connect').onclick = async () => {
  $('vpn-status').textContent = 'Connecting…'
  renderVpn(await api.vpn.connect())
}
$('vpn-disconnect').onclick = async () => renderVpn(await api.vpn.disconnect())

$('clear-now').onclick = async () => {
  const button = $('clear-now')
  button.disabled = true
  await api.privacy.clear()
  button.textContent = 'Cleared'
  setTimeout(() => { button.textContent = 'Clear browsing data now'; button.disabled = false }, 1500)
}

$('reset').onclick = async () => {
  current = await api.settings.reset()
  fill(current)
  await preview()
}

api.vpn.onStatus(renderVpn)

boot()
