'use strict'

// "//" is what separates a real scheme from a host with a port - without it
// "localhost:3000" and "example.com:8080" both parse as schemes.
const HIERARCHICAL = /^[a-z][a-z0-9+.-]*:\/\//i
const OPAQUE_SCHEME = /^(mailto|tel|magnet|about|opsecium|view-source|chrome|javascript|data|file):/i
const REFUSED_SCHEME = /^(javascript|data|file):/i
const LOOKS_LIKE_HOST = /^[^\s/?#]+\.[a-z]{2,}(:\d+)?(\/|$|\?|#)/i
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i

// Anything that is not clearly an address goes to the search engine. Default
// engine is DuckDuckGo, mostly because it does not need a session to work.
function normalise (input, searchEngine) {
  const raw = String(input || '').trim()
  if (!raw) return ''

  // these only ever end up in an address bar by accident or on someone's behalf
  if (REFUSED_SCHEME.test(raw)) return search(raw, searchEngine)
  if (HIERARCHICAL.test(raw) || OPAQUE_SCHEME.test(raw)) return raw

  if (LOCALHOST.test(raw)) return 'http://' + raw
  if (LOOKS_LIKE_HOST.test(raw) && !raw.includes(' ')) return 'https://' + raw

  return search(raw, searchEngine)
}

function search (query, engine) {
  const template = engine || 'https://duckduckgo.com/?q=%s'
  return template.replace('%s', encodeURIComponent(query))
}

// What the address bar shows: internal pages read better without the scheme
function display (url) {
  if (!url) return ''
  if (url.startsWith('opsecium://')) return url.replace('opsecium://', '')
  return url
}

module.exports = { normalise, search, display }
