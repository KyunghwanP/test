// 이 sw.js가 놓인 폴더(= 배포 경로). GitHub Pages의 /ynhs/ · /test/ 어디에 올려도
// 자동으로 맞춰지므로 두 저장소가 동일한 파일을 공유할 수 있다.
const BASE = self.location.pathname.replace(/[^/]*$/, '');   // 예: '/ynhs/' · '/test/'
// 캐시 저장소는 '경로'가 아니라 '출처' 단위로 공유된다 → /ynhs/ 와 /test/ 는 같은 출처라
// 캐시 이름이 같으면 서로의 캐시를 지운다(한쪽 버전이 올라갈 때 activate가 삭제).
// 그래서 이름에 BASE를 넣어 배포별로 분리한다. 예: 'ynhs:/ynhs/:v496'
const CACHE_VER  = 'v507';
const CACHE_NAME = 'ynhs:' + BASE + ':' + CACHE_VER;
const CACHE_MINE = 'ynhs:' + BASE + ':';                     // 이 배포가 소유한 캐시 접두사
// 화면(HTML)을 네트워크에서 기다려 주는 최대 시간. 이 시간을 넘기면 캐시로 즉시 전환한다.
const NAV_TIMEOUT = 3500;
// 캐시가 없어 네트워크를 기다려야 할 때의 상한. 이걸 넘기면 매달려 있지 않고
// 안내 응답을 돌려준다(브라우저가 무한 대기 끝에 타임아웃 페이지를 띄우는 것보다 낫다).
const HARD_TIMEOUT = 15000;

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // 내 배포의 옛 버전 + 구버전 공용 이름(ynhs-v###)만 정리한다.
    // 다른 배포(/test/ ↔ /ynhs/)의 캐시는 건드리지 않는다.
    await Promise.all(keys
      .filter(k => (k.startsWith(CACHE_MINE) && k !== CACHE_NAME) || /^ynhs-v\d+$/.test(k))
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 성공하면 응답, 실패하면 null. 절대 던지지 않는다(= respondWith가 깨지지 않음).
function netFetch(req, cache, cacheKey) {
  return fetch(req).then(res => {
    // redirected 응답을 캐시했다가 네비게이션에 돌려주면 브라우저가 거부하므로 저장하지 않는다.
    if (res && res.ok && res.status === 200 && !res.redirected) {
      cache.put(cacheKey, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => null);
}

// ms 안에 안 끝나면 null. (원래 promise는 계속 진행 → 배경 캐시 갱신은 그대로 이뤄진다)
function withTimeout(promise, ms) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), ms);
    promise.then(v => { clearTimeout(t); resolve(v); },
                 () => { clearTimeout(t); resolve(null); });
  });
}

// ── 캐시 전략 ────────────────────────────────────────────────────────────────
//  이전(순수 network-first)의 문제:
//   · 매 요청이 네트워크를 '무한정' 기다려 → 망이 느리거나 끊기면 페이지가 멈춤.
//   · 실패 시 caches.match() 폴백이, 위젯 URL의 ?t=타임스탬프(캐시버스터) 때문에
//     캐시 키가 안 맞아 undefined 반환 → 브라우저가 ERR_FAILED로 처리
//     ('되다 안 되다'·자주 멈춤의 원인. 시크릿 모드는 SW가 없어서 멀쩡했던 것.)
//  지금:
//   · 화면(HTML) = 네트워크 우선 + 3.5초 타임아웃 → 평소엔 항상 최신 코드가 뜨고,
//     망이 느리거나 끊기면 즉시 캐시로 전환해 멈추지 않는다. (배포 직후 '반영 안 됨'이
//     생기지 않도록 신선도를 유지하는 쪽을 택함)
//   · 그 외 자원(js·png·json 등) = 캐시 우선 + 배경 갱신 → 빠르고 망 장애에 강함.
//   · 어떤 경우에도 undefined를 반환하지 않는다(ERR_FAILED 원천 차단).
//   · 교차 출처(Firebase·GAS·날씨 API 등)는 미개입 → 실시간 데이터는 캐시되지 않는다.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 외부(CDN·API 등)는 미개입
  if (url.pathname.includes('/docs/')) return;          // 대용량 PDF는 브라우저가 직접 처리

  const isNav = req.mode === 'navigate';
  // 화면 요청은 쿼리(?widget=…&t=…)를 무시하고 경로로 캐시 → 캐시버스터 때문에 못 찾던
  // 문제 해결 + 캐시 무한증식 방지. 어떤 화면인지는 페이지 JS가 location.search로 판단한다.
  const cacheKey = isNav ? new Request(url.origin + url.pathname) : req;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const net = netFetch(req, cache, cacheKey);

    if (isNav) {
      // 네트워크 우선 — 단, 3.5초까지만 기다린다.
      const fresh = await withTimeout(net, NAV_TIMEOUT);
      if (fresh) return fresh;
      const cached = await cache.match(cacheKey);
      if (cached) {
        e.waitUntil(net);     // 느린 네트워크는 배경에서 계속 받아 캐시를 갱신
        return cached;
      }
    } else {
      // 자원 — 캐시가 있으면 즉시 반환하고 배경에서 갱신
      const cached = await cache.match(cacheKey);
      if (cached) {
        e.waitUntil(net);
        return cached;
      }
    }

    // 캐시가 없다 → 네트워크를 기다리되 '무한정'은 안 된다.
    // 여기서 무한 대기하면 서비스 워커가 요청을 붙잡은 채 끝나지 않아 브라우저가
    // ERR_TIMED_OUT 을 띄운다(시크릿 창은 워커가 없어 멀쩡한데 일반 창만 먹통).
    const res = await withTimeout(net, HARD_TIMEOUT);
    if (res) return res;

    // 네트워크도 실패 + 캐시도 없음 → undefined 대신 명확한 응답(ERR_FAILED 방지).
    if (isNav) {
      const shell = await cache.match(new Request(url.origin + BASE))
                 || await cache.match(new Request(url.origin + BASE + 'index.html'));
      if (shell) return shell;
    }
    return new Response('오프라인 상태이고 캐시된 내용이 없습니다. 잠시 후 다시 시도해 주세요.', {
      status: 503, statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('./');
    })
  );
});
