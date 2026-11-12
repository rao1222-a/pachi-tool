// オフライン（ホール内の電波が弱い場所）でも開けるようにキャッシュする
const CACHE = 'pachi-ev-v1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
));
// ネット優先・失敗したらキャッシュ（更新がすぐ反映されるように）
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request))
));
