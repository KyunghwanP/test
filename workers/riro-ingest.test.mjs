// riro-ingest 워커 검증 — fetch 를 가짜로 물려 실제 코드 경로(RSA 서명·열쇠 비교·전달)를 그대로 태운다.
// 이 워커가 지켜야 하는 것: 열쇠 없이는 아무것도 못 쓰고, 쓰는 곳은 riro_points 의 정해진 문서 넷뿐이며,
// 받은 몸통을 손대지 않고 그대로 Firestore 에 넘긴다.
import worker from './riro-ingest.js';

const kp = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
let b = ''; for (const x of pkcs8) b += String.fromCharCode(x);
const PEM = `-----BEGIN PRIVATE KEY-----\n${btoa(b).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
const KEY = 'k'.repeat(10) + 'Abc_-123456789012345678901234';
const SA_JSON = JSON.stringify({ private_key: PEM, client_email: 'sa@test.iam.gserviceaccount.com', project_id: 'ynhs-test' });
const ENV = { SA_JSON, RIRO_KEY: KEY };

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

// ── 바깥 세계 ──
let CALLS = [], TOKENS = 0, FS_STATUS = 200;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  CALLS.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  if (url === 'https://oauth2.googleapis.com/token') {
    const jwt = new URLSearchParams(init.body).get('assertion');
    const [h, p, s] = jwt.split('.');
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey,
      Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return new Response('bad sig', { status: 400 });
    TOKENS++;
    return new Response(JSON.stringify({ access_token: 'tok-' + TOKENS, expires_in: 3600 }), { status: 200 });
  }
  if (url.startsWith('https://firestore.googleapis.com/')) {
    if (FS_STATUS !== 200) return new Response('{"error":{"message":"Invalid value at fields.students"}}', { status: FS_STATUS });
    return new Response('{"name":"x"}', { status: 200 });
  }
  return new Response('unexpected ' + url, { status: 599 });
};
const req = (path, { method = 'PUT', key = KEY, body, headers = {} } = {}) =>
  new Request('https://riro-ingest.example.workers.dev' + path, {
    method, body, headers: { ...(key ? { 'X-Riro-Key': key } : {}), 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const call = async (r, env = ENV) => { const res = await worker.fetch(r, env); return { status: res.status, body: await res.json() }; };
const DOC = (n = 200) => JSON.stringify({ fields: { students: { arrayValue: { values: Array.from({ length: n }, (_, i) => ({ mapValue: { fields: { name: { stringValue: '학생' + i } } } })) } }, count: { integerValue: String(n) } } });

console.log('\n■ 열쇠');
check('RIRO_KEY 가 없으면 아무것도 안 받는다', (await call(req('/riro/ping', { method: 'GET' }), { SA_JSON })).status === 500);
check('RIRO_KEY 가 짧으면(24자 미만) 안 받는다', (await call(req('/riro/ping', { method: 'GET', key: 'short' }), { SA_JSON, RIRO_KEY: 'short' })).status === 500);
check('열쇠 없이 → 401', (await call(req('/riro/grade1', { key: null, body: DOC() }))).status === 401);
check('틀린 열쇠 → 401', (await call(req('/riro/grade1', { key: KEY.slice(0, -1) + 'X', body: DOC() }))).status === 401);
check('길이가 다른 열쇠 → 401', (await call(req('/riro/grade1', { key: KEY + 'x', body: DOC() }))).status === 401);
check('401 일 때는 Firestore 에 아무것도 안 나간다', !CALLS.some(c => c.url.includes('firestore')), CALLS.map(c => c.url));

console.log('\n■ 주소·방식');
for (const [p, m, want] of [['/riro/contacts', 'PUT', 404], ['/riro/grade4', 'PUT', 404], ['/riro/GRADE1', 'PUT', 404],
  ['/riro/grade1/../../contacts/main', 'PUT', 404], ['/riro/%2e%2e%2fcontacts', 'PUT', 404], ['/riro/grade1', 'POST', 405],
  ['/riro/grade1', 'GET', 405], ['/riro/ping', 'PUT', 405], ['/', 'GET', 404], ['/riro/meta/x', 'PUT', 404]]) {
  const r = await call(req(p, { method: m, body: m === 'GET' ? undefined : DOC() }));
  check(`${m} ${p} → ${want}`, r.status === want, r);
}

console.log('\n■ 연결 확인 (ping)');
CALLS = [];
const ping = await call(req('/riro/ping', { method: 'GET' }));
check('맞는 열쇠면 200 + 프로젝트', ping.status === 200 && ping.body.project === 'ynhs-test', ping);
check('SA_JSON 으로 토큰까지 받아 본다', CALLS.some(c => c.url.includes('oauth2')));
check('ping 은 아무것도 쓰지 않는다', !CALLS.some(c => c.url.includes('firestore')));
// 토큰·키는 모듈에 캐시된다 — 막 배포된 워커처럼 새로 읽은 사본으로 본다
const fresh = (await import('./riro-ingest.js?fresh=' + Date.now())).default;
const noSa = await fresh.fetch(req('/riro/ping', { method: 'GET' }), { RIRO_KEY: KEY });
const noSaBody = await noSa.json();
check('SA_JSON 이 빠졌으면 ping 이 알려 준다 (첫 저장 전에)', noSa.status === 500 && noSaBody.error === 'SA' && /SA_JSON/.test(noSaBody.detail), noSaBody);

console.log('\n■ 저장 — 받은 그대로 정해진 문서에');
CALLS = [];
const body = DOC(300);
const r1 = await call(req('/riro/grade2', { body }));
const put = CALLS.find(c => c.url.includes('firestore'));
check('200 ok', r1.status === 200 && r1.body.ok && r1.body.doc === 'grade2', r1);
check('riro_points/grade2 를 PATCH (updateMask 없이 = 통째로)', put && put.method === 'PATCH'
      && put.url === 'https://firestore.googleapis.com/v1/projects/ynhs-test/databases/(default)/documents/riro_points/grade2', put && put.url);
check('몸통이 한 바이트도 안 바뀐다', put && new TextDecoder().decode(put.body) === body);
check('서비스 계정 토큰을 붙인다', put && /^Bearer tok-\d+$/.test(put.headers.Authorization), put && put.headers);
const before = TOKENS;
await call(req('/riro/grade3', { body }));
await call(req('/riro/meta', { body: '{"fields":{"updatedAt":{"stringValue":"2026-10-26T00:00:00.000Z"},"total":{"integerValue":"1033"}}}' }));
check('토큰은 다시 받지 않고 재사용한다', TOKENS === before, { before, now: TOKENS });

console.log('\n■ 이상한 몸통은 막는다');
check('빈 학년(1000 바이트 미만) → 400', (await call(req('/riro/grade1', { body: '{"fields":{"students":{"arrayValue":{}}}}' }))).status === 400);
check('문서 모양이 아니면 → 400', (await call(req('/riro/grade1', { body: '[' + 'x'.repeat(2000) + ']' }))).status === 400);
check('너무 크면 → 413', (await call(req('/riro/grade1', { body: '{"fields":{' + ' '.repeat(3_000_001) + '}}' }))).status === 413);
FS_STATUS = 400;
const bad = await call(req('/riro/grade1', { body }));
check('Firestore 가 거부하면 502 + 상태를 PC 에 돌려준다', bad.status === 502 && bad.body.status === 400 && /Invalid value/.test(bad.body.detail), bad);
FS_STATUS = 200;

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
