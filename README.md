# Opsecium

A Chromium browser that lets you decide what it says about you, routes through
a VPN, and does not talk to anyone you did not ask it to talk to.

Built on Electron, so the engine is real Chromium - pages render the way they
render everywhere else. What is different is everything around the engine.

## Why

Every mainstream browser leaks. Not always maliciously, but constantly: variations
seeds, safe browsing pings, update checks, autofill lookups, dictionary downloads,
crash uploads. On top of that, changing your user agent with an extension is close
to pointless now, because Chromium also sends User-Agent Client Hints that are
generated from the real build and do not change with the string.

Opsecium fixes both ends of that.

## User agent

Pick a profile or paste your own string. Either way the whole identity moves
together:

- `User-Agent` header and `navigator.userAgent`
- `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `-platform-version`,
  `-arch`, `-model`, `-bitness`, `-full-version-list`
- `navigator.userAgentData`, including `getHighEntropyValues()`
- `navigator.platform`, `vendor`, `maxTouchPoints`, `language`, `languages`
- viewport, device pixel ratio and touch events when the string is a phone

For a custom string the hint metadata is derived from the string itself, so
this:

```
Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36
```

also produces `"Samsung Internet";v="27"` in `sec-ch-ua`, `?1` for mobile,
`"Android"` and `"10"` for the platform, `"K"` for the model, and a 412x915
viewport at 2.625x. Paste a Safari or Firefox string and the client hint
headers are dropped entirely, because those engines do not send them.

Settings shows exactly what a site will see before you commit to it. Changing
profile applies to every open tab immediately - no restart.

## VPN

Three modes:

**Private Internet Access** - drives the PIA desktop client through its own
`piactl` CLI. The daemon keeps owning routing, DNS and credentials; Opsecium
just connects, disconnects, picks a region and watches the state. `piactl` is
autodetected in the usual install locations on Linux, macOS and Windows, and
you can point at it manually if yours lives somewhere else.

**Proxy** - any SOCKS5 or HTTP endpoint, which covers other providers,
a WireGuard box you run yourself, or a local Tor `socks5://127.0.0.1:9050`.

**Off** - normal connection, no pretence otherwise.

The kill switch is on by default. While the tunnel is down, requests are
cancelled and top level navigations land on an internal page instead. It fails
closed: an error talking to `piactl` counts as "not connected".

PIA is not bundled - it is proprietary and needs your own subscription. Install
the client, sign in once, and Opsecium picks it up from there.

## Telemetry

Removed rather than turned down.

- background networking, variations/field trials, component and metrics
  reporting, domain reliability, breakpad and crash uploads, safe browsing
  update pings, DNS prefetch, autofill server calls all disabled at startup
- Privacy Sandbox in full - Topics, FLEDGE, Attribution Reporting, Trust
  Tokens, Shared Storage, Fenced Frames
- spell checker off, because it fetches dictionaries from Google on first use
- `X-Client-Data` stripped from every request; `DNT` and `Sec-GPC` added
- WebRTC forced to `disable_non_proxied_udp` so it cannot announce your real
  address around the tunnel
- a blocklist of known telemetry and analytics endpoints, extendable in
  settings
- geolocation, USB, serial, HID, bluetooth and idle detection refused outright
- cookies, cache and storage cleared on exit by default

There is no analytics in Opsecium itself, no update check, no crash reporting
and no remote config. The only network traffic is what you navigate to.

## Running it

```sh
npm install
npm start
```

Tests cover the parts worth being sure about - user agent derivation, header
rewriting, the blocklist and address bar parsing:

```sh
npm test
```

Packaging:

```sh
npm run dist:linux    # AppImage + deb
npm run dist:win      # nsis
npm run dist:mac      # dmg
```

## Keyboard

| | |
|---|---|
| `Ctrl+T` | new tab |
| `Ctrl+W` | close tab |
| `Ctrl+L` | focus address bar |
| `Ctrl+R` | reload (`Ctrl+Shift+R` ignores cache) |
| `Ctrl+,` | settings |
| `F12` | devtools |

## What this is not

Not Tor Browser. Opsecium gives you a consistent, chosen identity and stops the
browser reporting on you - it does not make you anonymous, and a coherent fake
user agent is still one more thing to fingerprint if the rest of your setup is
unique. Canvas, WebGL, fonts and audio are untouched so far. See
[docs/threat-model.md](docs/threat-model.md) for what is covered and what is not.

## Licence

MIT.
