'use strict'

// Second integration check, also under electron. This one is about what is
// left on the disk: that a passphrase really encrypts the settings file, that
// a restart cannot read it without one, and that an ephemeral session does
// not write a cookie jar at all.
//
//   npm run smoke:disk

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { app, session } = require('electron')

const vault = require('../src/main/vault')

const PROFILE = path.join(app.getPath('temp'), 'opsecium-disk-' + process.pid)
app.setPath('userData', PROFILE)

const PASSPHRASE = 'a passphrase with spaces and 🔐'
const PROXY = 'socks5://10.11.12.13:1080'

const checks = []
function check (name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => checks.push(`ok    ${name}`))
    .catch((err) => {
      checks.push(`FAIL  ${name}\n      ${err.message}`)
      process.exitCode = 1
    })
}

// Re-requiring the store is how we pretend to restart: it is a singleton, so
// dropping it from the cache gives us a genuinely fresh one reading the same
// file from disk.
function freshStore () {
  delete require.cache[require.resolve('../src/main/store')]
  return require('../src/main/store')
}

const settingsFile = () => path.join(PROFILE, 'settings.json')

app.whenReady().then(async () => {
  let store = freshStore()
  store.load()
  store.set('vpn.proxy.url', PROXY)

  await check('a store with no passphrase is plain json', () => {
    const raw = fs.readFileSync(settingsFile(), 'utf8')
    assert.ok(raw.includes(PROXY), 'the proxy should be readable while unencrypted')
    assert.strictEqual(vault.isVault(raw), false)
  })

  await store.setPassphrase(PASSPHRASE)

  await check('setting a passphrase encrypts the file in place', () => {
    const raw = fs.readFileSync(settingsFile(), 'utf8')
    assert.ok(vault.isVault(raw), 'the file should be a vault now')
    assert.ok(!raw.includes(PROXY), 'the proxy address is still readable on disk')
    assert.ok(!raw.includes('socks5'), 'the proxy scheme is still readable on disk')
  })

  await check('no plaintext copy is left beside it', () => {
    const stragglers = fs.readdirSync(PROFILE)
      .filter((name) => name.startsWith('settings') && name !== 'settings.json')
    assert.deepStrictEqual(stragglers, [], `left behind: ${stragglers.join(', ')}`)
  })

  await check('the file permissions are owner only', () => {
    if (process.platform === 'win32') return // no posix mode to check
    const mode = fs.statSync(settingsFile()).mode & 0o777
    assert.strictEqual(mode, 0o600, `mode is ${mode.toString(8)}`)
  })

  // restart
  store = freshStore()
  const afterRestart = store.load()

  await check('a restart comes up locked, on defaults, not on your settings', () => {
    assert.strictEqual(store.locked, true)
    assert.strictEqual(store.encrypted, true)
    assert.notStrictEqual(afterRestart.vpn.proxy.url, PROXY, 'settings leaked while locked')
    assert.strictEqual(store.get('vpn.proxy.url'), '')
  })

  await check('the wrong passphrase does not unlock it', async () => {
    await assert.rejects(() => store.unlock('not the passphrase'), /wrong passphrase/)
    assert.strictEqual(store.locked, true, 'still locked after a failed attempt')
  })

  await check('the right passphrase brings the settings back', async () => {
    await store.unlock(PASSPHRASE)
    assert.strictEqual(store.locked, false)
    assert.strictEqual(store.get('vpn.proxy.url'), PROXY)
  })

  await check('removing the passphrase writes plain json again', async () => {
    await store.setPassphrase(null)
    const raw = fs.readFileSync(settingsFile(), 'utf8')
    assert.strictEqual(vault.isVault(raw), false)
    assert.ok(raw.includes(PROXY))
  })

  // ephemeral sessions

  await check('an ephemeral session keeps its cookies out of the profile', async () => {
    const ephemeral = session.fromPartition('opsecium-ephemeral')
    await ephemeral.cookies.set({ url: 'https://example.com', name: 'canary', value: 'should-not-persist' })
    const stored = await ephemeral.cookies.get({ name: 'canary' })
    assert.strictEqual(stored.length, 1, 'the cookie should work, just not be written out')

    await ephemeral.flushStorageData()
    await new Promise((resolve) => setTimeout(resolve, 300))

    const partitions = path.join(PROFILE, 'Partitions')
    const written = fs.existsSync(partitions)
      ? walk(partitions).filter((file) => /cookies/i.test(path.basename(file)))
      : []
    assert.deepStrictEqual(written, [], `cookie storage on disk: ${written.join(', ')}`)
  })

  await check('a persistent session is the one that does write', async () => {
    const persistent = session.fromPartition('persist:opsecium-disk-check')
    await persistent.cookies.set({ url: 'https://example.com', name: 'canary', value: 'this-one-persists' })
    await persistent.flushStorageData()
    await new Promise((resolve) => setTimeout(resolve, 500))

    const partitions = path.join(PROFILE, 'Partitions')
    const written = fs.existsSync(partitions)
      ? walk(partitions).filter((file) => /cookies/i.test(path.basename(file)))
      : []
    assert.ok(written.length > 0, 'nothing was written, so the check above proves nothing')
  })

  console.log(checks.join('\n'))
  console.log(process.exitCode ? '\ndisk checks failed' : `\n${checks.length} checks passed`)

  fs.rmSync(PROFILE, { recursive: true, force: true })
  app.exit(process.exitCode || 0)
}).catch((err) => {
  console.error('disk checks crashed:', err)
  app.exit(1)
})

function walk (dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}
