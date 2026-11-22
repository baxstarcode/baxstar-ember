# Ember in a Mac app window

Ember uses Chrome's installed web-app support. Install from
https://ember.baxstarfishing.com in the Chrome profile already used for Ember:
choose Chrome's install icon in the address bar and confirm Install. Chrome also
offers installation through its menu. Open the installed Ember, then use the Dock
icon's Options → Keep in Dock if desired. This is not a DMG or native Apple client.

The app opens the main Ember screen in a standalone window. Caption Studio remains
an app shortcut. Existing browser app identity is preserved with an explicit
manifest `id` matching the former caption start URL; do not replace it with `/`
just because the new launch URL is `/`. Changing identity can create a second app.

The current Ember SVG supplies 192px and 512px PNG app icons and a 180px Apple touch
icon. Regenerate them with `node scripts/export-app-icons.mjs`. The manifest link
uses credentials because Cloudflare Access protects the manifest as well as HTML.
Its versioned URL avoids reusing an older cached Caption Studio manifest during
the install; the explicit app identity remains unchanged.
No Access policy, Worker, API, data storage, service worker, or voice behavior changes.
The existing network-first document strategy receives published updates on reopening
when the network and Access session are available; an already-open session is not
automatically reloaded during a conversation. Offline availability of a cached
shell is not offline AI or an authentication bypass.

Verification: `npm run build:pages` and `npm run test:app-install`. The latter uses
a temporary regular Chromium profile and a cookie-gated local manifest, checks the
browser's installability errors, decodes the actual PNGs, verifies main-screen
launch, and checks a new document is received on reload. It captures desktop/phone
views at device scale 3. The test profile is removed afterward. Incognito is not
used because Chrome refuses app installation there.

Local checks do not establish actual macOS Dock installation, production Cloudflare
session transfer, or physical microphone/speaker behavior in an installed window.
The active Codex environment has no tool controlling Brady's Chrome; do not ask him
to authenticate in a substitute cloud browser. Foreground-only voice and the
existing Aria provider remain the supported scope.

References: [MDN installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
and [stable app identity](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id).
