const CACHE_NAME = "sigma-coupon-map-movieclub-v51";

const CORE_ASSETS = [
  "./home.html",
  "./offline-scanner.html",
  "./offline-seller.html",
  "./presale.html",
  "./presale-collection.html",
  "./presale-collection-admin.html",
  "./admin-menu.html",
  "./offline-test-reset-admin.html",
  "./manager.html",
  "./offline-store.js",
  "./benefits.html",
  "./claim.html",
  "./sample-ticket.html",
  "./ticket.html",
  "./coupon-campus-illustrated.png",
  "./coupon-campus-illustrated.svg",
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
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // 1ファイルの取得失敗でService Worker全体の更新が止まらないよう個別保存。
    for (const url of CORE_ASSETS) {
      try {
        await cache.add(url);
      } catch (_) {}
    }

    for (const url of EXTERNAL_ASSETS) {
      try {
        const res = await fetch(url);
        if (res && res.ok) await cache.put(url, res.clone());
      } catch (_) {}
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
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (EXTERNAL_ASSETS.includes(url.href)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(async response => {
        try {
          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }
        } catch (_) {}
        return response;
      }))
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // offline-store.js は更新頻度が高く、古いキャッシュだと集金画面が起動できない。
  // クエリ文字列の有無に関係なく常にネットワークを優先し、成功時だけ最新をキャッシュ。
  if (url.pathname.endsWith("/offline-store.js")) {
    event.respondWith(
      fetch(request)
        .then(async response => {
          try {
            if (response && response.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(request, response.clone());
            }
          } catch (_) {}
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("./offline-store.js")))
    );
    return;
  }

  // HTMLは常にオンラインの最新版を優先。
  // これによりノルマ集金担当解除などの権限変更が古いキャッシュに邪魔されにくくなる。
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then(async response => {
          try {
            if (response && response.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(request, response.clone());
            }
          } catch (_) {}
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match("./home.html")))
    );
    return;
  }

  // 画像・JS等はキャッシュ優先。未保存なら取得して保存。
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(async response => {
      try {
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
      } catch (_) {}
      return response;
    }))
  );
});
