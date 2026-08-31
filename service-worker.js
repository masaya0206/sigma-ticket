const CACHE_NAME = "sigma-ticket-pwa-v5-1";
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
 "./operations.html",
 "./seller-team.html",
 "./points-admin.html",
 "./points-my.html",
 "./order-entry.html",
 "./register-teams.html",
 "./shopping.html",
 "./role-control.html",
 "./manifest.webmanifest",
 "./icon-180.png",
 "./icon-192.png",
 "./icon-512.png"
];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin!==location.origin)return;if(r.mode==="navigate"||r.destination==="document"){e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE_NAME).then(c=>c.put(r,cp));return res}).catch(()=>caches.match(r).then(x=>x||caches.match("./home.html"))));return;}e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{const cp=res.clone();caches.open(CACHE_NAME).then(x=>x.put(r,cp));return res})));});
