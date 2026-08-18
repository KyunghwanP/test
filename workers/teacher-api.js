/**
 * 교사 전용 API — Cloudflare Worker
 * ============================================================================
 * 이 워커는 '교사 Firebase ID 토큰이 있어야만 열리는 것'만 담는다.
 * 학부모가 두드리는 입구(consult-api)와 프로세스를 분리하는 것이 목적이다.
 *
 *  · consult-api — 학부모용. 인증 전 아무나 호출할 수 있는 입구가 있다.
 *  · teacher-api — 이 파일. 모든 경로가 verifyTeacher() 뒤에 있다.
 *
 * 왜 나눴나
 *  1) 인증 성격이 정반대다. 한 파일에 두면 학부모 쪽 실수 하나가 교직원·학생
 *     연락처로 새는 경로가 된다.
 *  2) 재배포가 겹친다. 연락처를 고치려고 배포했다가 상담 예약이 깨지면 하필
 *     그날이 상담 오픈일일 수 있다(반대도 마찬가지).
 * 대가로 공통 코드(서명·Firestore REST·CORS) 약 200줄이 consult-api와 중복된다.
 * 거의 바뀌지 않는 인프라 코드라 중복을 감수하는 쪽을 택했다.
 *
 * 담당
 *  · GET  /photo            학생 사진 내려주기 (R2)
 *  · POST {action:'photoPut'}  사진 올리기 (관리자만)
 *  · POST {action:'contact'}   학생·교원 연락처 '1건' 조회 + 접속기록
 *
 * 연락처를 왜 여기서 주나
 *  예전에는 앱이 students/main · contacts/main 문서를 통째로 받았다. 화면에는
 *  한 반씩만 보여주면서 실제로는 전교생 연락처를 전부 브라우저로 내려보내고
 *  있었던 것이라, 페이지 저장 한 번이면 전체가 유출됐다. 이제 연락처는
 *  '상세 팝업을 연 그 1명분'만 여기서 나가고, 조회는 전부 기록되며 하루 상한을
 *  넘으면 막힌다(개인정보 보호법 제29조 안전조치 — 접근통제·접속기록).
 *
 * 필요한 시크릿/변수 (wrangler secret put / 대시보드 Variables)
 *  · SA_JSON         : 서비스 계정 JSON 전체 문자열 (필수, 암호화 시크릿)
 *  · ALLOWED_ORIGINS : 쉼표 구분 허용 Origin. 예) https://kyunghwanp.github.io
 *  · FIREBASE_API_KEY: 교사 토큰 검증용 (필수)
 *  · PROJECT_ID      : (선택) 미지정 시 SA_JSON의 project_id 사용
 *  · PHOTOS          : R2 버킷 바인딩. 없으면 사진 기능만 조용히 꺼진다.
 *
 * 자세한 배포 방법은 같은 폴더의 README.md 참고.
 */

const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';

// ── 공통 유틸 ────────────────────────────────────────────────────────────────
const enc = new TextEncoder();

function b64urlFromBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlFromString(str) {
  return b64urlFromBytes(enc.encode(str));
}
// 표준 base64(PEM 본문 등) → Uint8Array
function bytesFromB64(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const nowSec = () => Math.floor(Date.now() / 1000);
// 오늘(KST) 'YYYY-MM-DD'. 워커는 UTC로 도므로 9시간을 더해 계산한다.
function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ── 서비스 계정 · 액세스 토큰 ────────────────────────────────────────────────
// 아이솔레이트가 살아있는 동안 재사용. 만료 60초 전에 갱신.
let _saCache = null;      // { sa, keyPromise }
let _tokenCache = null;   // { token, exp }

function getSA(env) {
  if (_saCache) return _saCache;
  if (!env.SA_JSON) throw new Error('SA_JSON 시크릿이 설정되지 않았습니다.');
  const sa = JSON.parse(env.SA_JSON);
  if (!sa.private_key || !sa.client_email) throw new Error('SA_JSON 형식이 올바르지 않습니다.');
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const keyPromise = crypto.subtle.importKey(
    'pkcs8', bytesFromB64(pem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
  _saCache = { sa, keyPromise };
  return _saCache;
}

async function signRS256(env, header, payload) {
  const { keyPromise } = getSA(env);
  const key = await keyPromise;
  const data = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data));
  return `${data}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

// Firestore REST 호출용 OAuth 액세스 토큰
async function getAccessToken(env) {
  if (_tokenCache && _tokenCache.exp > nowSec() + 60) return _tokenCache.token;
  const { sa } = getSA(env);
  const iat = nowSec();
  const jwt = await signRS256(env,
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat, exp: iat + 3600
    });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`
  });
  if (!res.ok) throw new Error('토큰 발급 실패: ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  _tokenCache = { token: json.access_token, exp: iat + (json.expires_in || 3600) };
  return _tokenCache.token;
}

// ── Firestore REST ───────────────────────────────────────────────────────────
// REST는 값에 타입 래퍼를 쓴다(stringValue 등) → JS 값과 상호 변환.
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  // Date는 timestamp로 — 접속기록의 expireAt이 문자열이면 Firestore TTL이 못 지운다.
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFs(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function fromFs(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) {
    const out = {};
    const f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) out[k] = fromFs(f[k]);
    return out;
  }
  return null;
}
function fieldsToObj(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = fromFs(fields[k]);
  return out;
}
function objToFields(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = toFs(obj[k]);
  return out;
}

function projectId(env) {
  return env.PROJECT_ID || getSA(env).sa.project_id;
}
function docPath(env, coll, id) {
  return `projects/${projectId(env)}/databases/(default)/documents/${coll}/${id}`;
}
const FS_BASE = 'https://firestore.googleapis.com/v1/';

// 문서 1건 읽기 → { data, updateTime } (없으면 data:null)
async function fsGet(env, coll, id) {
  const token = await getAccessToken(env);
  const res = await fetch(FS_BASE + docPath(env, coll, id), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return { data: null, updateTime: null };
  if (!res.ok) throw new Error('Firestore 읽기 실패: ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  return { data: fieldsToObj(json.fields), updateTime: json.updateTime || null };
}

async function fsCommit(env, writes) {
  const token = await getAccessToken(env);
  const res = await fetch(`${FS_BASE}projects/${projectId(env)}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (res.ok) return true;
  const text = await res.text();
  if (res.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(text)) return false;
  throw new Error('Firestore 쓰기 실패: ' + text.slice(0, 200));
}

function writeUpdate(env, coll, id, obj) {
  return {
    update: { name: docPath(env, coll, id), fields: objToFields(obj) },
    updateMask: { fieldPaths: Object.keys(obj) }
  };
}

// ── 교사 인증 ────────────────────────────────────────────────────────────────
// 토큰 검증 결과를 잠깐 재사용한다. 사진명렬 업로드는 수백 장을 연달아 올리는데,
// 장마다 Identity Toolkit 왕복이 붙으면 그것만으로 몇 분이 걸린다.
const _teacherCache = new Map();   // idToken → { who, exp }
const TEACHER_TTL = 120;           // 초

// 교사 Firebase ID 토큰 검증 → { email, admin } / 실패면 null
async function verifyTeacher(env, idToken) {
  if (!idToken || !env.FIREBASE_API_KEY) return null;
  const hit = _teacherCache.get(idToken);
  if (hit && hit.exp > nowSec()) return hit.who;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }) });
  if (!res.ok) return null;
  const u = ((await res.json()).users || [])[0];
  const email = String(u && u.email || '').toLowerCase();
  if (!u || !u.emailVerified || !email.endsWith('@yeungnam.hs.kr')) return null;
  if (/^[0-9]{7}@yeungnam\.hs\.kr$/.test(email)) return null;    // 학생 계정 제외
  const who = { email, admin: email === String(env.ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase() };
  if (_teacherCache.size > 200) _teacherCache.clear();
  _teacherCache.set(idToken, { who, exp: nowSec() + TEACHER_TTL });
  return who;
}

// Authorization: Bearer <idToken> 에서 뽑아 검증
async function whoFromHeader(env, request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  return verifyTeacher(env, m ? m[1] : '');
}

// ── 학생 사진 (R2) ───────────────────────────────────────────────────────────
function photoKey(g, r, n) {
  // parseInt는 '2/x'에서 2를 뽑아낸다. 키를 정수로 다시 조립하므로 경로 탈출은 없지만,
  // 엉뚱한 입력을 조용히 받아들이지 않도록 '숫자만'인지 먼저 본다.
  const i = v => (/^\d{1,2}$/.test(String(v).trim()) ? parseInt(v, 10) : null);
  const [gg, rr, nn] = [i(g), i(r), i(n)];
  if (gg === null || rr === null || nn === null) return null;
  if (gg < 1 || gg > 9 || rr < 1 || rr > 99 || nn < 1 || nn > 99) return null;   // 경로 조작 방지
  return `photos/${gg}-${rr}/${nn}.jpg`;
}

// 사진 내려주기 — GET /photo?g=&r=&n= + Authorization: Bearer <idToken>
// POST로 하면 브라우저가 응답을 캐시하지 않는다. 같은 학생을 다시 열 때마다 90KB를
// 새로 받게 되므로 GET으로 둔다(Cache-Control이 살아난다).
async function handlePhotoGet(env, request, cors) {
  if (!env.PHOTOS) return json({ success: false, error: 'NO_BUCKET' }, 503, cors);
  const who = await whoFromHeader(env, request);
  if (!who) return json({ success: false, error: 'AUTH' }, 403, cors);
  const q = new URL(request.url).searchParams;
  const key = photoKey(q.get('g'), q.get('r'), q.get('n'));
  if (!key) return json({ success: false, error: 'BAD_KEY' }, 400, cors);

  const obj = await env.PHOTOS.get(key);
  if (!obj) return json({ success: false, error: 'NOT_FOUND' }, 404, cors);
  return new Response(obj.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'image/jpeg',
               // 사진은 잘 안 바뀐다. 브라우저가 다시 묻지 않도록 오래 잡아둔다.
               'Cache-Control': 'private, max-age=86400' }
  });
}

// 사진 올리기 — 관리자만. upload.html의 '사진명렬 업로드'가 장당 한 번씩 부른다.
async function handlePhotoPut(env, body) {
  if (!env.PHOTOS) return { success: false, error: 'NO_BUCKET' };
  const who = await verifyTeacher(env, String(body.idToken || ''));
  if (!who) return { success: false, error: 'AUTH' };
  if (!who.admin) return { success: false, error: 'FORBIDDEN' };
  const key = photoKey(body.g, body.r, body.n);
  if (!key) return { success: false, error: 'BAD_KEY' };

  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
  if (!m) return { success: false, error: 'BAD_IMAGE' };
  const bytes = bytesFromB64(m[1]);
  if (bytes.length > 2 * 1024 * 1024) return { success: false, error: 'TOO_LARGE' };

  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  return { success: true, key, size: bytes.length };
}

// ── 연락처 1건 조회 + 접속기록 ───────────────────────────────────────────────
// 상한은 '몇 번 눌렀나'가 아니라 '몇 사람의 번호를 봤나'로 센다. 같은 학생 팝업을
// 다시 열었다고 상한이 깎이면 정상 업무만 불편해지고, 정작 막아야 할 대량 수집은
// '서로 다른 사람'을 훑는 행위이기 때문이다.
const CONTACT_DAILY_LIMIT = 100;   // 1인 1일 '서로 다른 대상' 조회 상한
const LOG_KEEP_DAYS = 400;         // 접속기록 보관(≥1년). Firestore TTL로 자동 삭제.
const LOG_MAX_ITEMS = 500;         // 문서 1MB 한도 방어. 넘으면 상세는 그만 쌓고 건수만 센다.

// 접속기록 문서 ID. 사람×날짜로 하나 — 상한 확인과 기록을 한 문서에서 끝낸다.
function logId(email, date) {
  // 문서 ID에 '/'가 들어가면 경로가 깨진다. 이메일에는 없지만 방어적으로 치환한다.
  return `${String(email).replace(/\//g, '_')}_${date}`;
}

// 하루 상한 확인 + 기록. 상한을 넘었으면 false(=조회 거부).
// cur(기록 문서)는 호출부가 연락처 읽기와 '동시에' 미리 받아둔 것을 넘겨준다.
// 순서대로 하면 왕복이 하나 더 붙어 사용자가 기다리는 시간이 그만큼 늘어난다.
async function noteAccess(env, email, target, cur) {
  const date = todayKst();
  const prev = (cur && cur.data) || {};
  const items = Array.isArray(prev.items) ? prev.items : [];
  const seen = new Set(items.map(x => x && x.target));
  if (!seen.has(target) && seen.size >= CONTACT_DAILY_LIMIT) return false;
  // KST HH:MM
  const hhmm = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16);
  if (items.length < LOG_MAX_ITEMS) items.push({ t: hhmm, target });
  await fsCommit(env, [writeUpdate(env, 'accessLogs', logId(email, date), {
    email, date,
    count:   (Number(prev.count) || 0) + 1,          // 총 조회 횟수
    people:  seen.size + (seen.has(target) ? 0 : 1), // 서로 다른 대상 수(= 상한 기준)
    items,
    expireAt: new Date(Date.now() + LOG_KEEP_DAYS * 86400 * 1000)
  })]);
  return true;
}

// 연락처 원본은 studentsContact/main · contactsPhone/main 에 있고, 보안 규칙이
// 브라우저 읽기를 막는다(서비스 계정만 읽힌다). 아직 분리 업로드를 안 한 상태에서도
// 동작하도록 예전 문서(students/main · contacts/main)로 폴백한다.
async function loadStudentContacts(env) {
  const split = await fsGet(env, 'studentsContact', 'main');
  if (split.data && Array.isArray(split.data.students) && split.data.students.length) {
    return split.data.students;
  }
  const old = await fsGet(env, 'students', 'main');
  return (old.data && old.data.students) || [];
}
async function loadStaffContacts(env) {
  const split = await fsGet(env, 'contactsPhone', 'main');
  if (split.data && Array.isArray(split.data.staff) && split.data.staff.length) {
    return split.data.staff;
  }
  const old = await fsGet(env, 'contacts', 'main');
  return (old.data && old.data.staff) || [];
}

const sameNum = (a, b) => String(a ?? '').trim() !== '' &&
                          parseInt(a, 10) === parseInt(b, 10);

// POST { action:'contact', idToken, type:'student', g, r, n }
//      { action:'contact', idToken, type:'staff', i, name }
// 한 번에 '1명분'만 나간다. 전교생을 받으려면 그만큼 요청해야 하고, 전부 기록되며
// 하루 상한에 걸린다.
async function handleContact(env, body) {
  const who = await verifyTeacher(env, String(body.idToken || ''));
  if (!who) return { success: false, error: 'AUTH' };

  const type = String(body.type || '');
  let found = null, target = '';

  // 접속기록 문서를 연락처와 동시에 받기 시작한다(기다리는 시간을 왕복 하나만큼 줄인다).
  const logP = fsGet(env, 'accessLogs', logId(who.email, todayKst())).catch(() => null);

  if (type === 'student') {
    const list = await loadStudentContacts(env);
    const s = list.find(x => x && sameNum(x.grade, body.g) &&
                                  sameNum(x.room,  body.r) &&
                                  sameNum(x.num,   body.n));
    if (!s) return { success: false, error: 'NOT_FOUND' };
    target = `S ${parseInt(body.g, 10)}-${parseInt(body.r, 10)}-${parseInt(body.n, 10)}`;
    found = {
      birth:       s.birth || '',
      phone:       s.phone || '',
      fatherPhone: s.fatherPhone || '',
      motherPhone: s.motherPhone || ''
    };
  } else if (type === 'staff') {
    const list = await loadStaffContacts(env);
    const name = String(body.name || '').trim();
    const i = parseInt(body.i, 10);
    // 인덱스로 먼저 찾되, 명렬을 다시 올려 순서가 밀렸을 수 있으니 이름으로 검증한다.
    // 어긋나면 이름이 딱 하나일 때만 그걸로 대체한다(동명이인은 거부 — 잘못 주는 것보다 낫다).
    let c = Number.isInteger(i) && list[i];
    if (!c || (name && String(c.name || '').trim() !== name)) {
      const hits = list.filter(x => x && String(x.name || '').trim() === name);
      c = hits.length === 1 ? hits[0] : null;
    }
    if (!c) return { success: false, error: 'NOT_FOUND' };
    target = `T ${c.name || ''}`;
    found = { phone: c.phone || '' };
  } else {
    return { success: false, error: 'BAD_TYPE' };
  }

  if (!(await noteAccess(env, who.email, target, await logP))) {
    return { success: false, error: 'DAILY_LIMIT', limit: CONTACT_DAILY_LIMIT };
  }
  return { success: true, contact: found };
}

// ── CORS · 응답 ──────────────────────────────────────────────────────────────
function corsHeaders(env, origin) {
  // 끝 슬래시·대소문자 차이로 매칭이 어긋나는 사고가 잦아 정규화해서 비교한다.
  const norm = s => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
  const allow = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(norm).filter(Boolean);
  // 허용 목록이 비어 있으면(초기 설정 전) 아무 곳도 허용하지 않는다 — 안전측.
  const ok = allow.includes(norm(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // 사진 조회는 GET + Authorization 이다(브라우저 캐시를 쓰려면 GET이어야 한다)
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
// 오류 응답은 절대 캐시되면 안 된다. 405·404 등은 규격상 브라우저가 임의로 캐시해도 되는
// 상태 코드라, no-store가 없으면 배포를 고친 뒤에도 옛 오류가 계속 나온다.
// 연락처 응답도 캐시되면 안 된다(개인정보 + 조회마다 기록이 남아야 함) → 여기로만 나간다.
const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8',
                     'Cache-Control': 'no-store', ...headers }
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (cors['Access-Control-Allow-Origin'] === 'null') {
      return json({ success: false, error: 'ORIGIN' }, 403, cors);
    }
    // 사진 조회만 GET (브라우저 캐시를 쓰기 위해). 나머지는 전부 POST + JSON.
    if (request.method === 'GET') {
      if (new URL(request.url).pathname === '/photo') {
        try { return await handlePhotoGet(env, request, cors); }
        catch (e) { console.error('photoGet', e && e.message);
                    return json({ success: false, error: 'SERVER' }, 500, cors); }
      }
      return json({ success: false, error: 'METHOD' }, 405, cors);
    }
    if (request.method !== 'POST') return json({ success: false, error: 'METHOD' }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ success: false, error: 'BAD_JSON' }, 400, cors); }

    try {
      switch (body.action) {
        case 'contact':  return json(await handleContact(env, body),  200, cors);
        case 'photoPut': return json(await handlePhotoPut(env, body), 200, cors);
        default:         return json({ success: false, error: 'UNKNOWN_ACTION' }, 400, cors);
      }
    } catch (e) {
      // 내부 오류 메시지는 그대로 노출하지 않는다(키·경로 유출 방지).
      console.error('teacher-api', body.action, e && e.message);
      return json({ success: false, error: 'SERVER' }, 500, cors);
    }
  }
};
