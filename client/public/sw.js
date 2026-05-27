var useSW = false;
if (useSW) {
  var version = "SW_VERSION-PACKAGE_HASH";
  var cacheName = "memorains_note_v_" + version;

  // All SPA routes under /doc/client/ resolve to the same index.html.
  // We cache it once under this key and serve it for every navigation request.
  var appShellKey = "/doc/client/index.html";

  // Check if the request is a navigation (HTML/document) request —
  // i.e. a browser page navigation or any request expecting text/html.
  function isNavigationRequest(request) {
    return (
      request.mode === "navigate" ||
      (request.method === "GET" &&
        request.headers.get("accept") &&
        request.headers.get("accept").indexOf("text/html") !== -1)
    );
  }

  // ---- Install ----
  // Don't pre-cache index.html here!  During install, the OLD service
  // worker is still controlling the page, and its fetch handler would
  // intercept our cache.add() request — potentially returning the stale
  // cached index.html, which the new SW would then incorrectly cache.
  //
  // Instead, the first navigation after activation populates the cache
  // (lazy caching).  Combined with skipWaiting() + controllerchange reload,
  // this is seamless: the reload triggers the network fetch, the response
  // is cached, and every subsequent navigation is instant from cache.
  self.addEventListener("install", function (e) {
    console.log("[Service Worker] Install");
    // Immediately activate, don't wait for tabs to close.
    self.skipWaiting();
  });

  // ---- Fetch ----
  self.addEventListener("fetch", function (e) {
    // -- Navigation requests (HTML pages) --
    // Strategy: Cache-first, lazy-populated on first navigation.
    //
    // - First navigation after SW activation: cache miss → network fetch
    //   → cache the response → subsequent navigations are instant.
    // - All SPA routes map to the same appShellKey cache entry.
    // - Version updates: PACKAGE_HASH changes → new sw.js → new SW
    //   installs → activates → cleans old cache → reload → first
    //   navigation populates new cache → instant thereafter.
    if (isNavigationRequest(e.request)) {
      e.respondWith(
        caches.open(cacheName).then(function (cache) {
          return cache.match(appShellKey).then(function (cachedResponse) {
            if (cachedResponse) {
              return cachedResponse;
            }
            return fetch(e.request).then(function (networkResponse) {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(appShellKey, networkResponse.clone());
              }
              return networkResponse;
            });
          });
        }),
      );
      return;
    }

    // -- Static assets (JS, CSS, fonts, images, etc.) --
    // Strategy: Cache-first.
    // Vite generates unique content hashes in filenames (e.g. index-CesdcEv-.js),
    // so each asset URL is permanently immutable — a cache hit is always correct.
    e.respondWith(
      caches.match(e.request).then(function (cachedResponse) {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(e.request).then(function (networkResponse) {
          if (
            e.request.method === "GET" &&
            networkResponse.status === 200
          ) {
            var cloned = networkResponse.clone();
            caches.open(cacheName).then(function (cache) {
              cache.put(e.request, cloned);
            });
          }
          return networkResponse;
        });
      }),
    );
  });

  // ---- Activate: clean old caches and take over ----
  self.addEventListener("activate", function (e) {
    console.log("[Service Worker] Activate, cleaning old caches");
    e.waitUntil(
      caches.keys().then(function (keyList) {
        return Promise.all(
          keyList.map(function (key) {
            if (key !== cacheName) {
              console.log("[Service Worker] Deleting old cache: " + key);
              return caches.delete(key);
            }
          }),
        );
      }),
    );
    // Take control of all open pages immediately.
    self.clients.claim();
  });
}
