# Opsecium

A Chromium browser that lets you decide what it says about you, routes through
a VPN, and does not talk to anyone you did not ask it to talk to.

Built on Electron, so the engine is real Chromium - pages render the way they
render everywhere else. What is different is everything around the engine.

## Getting it

Grab an installer from [releases](https://github.com/seattlex/Opsecium/releases):

| | |
|---|---|
| Windows | `Opsecium-<version>-win-x64.exe` installs it, or the portable exe runs with no install |
| macOS | `Opsecium-<version>-mac-x64.dmg` |
| Linux | `.AppImage` runs anywhere, `.deb` for Debian and Ubuntu |

Nothing is code signed yet, so Windows shows a SmartScreen warning and macOS
needs the app allowed through Gatekeeper on first run. Every release carries a
`SHA256SUMS.txt` built alongside the artifacts.

Or run it from source - see [docs/BUILDING.md](docs/BUILDING.md).

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

## Fingerprinting

A user agent nobody can contradict is only half the job. The values that
should follow the profile are made to follow it, and the ones that get read as
a hash are perturbed:

- **WebGL** reports a GPU that fits the platform being claimed. An Android
  profile says Adreno or Mali, a Windows one says an ANGLE/Direct3D string, and
  the desktop GPU actually doing the work never appears.
- **Canvas, audio and text metrics** get noise that is *stable per site and per
  session*. This part matters: noise that changes on every read is itself a
  giveaway, because reading the same canvas twice returns the same bytes in
  every real browser. Two different sites get two different answers and cannot
  line them up.
- **Core count and memory** are set to plausible values for the device claimed,
  so a phone does not report 32 threads.
- **Timezone and locale** can be pinned, so a machine in UTC does not undo an
  Asia/Tokyo cover story the moment a page calls `new Date()`.
- The patched methods still return `[native code]` from `toString()`, which is
  the first thing a fingerprinting script checks.

**New identity** (`Ctrl+Shift+N`) rotates the noise seed and clears cookies,
cache and storage in one go. Everything derived above changes with it.

`opsecium://leaks` measures all of it in the page, with no network calls, and
tells you which pairs are consistent. Run it after switching profiles.

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
- HTTPS only, upgrading insecure requests and leaving loopback and `.onion`
  alone because upgrading those only breaks them
- cross site `Referer` stripped
- optional DNS over HTTPS, since the resolver otherwise hands over every host
  you visit regardless of the tunnel

There is no analytics in Opsecium itself, no update check, no crash reporting
and no remote config. The only network traffic is what you navigate to.

## Running it

```sh
npm install
npm start
```

Tests cover the parts worth being sure about - user agent derivation, header
rewriting, fingerprint config, the blocklist and address bar parsing. The
smoke check boots the browser for real and asserts on what a server receives
and what the page can read:

```sh
npm test
npm run smoke
```

Packaging is in [docs/BUILDING.md](docs/BUILDING.md).

## Keyboard

| | |
|---|---|
| `Ctrl+T` | new tab |
| `Ctrl+W` | close tab |
| `Ctrl+L` | focus address bar |
| `Ctrl+R` | reload (`Ctrl+Shift+R` ignores cache) |
| `Ctrl+,` | settings |
| `Ctrl+Shift+N` | new identity |
| `F12` | devtools |

## What this is not

Not Tor Browser. Opsecium gives you a consistent, chosen identity and stops the
browser reporting on you - it does not make you anonymous, and a coherent fake
user agent is still one more thing to fingerprint if the rest of your setup is
unique. Canvas, WebGL, fonts and audio are untouched so far. See
[docs/threat-model.md](docs/threat-model.md) for what is covered and what is not.

## Licence

MIT.
