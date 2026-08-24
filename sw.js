// 이 sw.js가 놓인 폴더(= 배포 경로). GitHub Pages의 /ynhs/ · /test/ 어디에 올려도
// 자동으로 맞춰지므로 두 저장소가 동일한 파일을 공유할 수 있다.
const BASE = self.location.pathname.replace(/[^/]*$/, '');   // 예: '/ynhs/' · '/test/'
// 캐시 저장소는 '경로'가 아니라 '출처' 단위로 공유된다 → /ynhs/ 와 /test/ 는 같은 출처라
// 캐시 이름이 같으면 서로의 캐시를 지운다(한쪽 버전이 올라갈 때 activate가 삭제).
// 그래서 이름에 BASE를 넣어 배포별로 분리한다. 예: 'ynhs:/ynhs/:v496'
const CACHE_VER  = 'v537';
const CACHE_NAME = 'ynhs:' + BASE + ':' + CACHE_VER;
const CACHE_MINE = 'ynhs:' + BASE + ':';                     // 이 배포가 소유한 캐시 접두사
// 화면(HTML)을 네트워크에서 기다려 주는 최대 시간. 이 시간을 넘기면 캐시로 즉시 전환한다.
const NAV_TIMEOUT = 3500;
// 캐시가 없어 네트워크를 기다려야 할 때의 상한. 이걸 넘기면 매달려 있지 않고
// 안내 응답을 돌려준다(브라우저가 무한 대기 끝에 타임아웃 페이지를 띄우는 것보다 낫다).
const HARD_TIMEOUT = 15000;

// 첫 화면을 여는 데 필요한 것들. 설치 단계에서 미리 받아 둔다.
// 이걸 안 하면 '처음 온 기기'는 캐시가 빈 채로 남는다 — 첫 방문의 index.html 은
// 워커가 생기기 전에 브라우저가 직접 받아서 캐시를 거치지 않고, activate 는 옛 캐시가
// 있을 때만 옮겨오기 때문이다. 그 상태에서 다음 접속에 망이 흔들리면 곧장 오프라인 안내가 뜬다.
// 아이콘은 넣지 않는다 — 오프라인 안내는 '화면(navigate) 요청'이 실패할 때만 뜨고,
// 아이콘이 없다고 그 화면이 뜨지는 않는다. 배포마다 몇백 KB를 다시 받을 이유가 없다.
// 서브페이지(career·jindan 등)도 같은 이유로 뺀다 — 한 번 열면 캐시 우선 경로가 알아서 담는다.
const PRECACHE = [BASE, BASE + 'index.html', BASE + 'manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  // 설치는 요청을 막지 않으므로 여기서 받아도 화면이 멈추지 않는다(activate 와 다른 점).
  e.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      // addAll 은 하나만 실패해도 전부 무효가 된다 → 개별로 넣고 실패는 넘긴다.
      await Promise.all(PRECACHE.map(async path => {
        try {
          const res = await fetch(new Request(self.location.origin + path, { cache: 'reload' }));
          if (res && res.ok && res.status === 200 && !res.redirected) {
            await cache.put(new Request(self.location.origin + path), res);
          }
        } catch (e) { /* 한 건 실패가 설치를 막지 않게 */ }
      }));
    } catch (e) { /* 저장소 문제로 설치가 멈추지 않게 */ }
  })());
});

// 활성화가 끝날 때까지 모든 요청이 대기열에 묶인다. 그래서 여기서는
// '반드시 끝나야 하는 최소한'만 하고, 오래 걸릴 수 있는 일은 절대 넣지 않는다.
//
// 옛 캐시를 통째로 옮겨 담다가 이 규칙을 어겼었다(항목 수만큼 순차 복사).
// 항목이 많으면 그동안 화면이 통째로 멈추고, 길어지면 ERR_TIMED_OUT 이 된다.
// 지금은 껍데기(첫 화면) 두 개만 옮긴다 — 캐시가 비어 '오프라인' 안내가 뜨는 것을
// 막는 데 필요한 것은 그것뿐이고, 나머지 자원은 쓰일 때 캐시 우선 경로가 알아서
// 다시 채운다(그건 화면을 막지 않는다).
const SHELL_PATHS = [BASE, BASE + 'index.html'];

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      // 내 배포의 옛 버전 + 구버전 공용 이름(ynhs-v###)만 정리한다.
      // 다른 배포(/test/ ↔ /ynhs/)의 캐시는 건드리지 않는다.
      const old = keys.filter(k => (k.startsWith(CACHE_MINE) && k !== CACHE_NAME) || /^ynhs-v\d+$/.test(k));
      const cache = await caches.open(CACHE_NAME);

      for (const path of SHELL_PATHS) {
        const key = new Request(self.location.origin + path);
        if (await cache.match(key)) continue;
        for (const k of old) {
          const prev = await caches.open(k);
          const res = await prev.match(key);
          if (res) { await cache.put(key, res).catch(() => {}); break; }
        }
      }
      await Promise.all(old.map(k => caches.delete(k)));
    } catch (err) {
      // 저장소가 말썽이어도 활성화는 끝내야 한다. 여기서 멈추면 워커가
      // 요청을 붙잡은 채 활성화되지 않아 페이지가 아예 안 열린다.
    }
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

// 같은 파일인지 ETag(없으면 Last-Modified)로 본다. 본문을 읽어 비교하면
// 900KB를 한 번 더 훑게 되고, 스트림을 소비해 응답을 못 쓰게 된다.
function stamp(res) {
  if (!res || !res.headers) return '';
  return res.headers.get('etag') || res.headers.get('last-modified') || '';
}

// 캐시로 화면을 띄운 뒤, 배경에서 받은 것이 다르면 페이지에 알린다.
// 페이지가 '새 버전이 있습니다'를 띄우고 사용자가 원할 때 새로고침한다.
// 이게 없으면 망이 3.5초를 넘길 때마다 옛 화면이 나오고 배포가 반영되지 않는다.
async function notifyIfNewer(net, cached) {
  const fresh = await net;
  if (!fresh || !fresh.ok) return;
  const a = stamp(cached), b = stamp(fresh);
  if (!a || !b || a === b) return;
  const list = await self.clients.matchAll({ type: 'window' });
  for (const c of list) c.postMessage({ type: 'sw-update' });
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
// 워커가 화면을 못 띄우는 상황에서 빠져나갈 문.
//   주소 끝에 ?nosw=1 을 붙여 열면 가로채지 않고 그대로 통과시키고, 등록도 스스로 푼다.
//   캐시도 없고 망도 느려 안내 화면만 나오는 상태가 되면 그 화면에서 이리로 나갈 수
//   있어야 한다 — F12 를 열 줄 모르는 사람도 빠져나올 수 있게.
function isEscape(url){ return url.searchParams.get('nosw') === '1'; }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isEscape(url)) {
    // 등록을 풀면 다음 열기부터 워커 없이 동작한다.
    e.waitUntil(self.registration.unregister().catch(() => {}));
    return;                                   // 가로채지 않는다 → 브라우저가 직접 받는다
  }
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
        // 느린 네트워크는 배경에서 계속 받아 캐시를 갱신하고, 내용이 달라졌으면 알린다
        e.waitUntil(notifyIfNewer(net, cached));
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
    // 이 폴백은 '앱 첫 화면' 요청에만 쓴다. career.html 같은 다른 페이지 자리에 앱 껍데기를
    // 돌려주면 그 페이지가 있어야 할 자리에 앱이 통째로 들어간다. iframe 로드도 mode가
    // 'navigate' 라서, 진로진학 탭 안에서 그 일이 벌어지면 그 안의 앱이 또 career.html 을
    // 요청해 사이드바가 무한히 중첩된다(망이 느린 사용자에게만 나타남).
    if (isNav && (url.pathname === BASE || url.pathname === BASE + 'index.html')) {
      const shell = await cache.match(new Request(url.origin + BASE))
                 || await cache.match(new Request(url.origin + BASE + 'index.html'));
      if (shell) return shell;
    }
    // 여기까지 왔다는 것은 캐시도 없고 망도 안 된다는 뜻이다. 글자만 던져 두면
    // 사용자가 할 수 있는 일이 없다 — 다시 시도와 '워커 없이 열기'를 함께 준다.
    const esc = url.origin + url.pathname + (url.search ? url.search + '&' : '?') + 'nosw=1';
    return new Response(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>연결하지 못했습니다</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:'Noto Sans KR','맑은 고딕',sans-serif;background:#F8FAFC;color:#0F172A;padding:24px}
  @media (prefers-color-scheme:dark){body{background:#0B1220;color:#E8EDF5}}
  .box{max-width:420px;text-align:center}
  h1{font-size:19px;font-weight:700;margin:0 0 10px;letter-spacing:-.02em}
  p{font-size:14px;line-height:1.7;color:#64748B;margin:0 0 22px}
  @media (prefers-color-scheme:dark){p{color:#9AA7BC}}
  a,button{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:13px;
    border-radius:6px;font:600 15px/1 inherit;text-decoration:none;cursor:pointer;border:none}
  .go{background:#006BFF;color:#fff}
  .esc{background:transparent;color:#64748B;border:1.5px solid #CBD5E1;font-size:13px}
  @media (prefers-color-scheme:dark){.esc{color:#9AA7BC;border-color:#38465F}}
</style>
<div class="box">
  <h1>연결하지 못했습니다</h1>
  <p>인터넷이 느리거나 끊겨 있고, 이 기기에 저장해 둔 화면도 없습니다.</p>
  <button class="go" onclick="location.reload()">다시 시도</button>
  <a class="esc" href="${esc}">그래도 안 되면 · 캐시 없이 열기</a>
</div>`, {
      status: 503, statusText: 'Offline',
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
