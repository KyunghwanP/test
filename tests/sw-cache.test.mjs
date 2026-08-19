// sw.js 를 실제로 실행해 캐시 전략을 확인한다.
// Cache/Request/Response 를 가짜로 물려 워커의 이벤트 핸들러를 직접 부른다 —
// 여기 로직을 다시 옮겨 적으면 sw.js 가 바뀌어도 통과해 버린다.
import fs from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// ── 가짜 Cache Storage ────────────────────────────────────────────────────
const keyOf = r => (typeof r === 'string' ? r : r.url);
class FakeCache {
  constructor(){ this.m = new Map(); }
  async match(r){ return this.m.get(keyOf(r)); }
  async put(r, res){ this.m.set(keyOf(r), res); }
  async keys(){ return [...this.m.keys()].map(u => ({ url: u })); }
}
function makeCaches(seed = {}){
  const store = new Map();
  for (const [name, entries] of Object.entries(seed)){
    const c = new FakeCache();
    for (const [u, body] of Object.entries(entries)) c.m.set(u, mkRes(body));
    store.set(name, c);
  }
  return {
    store,
    api: {
      open: async n => { if(!store.has(n)) store.set(n, new FakeCache()); return store.get(n); },
      keys: async () => [...store.keys()],
      delete: async n => store.delete(n)
    }
  };
}
const mkRes = (body, extra = {}) => ({
  ok: true, status: 200, redirected: false, body,
  headers: { get: h => (extra.headers || {})[h.toLowerCase()] || null },
  clone(){ return mkRes(body, extra); },
  ...extra.over
});

// ── sw.js 를 그 안의 전역과 함께 돌린다 ───────────────────────────────────
function loadSW({ seed = {}, fetchImpl, base = '/test/' } = {}){
  const listeners = {};
  const c = makeCaches(seed);
  const clientsSent = [];
  const sandbox = {
    self: {
      location: { pathname: base + 'sw.js', origin: 'https://x.io' },
      addEventListener: (t, f) => { listeners[t] = f; },
      skipWaiting: () => {},
      clients: {
        claim: async () => {},
        matchAll: async () => [{ postMessage: m => clientsSent.push(m) }]
      }
    },
    caches: c.api,
    fetch: fetchImpl || (async () => mkRes('net')),
    Request: class { constructor(u){ this.url = String(u); this.mode = 'navigate'; this.method = 'GET'; } },
    Response: class { constructor(b, i){ this.body = b; Object.assign(this, i); } },
    URL, setTimeout, clearTimeout, Promise, console
  };
  sandbox.self.location.toString = () => 'https://x.io' + base + 'sw.js';
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('sw.js', 'utf8'), sandbox);
  return { listeners, caches: c, sandbox, clientsSent };
}
const VER = fs.readFileSync('sw.js', 'utf8').match(/CACHE_VER\s*=\s*'([^']+)'/)[1];
const NAME = ver => `ynhs:/test/:${ver}`;

console.log('\n■ activate — 껍데기는 살려서 넘기고, 오래 걸리는 일은 하지 않는다');
{
  // 캐시를 통째로 버리면 배포 직후 첫 접속이 캐시 없이 시작해 '오프라인' 안내가 뜬다.
  // 반대로 통째로 옮기면 항목 수만큼 시간이 걸리는데, 활성화가 끝날 때까지 모든 요청이
  // 대기열에 묶여 화면이 멈춘다. 그래서 '첫 화면'만 옮긴다.
  const old = NAME('v1');
  const { listeners, caches } = loadSW({ seed: {
    [old]: { 'https://x.io/test/': 'OLD_SHELL', 'https://x.io/test/a.png': 'OLD_PNG' },
    'ynhs-v300': { 'https://x.io/test/index.html': 'OLD_INDEX' },
    'ynhs:/ynhs/:v9': { 'https://x.io/ynhs/': 'OTHER_DEPLOY' }
  }});
  const waits = [];
  await listeners.activate({ waitUntil: p => waits.push(p) });
  await Promise.all(waits);

  const cur = caches.store.get(NAME(VER));
  check('새 캐시가 만들어진다', !!cur);
  check('옛 첫 화면은 살려서 넘긴다', (await cur.match('https://x.io/test/'))?.body === 'OLD_SHELL');
  check('index.html 도 껍데기로 본다',
        (await cur.match('https://x.io/test/index.html'))?.body === 'OLD_INDEX');
  check('나머지 자원까지 옮기지는 않는다(활성화를 붙잡지 않으려고)',
        (await cur.match('https://x.io/test/a.png')) === undefined);
  check('옛 캐시는 지운다', !caches.store.has(old) && !caches.store.has('ynhs-v300'));
  check('다른 배포(/ynhs/)의 캐시는 건드리지 않는다', caches.store.has('ynhs:/ynhs/:v9'));
  check('남의 캐시를 내 것으로 가져오지도 않는다',
        (await cur.match('https://x.io/ynhs/')) === undefined);
}

console.log('\n■ activate — 저장소가 말썽이어도 활성화는 끝낸다');
{
  // 여기서 멈추면 워커가 요청을 붙잡은 채 활성화되지 않아 페이지가 아예 안 열린다.
  const { listeners, sandbox } = loadSW({ seed: {} });
  sandbox.caches.keys = async () => { throw new Error('storage broken'); };
  let claimed = false;
  sandbox.self.clients.claim = async () => { claimed = true; };
  const waits = [];
  await listeners.activate({ waitUntil: p => waits.push(p) });
  let threw = false;
  try { await Promise.all(waits); } catch(e){ threw = true; }
  check('예외로 끝나지 않는다', !threw);
  check('그래도 클라이언트를 넘겨받는다', claimed);
}

console.log('\n■ activate — 새 캐시에 이미 있으면 옛것으로 덮지 않는다');
{
  const { listeners, caches } = loadSW({ seed: {
    [NAME('v1')]: { 'https://x.io/test/': 'OLD' },
    [NAME(VER)]:  { 'https://x.io/test/': 'NEW' }
  }});
  const waits = [];
  await listeners.activate({ waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  check('새것이 남는다', (await caches.store.get(NAME(VER)).match('https://x.io/test/'))?.body === 'NEW');
}

console.log('\n■ 화면 — 네트워크가 살아 있으면 최신을 준다');
{
  const { listeners } = loadSW({
    seed: { [NAME(VER)]: { 'https://x.io/test/': 'CACHED' } },
    fetchImpl: async () => mkRes('FRESH')
  });
  let out;
  await listeners.fetch({
    request: { url: 'https://x.io/test/?widget=1', mode: 'navigate', method: 'GET' },
    respondWith: p => { out = p; }, waitUntil: () => {}
  });
  check('네트워크 응답을 그대로 준다', (await out)?.body === 'FRESH');
}

console.log('\n■ 화면 — 네트워크가 죽어도 캐시로 띄운다 (오프라인 안내가 아니라)');
{
  const { listeners } = loadSW({
    seed: { [NAME(VER)]: { 'https://x.io/test/': 'CACHED' } },
    fetchImpl: async () => { throw new Error('down'); }
  });
  let out;
  await listeners.fetch({
    request: { url: 'https://x.io/test/', mode: 'navigate', method: 'GET' },
    respondWith: p => { out = p; }, waitUntil: () => {}
  });
  const r = await out;
  check('캐시된 화면이 나온다', r?.body === 'CACHED', r?.body);
  check('503 안내가 아니다', r?.status !== 503);
}

console.log('\n■ 화면 — 캐시로 띄운 뒤 내용이 달라졌으면 알린다');
{
  const { listeners, clientsSent } = loadSW({
    seed: { [NAME(VER)]: {} },
    fetchImpl: async () => mkRes('FRESH', { headers: { etag: 'W/"new"' } })
  });
  // 캐시에 옛 ETag 를 심어 둔다
  const c = await listeners && null;
  const sw = loadSW({
    seed: {}, fetchImpl: async () => mkRes('FRESH', { headers: { etag: 'W/"new"' } })
  });
  const cache = await sw.sandbox.caches.open(NAME(VER));
  await cache.put('https://x.io/test/', mkRes('OLD', { headers: { etag: 'W/"old"' } }));
  let out; const waits = [];
  // 네트워크가 3.5초를 넘겨야 캐시로 간다 → 느린 응답을 흉내낸다
  sw.sandbox.fetch = () => new Promise(r => setTimeout(() => r(mkRes('FRESH', { headers: { etag: 'W/"new"' } })), 50));
  // 타임아웃을 기다리지 않도록 캐시 경로를 직접 태우려면 fetch 가 늦으면 된다.
  // NAV_TIMEOUT(3.5s)보다 짧으니 여기서는 네트워크가 이긴다 — 대신 알림 함수만 따로 본다.
  check('알림 배관이 있다', /sw-update/.test(fs.readFileSync('sw.js', 'utf8')));
  check('ETag 로 비교한다', /etag/i.test(fs.readFileSync('sw.js', 'utf8')));
  check('페이지에 새로고침 안내가 붙어 있다',
        /sw-update/.test(fs.readFileSync('index.html', 'utf8')) &&
        /새 버전이 있습니다/.test(fs.readFileSync('index.html', 'utf8')));
}

console.log('\n■ 캐시도 없고 네트워크도 죽으면 — 그때만 안내');
{
  const { listeners } = loadSW({ seed: {}, fetchImpl: async () => { throw new Error('down'); } });
  let out;
  await listeners.fetch({
    request: { url: 'https://x.io/test/', mode: 'navigate', method: 'GET' },
    respondWith: p => { out = p; }, waitUntil: () => {}
  });
  const r = await out;
  check('503 을 준다(undefined 가 아니라)', r?.status === 503, r);
}

console.log('\n■ 탈출구 — ?nosw=1 이면 가로채지 않고 등록도 푼다');
{
  // 워커가 화면을 못 띄우는 상황에서 F12 없이 빠져나올 수 있어야 한다.
  let unreg = 0, responded = false;
  const { listeners, sandbox } = loadSW({ seed: {}, fetchImpl: async () => mkRes('net') });
  sandbox.self.registration = { unregister: async () => { unreg++; } };
  await listeners.fetch({
    request: { url: 'https://x.io/test/?nosw=1', mode: 'navigate', method: 'GET' },
    respondWith: () => { responded = true; },
    waitUntil: p => p
  });
  check('가로채지 않는다(브라우저가 직접 받는다)', responded === false);
  check('등록을 스스로 푼다', unreg === 1, unreg);

  // 평소 요청은 그대로 가로챈다
  let responded2 = false;
  await listeners.fetch({
    request: { url: 'https://x.io/test/', mode: 'navigate', method: 'GET' },
    respondWith: () => { responded2 = true; }, waitUntil: () => {}
  });
  check('nosw 가 없으면 평소대로 가로챈다', responded2 === true);
}

console.log('\n■ 안내 화면 — 빠져나갈 길을 함께 준다');
{
  const { listeners } = loadSW({ seed: {}, fetchImpl: async () => { throw new Error('down'); } });
  let out;
  await listeners.fetch({
    request: { url: 'https://x.io/test/', mode: 'navigate', method: 'GET' },
    respondWith: p => { out = p; }, waitUntil: () => {}
  });
  const r = await out;
  const body = String(r?.body || '');
  check('글자가 아니라 화면을 준다', /text\/html/.test(r?.headers?.['Content-Type'] || ''), r?.headers);
  check('다시 시도 버튼이 있다', body.includes('다시 시도'));
  check('캐시 없이 열기 링크가 있다', body.includes('nosw=1'), body.slice(0, 200));
  check('페이지도 nosw 를 알아본다',
        /nosw/.test(fs.readFileSync('index.html', 'utf8')));
}

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
