'use strict'

const api = window.opsecium

const el = {
  tabs: document.getElementById('tabs'),
  newtab: document.getElementById('newtab'),
  back: document.getElementById('back'),
  forward: document.getElementById('forward'),
  reload: document.getElementById('reload'),
  home: document.getElementById('home'),
  address: document.getElementById('address'),
  lock: document.getElementById('lock'),
  uaValue: document.getElementById('ua-value'),
  uaBadge: document.getElementById('ua-badge'),
  vpnBadge: document.getElementById('vpn-badge'),
  vpnDot: document.getElementById('vpn-dot'),
  vpnValue: document.getElementById('vpn-value'),
  settings: document.getElementById('settings')
}

let state = { tabs: [], activeId: null }
let addressEdited = false

function activeTab () {
  return state.tabs.find((t) => t.id === state.activeId) || null
}

function renderTabs () {
  el.tabs.replaceChildren()

  for (const tab of state.tabs) {
    const node = document.createElement('div')
    node.className = 'tab' + (tab.active ? ' active' : '')
    node.title = tab.title

    if (tab.loading) {
      const spinner = document.createElement('div')
      spinner.className = 'spinner'
      node.append(spinner)
    } else if (tab.favicon) {
      const icon = document.createElement('img')
      icon.className = 'favicon'
      icon.src = tab.favicon
      icon.onerror = () => icon.remove()
      node.append(icon)
    }

    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = tab.title
    node.append(title)

    const close = document.createElement('span')
    close.className = 'close'
    close.textContent = '×'
    close.onclick = (event) => {
      event.stopPropagation()
      api.tabs.close(tab.id)
    }
    node.append(close)

    node.onclick = () => api.tabs.select(tab.id)
    node.onauxclick = (event) => { if (event.button === 1) api.tabs.close(tab.id) }

    el.tabs.append(node)
  }
}

function renderToolbar () {
  const tab = activeTab()
  el.back.disabled = !tab || !tab.canGoBack
  el.forward.disabled = !tab || !tab.canGoForward
  el.reload.textContent = tab && tab.loading ? '×' : '↻'

  if (!tab) {
    el.address.value = ''
    return
  }

  if (!addressEdited && document.activeElement !== el.address) {
    el.address.value = tab.url.startsWith('opsecium://') ? '' : tab.url
  }

  const secure = /^(https:|opsecium:)/.test(tab.url)
  el.lock.classList.toggle('insecure', !secure)
  el.lock.title = secure ? 'Connection is encrypted' : 'Not a secure connection'
}

function renderVpn (status) {
  if (!status) return
  const stateName = status.state
  el.vpnDot.className = 'dot'

  if (stateName === 'connected') el.vpnDot.classList.add('on')
  else if (stateName === 'connecting') el.vpnDot.classList.add('busy')
  else if (stateName === 'error' || stateName === 'unavailable') el.vpnDot.classList.add('error')
  else el.vpnDot.classList.add('off')

  let label = 'off'
  if (status.mode === 'pia') {
    label = stateName === 'connected' ? (status.region || 'PIA') : (status.detail || stateName)
  } else if (status.mode === 'proxy') {
    label = stateName === 'connected' ? 'proxy' : 'proxy down'
  }

  el.vpnValue.textContent = label
  el.vpnBadge.classList.toggle('blocking', !!status.blocking)
  el.vpnBadge.title = status.blocking
    ? 'Kill switch active - traffic is blocked until the tunnel is up'
    : (status.detail || 'VPN status')
}

function renderIdentity (identity) {
  if (!identity) return
  el.uaValue.textContent = identity.id === 'custom' ? 'custom' : identity.id
  el.uaBadge.title = identity.ua
}

function apply (next) {
  state = next
  renderTabs()
  renderToolbar()
}

// events from the main process

api.tabs.onState(apply)
api.vpn.onStatus(renderVpn)
api.ua.onChange(renderIdentity)

// user input

el.newtab.onclick = () => api.tabs.create()
el.back.onclick = () => api.nav.action('back')
el.forward.onclick = () => api.nav.action('forward')
el.home.onclick = () => api.nav.action('home')
el.reload.onclick = () => {
  const tab = activeTab()
  api.nav.action(tab && tab.loading ? 'stop' : 'reload')
}
el.settings.onclick = () => api.settings.open()
el.uaBadge.onclick = () => api.settings.open()
el.vpnBadge.onclick = () => api.vpn.toggle().then(renderVpn)

el.address.addEventListener('input', () => { addressEdited = true })
el.address.addEventListener('focus', () => el.address.select())
el.address.addEventListener('blur', () => { addressEdited = false; renderToolbar() })
el.address.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    addressEdited = false
    api.nav.load(el.address.value)
    el.address.blur()
  } else if (event.key === 'Escape') {
    addressEdited = false
    renderToolbar()
    el.address.blur()
  }
})

document.addEventListener('keydown', (event) => {
  const mod = event.ctrlKey || event.metaKey
  if (mod && event.key.toLowerCase() === 'l') {
    event.preventDefault()
    el.address.focus()
  }
})

async function boot () {
  apply(await api.tabs.state())
  renderVpn(await api.vpn.status())
  const { current } = await api.ua.list()
  renderIdentity(current)
}

boot()
