# Threat model

Being honest about this matters more than the feature list. Opsecium is built
against a specific set of problems, and there are plenty it does nothing about.

## What it is for

**A site or a script trying to work out what browser and device you are on.**
Handled. The string, the client hints, the JS surface and the viewport all
agree, and they agree with a real device rather than with a spoofed one. This
is the case where a UA switching extension gets you caught, because it changes
the string and leaves `sec-ch-ua` and `navigator.userAgentData` reporting the
truth underneath.

**The browser reporting on you by itself.** Handled. Chromium's own network
chatter is off at startup, not toggled in a settings page that a later update
can quietly re-enable. Nothing in this codebase phones home either - no
analytics, no update check, no crash reporting.

**Traffic escaping while the tunnel is down.** Handled by the kill switch. It
fails closed: an error talking to `piactl`, a half connected state or a
misconfigured proxy all count as "not connected" and traffic stops. Turning
the kill switch off is a deliberate choice in settings.

**Your real address leaking around a working tunnel.** Mostly handled. WebRTC
is forced to `disable_non_proxied_udp`, which covers the classic STUN leak
including from workers. DNS is the VPN daemon's job in PIA mode; in proxy mode
resolution happens at the proxy for SOCKS5, so prefer SOCKS5 over HTTP, or set
a DNS over HTTPS template.

**A profile contradicting itself.** Handled for the surfaces that get checked
together. WebGL reports a GPU that fits the claimed platform, core count and
memory are plausible for the claimed device, touch points follow the mobile
flag, and timezone and locale can be pinned so `new Date()` does not undo the
user agent. `opsecium://leaks` shows the pairs and flags the ones that
disagree.

**Being recognised across visits by a hash.** Partly handled. Canvas, audio
and text metrics carry noise seeded per session and per origin. Two sites get
different answers, one site gets a consistent answer, and "new identity"
changes both. The consistency is the point - noise that changes on every read
is a stronger signal than no noise at all, since no real browser behaves that
way.

## What it is not for

**Anonymity.** This is not Tor Browser and does not try to be. There is no
circuit, no traffic analysis resistance, and no attempt to make you look like
everybody else. You get an identity you chose instead of the one your build
hands out - a different goal.

**Fingerprinting in general.** The surfaces above are covered. Plenty are not:
WebGL rendering output beyond the vendor strings, installed fonts by any route
other than text width, media capabilities and codec support, WebGPU, speech
synthesis voices, battery, and timing side channels. A determined
fingerprinter with a large enough surface will still tell sessions apart, and
emulating a phone convincingly end to end - where the GPU renders like a
phone, not merely reports one - is a much larger project than this one.

Noise is also a trade. A site that hashes a canvas to detect fraud may decide
you are suspicious. That is the cost of not being trackable by the same
mechanism, and it is one checkbox away if a site you need breaks.

**A hostile local machine.** Settings live in a plain JSON file in the user
data directory, mode 0600. Anything with your user account can read it. There
are no secrets in it, but there is a proxy URL.

**Network level observation.** Your ISP sees a VPN connection. Whoever runs the
exit sees your traffic. That is the trade every VPN makes and Opsecium does not
change it.

## Deliberate choices

**Bundling the PIA client was rejected.** It is proprietary, it needs a
subscription, and it wants root to install a daemon and rewrite routes.
Shipping a copy would mean redistributing someone else's software and asking
for privileges this browser has no business holding. Driving `piactl` means
credentials never pass through Opsecium at all.

**Permissions default to no.** Geolocation, USB, serial, HID, bluetooth and
idle detection are refused outright rather than prompted, because a prompt is
something people click through. Camera, microphone and notifications are denied
for now too; they need a prompt surface in the shell before they can be
anything else, and denying is the safe placeholder.

**`clearOnExit` is on by default.** Losing your sessions on every close is
annoying and it is still the right default for the kind of browsing this is
for. It is one checkbox away.

**No extension support.** Chromium extensions get broad access to page content
and network requests. Supporting them would undo a good part of the point, and
Electron's extension support is partial anyway.

## Known gaps

- Camera, microphone and notification requests are denied rather than prompted.
- No per site settings, no history UI, no bookmarks yet.
- The blocklist is a static host list, not a filter engine.
- Timezone has to be set by hand. It is not derived from the VPN exit, so
  connecting to a Tokyo endpoint does not move the clock on its own.
- Device emulation resizes the viewport and reports a matching GPU, but the
  rendering is still done by the real one. Anything that hashes actual WebGL
  output rather than reading the vendor string sees a desktop.
- Nothing is code signed, so first run warnings are expected on Windows and
  macOS.
