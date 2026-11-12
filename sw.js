// オフライン（ホール内の電波が弱い場所）でも開けるようにキャッシュする
const CACHE = 'pachi-ev-v3';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
// 同じ github.io 上の別アプリのキャッシュは消さない
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pachi-ev-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
// キャッシュを先に返して即起動し、裏でネットから更新（電波が弱くても待たされない）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true }) || (e.request.mode === 'navigate' && await c.match('./'));
    const net = fetch(e.request).then(r => { if (r.ok) return c.put(e.request, r.clone()).then(() => r); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
