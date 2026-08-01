'use strict'

// Everything in here runs before app.whenReady(). Chromium reads most of these
// once at startup, so there is no runtime toggle for them - if you want a
// different setup you restart the browser.

// Features that phone home, profile the user, or exist purely to feed an ad
// stack. None of them are needed to render a page.
const DISABLED_FEATURES = [
  'AutofillServerCommunication',
  'OptimizationHints',
  'OptimizationHintsFetching',
  'Translate',
  'TranslateUI',
  'MediaRouter',
  'DialMediaRouteProvider',
  'SegmentationPlatform',
  'InterestFeedContentSuggestions',
  // Privacy Sandbox - all of it
  'PrivacySandboxSettings3',
  'PrivacySandboxSettings4',
  'BrowsingTopics',
  'InterestGroupStorage',
  'Fledge',
  'FledgeBiddingAndAuctionServer',
  'AttributionReporting',
  'AttributionReportingCrossAppWeb',
  'TrustTokens',
  'PrivateStateTokens',
  'FencedFrames',
  'SharedStorageAPI',
  // Misc reporting surfaces
  'CrashpadReporting',
  'IdleDetection',
  'ComputePressure'
]

const SWITCHES = [
  // no metrics, no crash uploads, no variations seed fetch
  ['disable-background-networking'],
  ['disable-breakpad'],
  ['disable-crash-reporter'],
  ['disable-domain-reliability'],
  ['disable-component-update'],
  ['disable-client-side-phishing-detection'],
  ['disable-sync'],
  ['disable-speech-api'],
  ['no-pings'],
  ['no-default-browser-check'],
  ['no-first-run'],
  ['no-service-autorun'],
  ['safebrowsing-disable-auto-update'],
  // don't hand the resolver a list of everything you might click
  ['dns-prefetch-disable'],
  // variations service is the A/B testing channel back to Google
  ['disable-field-trial-config'],
  ['variations-server-url', ''],
  ['disable-search-engine-choice-screen']
]

function applyHardeningSwitches (app, settings) {
  for (const [name, value] of SWITCHES) {
    if (value === undefined) app.commandLine.appendSwitch(name)
    else app.commandLine.appendSwitch(name, value)
  }

  app.commandLine.appendSwitch('disable-features', DISABLED_FEATURES.join(','))

  // WebRTC will happily announce your real address over a proxied session.
  // Chromium's own switch is the only thing that covers workers too.
  if (settings.get('privacy.blockWebrtcLeaks')) {
    app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')
  }

  if (settings.get('privacy.disableHardwareAcceleration')) {
    app.disableHardwareAcceleration()
  }

  // Send origins rather than full paths in Referer, cross origin.
  if (settings.get('privacy.trimReferrers')) {
    app.commandLine.appendSwitch('enable-features', 'ReducedReferrerGranularity')
  }
}

module.exports = { applyHardeningSwitches, DISABLED_FEATURES, SWITCHES }
