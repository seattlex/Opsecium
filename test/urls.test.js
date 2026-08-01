'use strict'

const test = require('node:test')
const assert = require('node:assert')

const urls = require('../src/main/urls')

const ENGINE = 'https://duckduckgo.com/?q=%s'

test('bare hosts get https, not a search', () => {
  assert.strictEqual(urls.normalise('example.com', ENGINE), 'https://example.com')
  assert.strictEqual(urls.normalise('example.com/path?a=1', ENGINE), 'https://example.com/path?a=1')
  assert.strictEqual(urls.normalise('sub.example.co.uk', ENGINE), 'https://sub.example.co.uk')
})

test('localhost stays on http', () => {
  assert.strictEqual(urls.normalise('localhost:3000', ENGINE), 'http://localhost:3000')
  assert.strictEqual(urls.normalise('127.0.0.1:8080/admin', ENGINE), 'http://127.0.0.1:8080/admin')
})

test('anything with spaces is a search', () => {
  assert.strictEqual(urls.normalise('what is a client hint', ENGINE), 'https://duckduckgo.com/?q=what%20is%20a%20client%20hint')
  assert.strictEqual(urls.normalise('example.com is down', ENGINE), 'https://duckduckgo.com/?q=example.com%20is%20down')
})

test('explicit schemes are left alone', () => {
  assert.strictEqual(urls.normalise('https://example.com', ENGINE), 'https://example.com')
  assert.strictEqual(urls.normalise('opsecium://newtab', ENGINE), 'opsecium://newtab')
})

test('pasted javascript and file urls are searched, never run', () => {
  assert.ok(urls.normalise('javascript:alert(1)', ENGINE).startsWith('https://duckduckgo.com/'))
  assert.ok(urls.normalise('file:///etc/passwd', ENGINE).startsWith('https://duckduckgo.com/'))
  assert.ok(urls.normalise('data:text/html,<h1>x', ENGINE).startsWith('https://duckduckgo.com/'))
})

test('empty input does nothing', () => {
  assert.strictEqual(urls.normalise('', ENGINE), '')
  assert.strictEqual(urls.normalise('   ', ENGINE), '')
})
