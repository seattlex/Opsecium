'use strict'

// Settings at rest. Without a passphrase this is a plain JSON file and anyone
// with your user account can read your proxy, your custom user agent and the
// hosts you added. That is fine for a browser you use for privacy - it is not
// fine for one you use for confidentiality.
//
// scrypt for the KDF because the threat here is an offline guess against a
// file someone copied, and scrypt makes that expensive in memory as well as
// time. AES-256-GCM so a tampered file fails to open rather than opening
// wrong.

const crypto = require('node:crypto')

const MAGIC = 'OPSECIUM-VAULT'
const VERSION = 1

// ~128 MB and about a tenth of a second on a normal machine. Unlocking happens
// once per launch, so the cost lands on an attacker guessing, not on you.
const KDF = { N: 2 ** 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 }

function deriveKey (passphrase, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(passphrase), salt, KDF.keylen, KDF, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
}

async function seal (plaintext, passphrase) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = await deriveKey(passphrase, salt)

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  // the header is authenticated too, so nobody can downgrade the version or
  // swap the KDF parameters on a file we then trust
  const header = Buffer.from(JSON.stringify({ magic: MAGIC, version: VERSION, kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p }))
  cipher.setAAD(header)

  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()])
  key.fill(0)

  return JSON.stringify({
    magic: MAGIC,
    version: VERSION,
    kdf: 'scrypt',
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    body: body.toString('base64')
  })
}

async function open (serialised, passphrase) {
  let envelope
  try {
    envelope = JSON.parse(serialised)
  } catch {
    throw new Error('this is not a vault file')
  }

  if (envelope.magic !== MAGIC) throw new Error('this is not a vault file')
  if (envelope.version !== VERSION) throw new Error(`vault version ${envelope.version} is not supported`)
  if (envelope.kdf !== 'scrypt') throw new Error(`unknown key derivation "${envelope.kdf}"`)

  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const body = Buffer.from(envelope.body, 'base64')

  // Derive with the parameters the file was written with, but never let a file
  // talk us into something cheaper than what we would choose ourselves.
  const params = {
    N: Math.max(Number(envelope.N) || 0, KDF.N),
    r: Math.max(Number(envelope.r) || 0, KDF.r),
    p: Math.max(Number(envelope.p) || 0, KDF.p),
    keylen: KDF.keylen,
    maxmem: KDF.maxmem
  }

  const key = await new Promise((resolve, reject) => {
    crypto.scrypt(String(passphrase), salt, params.keylen, params, (err, derived) => {
      if (err) reject(err)
      else resolve(derived)
    })
  })

  const header = Buffer.from(JSON.stringify({
    magic: envelope.magic,
    version: envelope.version,
    kdf: envelope.kdf,
    N: envelope.N,
    r: envelope.r,
    p: envelope.p
  }))

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(header)
  decipher.setAuthTag(tag)

  try {
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
    key.fill(0)
    return plaintext
  } catch {
    key.fill(0)
    // GCM cannot tell "wrong key" from "edited file" and neither can we
    throw new Error('wrong passphrase, or the file has been altered')
  }
}

function isVault (contents) {
  if (typeof contents !== 'string') return false
  const head = contents.slice(0, 200)
  return head.includes(`"magic":"${MAGIC}"`) || head.includes(`"magic": "${MAGIC}"`)
}

module.exports = { seal, open, isVault, MAGIC, VERSION, KDF }
