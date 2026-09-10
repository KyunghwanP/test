// notice-api 워커 검증.
//
// 이 워커는 대시보드에 코드를 붙여넣어 배포한다 — 되돌릴 길이 다시 붙여넣기뿐이라,
// 올리기 전에 여기서 실제 경로를 태워 본다. 스텁은 '바깥 세계'(Identity Toolkit,
// R2 버킷)만 흉내내고 워커 코드는 손대지 않는다.
//
// 특히 보는 것
//  · 관리자가 아닌 교사가 공지 이미지를 올리거나 지우지 못하는가
//  · 키에 '../' 같은 것이 섞여 남의 자리를 건드리지 못하는가
//  · 청소(sweep)가 지금 쓰이는 그림을 지워 버리지 않는가
import worker from './notice-api.js';

const ORIGIN = 'https://kyunghwanp.github.io';
const ADMIN   = 'pkh910518@yeungnam.hs.kr';
const TEACHER = 'hong@yeungnam.hs.kr';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

// ── 가짜 R2 버킷 ──
const mkBucket = () => {
  const store = new Map();          // key → Uint8Array
  return {
    _store: store,
    async put(k, bytes) { store.set(k, bytes); },
    async get(k) { return store.has(k) ? { body: store.get(k) } : null; },
    async delete(k) { store.delete(k); },
    async list({ prefix, limit }) {
      return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).slice(0, limit).map(key => ({ key })) };
    },
  };
};

let TOKENS = {};   // idToken → Identity Toolkit 응답의 users[0]
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('identitytoolkit.googleapis.com')) {
    const t = TOKENS[JSON.parse(init.body).idToken];
    return new Response(JSON.stringify({ users: t ? [t] : [] }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error('예상 못 한 바깥 호출: ' + url);
};
// 토큰 검증 결과를 워커가 120초 재사용하므로, 사람마다 토큰 문자열을 달리 준다.
// localId(= Firebase uid)도 같이 준다 — 캘린더 메모 그림의 '칸 이름'이 이 값이다.
const tok = (email, uid) => {
  const t = 'tok-' + email;
  TOKENS[t] = { email, emailVerified: true, localId: uid || ('uid' + email.split('@')[0]) };
  return t;
};
const T_ADMIN   = tok(ADMIN,   'uidAdmin');
const T_TEACHER = tok(TEACHER, 'uidHong');
const T_KIM     = tok('kim@yeungnam.hs.kr', 'uidKim');
tok('2350101@yeungnam.hs.kr');                       // 학생 계정 (형식만 만들어 둔다)
const T_STUDENT = 'tok-2350101@yeungnam.hs.kr';

let env;
const reset = () => { env = { ALLOWED_ORIGINS: ORIGIN, FIREBASE_API_KEY: 'fake', NOTICES: mkBucket() }; };
reset();

const post = (body, origin = ORIGIN) => worker.fetch(new Request('https://notice-api.test/', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify(body) }), env);
const getImg = (k, token, origin = ORIGIN) => worker.fetch(new Request(
  'https://notice-api.test/img?k=' + encodeURIComponent(k),
  { headers: token ? { Origin: origin, Authorization: 'Bearer ' + token } : { Origin: origin } }), env);

// 1×1 짜리 실제 JPEG 은 필요 없다 — 워커는 dataURL 머리글만 보고 본문은 그대로 넣는다
const PNG = 'data:image/png;base64,' + btoa('hello-image');

console.log('\n■ 출처 (CORS)');
{
  const bad = await post({ action: 'put' }, 'https://evil.example');
  check('허용 안 된 출처는 막는다', bad.status === 403);
  check('허용 안 된 출처엔 Origin 을 되돌려주지 않는다',
        bad.headers.get('Access-Control-Allow-Origin') === 'null');

  const pre = await worker.fetch(new Request('https://notice-api.test/', {
    method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
  check('사전요청(OPTIONS)은 204', pre.status === 204);
  check('Authorization 헤더를 허용한다',
        (pre.headers.get('Access-Control-Allow-Headers') || '').includes('Authorization'));
  check('출처마다 응답이 다르다고 알린다', pre.headers.get('Vary') === 'Origin');
}

console.log('\n■ 올리기 — 관리자만');
let KEY = '';
{
  const put = b => post({ action: 'put', idToken: T_ADMIN, scope: 'test', noticeId: 'board', ...b });

  const noAuth = await (await post({ action: 'put', idToken: 'none', scope: 'test', noticeId: 'board', fileId: 'a', dataUrl: PNG })).json();
  check('토큰이 없으면 못 올린다', noAuth.error === 'AUTH');

  const asTeacher = await (await post({ action: 'put', idToken: T_TEACHER, scope: 'test', noticeId: 'board', fileId: 'a', dataUrl: PNG })).json();
  check('관리자가 아닌 교사는 못 올린다', asTeacher.error === 'FORBIDDEN', asTeacher);

  const asStudent = await (await post({ action: 'put', idToken: T_STUDENT, scope: 'test', noticeId: 'board', fileId: 'a', dataUrl: PNG })).json();
  check('학생 계정은 교사로 안 쳐준다', asStudent.error === 'AUTH', asStudent);

  const ok = await (await put({ fileId: 'a1', dataUrl: PNG })).json();
  check('관리자는 올릴 수 있다', ok.success === true, ok);
  check('키를 돌려준다', ok.key === 'notices/test/board/a1.jpg', ok);
  check('버킷에 실제로 들어갔다', env.NOTICES._store.has('notices/test/board/a1.jpg'));
  KEY = ok.key;

  const bad = await (await put({ fileId: 'a2', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' })).json();
  check('이미지가 아니면 거절한다', bad.error === 'BAD_IMAGE', bad);
  const empty = await (await put({ fileId: 'a3', dataUrl: '' })).json();
  check('빈 본문도 거절한다', empty.error === 'BAD_IMAGE', empty);

  const big = 'data:image/jpeg;base64,' + btoa('x'.repeat(3 * 1024 * 1024 + 10));
  const tooBig = await (await put({ fileId: 'a4', dataUrl: big })).json();
  check('3MB 를 넘으면 거절한다', tooBig.error === 'TOO_BIG', tooBig);
  check('상한을 알려준다', tooBig.limit === 3 * 1024 * 1024);
}

console.log('\n■ 키 — 바깥 문자열이 경로가 된다');
{
  const put = (scope, noticeId, fileId) =>
    post({ action: 'put', idToken: T_ADMIN, scope, noticeId, fileId, dataUrl: PNG });
  for (const [label, a, b, c] of [
    ['상위 경로(..)',   '..',        'board', 'a'],
    ['슬래시가 섞인 값', 'test',      'a/../b', 'a'],
    ['한글·공백',       'test',      'board', '내 사진'],
    ['빈 값',           '',          'board', 'a'],
    ['너무 긴 값',      'test',      'board', 'x'.repeat(41)],
  ]) {
    const r = await (await put(a, b, c)).json();
    check(`${label} → 거절`, r.error === 'BAD_KEY', r);
  }
  check('그런 것이 버킷에 남지 않았다',
        [...env.NOTICES._store.keys()].every(k => /^notices\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.jpg$/.test(k)),
        [...env.NOTICES._store.keys()]);
}

console.log('\n■ 내려주기 — 교사면 누구나, 캐시는 개인용');
{
  const anon = await getImg(KEY, null);
  check('토큰 없이는 못 본다', anon.status === 403);

  const mine = await getImg(KEY, T_TEACHER);
  check('관리자가 아닌 교사도 볼 수 있다', mine.status === 200, mine.status);
  check('JPEG 으로 내려준다', mine.headers.get('Content-Type') === 'image/jpeg');
  const cc = mine.headers.get('Cache-Control') || '';
  check('브라우저가 오래 잡아둔다', /max-age=604800/.test(cc), cc);
  check('공용 캐시에는 안 남긴다(private)', /private/.test(cc), cc);
  check('본문이 올린 것과 같다',
        new TextDecoder().decode(await mine.arrayBuffer()) === 'hello-image');

  const gone = await getImg('notices/test/board/zzz.jpg', T_ADMIN);
  check('없는 그림은 404', gone.status === 404);
  const bad = await getImg('notices/../secret.jpg', T_ADMIN);
  check('이상한 키는 400', bad.status === 400);
  check('오류 응답은 캐시하지 않는다', gone.headers.get('Cache-Control') === 'no-store');

  const wrongMethod = await worker.fetch(new Request('https://notice-api.test/nope',
    { headers: { Origin: ORIGIN } }), env);
  check('/img 아닌 GET 은 405', wrongMethod.status === 405);
}

console.log('\n■ 지우기 — 관리자만');
{
  const asTeacher = await (await post({ action: 'del', idToken: T_TEACHER, key: KEY })).json();
  check('관리자가 아닌 교사는 못 지운다', asTeacher.error === 'FORBIDDEN', asTeacher);
  check('그래서 그림이 남아 있다', env.NOTICES._store.has(KEY));

  const bad = await (await post({ action: 'del', idToken: T_ADMIN, key: '../x' })).json();
  check('이상한 키는 거절', bad.error === 'BAD_KEY', bad);

  const ok = await (await post({ action: 'del', idToken: T_ADMIN, key: KEY })).json();
  check('관리자는 지울 수 있다', ok.success === true && ok.deleted === 1, ok);
  check('버킷에서 사라졌다', !env.NOTICES._store.has(KEY));
}

console.log('\n■ 청소 — 쓰이는 그림은 남긴다');
{
  reset();
  const put = fileId => post({ action: 'put', idToken: T_ADMIN, scope: 'test', noticeId: 'board', fileId, dataUrl: PNG });
  for (const f of ['keep1', 'keep2', 'orphan1', 'orphan2']) await put(f);
  await post({ action: 'put', idToken: T_ADMIN, scope: 'live', noticeId: 'board', fileId: 'other', dataUrl: PNG });
  check('다섯 장이 들어갔다', env.NOTICES._store.size === 5, env.NOTICES._store.size);

  const keep = ['notices/test/board/keep1.jpg', 'notices/test/board/keep2.jpg'];
  const r = await (await post({ action: 'sweep', idToken: T_ADMIN, scope: 'test', keep })).json();
  check('버려진 두 장을 지웠다', r.success === true && r.deleted === 2, r);
  check('쓰이는 그림은 그대로', keep.every(k => env.NOTICES._store.has(k)));
  // 배포가 버킷을 같이 쓴다 — test 를 청소하다 운영 공지를 지우면 되돌릴 길이 없다
  check('다른 배포(live)는 건드리지 않는다', env.NOTICES._store.has('notices/live/board/other.jpg'));

  const asTeacher = await (await post({ action: 'sweep', idToken: T_TEACHER, scope: 'test', keep: [] })).json();
  check('관리자가 아닌 교사는 청소도 못 한다', asTeacher.error === 'FORBIDDEN', asTeacher);
  const badScope = await (await post({ action: 'sweep', idToken: T_ADMIN, scope: '..', keep: [] })).json();
  check('이상한 배포 이름은 거절', badScope.error === 'BAD_KEY', badScope);
  check('그동안 아무것도 더 안 지워졌다', env.NOTICES._store.size === 3, env.NOTICES._store.size);
}

console.log('\n■ 업무캘린더 메모 그림 — 교사 누구나, 대신 자기 칸에만');
{
  reset();
  const putTask = (token, taskId, fileId) =>
    post({ action: 'put', kind: 'task', idToken: token, scope: 'test', taskId, fileId, dataUrl: PNG });

  const hong = await (await putTask(T_TEACHER, 'task1', 'a')).json();
  check('관리자가 아닌 교사도 올릴 수 있다', hong.success === true, hong);
  check('키에 올린이 uid 가 들어간다', hong.key === 'tasks/test/uidHong/task1/a.jpg', hong.key);

  const kim = await (await putTask(T_KIM, 'task9', 'b')).json();
  check('사람이 다르면 칸도 다르다', kim.key === 'tasks/test/uidKim/task9/b.jpg', kim.key);

  // 여기가 핵심이다. uid 를 요청에 적어 보내도 워커는 토큰에서 꺼낸 값만 쓴다.
  const spoof = await (await post({ action: 'put', kind: 'task', idToken: T_TEACHER,
    scope: 'test', uid: 'uidKim', taskId: 'task9', fileId: 'c', dataUrl: PNG })).json();
  check('남의 uid 를 적어 보내도 자기 칸에 들어간다',
        spoof.key === 'tasks/test/uidHong/task9/c.jpg', spoof.key);

  const student = await (await putTask(T_STUDENT, 'task1', 'z')).json();
  check('학생 계정은 올리지 못한다', student.error === 'AUTH', student);

  const badId = await (await putTask(T_TEACHER, '../..', 'd')).json();
  check('일정 id 에 이상한 글자가 오면 거절', badId.error === 'BAD_KEY', badId);
}

console.log('\n■ 캘린더 그림 지우기 — 남의 것은 못 지운다');
{
  const mine   = 'tasks/test/uidHong/task1/a.jpg';
  const theirs = 'tasks/test/uidKim/task9/b.jpg';

  const no = await (await post({ action: 'del', idToken: T_TEACHER, key: theirs })).json();
  check('남의 그림은 못 지운다', no.error === 'FORBIDDEN', no);
  check('그래서 남의 그림이 그대로 있다', env.NOTICES._store.has(theirs));

  const mixed = await (await post({ action: 'del', idToken: T_TEACHER, keys: [mine, theirs] })).json();
  check('섞어 보내도 내 것만 지운다', mixed.success === true && mixed.deleted === 1, mixed);
  check('내 그림은 지워졌다', !env.NOTICES._store.has(mine));
  check('남의 그림은 살아남았다', env.NOTICES._store.has(theirs));

  const asAdmin = await (await post({ action: 'del', idToken: T_ADMIN, key: theirs })).json();
  check('관리자는 뒤처리를 할 수 있다', asAdmin.success === true, asAdmin);
}

console.log('\n■ 캘린더 청소 — 자기 칸 밖으로 나가지 않는다');
{
  reset();
  const putTask = (token, taskId, fileId) =>
    post({ action: 'put', kind: 'task', idToken: token, scope: 'test', taskId, fileId, dataUrl: PNG });
  await putTask(T_TEACHER, 'task1', 'keep');
  await putTask(T_TEACHER, 'task1', 'orphan');
  await putTask(T_KIM,     'task9', 'kim1');
  await putTask(T_KIM,     'task9', 'kim2');
  await post({ action: 'put', idToken: T_ADMIN, scope: 'test', noticeId: 'board', fileId: 'n1', dataUrl: PNG });

  // 홍 선생님이 청소한다. 자기가 쓰는 그림 하나만 남기라고 보낸다.
  const r = await (await post({ action: 'sweep', kind: 'task', idToken: T_TEACHER,
    scope: 'test', keep: ['tasks/test/uidHong/task1/keep.jpg'] })).json();
  check('청소가 된다', r.success === true, r);
  check('내 칸의 안 쓰는 그림만 지운다', r.deleted === 1, r);
  check('내가 쓰는 그림은 남는다', env.NOTICES._store.has('tasks/test/uidHong/task1/keep.jpg'));
  check('내 안 쓰는 그림은 사라진다', !env.NOTICES._store.has('tasks/test/uidHong/task1/orphan.jpg'));
  // 여기가 이 기능에서 제일 위험한 자리다 — 범위를 잘못 잡으면 전 교사의 그림이 날아간다
  check('남의 그림은 건드리지 않는다',
        env.NOTICES._store.has('tasks/test/uidKim/task9/kim1.jpg') &&
        env.NOTICES._store.has('tasks/test/uidKim/task9/kim2.jpg'));
  check('공지 그림도 건드리지 않는다', env.NOTICES._store.has('notices/test/board/n1.jpg'));

  // keep 을 비워 보내도 남의 칸은 여전히 안전하다(내 것은 다 지워진다)
  const r2 = await (await post({ action: 'sweep', kind: 'task', idToken: T_TEACHER,
    scope: 'test', keep: [] })).json();
  check('빈 목록이면 내 칸은 비워진다', r2.deleted === 1, r2);
  check('그래도 남의 칸은 그대로다',
        env.NOTICES._store.has('tasks/test/uidKim/task9/kim1.jpg'));

  // 교사가 공지 쪽 청소를 부르면 여전히 막힌다
  const asNotice = await (await post({ action: 'sweep', idToken: T_TEACHER, scope: 'test', keep: [] })).json();
  check('교사는 공지 청소를 못 부른다', asNotice.error === 'FORBIDDEN', asNotice);
  check('그래서 공지 그림이 남아 있다', env.NOTICES._store.has('notices/test/board/n1.jpg'));

  // 배포가 다르면 서로 안 섞인다
  await putTask(T_TEACHER, 'task1', 'liveish');
  const r3 = await (await post({ action: 'sweep', kind: 'task', idToken: T_TEACHER,
    scope: 'live', keep: [] })).json();
  check('다른 배포를 청소해도 이쪽은 그대로', r3.deleted === 0 &&
        env.NOTICES._store.has('tasks/test/uidHong/task1/liveish.jpg'), r3);
}

console.log('\n■ 캘린더 그림 내려받기');
{
  const k = 'tasks/test/uidKim/task9/kim1.jpg';
  const mine = await getImg(k, T_TEACHER);
  // 일정은 공유받은 사람만 보지만, 그림은 키를 아는 교사면 받을 수 있다.
  // 워커가 Firestore 를 안 보기 때문이다 — 알고 받아들인 선택이라 여기 적어 둔다.
  check('키를 알면 다른 교사도 받을 수 있다 (알고 있는 한계)', mine.status === 200, mine.status);
  const anon = await getImg(k, '');
  check('로그인 안 했으면 못 받는다', anon.status === 403, anon.status);
  const stu = await getImg(k, T_STUDENT);
  check('학생 계정은 못 받는다', stu.status === 403, stu.status);
}

console.log('\n■ 버킷을 안 붙였을 때 (설정 전이거나 되돌렸을 때)');
{
  const noBucket = { ALLOWED_ORIGINS: ORIGIN, FIREBASE_API_KEY: 'fake' };
  const r = await worker.fetch(new Request('https://notice-api.test/', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'put', idToken: T_ADMIN, scope: 'test', noticeId: 'board', fileId: 'a', dataUrl: PNG }) }), noBucket);
  const j = await r.json();
  check('터지지 않고 꺼졌다고 답한다', j.error === 'NO_BUCKET', j);
}

console.log('\n■ 그 밖');
{
  const unknown = await (await post({ action: '없는것', idToken: T_ADMIN })).json();
  check('모르는 action 은 거절', unknown.error === 'UNKNOWN_ACTION');
  const broken = await worker.fetch(new Request('https://notice-api.test/', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{' }), env);
  check('깨진 JSON 도 500 이 아니라 400', broken.status === 400);
  const del = await worker.fetch(new Request('https://notice-api.test/', {
    method: 'DELETE', headers: { Origin: ORIGIN } }), env);
  check('POST·GET 말고는 405', del.status === 405);
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
