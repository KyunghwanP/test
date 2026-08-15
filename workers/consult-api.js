/**
 * 학부모 상담 예약 API — Cloudflare Worker
 * ============================================================================
 * 기존 Google Apps Script(GAS)를 대체한다.
 *  · GAS는 /exec 호출이 반드시 302 리다이렉트를 타고(왕복 2회) 콜드 스타트가
 *    1~3초라 느렸고, 동시 실행 수 제한 때문에 '예약 오픈 시각'에 몰리면 큐가
 *    쌓여 타임아웃이 났다.
 *  · Worker는 리다이렉트가 없고 V8 아이솔레이트라 콜드 스타트가 사실상 없다.
 *
 * 역할 분담
 *  · 조회(슬롯 목록)  → 학부모 브라우저가 Firestore를 '직접' 읽는다. 이 워커를
 *    거치지 않으므로 오픈 시각 폭주가 워커에 부하를 주지 않는다.
 *    개인정보가 없는 공개 미러 문서 consultationsPublic/{반}만 읽게 하고,
 *    그 반 학부모로 인증된 사람만 읽도록 보안 규칙으로 막는다.
 *  · 인증·예약·취소     → 이 워커. 서비스 계정으로 Firestore에 접근한다.
 *
 * 학생 사진(photoGet/photoPut)도 이 워커가 맡는다.
 *  · Firestore는 문서 하나가 1MB라 반 40명을 한 문서에 담으면 장당 10KB(150×200)가
 *    한계였다. R2는 그 제한이 없어 600×800으로 올릴 수 있다.
 *  · R2 버킷 자체에는 로그인 개념이 없다 → 비공개로 두고 이 워커가 문지기를 한다.
 *    (교사 Firebase ID 토큰을 Identity Toolkit에 물어 검증)
 *
 * 필요한 시크릿/변수 (wrangler secret put / 대시보드 Variables)
 *  · SA_JSON         : 서비스 계정 JSON 전체 문자열 (필수, 암호화 시크릿)
 *  · ALLOWED_ORIGINS : 쉼표 구분 허용 Origin
 *                      예) https://kyunghwanp.github.io
 *  · PROJECT_ID      : (선택) 미지정 시 SA_JSON의 project_id 사용
 *  · FIREBASE_API_KEY: 교사 토큰 검증용 (impersonate·photo* 에 필요)
 *  · PHOTOS          : (선택) R2 버킷 바인딩. 없으면 사진 기능만 조용히 꺼진다.
 *
 * 자세한 배포 방법은 같은 폴더의 README.md 참고.
 */

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

// 타이밍 공격에 안전한 비교(토큰 서명 검증용)
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── 서비스 계정 · 액세스 토큰 ────────────────────────────────────────────────
// 아이솔레이트가 살아있는 동안 재사용(요청마다 JWT 서명+토큰 교환을 반복하면
// 왕복이 하나 더 붙어 느려진다). 만료 60초 전에 갱신.
let _saCache = null;      // { sa, keyPromise }
let _tokenCache = null;   // { token, exp }

function getSA(env) {
  if (_saCache) return _saCache;
  if (!env.SA_JSON) throw new Error('SA_JSON 시크릿이 설정되지 않았습니다.');
  const sa = JSON.parse(env.SA_JSON);
  if (!sa.private_key || !sa.client_email) throw new Error('SA_JSON 형식이 올바르지 않습니다.');
  // PEM → PKCS#8 → CryptoKey (RS256 서명용). import는 한 번만.
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
      // Firestore(datastore) + 사용자 조회(identitytoolkit). 스코프는 공백으로 구분한다.
      // identitytoolkit 이 없으면 관리자 '실제 권한으로 보기'의 계정 조회가 403으로 막힌다.
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
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

// Firebase 커스텀 토큰 — 학부모 브라우저가 이걸로 로그인해 Firestore를 직접 읽는다.
// claims.classKey 를 보안 규칙에서 검사해 '자기 반 슬롯'만 읽도록 제한한다.
async function mintCustomToken(env, uid, claims) {
  const { sa } = getSA(env);
  const iat = nowSec();
  return signRS256(env,
    { alg: 'RS256', typ: 'JWT' },
    {
      iss: sa.client_email, sub: sa.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat, exp: iat + 3600,   // 커스텀 토큰은 최대 1시간
      uid, claims
    });
}

// ── 세션 토큰(예약·취소 시 신원 확인) ────────────────────────────────────────
// 대칭키(HMAC)라 워커가 자기 서명을 즉시 검증할 수 있다. 키는 서비스 계정
// 개인키에서 파생 → 관리할 시크릿이 늘지 않는다.
let _hmacKeyPromise = null;
function getHmacKey(env) {
  if (_hmacKeyPromise) return _hmacKeyPromise;
  const { sa } = getSA(env);
  _hmacKeyPromise = crypto.subtle.digest('SHA-256', enc.encode(sa.private_key))
    .then(raw => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  return _hmacKeyPromise;
}
async function makeSession(env, data) {
  const body = b64urlFromString(JSON.stringify({ ...data, exp: nowSec() + 6 * 3600 }));
  const key = await getHmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return `${body}.${b64urlFromBytes(new Uint8Array(sig))}`;
}
async function readSession(env, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const key = await getHmacKey(env);
  const expect = b64urlFromBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body))));
  if (!safeEqual(sig || '', expect)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(bytesFromB64(body)));
    if (!data.exp || data.exp < nowSec()) return null;
    return data;
  } catch { return null; }
}

// ── Firestore REST ───────────────────────────────────────────────────────────
// REST는 값에 타입 래퍼를 쓴다(stringValue 등) → JS 값과 상호 변환.
function toFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
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

// 여러 문서를 한 번에 원자적으로 쓴다. precondition을 주면 그 사이 문서가
// 바뀐 경우 실패한다(= 선착순 경합을 잠금 없이 안전하게 처리).
async function fsCommit(env, writes) {
  const token = await getAccessToken(env);
  const res = await fetch(`${FS_BASE}projects/${projectId(env)}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (res.ok) return true;
  const text = await res.text();
  // 선행조건 불일치 → 그 사이 누가 먼저 예약함
  if (res.status === 409 || /FAILED_PRECONDITION|ALREADY_EXISTS/i.test(text)) return false;
  throw new Error('Firestore 쓰기 실패: ' + text.slice(0, 200));
}

function writeUpdate(env, coll, id, obj, updateTime) {
  const w = {
    update: { name: docPath(env, coll, id), fields: objToFields(obj) },
    updateMask: { fieldPaths: Object.keys(obj) }
  };
  if (updateTime) w.currentDocument = { updateTime };
  return w;
}

// ── 도메인 로직 ──────────────────────────────────────────────────────────────
// 학부모에게 공개해도 되는 형태(개인정보 제거 + 열린 슬롯만)
function publicSlots(slots) {
  return (Array.isArray(slots) ? slots : [])
    .filter(s => s && s.status !== 'booked')
    .map(s => ({ id: s.id, date: s.date, time: s.time, duration: s.duration || 20 }));
}
// 미러 문서 갱신 write (본 문서와 같은 커밋에 넣어 항상 일치시킨다)
function mirrorWrite(env, classKey, slots, openAt) {
  return writeUpdate(env, 'consultationsPublic', classKey, {
    slots: publicSlots(slots),
    openAt: openAt || '',
    updatedAt: new Date().toISOString()
  });
}
// 오늘(KST) 날짜 'YYYY-MM-DD'. 워커는 UTC로 도므로 9시간을 더해 계산한다.
function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 내 예약 찾기 — 학생 이름+번호로 식별(직접 예약분도 잡히도록).
//   지난 날짜의 예약은 제외한다. 슬롯은 한 문서에 계속 누적되므로, 전체를 훑으면
//   지난 학기 예약 때문에 다음 상담 주간에 '이미 예약됨'으로 막힌다.
//   '이미 예약이 있다'는 판단은 앞으로 있을 상담에만 적용되어야 한다.
function findMine(slots, studentName, studentNum) {
  const today = todayKst();
  return (Array.isArray(slots) ? slots : []).find(s =>
    s && s.status === 'booked' &&
    String(s.date || '') >= today &&
    String(s.studentName || '').trim() === String(studentName || '').trim() &&
    String(s.studentNum || '') === String(studentNum || '')
  ) || null;
}
function mineView(s) {
  if (!s) return null;
  return {
    id: s.id, date: s.date, time: s.time, duration: s.duration || 20,
    type: s.bookedType || s.type || 'face',
    name: s.bookedName || '', phone: s.bookedPhone || '', memo: s.bookedMemo || ''
  };
}

// ── 핸들러 ───────────────────────────────────────────────────────────────────
// 학부모 인증: 학년·반·이름·생년월일이 학생부와 일치하는지 확인
async function handleVerify(env, body) {
  const grade = String(body.grade || '').trim();
  const room  = String(body.room  || '').trim();
  const name  = String(body.name  || '').trim();
  const birth = String(body.birth || '').trim();
  if (!grade || !room || !name || !birth) return { success: false, error: 'MISSING_FIELDS' };

  const { data } = await fsGet(env, 'students', 'main');
  const roster = (data && Array.isArray(data.students)) ? data.students : [];
  const hit = roster.find(s =>
    String(parseInt(s.grade)) === String(parseInt(grade)) &&
    String(parseInt(s.room))  === String(parseInt(room))  &&
    String(s.name || '').trim() === name &&
    String(s.birth || '').trim() === birth
  );
  if (!hit) return { success: false, error: 'NOT_FOUND' };

  const classKey = `${parseInt(hit.grade)}-${parseInt(hit.room)}`;
  const studentNum = String(parseInt(hit.num));
  const { data: cData } = await fsGet(env, 'consultations', classKey);
  const slots = (cData && Array.isArray(cData.slots)) ? cData.slots : [];

  // 세션(예약·취소용) + 커스텀 토큰(브라우저가 Firestore를 직접 읽기 위한 것)
  const [session, customToken] = await Promise.all([
    makeSession(env, { classKey, studentName: hit.name, studentNum }),
    mintCustomToken(env, `p_${classKey}_${studentNum}`, { classKey })
  ]);

  return {
    success: true, classKey, session, customToken,
    studentName: hit.name, studentNum,
    teacher: (cData && cData.teacher) || '',
    openAt: (cData && cData.openAt) || '',
    slots: publicSlots(slots),
    mine: mineView(findMine(slots, hit.name, studentNum))
  };
}

// 슬롯 목록 조회 — 평소엔 학부모 브라우저가 미러를 직접 읽으므로 거의 쓰이지 않는다.
// 직접 읽기가 실패했을 때의 대체 경로 + 내 예약 확인용.
async function handleSlots(env, body) {
  const sess = await readSession(env, body.session);
  if (!sess) return { success: false, error: 'AUTH' };
  const { classKey, studentName, studentNum } = sess;
  const { data } = await fsGet(env, 'consultations', classKey);
  const slots = (data && Array.isArray(data.slots)) ? data.slots : [];
  return {
    success: true,
    openAt: (data && data.openAt) || '',
    slots: publicSlots(slots),
    mine: mineView(findMine(slots, studentName, studentNum))
  };
}

// 예약 — updateTime 선행조건으로 원자 처리(잠금 없이 선착순 보장)
async function handleBook(env, body) {
  const sess = await readSession(env, body.session);
  if (!sess) return { success: false, error: 'AUTH' };
  const { classKey, studentName, studentNum } = sess;
  const slotId = String(body.slotId || '');
  if (!slotId) return { success: false, error: 'MISSING_FIELDS' };

  // 경합에 대비해 몇 번 재시도(그 사이 다른 사람이 '다른' 슬롯을 잡은 경우 등)
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, updateTime } = await fsGet(env, 'consultations', classKey);
    const slots = (data && Array.isArray(data.slots)) ? data.slots : [];

    const openAt = (data && data.openAt) || '';
    if (openAt && new Date(openAt).getTime() > Date.now()) return { success: false, error: 'NOT_OPEN' };
    if (findMine(slots, studentName, studentNum)) return { success: false, error: 'ALREADY_BOOKED' };

    const idx = slots.findIndex(s => s && s.id === slotId);
    if (idx === -1) return { success: false, error: 'GONE' };
    if (slots[idx].status === 'booked') return { success: false, error: 'TAKEN' };

    const next = slots.slice();
    next[idx] = {
      ...slots[idx],
      status: 'booked',
      studentName, studentNum,
      bookedName:  String(body.bkName  || '').slice(0, 40),
      bookedPhone: String(body.bkPhone || '').slice(0, 30),
      bookedMemo:  String(body.bkMemo  || '').slice(0, 500),
      bookedType:  body.bkType === 'phone' ? 'phone' : 'face',
      bookedAt: new Date().toISOString()
    };

    const ok = await fsCommit(env, [
      writeUpdate(env, 'consultations', classKey,
        { slots: next, updatedAt: new Date().toISOString() }, updateTime),
      mirrorWrite(env, classKey, next, openAt)
    ]);
    if (ok) return { success: true, mine: mineView(next[idx]) };
    // 선행조건 실패 → 문서가 바뀌었다. 다시 읽어 재시도.
  }
  return { success: false, error: 'BUSY' };
}

// 취소 — 예약 정보 필드를 지우고 다시 open 으로
async function handleCancel(env, body) {
  const sess = await readSession(env, body.session);
  if (!sess) return { success: false, error: 'AUTH' };
  const { classKey, studentName, studentNum } = sess;

  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, updateTime } = await fsGet(env, 'consultations', classKey);
    const slots = (data && Array.isArray(data.slots)) ? data.slots : [];
    const idx = slots.findIndex(s =>
      s && s.status === 'booked' &&
      String(s.studentName || '').trim() === String(studentName || '').trim() &&
      String(s.studentNum || '') === String(studentNum || '')
    );
    if (idx === -1) return { success: false, error: 'NO_BOOKING' };
    // 교사가 직접 넣은 예약(token:'teacher')은 학부모가 취소할 수 없다(교사 앱과 동일 규칙).
    if (slots[idx].token === 'teacher') return { success: false, error: 'TEACHER_BOOKED' };

    const next = slots.slice();
    const { studentName: _a, studentNum: _b, bookedName: _c, bookedPhone: _d,
            bookedMemo: _e, bookedType: _f, bookedAt: _g, ...rest } = slots[idx];
    next[idx] = { ...rest, status: 'open' };

    const openAt = (data && data.openAt) || '';
    const ok = await fsCommit(env, [
      writeUpdate(env, 'consultations', classKey,
        { slots: next, updatedAt: new Date().toISOString() }, updateTime),
      mirrorWrite(env, classKey, next, openAt)
    ]);
    if (ok) return { success: true };
  }
  return { success: false, error: 'BUSY' };
}

// ── 관리자: 다른 교사 계정으로 보기(가장) ────────────────────────────────────
// 권한이 실제로 부여됐는지 확인하려면 그 사람 자격으로 규칙이 평가돼야 한다.
// 관리자 본인의 ID 토큰을 검증한 뒤, 대상 교사 uid 로 커스텀 토큰을 발급한다.
// (앱은 이 토큰을 메모리 세션으로만 쓰고, 그 상태에서 쓰기는 전부 차단한다)
const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';

async function handleImpersonate(env, body) {
  const idToken = String(body.idToken || '');
  const target  = String(body.targetEmail || '').trim().toLowerCase();
  if (!idToken || !target) return { success: false, error: 'MISSING_FIELDS' };
  if (!env.FIREBASE_API_KEY) return { success: false, error: 'NO_API_KEY' };

  // 1) 호출자가 정말 관리자인지 — 토큰을 Identity Toolkit 에 물어 검증한다.
  const vres = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }) });
  if (!vres.ok) return { success: false, error: 'AUTH' };
  const me = ((await vres.json()).users || [])[0];
  const admin = String(env.ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase();
  if (!me || !me.emailVerified || String(me.email || '').toLowerCase() !== admin) {
    return { success: false, error: 'FORBIDDEN' };
  }

  // 2) 대상 교사의 uid 찾기 — 한 번도 로그인한 적 없으면 계정 자체가 없다.
  const token = await getAccessToken(env);
  const lres = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId(env)}/accounts:lookup`,
    { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [target] }) });
  if (!lres.ok) {
    // 원인 파악이 빠르도록 상태코드를 함께 준다(403이면 대개 스코프 문제).
    console.error('accounts:lookup', lres.status, (await lres.text()).slice(0, 200));
    return { success: false, error: 'LOOKUP_FAILED_' + lres.status };
  }
  const user = ((await lres.json()).users || [])[0];
  if (!user || !user.localId) return { success: false, error: 'NEVER_LOGGED_IN' };

  return { success: true, customToken: await mintCustomToken(env, user.localId, {}) };
}

// ── 진입점 ───────────────────────────────────────────────────────────────────
// ── 학생 사진 (R2) ──────────────────────────────────────────────────────────
// 키: photos/{학년}-{반}/{번호}.jpg  — 학생 한 명 = 파일 하나.
// Firestore(studentPhotos)의 작은 사진은 그대로 둔다. R2에 없으면 앱이 그쪽으로
// 되돌아가므로, 사진명렬을 다시 올리기 전까지 화면이 깨지지 않는다.
function photoKey(g, r, n) {
  // parseInt는 '2/x'에서 2를 뽑아낸다. 키를 정수로 다시 조립하므로 경로 탈출은 없지만,
  // 엉뚱한 입력을 조용히 받아들이지 않도록 '숫자만'인지 먼저 본다.
  const i = v => (/^\d{1,2}$/.test(String(v).trim()) ? parseInt(v, 10) : null);
  const [gg, rr, nn] = [i(g), i(r), i(n)];
  if (gg === null || rr === null || nn === null) return null;
  if (gg < 1 || gg > 9 || rr < 1 || rr > 99 || nn < 1 || nn > 99) return null;   // 경로 조작 방지
  return `photos/${gg}-${rr}/${nn}.jpg`;
}

// 교사 Firebase ID 토큰 검증 → { email, admin } / 실패면 null
async function verifyTeacher(env, idToken) {
  if (!idToken || !env.FIREBASE_API_KEY) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }) });
  if (!res.ok) return null;
  const u = ((await res.json()).users || [])[0];
  const email = String(u && u.email || '').toLowerCase();
  if (!u || !u.emailVerified || !email.endsWith('@yeungnam.hs.kr')) return null;
  if (/^[0-9]{7}@yeungnam\.hs\.kr$/.test(email)) return null;    // 학생 계정 제외
  return { email, admin: email === String(env.ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase() };
}

// 사진 내려주기 — 응답은 JSON이 아니라 이미지 바이트다.
async function handlePhotoGet(env, body, cors) {
  if (!env.PHOTOS) return json({ success: false, error: 'NO_BUCKET' }, 503, cors);
  const who = await verifyTeacher(env, String(body.idToken || ''));
  if (!who) return json({ success: false, error: 'AUTH' }, 403, cors);
  const key = photoKey(body.g, body.r, body.n);
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

function corsHeaders(env, origin) {
  // 끝 슬래시·대소문자 차이로 매칭이 어긋나는 사고가 잦아 정규화해서 비교한다.
  // (예: 'https://kyunghwanp.github.io/' 로 적어도 동작하게)
  const norm = s => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
  const allow = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(norm).filter(Boolean);
  // 허용 목록이 비어 있으면(초기 설정 전) 아무 곳도 허용하지 않는다 — 안전측.
  const ok = allow.includes(norm(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ success: false, error: 'METHOD' }, 405, cors);
    if (cors['Access-Control-Allow-Origin'] === 'null') {
      return json({ success: false, error: 'ORIGIN' }, 403, cors);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ success: false, error: 'BAD_JSON' }, 400, cors); }

    try {
      switch (body.action) {
        case 'verify': return json(await handleVerify(env, body), 200, cors);
        case 'slots':  return json(await handleSlots(env, body),  200, cors);
        case 'book':   return json(await handleBook(env, body),   200, cors);
        case 'cancel': return json(await handleCancel(env, body), 200, cors);
        case 'impersonate': return json(await handleImpersonate(env, body), 200, cors);
        // 사진 조회만 이미지 바이트를 그대로 돌려준다(base64로 감싸면 33% 커진다)
        case 'photoGet': return await handlePhotoGet(env, body, cors);
        case 'photoPut': return json(await handlePhotoPut(env, body), 200, cors);
        default:       return json({ success: false, error: 'UNKNOWN_ACTION' }, 400, cors);
      }
    } catch (e) {
      // 내부 오류 메시지는 그대로 노출하지 않는다(키·경로 유출 방지).
      console.error('consult-api', body.action, e && e.message);
      return json({ success: false, error: 'SERVER' }, 500, cors);
    }
  }
};
