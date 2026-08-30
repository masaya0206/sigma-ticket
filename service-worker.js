const CACHE_NAME = "sigma-ticket-pwa-v2";

const APP_SHELL = [
  "./",
  "./home.html",
  "./staff.html",
  "./seller.html",
  "./seller-register.html",
  "./claim.html",
  "./index.html",
  "./front.html",
  "./back.html",
  "./admin.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Supabase/API/CDN requests are always networked.
  if (url.origin !== self.location.origin) {
    return;
  }

  // HTML/navigation: network first so GitHub Pages updates show quickly.
  if (
    request.mode === "navigate" ||
    request.destination === "document"
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request)
            .then((cached) => cached || caches.match("./home.html"))
        )
    );
    return;
  }

  // Static local files: cache first.
  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
            return response;
          });
      })
  );
});
