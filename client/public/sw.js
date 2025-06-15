var useSW = false;
if (useSW) {
  // var jsHash = "8ff3a466";
  // var cssHash = "00a2a709";
  var version = "SW_VERSION";
  var cacheName = "memorains_note_v_" + version;

  var filesToCatch = [
    // "/doc/client/",
    "/doc/client/quill.snow.css",
    // "/doc/client/static/js/main." + jsHash + ".js",
    // "/doc/client/static/css/main." + cssHash + ".css",
  ];

  self.addEventListener("install", function (e) {
    console.log("[Service Worker] Install");
    e.waitUntil(
      caches.open(cacheName).then(function (cache) {
        console.log("[Service Worker] Caching all: app shell and content");
        return cache.addAll(filesToCatch);
      }),
    );
  });

  self.addEventListener("fetch", function (e) {
    e.respondWith(
      caches.match(e.request).then(function (r) {
        var inCache = r ? "in cache" : "online";
        console.log(
          "[Service Worker] Fetching resource " +
            inCache +
            ": " +
            e.request.url,
        );
        return (
          r ||
          fetch(e.request).then(function (response) {
            return caches.open(cacheName).then(function (cache) {
              if (e.request.method === "GET") {
                console.log(
                  "[Service Worker] Caching new resource: " + e.request.url,
                );
                cache.put(e.request, response.clone());
              }
              return response;
            });
          })
        );
      }),
    );
  });

  self.addEventListener("activate", function (e) {
    console.log("[Service Worker] activate");
    e.waitUntil(
      caches.keys().then(function (keyList) {
        return Promise.all(
          keyList.map(function (key) {
            if (cacheName.indexOf(key) === -1) {
              console.log(
                "[Service Worker] delete cache:" + cacheName + ":" + key,
              );
              return caches.delete(key);
            }
          }),
        );
      }),
    );
  });
}
