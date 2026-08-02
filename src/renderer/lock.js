'use strict'

const api = window.opsecium
const $ = (id) => document.getElementById(id)

const mode = new URLSearchParams(location.search).get('mode') || 'locked'

if (mode === 'startup') {
  $('heading').textContent = 'Opsecium is sealed'
  $('hint').textContent = 'Your settings are encrypted. Enter the passphrase to open them.'
  $('foot').textContent = 'Closing this window quits, it does not skip the passphrase.'
} else {
  $('foot').textContent = 'The passphrase is not held in memory while this is up.'
}

let busy = false

$('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (busy) return

  const passphrase = $('passphrase').value
  if (!passphrase) return

  busy = true
  $('submit').disabled = true
  $('submit').textContent = 'Working'
  $('error').textContent = ''

  // scrypt is meant to take a moment, so say something rather than freezing
  const result = await api.lock.attempt(passphrase)

  busy = false
  $('submit').disabled = false
  $('submit').textContent = 'Unlock'

  if (!result.ok) {
    $('error').textContent = result.error || 'that did not work'
    $('passphrase').value = ''
    $('passphrase').focus()
  }
})

$('passphrase').focus()
