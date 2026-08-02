'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { session, protocol, net } = require('electron')

const spoof = require('./spoof')
const { upgradeToHttps, isCrossOrigin } = require('./urls')
const { Blocklist } = require('./blocklist')

// Without the persist: prefix Chromium keeps the whole partition in memory -
// no cookie jar, no cache, no local storage, nothing to recover afterwards.
// Which one is in use is decided once at startup and cannot change under a
// running session, so the setting takes effect on the next launch.
const PARTITION = 'persist:opsecium'
const EPHEMERAL_PARTITION = 'opsecium-ephemeral'

let activePartition = PARTITION

function partition () {
  return activePartition
}

function selectPartition (settings) {
  activePartition = settings.get('privacy.ephemeral') ? EPHEMERAL_PARTITION : PARTITION
  return activePartition
}

// Permissions that get handed out without asking are the ones that cannot
// identify you. Everything else goes to a prompt, and the noisy sensors are
// refused outright.
const ALWAYS_DENY = new Set([
  'geolocation',
  'hid',
  'serial',
  'usb',
  'bluetooth',
  'idle-detection',
  'midiSysex',
  'window-management',
  'speaker-selection'
])

const ALWAYS_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write'])

let blocklist = null

function browsingSession () {
  return session.fromPartition(activePartition)
}

function registerSchemePrivileges () {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'opsecium',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

function registerInternalPages () {
  const root = path.join(__dirname, '..', 'pages')
  const handler = (request) => {
    const url = new URL(request.url)
    // stripped rather than resolved, so opsecium://../../etc/passwd is a 404
    const name = (url.hostname || 'newtab').replace(/[^a-z0-9-]/gi, '') || 'newtab'
    return net.fetch(pathToFileURL(path.join(root, `${name}.html`)).toString())
  }
  protocol.handle('opsecium', handler)
  browsingSession().protocol.handle('opsecium', handler)
}

function setupSession ({ settings, vpn, getIdentity }) {
  selectPartition(settings)
  const ses = browsingSession()
  blocklist = new Blocklist(settings)

  const identity = getIdentity()
  ses.setUserAgent(identity.ua, identity.acceptLanguage)

  if (settings.get('privacy.disableSpellcheck')) {
    // the spell checker downloads dictionaries from Google on first use
    ses.setSpellCheckerEnabled(false)
  }

  applyProxy(ses, settings)

  const mutate = spoof.headerMutator(getIdentity)

  ses.webRequest.onBeforeRequest((details, callback) => {
    // kill switch first - nothing leaves while the tunnel is down
    if (!vpn.trafficAllowed && !details.url.startsWith('opsecium://') && !details.url.startsWith('devtools://')) {
      if (details.resourceType === 'mainFrame') {
        callback({ redirectURL: 'opsecium://blocked' })
        return
      }
      callback({ cancel: true })
      return
    }

    if (blocklist.count(details.url)) {
      callback({ cancel: true })
      return
    }

    if (settings.get('privacy.httpsOnly')) {
      const upgraded = upgradeToHttps(details.url)
      if (upgraded) {
        callback({ redirectURL: upgraded })
        return
      }
    }

    callback({ cancel: false })
  })

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = mutate({ ...details.requestHeaders })
    if (settings.get('privacy.doNotTrack')) {
      headers.DNT = '1'
      headers['Sec-GPC'] = '1'
    }
    // X-Client-Data is a Chrome build/variations fingerprint sent to Google
    delete headers['X-Client-Data']

    if (settings.get('privacy.stripCrossOriginReferrer') && isCrossOrigin(headers.Referer, details.url)) {
      delete headers.Referer
    }

    callback({ requestHeaders: headers })
  })

  ses.setPermissionRequestHandler((contents, permission, callback) => {
    if (ALWAYS_DENY.has(permission)) return callback(false)
    if (ALWAYS_ALLOW.has(permission)) return callback(true)
    // notifications, camera, mic and the rest need a deliberate yes; until
    // there is a prompt surface in the shell they stay denied
    callback(false)
  })

  ses.setPermissionCheckHandler((contents, permission) => {
    if (ALWAYS_DENY.has(permission)) return false
    return ALWAYS_ALLOW.has(permission)
  })

  ses.setDevicePermissionHandler(() => false)

  return ses
}

function applyProxy (ses, settings) {
  const mode = settings.get('vpn.mode')
  const url = settings.get('vpn.proxy.url')
  if (mode === 'proxy' && url) {
    return ses.setProxy({
      proxyRules: url,
      proxyBypassRules: settings.get('vpn.proxy.bypass') || '<local>'
    })
  }
  return ses.setProxy({ mode: 'direct' })
}

async function reapplySession (settings) {
  const ses = browsingSession()
  await applyProxy(ses, settings)
  ses.setSpellCheckerEnabled(!settings.get('privacy.disableSpellcheck'))
  if (blocklist) blocklist.rebuild()
}

function blockedCount () {
  return blocklist ? blocklist.blocked : 0
}

async function clearBrowsingData () {
  const ses = browsingSession()
  await ses.clearStorageData({
    storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
  })
  await ses.clearCache()
  await ses.clearHostResolverCache()
  await ses.clearAuthCache()
}

module.exports = {
  PARTITION,
  EPHEMERAL_PARTITION,
  partition,
  selectPartition,
  browsingSession,
  registerSchemePrivileges,
  registerInternalPages,
  setupSession,
  reapplySession,
  clearBrowsingData,
  blockedCount,
  applyProxy
}
