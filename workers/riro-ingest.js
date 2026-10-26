/**
 * 리로스쿨 상벌점 받는 곳 — Cloudflare Worker (riro-ingest)
 * ============================================================================
 * 리로스쿨이 해외 접속을 막아(2026-10-14~) GitHub 서버가 더는 상벌점을 못 받는다.
 * 학교 PC 의 riro/riro-push.ps1 이 받아서 해석한 뒤, 저장할 모양(Firestore REST 표기)
 * 그대로 여기로 보낸다. 이 워커는 열쇠만 확인하고 그 몸통을 정해진 문서 하나에 쓴다.
 *
 *   PUT /riro/grade1 | grade2 | grade3 | meta   → riro_points/{그 이름} 을 통째로 덮어쓰기
 *   GET /riro/ping                               → 열쇠·연결 확인 (아무것도 안 씀)
 *   머리글 X-Riro-Key: <RIRO_KEY>
 *
 * 왜 몸통을 해석하지 않나
 *  무료 워커는 요청 하나에 CPU 10ms 까지다. 전교생 상벌점(학년마다 수백 KB)을 JSON 으로
 *  읽고 Firestore 표기로 바꾸기만 해도 학년 하나에 6~10ms, 전체면 40~70ms 가 든다.
 *  그래서 바꾸는 일은 PC 가 하고 여기서는 넘겨주기만 한다. 쓸 문서의 경로는 이 워커가
 *  정하므로(주소의 이름 4개 중 하나), 열쇠가 새어도 riro_points 밖은 건드릴 수 없다.
 *
 * 왜 다른 워커에 붙이지 않았나 (workers/README.md 의 '누가 부르느냐')
 *  teacher-api 는 모든 길이 교사 로그인 토큰 뒤에 있다. 여기는 사람이 아니라 학교 PC 가
 *  암호로 부른다. 한 파일에 섞으면 그 원칙이 깨진다. 공통 코드(서명)는 중복을 감수한다.
 *
 * 필요한 시크릿 (대시보드 → Settings → Variables and Secrets, 둘 다 Secret 으로)
 *  · SA_JSON  : 서비스 계정 JSON 전체 (다른 워커에 넣은 것과 같은 것)
 *  · RIRO_KEY : 학교 PC 에서 -Setup 할 때 만들어 준 전송 암호 (24자 이상)
 *  · PROJECT_ID (선택) : 없으면 SA_JSON 의 project_id
 *
 * 설치·운영은 riro/README.md.
 */

const enc = new TextEncoder();
const DOCS = new Set(['grade1', 'grade2', 'grade3', 'meta']);
const MAX_BYTES = 3_000_000;      // 학년 하나가 지금 수백 KB. Firestore 문서 한도(1MiB, 저장 크기 기준)보다 넉넉히
const MIN_BYTES = { grade1: 1000, grade2: 1000, grade3: 1000, meta: 20 };   // 빈 학년으로 덮어쓰는 실수를 막는다

function b64urlFromBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64urlFromString = str => b64urlFromBytes(enc.encode(str));
function bytesFromB64(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const nowSec = () => Math.floor(Date.now() / 1000);

// ── 서비스 계정 · 액세스 토큰 (teacher-api 와 같은 코드) ────────────────────────
let _saCache = null;      // { sa, keyPromise }
let _tokenCache = null;   // { token, exp }
function getSA(env) {
  if (_saCache) return _saCache;
  if (!env.SA_JSON) throw new Error('SA_JSON 시크릿이 설정되지 않았습니다.');
  const sa = JSON.parse(env.SA_JSON);
  if (!sa.private_key || !sa.client_email) throw new Error('SA_JSON 형식이 올바르지 않습니다.');
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const keyPromise = crypto.subtle.importKey('pkcs8', bytesFromB64(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  _saCache = { sa, keyPromise };
  return _saCache;
}
async function signRS256(env, header, payload) {
  const key = await getSA(env).keyPromise;
  const data = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data));
  return `${data}.${b64urlFromBytes(new Uint8Array(sig))}`;
}
async function getAccessToken(env) {
  if (_tokenCache && _tokenCache.exp > nowSec() + 60) return _tokenCache.token;
  const { sa } = getSA(env);
  const iat = nowSec();
  const jwt = await signRS256(env, { alg: 'RS256', typ: 'JWT' }, {
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`
  });
  if (!res.ok) throw new Error('토큰 발급 실패: ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  _tokenCache = { token: j.access_token, exp: iat + (j.expires_in || 3600) };
  return _tokenCache.token;
}
const projectId = env => env.PROJECT_ID || getSA(env).sa.project_id;

// ── 열쇠 확인 ──────────────────────────────────────────────────────────────────
// 길이가 달라도 걸리는 시간이 같도록 둘 다 SHA-256 으로 바꿔 끝까지 비교한다.
async function keyOk(env, given) {
  const want = String(env.RIRO_KEY || '');
  if (want.length < 24 || !given) return false;
  const [a, b] = await Promise.all([given, want].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
// 몸통이 '{"fields":' 로 시작하는지만 본다 (통째로 읽으면 CPU 가 든다. 나머지는 Firestore 가 검사한다)
function looksLikeDoc(buf) {
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
  return /^\s*\{\s*"fields"\s*:/.test(head);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    const m = /^\/riro\/([a-z0-9]+)$/.exec(path);
    if (!m) return json({ ok: false, error: 'NOT_FOUND' }, 404);
    const name = m[1];
    if (!(name === 'ping' ? request.method === 'GET' : request.method === 'PUT')) {
      return json({ ok: false, error: 'METHOD' }, 405);
    }
    if (name !== 'ping' && !DOCS.has(name)) return json({ ok: false, error: 'NOT_FOUND' }, 404);

    if (String(env.RIRO_KEY || '').length < 24) return json({ ok: false, error: 'RIRO_KEY 시크릿이 없거나 짧습니다 (24자 이상)' }, 500);
    if (!(await keyOk(env, request.headers.get('X-Riro-Key')))) return json({ ok: false, error: 'KEY' }, 401);
    if (name === 'ping') {
      // SA_JSON 까지 확인한다 — PC 의 -Check 가 첫 저장 전에 설정 실수를 잡게
      try { await getAccessToken(env); return json({ ok: true, project: projectId(env) }); }
      catch (e) { return json({ ok: false, error: 'SA', detail: String(e && e.message || e).slice(0, 200) }, 500); }
    }

    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return json({ ok: false, error: 'TOO_LARGE', bytes: buf.byteLength }, 413);
    if (buf.byteLength < MIN_BYTES[name]) return json({ ok: false, error: 'TOO_SMALL', bytes: buf.byteLength }, 400);
    if (!looksLikeDoc(buf)) return json({ ok: false, error: 'NOT_A_DOC' }, 400);

    try {
      const token = await getAccessToken(env);
      const url = `https://firestore.googleapis.com/v1/projects/${projectId(env)}/databases/(default)/documents/riro_points/${name}`;
      // updateMask 없이 PATCH = 문서를 통째로 바꾼다 (예전 스크래퍼의 set() 과 같다)
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: buf
      });
      if (!res.ok) {
        // Firestore 오류에는 자료 일부가 섞일 수 있어 워커 로그에는 남기지 않고 보낸 PC 에만 돌려준다
        return json({ ok: false, error: 'FIRESTORE', status: res.status, detail: (await res.text()).slice(0, 300) }, 502);
      }
      return json({ ok: true, doc: name, bytes: buf.byteLength });
    } catch (e) {
      console.error('riro-ingest', name, e && e.message);
      return json({ ok: false, error: 'SERVER', detail: String(e && e.message || e).slice(0, 200) }, 500);
    }
  }
};
