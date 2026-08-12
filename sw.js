/* Baxstar Ember — service worker.
 *
 * Purpose: make repeat opens instant on weak lake signal. It caches the app shell and
 * the steampunk asset pack same-origin, stale-while-revalidate, so the second open paints
 * from cache immediately and refreshes in the background.
 *
 * Deliberately conservative:
 *   · Only same-origin GET requests are cached. The Claude API proxy (cross-origin) and
 *     every non-GET are passed straight through to the network — Ember's brain is never
 *     served stale, and nothing here can cache an API response.
 *   · Navigation requests fall back to the last cached shell when offline, so opening the
 *     app with no signal still shows the UI (an in-progress caption is restored from
 *     localStorage by the app itself).
 *
 * This file is served same-origin; there is no CDN dependency. It is a no-op in any
 * context without service-worker support (e.g. the Claude artifact sandbox).
 */
// Bump whenever shell behavior changes. v2 specifically retires the build that
// opened the mic automatically and prevents an authenticated tab from staying
// on that cached shell while a private window receives the new one.
const CACHE = "ember-shell-v2";

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

  // The app document (navigation) is NETWORK-FIRST: online you always get the freshest
  // build, so a deploy is never a reload behind. Offline, we fall back to the last cached
  // shell so the UI still opens (an in-progress caption is restored from localStorage).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok && fresh.type === "basic") cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          return (
            (await cache.match(req)) ||
            (await cache.match("index.html")) ||
            (await cache.match("_preview.html")) ||
            (await cache.match("./")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // Everything else same-origin (assets: SVGs, webp, the manifest) is
  // STALE-WHILE-REVALIDATE: instant from cache, refreshed in the background. These are
  // content-stable, so serving a cached copy first is exactly what makes repeat opens
  // instant on weak signal.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) { network; return cached; }
      const fresh = await network;
      return fresh || Response.error();
    })()
  );
});
