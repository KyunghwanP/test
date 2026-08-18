// teacher-api 워커 검증.
// fetch를 통째로 가짜로 물려서 실제 코드 경로(RSA 서명·Firestore 타입 변환·상한 계산)를
// 그대로 태운다. 스텁은 '바깥 세계'(Identity Toolkit·OAuth·Firestore REST)만 흉내낸다.
import worker from './teacher-api.js';

// ── 가짜 서비스 계정 (진짜 RSA 키를 만들어 넣는다 — 서명 경로를 건너뛰지 않으려고) ──
const kp = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
let b = ''; for (const x of pkcs8) b += String.fromCharCode(x);
const PEM = `-----BEGIN PRIVATE KEY-----\n${btoa(b).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;

const ORIGIN = 'https://kyunghwanp.github.io';
const env = {
  SA_JSON: JSON.stringify({ private_key: PEM, client_email: 'sa@test.iam.gserviceaccount.com', project_id: 'ynhs-test' }),
  ALLOWED_ORIGINS: ORIGIN,
  FIREBASE_API_KEY: 'fake-key',
  PHOTOS: null
};

// ── 가짜 Firestore 저장소 ──
let DOCS = {};        // 'coll/id' → 평범한 JS 객체
let COMMITS = [];     // 실제로 나간 쓰기 기록
let READS = [];       // 실제로 읽은 문서 경로

const TEACHER = 'hong@yeungnam.hs.kr';
let TOKENS = {};      // idToken → { email, emailVerified }

function toFs(v) {                       // 스텁이 응답을 만들 때 쓰는 최소 변환
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === 'object') {
    const fields = {}; for (const k of Object.keys(v)) fields[k] = toFs(v[k]);
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
  if ('timestampValue' in v) return { __ts: v.timestampValue };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFs);
  if ('mapValue' in v) {
    const o = {}, f = v.mapValue.fields || {};
    for (const k of Object.keys(f)) o[k] = fromFs(f[k]);
    return o;
  }
  return null;
}
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);

  if (u.startsWith('https://oauth2.googleapis.com/token')) {
    return J({ access_token: 'fake-access', expires_in: 3600 });
  }
  if (u.includes('identitytoolkit.googleapis.com')) {
    const { idToken } = JSON.parse(init.body);
    const t = TOKENS[idToken];
    return t ? J({ users: [t] }) : J({ users: [] });
  }
  if (u.includes('firestore.googleapis.com')) {
    if (u.endsWith(':commit')) {
      const { writes } = JSON.parse(init.body);
      for (const w of writes) {
        const path = w.update.name.split('/documents/')[1];
        const obj = {};
        for (const k of Object.keys(w.update.fields)) obj[k] = fromFs(w.update.fields[k]);
        DOCS[path] = { ...(DOCS[path] || {}), ...obj };
        COMMITS.push({ path, obj });
      }
      return J({ writeResults: [] });
    }
    const path = u.split('/documents/')[1];
    READS.push(path);
    const d = DOCS[path];
    if (!d) return J({ error: { message: 'not found' } }, 404);
    const fields = {}; for (const k of Object.keys(d)) fields[k] = toFs(d[k]);
    return J({ name: u, fields, updateTime: '2026-08-18T00:00:00Z' });
  }
  throw new Error('스텁이 모르는 요청: ' + u);
};

// ── 픽스처 ──
const STUDENTS = [
  { grade: 1, room: 3, num: 7,  name: '김학생', birth: '2009-04-01', phone: '010-1111-1111', fatherPhone: '010-2222-2222', motherPhone: '010-3333-3333' },
  { grade: 1, room: 3, num: 8,  name: '이학생', birth: '2009-05-02', phone: '010-4444-4444', fatherPhone: '', motherPhone: '010-5555-5555' },
  { grade: 2, room: 1, num: 12, name: '박학생', birth: '2008-01-09', phone: '010-6666-6666', fatherPhone: '010-7777-7777', motherPhone: '' }
];
const STAFF = [
  { name: '김교사', dept: '교무기획부', phone: '010-8888-8888' },
  { name: '이교사', dept: '1학년부',    phone: '010-9999-9999' },
  { name: '최교사', dept: '2학년부',    phone: '010-1010-1010' },
  { name: '최교사', dept: '3학년부',    phone: '010-2020-2020' }   // 동명이인
];

function reset({ split = true } = {}) {
  DOCS = {}; COMMITS = []; READS = [];
  TOKENS = {
    'tok-teacher': { email: TEACHER,                    emailVerified: true },
    'tok-admin':   { email: 'pkh910518@yeungnam.hs.kr', emailVerified: true },
    'tok-student': { email: '1030712@yeungnam.hs.kr',   emailVerified: true },
    'tok-outside': { email: 'someone@gmail.com',        emailVerified: true },
    'tok-unverif': { email: 'x@yeungnam.hs.kr',         emailVerified: false }
  };
  if (split) {
    DOCS['studentsContact/main'] = { students: STUDENTS };
    DOCS['contactsPhone/main']   = { staff: STAFF };
    // 분리 후: 예전 문서에는 연락처가 없다
    DOCS['students/main'] = { students: STUDENTS.map(({ grade, room, num, name }) => ({ grade, room, num, name })) };
    DOCS['contacts/main'] = { staff: STAFF.map(({ name, dept }) => ({ name, dept })) };
  } else {
    // 분리 업로드 전 상태 — 연락처가 아직 예전 문서에 있다
    DOCS['students/main'] = { students: STUDENTS };
    DOCS['contacts/main'] = { staff: STAFF };
  }
}

const post = (body, origin = ORIGIN) => worker.fetch(new Request('https://teacher-api.test/', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
}), env);

// ── 검사 ──
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra !== undefined ? '\n       →' + JSON.stringify(extra) : ''); }
}

console.log('\n■ 학생 연락처 — 1명분만 나가는가');
reset();
{
  const res = await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 1, r: 3, n: 7 });
  const j = await res.json();
  check('성공', j.success === true, j);
  check('그 학생의 번호가 맞다', j.contact && j.contact.phone === '010-1111-1111', j.contact);
  check('부·모 번호도 온다', j.contact.fatherPhone === '010-2222-2222' && j.contact.motherPhone === '010-3333-3333', j.contact);
  check('생년월일도 온다', j.contact.birth === '2009-04-01', j.contact);
  const s = JSON.stringify(j);
  check('다른 학생 번호가 섞이지 않는다', !s.includes('4444') && !s.includes('6666'), s);
  check('이름조차 응답에 없다(필요한 것만)', !s.includes('김학생'), s);
  check('응답이 캐시되지 않는다', res.headers.get('Cache-Control') === 'no-store', res.headers.get('Cache-Control'));
}

console.log('\n■ 접속기록');
{
  const log = COMMITS.find(c => c.path.startsWith('accessLogs/'));
  check('기록이 남는다', !!log, COMMITS.map(c => c.path));
  check('문서 ID가 사람×날짜', /^accessLogs\/hong@yeungnam\.hs\.kr_\d{4}-\d{2}-\d{2}$/.test(log.path), log.path);
  check('누가 조회했는지 남는다', log.obj.email === TEACHER, log.obj.email);
  check('무엇을 봤는지 남는다', log.obj.items[0].target === 'S 1-3-7', log.obj.items);
  check('시각이 남는다', /^\d{2}:\d{2}$/.test(log.obj.items[0].t), log.obj.items[0]);
  check('건수가 센다', log.obj.count === 1, log.obj.count);
  check('보관기한이 timestamp 형이다(TTL이 지울 수 있게)',
        log.obj.expireAt && typeof log.obj.expireAt.__ts === 'string', log.obj.expireAt);
  const days = (new Date(log.obj.expireAt.__ts) - Date.now()) / 86400e3;
  check('보관기한이 1년 이상', days > 365, Math.round(days) + '일');
}

console.log('\n■ 인증');
reset();
{
  for (const [tok, label] of [['tok-student', '학생 계정'], ['tok-outside', '외부 계정'],
                              ['tok-unverif', '메일 미인증'], ['', '토큰 없음']]) {
    const j = await (await post({ action: 'contact', idToken: tok, type: 'student', g: 1, r: 3, n: 7 })).json();
    check(label + ' 거부', j.success === false && j.error === 'AUTH', j);
  }
  check('거부된 조회는 기록도 안 남는다', COMMITS.length === 0, COMMITS);
  const j2 = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 1, r: 3, n: 7 },
                               'https://evil.example')).json();
  check('허용되지 않은 Origin 차단', j2.error === 'ORIGIN', j2);
}

console.log('\n■ 없는 학생 / 잘못된 요청');
reset();
{
  const a = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 9, r: 9, n: 9 })).json();
  check('없는 학생 → NOT_FOUND', a.error === 'NOT_FOUND', a);
  check('없는 학생은 기록도 안 남는다', !COMMITS.some(c => c.path.startsWith('accessLogs/')), COMMITS);
  const b2 = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'zzz' })).json();
  check('알 수 없는 type → BAD_TYPE', b2.error === 'BAD_TYPE', b2);
  const c = await (await post({ action: 'nope', idToken: 'tok-teacher' })).json();
  check('알 수 없는 action → UNKNOWN_ACTION', c.error === 'UNKNOWN_ACTION', c);
}

console.log('\n■ 하루 상한 (대량 수집 차단)');
const LOGKEY = () => 'accessLogs/' + TEACHER + '_' + new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
reset();
{
  // 같은 학생을 200번 열어도 막히면 안 된다 — 정상 업무다.
  let ok = 0;
  for (let i = 0; i < 200; i++) {
    const j = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 1, r: 3, n: 7 })).json();
    if (j.success) ok++;
  }
  check('같은 사람을 반복 조회해도 안 막힌다', ok === 200, ok);
  const log = DOCS[LOGKEY()];
  check('총 횟수는 그대로 센다', log.count === 200, log.count);
  check('서로 다른 대상은 1명', log.people === 1, log.people);
  check('기록 상세는 500건에서 멈춘다(문서 1MB 방어)', log.items.length === 200, log.items.length);
}
reset();
{
  // 서로 다른 사람을 훑는 것 = 대량 수집. 이건 막혀야 한다.
  const many = [];
  for (let g = 1; g <= 3; g++) for (let r = 1; r <= 10; r++) for (let n = 1; n <= 10; n++) many.push([g, r, n]);
  DOCS['studentsContact/main'] = { students: many.map(([g, r, n]) => ({ grade: g, room: r, num: n, phone: `010-0000-${g}${r}${n}` })) };
  let ok = 0, blocked = 0, lastErr = null;
  for (const [g, r, n] of many.slice(0, 105)) {
    const j = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g, r, n })).json();
    if (j.success) ok++; else { blocked++; lastErr = j; }
  }
  check('서로 다른 사람은 100명까지만', ok === 100, ok);
  check('그 뒤로는 막힌다', blocked === 5, blocked);
  check('상한 오류를 알려준다', lastErr && lastErr.error === 'DAILY_LIMIT' && lastErr.limit === 100, lastErr);
  const log = DOCS[LOGKEY()];
  check('이미 본 사람은 상한 뒤에도 다시 볼 수 있다', log.people === 100, log.people);
  const j2 = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 1, r: 1, n: 1 })).json();
  check('(확인) 이미 본 사람 재조회는 통과', j2.success === true, j2);
}

console.log('\n■ 교원 연락처');
reset();
{
  const a = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'staff', i: 0, name: '김교사' })).json();
  check('인덱스+이름이 맞으면 번호가 온다', a.success && a.contact.phone === '010-8888-8888', a);
  check('교원은 번호만 온다(부서 등 불필요)', Object.keys(a.contact).length === 1, a.contact);

  // 명렬을 다시 올려 순서가 밀린 상황
  const b2 = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'staff', i: 1, name: '김교사' })).json();
  check('인덱스가 밀려도 이름이 유일하면 복구', b2.success && b2.contact.phone === '010-8888-8888', b2);

  const c = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'staff', i: 99, name: '최교사' })).json();
  check('동명이인 + 인덱스 어긋남 → 거부(엉뚱한 번호를 주지 않음)', c.error === 'NOT_FOUND', c);

  const d = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'staff', i: 3, name: '최교사' })).json();
  check('동명이인이라도 인덱스가 맞으면 정확히 그 사람', d.success && d.contact.phone === '010-2020-2020', d);

  const log = COMMITS.filter(c2 => c2.path.startsWith('accessLogs/')).pop();
  check('교원 조회도 기록된다', log.obj.items.some(x => x.target === 'T 최교사'), log.obj.items);
}

console.log('\n■ 분리 업로드 전에도 동작하는가 (예전 문서 폴백)');
reset({ split: false });
{
  const a = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 2, r: 1, n: 12 })).json();
  check('students/main 으로 폴백', a.success && a.contact.phone === '010-6666-6666', a);
  // 접속기록 읽기는 연락처 읽기와 '동시에' 시작한다(사용자가 기다리는 왕복을 하나 줄임).
  check('기록 읽기를 먼저 띄운다(동시 진행)', READS[0].startsWith('accessLogs/'), READS);
  check('분리 문서를 예전 문서보다 먼저 본다',
        READS.indexOf('studentsContact/main') < READS.indexOf('students/main'), READS);
  const b2 = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'staff', i: 1, name: '이교사' })).json();
  check('contacts/main 으로 폴백', b2.success && b2.contact.phone === '010-9999-9999', b2);
}

console.log('\n■ 분리 후에는 예전 문서를 안 본다');
reset({ split: true });
{
  await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 1, r: 3, n: 7 });
  check('students/main 을 읽지 않는다', !READS.includes('students/main'), READS);
}

console.log('\n■ 숫자 표기가 달라도 찾는가 (문자열 "07" 등)');
reset();
DOCS['studentsContact/main'] = { students: [{ grade: '1', room: '03', num: '07', phone: '010-1111-1111' }] };
{
  const a = await (await post({ action: 'contact', idToken: 'tok-teacher', type: 'student', g: 1, r: 3, n: 7 })).json();
  check('문자열/0패딩도 매칭', a.success && a.contact.phone === '010-1111-1111', a);
}

console.log('\n■ 사진 업로드 권한');
reset();
{
  const a = await (await post({ action: 'photoPut', idToken: 'tok-teacher', g: 1, r: 1, n: 1, dataUrl: 'data:image/jpeg;base64,AAAA' })).json();
  check('R2 바인딩 없으면 조용히 꺼짐', a.error === 'NO_BUCKET', a);
  env.PHOTOS = { put: async () => {}, get: async () => null };
  const b2 = await (await post({ action: 'photoPut', idToken: 'tok-teacher', g: 1, r: 1, n: 1, dataUrl: 'data:image/jpeg;base64,AAAA' })).json();
  check('일반 교사는 사진 업로드 불가', b2.error === 'FORBIDDEN', b2);
  const c = await (await post({ action: 'photoPut', idToken: 'tok-admin', g: 1, r: 1, n: 1, dataUrl: 'data:image/jpeg;base64,AAAA' })).json();
  check('관리자는 가능', c.success === true, c);
  const d = await (await post({ action: 'photoPut', idToken: 'tok-admin', g: 1, r: '1/../x', n: 1, dataUrl: 'data:image/jpeg;base64,AAAA' })).json();
  check('경로 조작 거부', d.error === 'BAD_KEY', d);
  env.PHOTOS = null;
}

console.log('\n■ 사진 조회');
reset();
env.PHOTOS = { get: async k => (k === 'photos/1-3/7.jpg' ? { body: 'JPEGBYTES' } : null) };
{
  const g = (h, q = 'g=1&r=3&n=7') => worker.fetch(new Request('https://teacher-api.test/photo?' + q, {
    headers: { Origin: ORIGIN, ...(h || {}) } }), env);
  const a = await g({ Authorization: 'Bearer tok-teacher' });
  check('교사는 사진을 받는다', a.status === 200 && a.headers.get('Content-Type') === 'image/jpeg', a.status);
  const b2 = await g({ Authorization: 'Bearer tok-student' });
  check('학생 계정은 거부', b2.status === 403, b2.status);
  const c = await g({});
  check('토큰 없으면 거부', c.status === 403, c.status);
  const d = await g({ Authorization: 'Bearer tok-teacher' }, 'g=1&r=3&n=99');
  check('없는 사진은 404', d.status === 404, d.status);
  check('404도 캐시 안 됨', d.headers.get('Cache-Control') === 'no-store', d.headers.get('Cache-Control'));
  const e = await worker.fetch(new Request('https://teacher-api.test/nope', { headers: { Origin: ORIGIN } }), env);
  check('다른 GET 경로는 405', e.status === 405, e.status);
}
env.PHOTOS = null;

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
