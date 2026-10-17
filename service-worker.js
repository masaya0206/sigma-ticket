const CACHE_NAME = "sigma-connection-status-v87";

const CORE_ASSETS = [
  "./connection-status.js",
  "./home.html",
  "./offline-scanner.html",
  "./offline-seller.html",
  "./offline-work-store.js",
  "./offline-attendance-qr.html",
  "./offline-attendance.html",
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

  // HTMLはオンライン最新版を優先しつつ、全画面へ共通の通信状態バーを注入。
  // オフライン時は保存済みHTMLにも同じバーを付与する。
  if (request.mode === "navigate" || request.destination === "document") {
    const injectConnectionStatus = async response => {
      if (!response) return response;
      const type = response.headers.get("content-type") || "";
      if (!type.includes("text/html")) return response;
      try {
        let html = await response.clone().text();
        if (!html.includes("connection-status.js")) {
          const script = '<script src="./connection-status.js"></script>';
          if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, script + "</body>");
          else html += script;
        }
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        return new Response(html,{status:response.status,statusText:response.statusText,headers});
      } catch (_) { return response; }
    };
    event.respondWith((async()=>{
      try {
        const network=await fetch(request);
        if(network&&network.ok){try{const cache=await caches.open(CACHE_NAME);await cache.put(request,network.clone());}catch(_){}}
        return await injectConnectionStatus(network);
      } catch (_) {
        const cached=await caches.match(request)||await caches.match("./home.html");
        return await injectConnectionStatus(cached);
      }
    })());
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
