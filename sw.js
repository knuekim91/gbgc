/* 서비스 워커 — 화면 파일만 캐시합니다.
 * 링크 데이터(Apps Script 응답)는 항상 새로 받아오므로 캐시하지 않습니다. */

// 화면 파일을 고칠 때마다 이 번호를 올려 주세요. 기존 사용자의 캐시가 갱신됩니다.
var CACHE = 'gbgc-hub-v3';
var SHELL = [
  './',
  './index.html',
  './config.js',
  './assets/app.css',
  './assets/app.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './manifest.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                        // API 호출(POST)은 그대로 통과
  if (new URL(req.url).origin !== self.location.origin) return;  // 구글 등 외부 요청은 통과

  // 화면 파일은 네트워크 우선, 실패하면 캐시(오프라인)에서 보여 줍니다.
  //
  // cache:'no-store' 를 주는 이유: GitHub Pages 가 max-age=600 으로 내려주기 때문에
  // 그냥 fetch 하면 브라우저가 10분 동안 제 HTTP 캐시에서 예전 파일을 꺼내 줍니다.
  // 그러면 고친 화면이 한참 뒤에야 반영됩니다.
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
