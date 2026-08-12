// Minimal service worker — exists only to satisfy the Trusted Web Activity
// installability requirement (Android requires a registered service worker
// with a fetch handler before it will treat a site as an installable app).
// Deliberately not implementing offline caching — every request just passes
// straight through to the network, unchanged. Real offline support is
// separate, unrequested scope.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
