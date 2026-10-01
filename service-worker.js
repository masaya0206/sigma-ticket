const CACHE_NAME = "sigma-ticket-home-routing-v14";

const CORE_ASSETS = [
  "./home.html",
  "./offline-scanner.html",
  "./offline-seller.html",
  "./presale.html",
  "./presale-collection.html",
  "./presale-collection-admin.html",
  "./admin-menu.html",
  "./manager.html",
  "./offline-store.js",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

const EXTERNAL_ASSETS = [
  "https://unpkg.com/html5-qrcode",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil((async()=>{
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    for (const url of EXTERNAL_ASSETS) {
      try {
        const res = await fetch(url);
        await cache.put(url, res.clone());
      } catch (_) {
        // 外部ライブラリの事前保存だけ失敗してもSW自体は更新する。
        // オンライン時の次回アクセスでfetchハンドラが保存を再試行する。
      }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const r = event.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);

  if (EXTERNAL_ASSETS.includes(u.href)) {
    event.respondWith(
      caches.match(r).then(cached => cached || fetch(r).then(async res => {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(r, res.clone());
        } catch (_) {}
        return res;
      }))
    );
    return;
  }

  if (u.origin !== location.origin) return;

  if (r.mode === "navigate" || r.destination === "document") {
    event.respondWith(
      fetch(r)
        .then(async res => {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(r, res.clone());
          } catch (_) {}
          return res;
        })
        .catch(() => caches.match(r).then(x => x || caches.match("./home.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(r).then(cached => cached || fetch(r).then(async res => {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(r, res.clone());
      } catch (_) {}
      return res;
    }))
  );
});
