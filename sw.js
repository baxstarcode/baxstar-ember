/* Baxstar Ember — service worker.
 *
 * Purpose: make repeat opens instant on weak lake signal. It caches the app shell and
 * the steampunk asset pack same-origin, stale-while-revalidate, so the second open paints
 * from cache immediately and refreshes in the background.
 *
 * Deliberately conservative:
 *   · Only same-origin GET requests are cached. Every non-GET, including the
 *     same-origin API gateway, passes straight through — Ember's brain is never
 *     served stale, and nothing here can cache an API response.
 *   · Navigation requests fall back to the last cached shell when offline, so opening the
 *     app with no signal still shows the UI (an in-progress caption is restored from
 *     localStorage by the app itself).
 *
 * This file is served same-origin; there is no CDN dependency. It is a no-op in any
 * context without service-worker support (e.g. the Claude artifact sandbox).
 */
// v3: navigations are network-first. Cache-first shell delivery kept showing
// an older build (including the pre-picker voice UI) for one more launch after
// every deploy, which made fixed voice bugs appear to return.
const CACHE = "ember-shell-v4";

self.addEventListener("install", (event) => {
  // Take over as soon as possible; the app is single-page and safe to update eagerly.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache writes / API POSTs

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (API proxy, fonts) → network

  const isNavigation = req.mode === "navigate";

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);

      const network = fetch(req)
        .then(async (res) => {
          // Only cache complete, OK, basic responses.
          if (res && res.ok && res.type === "basic") await cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      // The document controls which features exist, so it must prefer the
      // current deployment. Give weak lake signal 3.5s, then use the offline
      // shell while the update finishes and is saved for the next open.
      if (isNavigation) {
        const fresh = await Promise.race([
          network,
          new Promise((resolve) => setTimeout(() => resolve(null), 3500)),
        ]);
        if (fresh) return fresh;
        if (cached) {
          event.waitUntil(network.then(() => undefined));
          return cached;
        }
      }

      // Assets stay cache-first for instant paint, with a tracked revalidation.
      if (cached) {
        event.waitUntil(network.then(() => undefined));
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      // Offline with nothing cached for this request: for a navigation, serve any cached
      // shell document so the UI still opens.
      if (isNavigation) {
        const shell =
          (await cache.match("_preview.html")) ||
          (await cache.match("index.html")) ||
          (await cache.match("./"));
        if (shell) return shell;
      }
      return Response.error();
    })()
  );
});
