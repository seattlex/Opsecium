'use strict'

const test = require('node:test')
const assert = require('node:assert')

const vault = require('../src/main/vault')

const SECRET = JSON.stringify({ vpn: { proxy: { url: 'socks5://127.0.0.1:9050' } } })

test('what goes in comes back out', async () => {
  const sealed = await vault.seal(SECRET, 'correct horse battery staple')
  assert.strictEqual(await vault.open(sealed, 'correct horse battery staple'), SECRET)
})

test('the plaintext is nowhere in the file', async () => {
  const sealed = await vault.seal(SECRET, 'pw')
  assert.ok(!sealed.includes('socks5'), 'the proxy url leaked')
  assert.ok(!sealed.includes('127.0.0.1'))
  assert.ok(vault.isVault(sealed))
})

test('the wrong passphrase does not half open it', async () => {
  const sealed = await vault.seal(SECRET, 'right')
  await assert.rejects(() => vault.open(sealed, 'wrong'), /wrong passphrase/)
  await assert.rejects(() => vault.open(sealed, ''), /wrong passphrase/)
})

test('an edited file is refused rather than trusted', async () => {
  const sealed = await vault.seal(SECRET, 'pw')
  const envelope = JSON.parse(sealed)

  const body = Buffer.from(envelope.body, 'base64')
  body[0] ^= 0xff
  const tampered = { ...envelope, body: body.toString('base64') }
  await assert.rejects(() => vault.open(JSON.stringify(tampered), 'pw'), /altered/)
})

test('the header is authenticated, so the parameters cannot be swapped', async () => {
  const sealed = await vault.seal(SECRET, 'pw')
  const envelope = JSON.parse(sealed)

  // claiming a different version has to fail outright
  await assert.rejects(() => vault.open(JSON.stringify({ ...envelope, version: 2 }), 'pw'), /not supported/)

  // and a file asking for a cheaper KDF must not be taken at its word
  const weakened = JSON.stringify({ ...envelope, N: 2 })
  await assert.rejects(() => vault.open(weakened, 'pw'), /wrong passphrase|altered/)
})

test('two seals of the same text look nothing alike', async () => {
  const a = await vault.seal(SECRET, 'pw')
  const b = await vault.seal(SECRET, 'pw')
  assert.notStrictEqual(a, b, 'salt and iv have to be fresh every write')

  const first = JSON.parse(a)
  const second = JSON.parse(b)
  assert.notStrictEqual(first.salt, second.salt)
  assert.notStrictEqual(first.iv, second.iv)
  assert.notStrictEqual(first.body, second.body)
})

test('rubbish is rejected with something readable', async () => {
  await assert.rejects(() => vault.open('not json at all', 'pw'), /not a vault file/)
  await assert.rejects(() => vault.open('{"just":"json"}', 'pw'), /not a vault file/)
  assert.strictEqual(vault.isVault('{"general":{}}'), false)
  assert.strictEqual(vault.isVault(null), false)
})

test('unicode and long passphrases survive the round trip', async () => {
  const passphrase = 'пароль 🔐 ' + 'x'.repeat(500)
  const sealed = await vault.seal(SECRET, passphrase)
  assert.strictEqual(await vault.open(sealed, passphrase), SECRET)
})
