// 생기부 보조자료 올리기 엔진(saenggibu.html 의 sgbCommitCore) — 단계마다 끊어 보고, 다음 올리기가 바로잡는지.
//
// 2026-10 점검에서 나온 것:
//  ① 올리다 중간에 끊기면 학생 문서는 반쯤 새것인데 지문 목록(manifest)은 옛것이라, 옛 파일을 다시 올려도
//     「바뀐 것 없음」 으로 보고 아무것도 안 써서 섞인 채 남았다.
//  ② 잠금이 계정만 봐서 같은 계정의 두 번째 창은 그냥 통과했고, 풀 때는 주인을 안 봐서 남의 잠금도 지웠다.
//     창이 멈췄다 깨어나도 그대로 이어 썼다.
// 이제: 덜 끝난 표시(saenggibu/dirty)를 먼저 저장하고 쓰며, 표시가 남아 있으면 다음 올리기가 서버 문서를 전부 읽어
// 「합친 최종 목록」 과 맞댄다. 저장하는 트랜잭션마다 잠금(작업 id · 유효 시간)을 읽어 보고 쓴다.
//
// 페이지의 순수 블록(<script id="sgbParser">)을 그대로 떼어 와 돌린다. Firestore 는 메모리 대역 —
// 트랜잭션은 실제처럼 「읽은 문서가 그사이 바뀌었으면 다시 돈다」. 검사가 정한 단계에서 오류를 내거나(끊김),
// 그 창을 영영 멈추거나(창을 닫음), 멈췄다 다시 깨운다(노트북 덮개). 이름은 지어낸 것이다.
//
// 실행: node tests/saenggibu-commit.test.mjs   (설치 필요 없음)
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../saenggibu.html', 'utf8');
const code = HTML.match(/<script id="sgbParser">([\s\S]*?)<\/script>/)[1];
const P = new Function(code + `;return { sgbParseBook, sgbCompare, sgbStamp, sgbCommitCore, sgbMetaPatchCore, sgbDirtyState,
  sgbCanon, sgbActBase, sgbFmtPath, SGB_LOCK_MS };`)();

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 600) : ''));
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

// ── 메모리 Firestore ──
class FakeDb {
  constructor(init = {}){ this.docs = new Map(); this.vers = new Map(); this.seq = 0; this.commits = []; this.retries = 0;
    for (const [p, v] of Object.entries(init)) this.put(p, v); }
  put(p, v){ this.docs.set(p, clone(v)); this.vers.set(p, ++this.seq); }
  del(p){ this.docs.delete(p); this.vers.set(p, ++this.seq); }
  ver(p){ return this.vers.get(p) || 0; }
  get(p){ return clone(this.docs.get(p)); }
  snap(){ return Object.fromEntries([...this.docs].map(([k, v]) => [k, clone(v)])); }
}
const clock = { t: Date.parse('2026-10-31T05:00:00Z') };
const KIM = 'kim@yeungnam.hs.kr', LEE = 'lee@yeungnam.hs.kr';
const never = () => new Promise(() => {});
// 창 하나 = io 하나. hooks.on(ev) 가 단계마다 불린다 — throw(끊김) · io.kill()(창을 닫음 — 이 창은 다시 안 움직인다)
// · await gate(멈춤 → 깨움). ev: { k: 'get'|'scan'|'txget'|'commit', p?, c?, writes?, n? }
function makeIo(db, { me = KIM, name = 'w', on, txOps = 4, partBytes = 300, beat = false } = {}){
  let dead = false, uid = 0, txn = 0;
  const step = async ev => {
    if (dead) await never();
    await Promise.resolve();
    if (on) await on(ev, io);
    if (dead) await never();
  };
  const io = {
    me, who: e => e.split('@')[0], now: () => clock.t, uid: () => `${name}-op${++uid}`, txOps, partBytes,
    get: async p => { await step({ k: 'get', p }); return db.get(p) ?? null; },
    scan: async c => { await step({ k: 'scan', c });
      return [...db.docs].filter(([p]) => p.startsWith(c + '/')).map(([p, v]) => [p.slice(c.length + 1), clone(v)]); },
    tx: async fn => {
      for (let attempt = 0; attempt < 5; attempt++){
        const reads = new Map(), writes = [];
        const t = {
          get: async p => { if (writes.length) throw new Error('트랜잭션: 읽기는 쓰기보다 먼저');
            await step({ k: 'txget', p }); reads.set(p, db.ver(p)); return db.get(p) ?? null; },
          set: (p, d) => { writes.push(['s', p, clone(d)]); },
          del: p => { writes.push(['d', p]); },
        };
        const out = await fn(t);
        const ev = { k: 'commit', n: ++txn, writes: writes.map(([k, p]) => `${k}:${p}`) };
        await step(ev);                                          // 여기서 끊기면 이 묶음은 안 들어간다
        if ([...reads].some(([p, v]) => db.ver(p) !== v)){ db.retries++; continue; }   // 그사이 바뀜 → 다시 돈다
        for (const [k, p, d] of writes) k === 's' ? db.put(p, d) : db.del(p);
        if (writes.length) db.commits.push({ who: name, n: ev.n, writes: ev.writes });   // 읽기만 한 것은 저장이 아니다
        return out;
      }
      throw new Error('트랜잭션 경합 — 다섯 번 다 실패');
    },
    // 잠금 시각 늘리기 — beat 면 검사가 io.beat() 로 손수 부른다(진짜 페이지는 1분마다 setInterval)
    every: beat ? (ms, fn) => { io.beat = fn; return () => { io.beat = null; }; } : undefined,
    kill(){ dead = true; },
  };
  return io;
}
const isData = p => /^(saenggibuStu|saenggibuAct)\//.test(p) || /^saenggibu\/fmt-/.test(p);
const dataWrites = (db, who, from = 0) => db.commits.slice(from).filter(c => c.who === who).flatMap(c => c.writes).filter(w => isData(w.slice(2)));

// ── 엑셀 대신 시트 배열(XLSX 가 읽어 준 모양 — 칸은 글자) ──
const NAMES = ['김가람', '박나래', '최다온', '이보람', '정하늘', '한별', '윤솔', '강바다', '오누리', '서로운', '문채원', '배시온'];
const STUDENTS = [];
for (const [g, c] of [[1, 1], [1, 2], [2, 1]]) for (let n = 1; n <= 8; n++) STUDENTS.push({ g, c, n, nm: NAMES[(g * 5 + c * 3 + n) % NAMES.length] + (n > 4 ? n : '') });
const ROSTER = STUDENTS.map(s => ({ grade: s.g, room: s.c, num: s.n, name: s.nm }));
const head = (dept, title) => [[dept, null, '⊙ 활  동  명:', null, title], ['학년', '반', '번호', '성명', '기재 내용']];
const row = (s, text) => [String(s.g), String(s.c), String(s.n), s.nm, text];
const SCHED = ['<누>창의(1학년 창체)', [
  ['창의교육부', null, null, '⊙ 활  동  명:', null, '1학년 창의적 체험활동 상황'],
  [null, null, null, '⊙ 입력 영역:', null, '창의적 체험활동 누가기록'],
  ['월', '일', '요일', '교시', '이수시간', '자율', '동아리', '봉사', '진로', '활동 영역', '활동 내용'],
  ['3', '9', '월', '1', '1', '1', '', '', '', '자율·자치활동', '도서관 활용교육'],
  ['3', '11', '수', '7', '1', '', '1', '', '', '동아리활동', '동아리 편성']]];
// 첫 합본(김 선생님): 독서 토론(전원) · 직업 탐색(앞 12명) · 창체 일정
const readTxt = (s, v) => `${s.nm} 학생은 독서 토론에서 ${v === 2 ? '사회를 맡아 쟁점을 정리하고 발표함.' : '근거를 들어 의견을 말함.'}`;
const FILE_A = { name: 'merge-a.xlsx', sheets: [
  ['<자>교무(독서 토론)', [...head('교무부', '독서 토론'), ...STUDENTS.map(s => row(s, readTxt(s, 1)))]],
  ['<진>진로(직업 탐색)', [...head('진로부', '직업 탐색'), ...STUDENTS.slice(0, 12).map(s => row(s, `${s.nm} 학생은 관심 직업의 하루를 조사함.`))]],
  SCHED] };
// 김 선생님이 고쳐 다시 내는 판 — 독서 토론 문안이 모두 바뀜(이 올리기가 중간에 끊긴다)
const FILE_B = { name: 'merge-b.xlsx', sheets: [
  ['<자>교무(독서 토론)', [...head('교무부', '독서 토론'), ...STUDENTS.map(s => row(s, readTxt(s, 2)))]],
  ['<진>진로(직업 탐색)', [...head('진로부', '직업 탐색'), ...STUDENTS.slice(0, 12).map(s => row(s, `${s.nm} 학생은 관심 직업의 하루를 조사함.`))]],
  SCHED] };
// 이 선생님(다른 부서)이 자기 시트 하나만 — 나머지는 기존 자료를 남긴다
const FILE_C = { name: 'dept-c.xlsx', sheets: [
  ['<자>과학(탐구 발표)', [...head('과학부', '탐구 발표'), ...STUDENTS.slice(4, 10).map(s => row(s, `${s.nm} 학생은 탐구 결과를 발표함.`))]]] };

// 올리기 계획 — 화면(doUpload)의 기본 「추가·수정」 그대로: 이 파일 것은 넣고, 이 파일에 없는 기존 것은 남긴다
function planFor(file, meta, me = KIM, at = '2026-10-31T05:00:00.000Z'){
  const parsed = P.sgbParseBook(file.sheets.map(([name, rows]) => ({ name, hidden: false, rows })));
  [...parsed.activities, ...parsed.schedules].forEach(a => { a.file = file.name; });
  const cmp = P.sgbCompare(meta, parsed);
  P.sgbStamp(cmp, me, at);
  const forms = Object.fromEntries([...parsed.activities, ...parsed.schedules].map(a => [a.id, { sheet: a.sheet, h: 2, widths: [6, 6, 6, 10, 60] }]));
  return { parsed, keep: cmp.missing, forms, order: meta?.order || [], metaAt: meta?.at || null, file: file.name,
    roster: ROSTER, changed: [], log: { file: file.name } };
}
const run = (db, file, opt = {}) => {
  const io = makeIo(db, opt);
  const plan = planFor(file, db.get('saenggibu/meta') || null, io.me);
  return { io, p: P.sgbCommitCore(io, plan, opt.say) };
};
// 끊김 없이 한 번에 — 기대값을 만든다(같은 시작 상태 + 같은 계획)
async function clean(base, file, me = KIM){
  const db = new FakeDb(base);
  const { p } = run(db, file, { me, name: 'clean' });
  await p;
  return db;
}
// 자료(학생·활동 조각·양식·목록·지문)가 같은가 — 다른 문서 이름을 돌려준다
function diff(a, b){
  const keys = new Set([...a.docs.keys(), ...b.docs.keys()].filter(p => isData(p) || /^saenggibu\/(meta|manifest)$/.test(p)));
  return [...keys].filter(k => P.sgbCanon(a.get(k) ?? null) !== P.sgbCanon(b.get(k) ?? null)).sort();
}
const settle = () => new Promise(r => setTimeout(r, 0));
const ok = p => p.catch(e => ({ crashed: e.message || String(e) }));   // 끝까지 가야 하는 것 — 실패해도 검사는 이어서
const gate = () => { let open; const g = new Promise(r => { open = r; }); g.open = open; return g; };

// 첫 상태 — 김 선생님이 합본 A 를 올려 둔 학교
const S0 = (await clean({ 'students/main': { students: ROSTER } }, FILE_A)).snap();
// B 까지 끝까지 올라간 상태(바꿔 단 뒤에 끊긴 경우의 기준)
const S1 = (await clean(S0, FILE_B)).snap();

console.log('\n[기본]');
{
  const db = new FakeDb(S0);
  const keys = [...db.docs.keys()];
  const meta = db.get('saenggibu/meta');
  check('첫 올리기 — 학생 24 · 활동 조각 여러 개 · 양식 3 · 목록 · 지문, 표시·잠금은 안 남는다',
    keys.filter(k => k.startsWith('saenggibuStu/')).length === 24 && keys.filter(k => k.startsWith('saenggibuAct/')).length > 6
    && keys.filter(k => k.startsWith('saenggibu/fmt-')).length === 3 && !keys.includes('saenggibu/dirty') && !keys.includes('saenggibu/lock'), keys.filter(k => !k.startsWith('saenggibuStu/')));
  const read = meta.activities.find(a => a.title === '독서 토론');
  check('활동마다 내용 지문(ver)이 붙고, 조각·양식 문서 이름에 들어간다', !!read.ver
    && keys.some(k => k.startsWith(`saenggibuAct/${read.id}.${read.ver}-1-`)) && keys.includes(`saenggibu/fmt-${read.id}.${read.ver}`));
  const read1 = new FakeDb(S1).get('saenggibu/meta').activities.find(a => a.title === '독서 토론');
  const job0 = meta.activities.find(a => a.title === '직업 탐색'), job1 = new FakeDb(S1).get('saenggibu/meta').activities.find(a => a.title === '직업 탐색');
  check('내용이 바뀐 활동은 새 이름(ver)으로, 안 바뀐 활동은 같은 이름 그대로', read1.ver !== read.ver && job0.ver === job1.ver, [read.ver, read1.ver, job0.ver, job1.ver]);
  const s1 = new FakeDb(S1);
  check('다 올라가면 옛 판 조각·양식은 지워진다', ![...s1.docs.keys()].some(k => k.includes(`${read.id}.${read.ver}`)));
}

// ── ① 단계마다 끊기 → 다음 올리기가 바로잡는다 ──
console.log('\n[단계마다 끊기 — 오류로 멈춤(잠금은 풀린다)]');
// B 를 올리다가 hit(ev) 가 참인 단계에서 오류. 그다음 recover 파일을 올리면 기대 상태와 같아야 한다
const S0_META = P.sgbCanon(new FakeDb(S0).get('saenggibu/meta'));
async function cleanAt(t, base, file, me = KIM){ const keepT = clock.t; clock.t = t; const db = await clean(base, file, me); clock.t = keepT; return db; }
async function cut(label, hit, { recover = FILE_A, base = 'auto', crash = false } = {}){
  const t0 = clock.t;
  const db = new FakeDb(S0);
  let fired = false, cnt = 0;
  const { io, p } = run(db, FILE_B, { name: 'B', on: (ev, io) => {
    if (fired || !hit(ev, ++cnt)) return;
    fired = true;
    if (crash){ io.kill(); return; }
    throw new Error('네트워크 끊김(검사)');
  } });
  let err = null, res = null;
  if (crash){ p.catch(() => {}); await settle(); for (let i = 0; i < 50; i++) await settle(); }
  else { try { res = await p; } catch (e) { err = e; } }
  const dirty = db.get('saenggibu/dirty'), lock = db.get('saenggibu/lock');
  const switched = P.sgbCanon(db.get('saenggibu/meta')) !== S0_META;   // 목록을 바꿔 달았나(그 시각의 B 결과가 기준)
  return { db, err, res, dirty, lock, fired, switched, io, label, recover,
    base: base !== 'auto' ? base : switched ? (await cleanAt(t0, S0, FILE_B)).snap() : S0 };
}
async function fix(r, me = KIM){
  if (r.lock) clock.t += P.SGB_LOCK_MS + 1000;                    // 닫힌 창의 잠금이 묵기를 기다린다
  const before = r.db.commits.length;
  const { p } = run(r.db, r.recover, { me, name: 'R' });
  const res = await ok(p);
  const want = await clean(r.base, r.recover, me);
  return { res, d: diff(r.db, want), left: ['saenggibu/dirty', 'saenggibu/lock'].filter(k => r.db.docs.has(k)),
    writes: dataWrites(r.db, 'R', before) };
}
const isDataCommit = ev => ev.k === 'commit' && ev.writes.some(w => w.startsWith('s:') && isData(w.slice(2)));
const isDelCommit = ev => ev.k === 'commit' && ev.writes.some(w => w.startsWith('d:') && isData(w.slice(2)));
const cases = [
  ['표시 저장 직후(첫 자료 쓰기 전)', (ev, n) => isDataCommit(ev) && (cut.first = (cut.first || 0) + 1) === 1],
  ['쓰기 도중(학생·조각 일부만 들어감)', ev => isDataCommit(ev) && (cut.w = (cut.w || 0) + 1) === 3],
  ['바꿔 달기 직전(자료는 다 썼고 목록은 옛것)', ev => ev.k === 'commit' && ev.writes.includes('s:saenggibu/meta')],
  ['지우기 도중(목록은 새것, 옛 조각 일부 남음)', ev => isDelCommit(ev) && (cut.d = (cut.d || 0) + 1) === 2],
  ['마무리 직전(정리까지 끝, 표시만 남음)', ev => ev.k === 'commit' && ev.writes.includes('d:saenggibu/dirty')],
];
for (const [label, hit] of cases){
  cut.first = cut.w = cut.d = 0;
  const r = await cut(label, hit);
  const phase = r.dirty?.phase;
  const early = !r.switched;
  check(`${label} — 끊긴 뒤: 표시 남음(${early ? '쓰기' : '정리'} 단계) · 잠금은 풀림 · 화면 알림 ${early ? '「끝나지 않음」' : '없음(자료는 맞음)'}`
    + (early ? ' · 올리기는 실패로' : ' · 올리기는 「올렸습니다」(정리만 덜 끝남)'),
    r.fired && (early ? !!r.err : r.res?.tidy === false && !!r.res.tidyErr) && phase === (early ? 'write' : 'clean') && !r.lock
    && P.sgbDirtyState(r.dirty, r.lock, clock.t) === (early ? 'broken' : ''), { fired: r.fired, err: r.err?.message, res: r.res, phase, lock: r.lock, switched: r.switched });
  if (label.startsWith('쓰기 도중')){
    const stu = [...r.db.docs.keys()].filter(k => k.startsWith('saenggibuStu/'));
    const mixed = stu.filter(k => P.sgbCanon(r.db.get(k)) !== P.sgbCanon(new FakeDb(S0).get(k)));
    check('— (재현) 이때 학생 문서 일부만 새것 — 섞인 상태', mixed.length > 0 && mixed.length < stu.length, [mixed.length, stu.length]);
    // 예전처럼 표시 없이(지문 목록만 믿고) 옛 파일을 다시 올리면 — 섞인 채 남는다(검사가 실제로 잡는지 대조)
    const ctl = new FakeDb(r.db.snap()); ctl.del('saenggibu/dirty');
    await ok(run(ctl, FILE_A, { name: 'ctl' }).p);
    const dc = diff(ctl, await clean(S0, FILE_A));
    check('— (대조) 표시가 없다면 옛 파일을 다시 올려도 섞인 문서가 그대로 남는다 — 예전 버그', dc.length > 0, dc.length);
  }
  const f = await fix(r);
  check(`${label} — 옛 파일(A)을 다시 올리면 바로잡힌다: 끊김 없이 올린 것과 문서가 같고, 표시·잠금이 안 남는다`,
    f.res.recovered && f.d.length === 0 && !f.left.length && f.res.tidy, { d: f.d.slice(0, 8), left: f.left, res: f.res });
}

console.log('\n[단계마다 끊기 — 창을 닫음(잠금이 남아 5분 뒤에 이어받는다)]');
for (const [label, hit] of cases.slice(1, 4)){
  cut.first = cut.w = cut.d = 0;
  const r = await cut(label, hit, { crash: true, recover: FILE_C });
  check(`${label} — 창이 닫힘: 잠금·표시가 남는다`, r.fired && !!r.lock && !!r.dirty, { lock: r.lock, dirty: r.dirty });
  const blocked = await run(r.db, FILE_C, { me: LEE, name: 'X' }).p.then(() => null, e => e);
  check('— 5분이 지나기 전에는 다른 선생님도 막힌다(아무것도 안 씀)', blocked?.busy === true && blocked.message.includes('kim 선생님이 올리는 중'), blocked?.message);
  const f = await fix(r, LEE);
  check(`${label} — 5분 뒤 다른 부서(이 선생님)가 자기 시트만 올려도 바로잡힌다(남긴 기존 활동 포함)`,
    f.res.recovered && f.d.length === 0 && !f.left.length, { d: f.d.slice(0, 8), left: f.left });
}

console.log('\n[실패가 겹침 — A→B 연달아 끊김]');
{
  const db = new FakeDb(S0);
  // B: 김 선생님이 독서 토론을 고쳐 올리다 쓰기 도중 창을 닫음
  const fmtCommit = ev => ev.k === 'commit' && ev.writes.some(w => w.startsWith('s:saenggibu/fmt-'));
  const b1 = run(db, FILE_B, { name: 'B', on: (ev, io) => { if (fmtCommit(ev)) io.kill(); } });   // 조각은 다 쓰고 양식 차례에 닫힘
  b1.p.catch(() => {}); for (let i = 0; i < 50; i++) await settle();
  const afterB = [...db.docs.keys()].filter(isData).length;
  // C: 5분 뒤 이 선생님이 자기 시트를 올리는데, 서버 확인을 마치고 쓰기 도중 또 끊김(오류)
  clock.t += P.SGB_LOCK_MS + 1000;
  let seenAct = false;
  const c1 = run(db, FILE_C, { me: LEE, name: 'C1', txOps: 1, on: ev => {
    if (!isDataCommit(ev)) return;
    if (seenAct) throw new Error('또 끊김(검사)');                  // 새 활동 조각이 들어간 바로 다음 저장에서
    if (ev.writes.some(w => w.startsWith('s:saenggibuAct/'))) seenAct = true; } });
  const e2 = await c1.p.then(() => null, e => e);
  const dirty2 = db.get('saenggibu/dirty');
  check('두 번째 올리기도 끊김 — 표시는 두 번째 작업 것으로 남고(쓰기 단계) 잠금은 풀림', !!e2 && dirty2?.phase === 'write'
    && dirty2.by === LEE && !db.get('saenggibu/lock'), { e: e2?.message, dirty2 });
  const metaNow = db.get('saenggibu/meta');
  const ownerOf = k => [...metaNow.activities].find(a => k.startsWith(`saenggibuAct/${a.id}.`))?.title || '새 활동';
  const orphan = [...db.docs.keys()].filter(k => k.startsWith('saenggibuAct/') && !new FakeDb(S0).docs.has(k));
  const owners = [...new Set(orphan.map(ownerOf))];
  check('— (재현) 두 번의 실패가 각자 새 이름 조각을 남겨 둠(B 의 독서 토론 새 판 · C 의 탐구 발표)', owners.includes('독서 토론') && owners.includes('새 활동') && afterB > 0, owners);
  // 세 번째: 이 선생님이 같은 파일을 다시 — 이번엔 끝까지
  const before = db.commits.length;
  const res = await ok(run(db, FILE_C, { me: LEE, name: 'C2' }).p);
  const want = await clean(S0, FILE_C, LEE);
  const d = diff(db, want);
  check('세 번째에 끝까지 — 앞선 두 실패의 조각까지 지우고, 끊김 없이 올린 것과 문서가 같다', res.recovered && d.length === 0
    && !db.docs.has('saenggibu/dirty') && !db.docs.has('saenggibu/lock'), { d: d.slice(0, 8), res });
  check('— 독서 토론은 옛 판(A) 그대로 — 끊긴 B 의 문안이 남지 않음', new FakeDb(want.snap()).get('saenggibuStu/1-1-1').items.some(i => (i.b || '').includes('근거를 들어'))
    && !(db.get('saenggibuStu/1-1-1').items.some(i => (i.b || '').includes('사회를 맡아'))));
  check('— 바로잡을 때 쓴 문서는 실제로 다른 것만(서버 문서와 맞대서)', dataWrites(db, 'C2', before).filter(w => w.startsWith('s:')).length
    < [...want.docs.keys()].filter(isData).length, dataWrites(db, 'C2', before).length);
}

console.log('\n[서버를 다 못 읽으면 — 복구한 것으로 치지 않는다]');
{
  cut.first = cut.w = cut.d = 0;
  const r = await cut('쓰기 도중', ev => isDataCommit(ev) && (cut.w = (cut.w || 0) + 1) === 3);
  const snap0 = P.sgbCanon(r.db.snap()), commits0 = r.db.commits.length;
  for (const c of ['saenggibuStu', 'saenggibuAct', 'saenggibu']){
    const e = await run(r.db, FILE_A, { name: 'S', on: ev => { if (ev.k === 'scan' && ev.c === c) throw new Error('읽다가 끊김'); } }).p.then(() => null, e => e);
    const left = r.db.get('saenggibu/dirty');
    check(`${c} 를 읽다 끊김 — 멈추고, 자료는 하나도 안 바꾸고, 표시는 그대로(다음에 다시)`, e?.scan === true
      && e.message.includes('복구를 멈췄습니다') && dataWrites(r.db, 'S', commits0).length === 0
      && left?.phase === 'write' && !r.db.get('saenggibu/lock'), { e: e?.message, left });
  }
  // 덜 읽힘 — 오류는 안 났는데 서버 목록에 방금 읽은 남길 자료가 빠져 있다(캐시만 읽힌 것 등)
  const e = await (async () => {
    const io = makeIo(r.db, { me: LEE, name: 'S2' });
    const scan = io.scan;
    io.scan = async c => (await scan(c)).filter(([id]) => c !== 'saenggibuAct' || !id.includes('-1-0'));
    return P.sgbCommitCore(io, planFor(FILE_C, r.db.get('saenggibu/meta'), LEE)).then(() => null, e => e);
  })();
  check('서버 목록이 덜 읽힘(있어야 할 남길 자료가 목록에 없음) — 멈추고 아무것도 안 바꾼다', e?.scan === true
    && dataWrites(r.db, 'S2', commits0).length === 0 && r.db.get('saenggibu/dirty')?.phase === 'write', e?.message);
  check('— 그동안 저장된 문서가 처음 끊긴 상태 그대로', P.sgbCanon(Object.fromEntries(Object.entries(r.db.snap()).filter(([k]) => isData(k))))
    === P.sgbCanon(Object.fromEntries(Object.entries(JSON.parse(snap0)).filter(([k]) => isData(k)))));
  const f = await fix(r);
  check('— 다시 올려 다 읽히면 그때 바로잡는다', f.res.recovered && f.d.length === 0 && !f.left.length, f.d.slice(0, 5));
}

// ── ② 같은 계정 두 창 ──
console.log('\n[같은 계정 두 창]');
{
  const db = new FakeDb(S0);
  const w1 = run(db, FILE_B, { name: 'W1' }), w2 = run(db, FILE_B, { name: 'W2' });
  const [r1, r2] = await Promise.allSettled([w1.p, w2.p]);
  const ok = [r1, r2].filter(r => r.status === 'fulfilled'), bad = [r1, r2].filter(r => r.status === 'rejected');
  check('동시에 눌러도 한 창만 들어간다 — 다른 창은 「이 계정의 다른 창에서 올리는 중」', ok.length === 1 && bad.length === 1
    && bad[0].reason.busy === true && bad[0].reason.message.includes('이 계정의 다른 창'), [r1.status, r2.status, bad[0]?.reason?.message]);
  const loser = r1.status === 'rejected' ? 'W1' : 'W2';
  check('— 막힌 창은 자료를 하나도 안 썼고, 결과는 한 번 올린 것과 같다', dataWrites(db, loser).length === 0
    && diff(db, await clean(S0, FILE_B)).length === 0 && !db.docs.has('saenggibu/lock') && !db.docs.has('saenggibu/dirty'));
}
{
  const db = new FakeDb(S0);
  const g = gate();
  let n = 0;
  const w1 = run(db, FILE_B, { name: 'W1', on: async ev => { if (isDataCommit(ev) && ++n === 2) await g; } });
  for (let i = 0; i < 50; i++) await settle();
  const e = await run(db, FILE_C, { name: 'W2' }).p.then(() => null, e => e);
  check('한 창이 쓰는 도중에 같은 계정 다른 창이 올리면 — 막고 아무것도 안 쓴다', e?.busy === true && dataWrites(db, 'W2').length === 0, e?.message);
  const lockBefore = db.get('saenggibu/lock');
  g.open();
  const res = await ok(w1.p);
  check('— 앞 창은 그대로 끝까지(막힌 창이 잠금을 지우지 않음)', !!lockBefore && lockBefore.id.startsWith('W1') && res.tidy
    && diff(db, await clean(S0, FILE_B)).length === 0 && !db.docs.has('saenggibu/lock'));
}

// ── ③ 잠금이 묵은 뒤 옛 창이 깨어남 ──
console.log('\n[잠금 만료 뒤 옛 창이 다시 저장하려 함]');
{
  // W1(김, 노트북 덮개 닫힘): 쓰기 두 번째 묶음 직전에 멈춤 → 6분 → W2(이)가 이어받아 끝까지 → W1 깨어남
  const db = new FakeDb(S0);
  const g = gate();
  let n = 0;
  const w1 = run(db, FILE_B, { name: 'W1', on: async ev => { if (isDataCommit(ev) && ++n === 2) await g; } });
  for (let i = 0; i < 50; i++) await settle();
  const w1Writes = dataWrites(db, 'W1').length;
  clock.t += 6 * 60 * 1000;
  const r2 = await ok(run(db, FILE_C, { me: LEE, name: 'W2' }).p);
  const c0 = db.commits.length;
  const snapW2 = P.sgbCanon(db.snap());
  g.open();
  const e1 = await w1.p.then(() => null, e => e);
  check('W2 가 이어받아 끝까지(멈춘 W1 의 반쪽 자료도 서버 확인으로 정리)', r2.recovered && r2.tidy
    && diff(db, await clean(S0, FILE_C, LEE)).length === 0, r2);
  check('W1 이 깨어나면 다음 저장에서 멈춘다 — 「잠금을 이어받아 여기서 멈췄습니다」', e1?.lost === true && e1.message.includes('이어받아'), e1?.message);
  check('— 깨어난 W1 은 아무것도 더 쓰지 않았다(잠금도 표시도 안 건드림)', db.commits.slice(c0).length === 0
    && P.sgbCanon(db.snap()) === snapW2 && w1Writes > 0, db.commits.slice(c0));
}
{
  // 트랜잭션 안에서 멈춤 — W1 이 잠금을 읽어 「내 것 · 유효」 를 확인한 뒤, 저장(commit) 직전에 멈춤.
  // 그사이 잠금이 묵어 W2 가 가져가 끝까지 올림 → W1 이 깨어나 저장하면? 읽은 잠금이 바뀌어 다시 돌고, 다시 읽으니 남의 것 → 멈춤
  const db = new FakeDb(S0);
  const g = gate();
  let n = 0;
  const w1 = run(db, FILE_B, { name: 'W1', on: async ev => { if (isDataCommit(ev) && ++n === 2) await g; } });
  for (let i = 0; i < 50; i++) await settle();
  clock.t += 6 * 60 * 1000;
  await ok(run(db, FILE_C, { me: KIM, name: 'W2' }).p);             // 같은 계정의 다른 창이 이어받음
  const c0 = db.commits.length, r0 = db.retries;
  g.open();
  const e1 = await w1.p.then(() => null, e => e);
  check('저장 직전에 멈췄던 창 — 깨어나 저장해도 들어가지 않는다(읽은 잠금이 바뀌어 다시 확인 → 멈춤)', e1?.lost === true
    && db.commits.slice(c0).length === 0 && db.retries > r0, { e: e1?.message, retries: db.retries - r0 });
  check('— 결과는 이어받은 창이 올린 그대로', diff(db, await clean(S0, FILE_C, KIM)).length === 0);
}
{
  // 깨어난 창이 끝나면서(finally) 잠금을 풀 때 — 지금 쥔 것이 남(W2)이면 건드리지 않는다
  const db = new FakeDb(S0);
  const g1 = gate(), g2 = gate();
  let n1 = 0, n2 = 0;
  const w1 = run(db, FILE_B, { name: 'W1', on: async ev => { if (isDataCommit(ev) && ++n1 === 2) await g1; } });
  for (let i = 0; i < 50; i++) await settle();
  clock.t += 6 * 60 * 1000;
  const t2 = clock.t;
  const w2 = run(db, FILE_C, { me: LEE, name: 'W2', on: async ev => { if (isDataCommit(ev) && ++n2 === 1) await g2; } });
  for (let i = 0; i < 50; i++) await settle();
  const held = db.get('saenggibu/lock');
  g1.open();
  const e1 = await w1.p.then(() => null, e => e);
  const still = db.get('saenggibu/lock');
  check('W2 가 쓰는 도중에 W1 이 깨어나 멈춤 — W1 은 W2 의 잠금을 지우지 않는다', e1?.lost === true && held?.id?.startsWith('W2')
    && still?.id === held.id, { e: e1?.message, held, still });
  g2.open();
  const r2 = await ok(w2.p);
  check('— W2 는 그대로 끝까지 · 결과는 W2 가 혼자 올린 것과 같다', r2.recovered && r2.tidy
    && diff(db, await cleanAt(t2, S0, FILE_C, LEE)).length === 0, r2);
}
{
  // 아무도 안 가져갔어도 — 멈춘 사이 잠금이 묵었으면 깨어난 창은 멈춘다(표시가 남아 다음 올리기가 바로잡는다)
  const db = new FakeDb(S0);
  const g = gate();
  let n = 0;
  const w1 = run(db, FILE_B, { name: 'W1', on: async ev => { if (isDataCommit(ev) && ++n === 2) await g; } });
  for (let i = 0; i < 50; i++) await settle();
  clock.t += 6 * 60 * 1000;
  const c0 = db.commits.length;
  g.open();
  const e1 = await w1.p.then(() => null, e => e);
  const dirty = db.get('saenggibu/dirty');
  const after = db.commits.slice(c0).filter(c => c.who === 'W1' && c.writes.some(w => isData(w.slice(2))));
  check('멈춘 사이 잠금이 묵음(아무도 안 가져감) — 깨어난 창은 하던 묶음 하나만 들어가고(잠금 문서가 그대로라 충돌 없음) 그다음 저장에서 「잠금 시간이 지나」 멈춘다',
    e1?.lost === true && e1.message.includes('잠금 시간이 지나') && after.length <= 1, { e: e1?.message, after: after.length });
  check('— 자기 잠금은 풀고, 표시는 남겨 「끝나지 않음」 으로 알린다', !db.get('saenggibu/lock') && dirty?.phase === 'write'
    && P.sgbDirtyState(dirty, null, clock.t) === 'broken');
  const f = await fix({ db, lock: null, recover: FILE_B, base: S0 });
  check('— 다시 올리면(같은 B) 끝까지 · 끊김 없이 올린 것과 같다', f.res.recovered && f.d.length === 0 && !f.left.length, f.d.slice(0, 5));
}
{
  // 오래 걸리는 올리기 — 1분마다 잠금 시각을 늘려 두면 5분이 넘어도 계속 쓴다(묵은 잠금으로 오해받지 않음)
  const db = new FakeDb(S0);
  const g = gate(), t0 = clock.t;
  let n = 0;
  const w1 = run(db, FILE_B, { name: 'W1', beat: true, on: async ev => { if (isDataCommit(ev) && ++n === 2) await g; } });
  for (let i = 0; i < 50; i++) await settle();
  for (let m = 0; m < 7; m++){ clock.t += 60 * 1000; await w1.io.beat(); }      // 7분 동안 1분마다
  const e = await run(db, FILE_C, { me: LEE, name: 'W2' }).p.then(() => null, e => e);
  check('7분째에도 잠금이 살아 있어 다른 선생님은 막힌다(1분마다 시각을 늘림)', e?.busy === true, e?.message);
  g.open();
  const res = await ok(w1.p);
  const d = diff(db, await cleanAt(t0, S0, FILE_B));
  check('— 앞 창은 끝까지 올라간다(1분마다 늘린 잠금 시각 때문에 하던 저장이 한 번 다시 돌 뿐)', res.tidy && d.length === 0, { d, res });
}

// ── 잠금을 지키는 단계 — 모든 저장(쓰기·지우기·목록·지문·표시·기록)이 잠금 확인 트랜잭션 안에서 ──
console.log('\n[모든 저장이 잠금을 확인한다]');
{
  const db = new FakeDb(S0);
  const reads = [];
  await ok(run(db, FILE_B, { name: 'W', on: ev => { if (ev.k === 'txget') reads.push(ev.p); if (ev.k === 'commit') reads.push('|'); } }).p);
  // 트랜잭션마다 첫 읽기가 잠금인지
  const txs = reads.join(',').split('|').map(s => s.split(',').filter(Boolean));
  const kinds = db.commits.filter(c => c.who === 'W').map(c => c.writes);
  check('저장 트랜잭션은 모두 잠금을 먼저 읽는다(쓰기·지우기·목록·마무리)', txs.slice(0, -1).every(t => t[0] === 'saenggibu/lock'), txs.slice(0, 6));
  check('목록·지문·표시(정리 단계)가 한 트랜잭션에', kinds.some(w => w.includes('s:saenggibu/meta') && w.includes('s:saenggibu/manifest') && w.includes('s:saenggibu/dirty')));
  check('표시 지우기·기록·잠금 풀기가 한 트랜잭션에(마지막)', (() => { const l = kinds.at(-1);
    return l.includes('d:saenggibu/dirty') && l.includes('s:saenggibu/log') && l.includes('d:saenggibu/lock'); })(), kinds.at(-1));
  check('자료 쓰기 전에 표시(쓰기 단계)가 먼저 저장된다', (() => { const i = kinds.findIndex(w => w.some(x => x.startsWith('s:') && isData(x.slice(2))));
    return i > 0 && kinds.slice(0, i).some(w => w.includes('s:saenggibu/dirty')); })());
  check('옛 조각 지우기는 목록을 바꿔 단 뒤에', (() => { const sw = kinds.findIndex(w => w.includes('s:saenggibu/meta'));
    const de = kinds.findIndex(w => w.some(x => x.startsWith('d:') && isData(x.slice(2)))); return sw >= 0 && de > sw; })());
}
{
  // 목록 고치기(관리)도 같은 잠금 — 올리는 중이면 막힌다
  const db = new FakeDb(S0);
  const g = gate();
  let n = 0;
  const w1 = run(db, FILE_B, { name: 'W1', on: async ev => { if (isDataCommit(ev) && ++n === 1) await g; } });
  for (let i = 0; i < 50; i++) await settle();
  const e = await P.sgbMetaPatchCore(makeIo(db, { me: KIM, name: 'M' }), m => { m.activities[0].fix = { title: '고침' }; }, { fixed: 'x' }).then(() => null, e => e);
  check('목록 고치기 — 같은 계정 다른 창이 올리는 중이면 막힌다', e?.busy === true, e?.message);
  g.open(); await ok(w1.p);
  await P.sgbMetaPatchCore(makeIo(db, { me: KIM, name: 'M2' }), m => { m.activities[0].fix = { title: '고침' }; }, { fixed: 'x' });
  check('— 끝난 뒤에는 고쳐지고, 기록·잠금 풀기까지 한 번에', db.get('saenggibu/meta').activities[0].fix?.title === '고침'
    && db.get('saenggibu/log').items[0].fixed === 'x' && !db.docs.has('saenggibu/lock'));
}
{
  // 남의 잠금을 지우지 않는다 — 막힌 창이 끝날 때(finally) 잠금을 안 건드리는지
  const db = new FakeDb({ ...S0, 'saenggibu/lock': { id: 'other-op', by: LEE, at: new Date(clock.t).toISOString() } });
  const e = await run(db, FILE_B, { name: 'W' }).p.then(() => null, e => e);
  check('다른 선생님 잠금이 있으면 막히고, 그 잠금은 그대로 둔다', e?.busy === true && db.get('saenggibu/lock')?.id === 'other-op', e?.message);
  // 예전 앱의 잠금(id 없이 by·at 만) — 같은 계정이라도 막는다(예전 앱이 아직 열려 있을 수 있다)
  const db2 = new FakeDb({ ...S0, 'saenggibu/lock': { by: KIM, at: new Date(clock.t).toISOString() } });
  const e2 = await run(db2, FILE_B, { name: 'W' }).p.then(() => null, e => e);
  check('예전 앱이 건 잠금(id 없음)도 살아 있으면 막는다 — 같은 계정이어도', e2?.busy === true && db2.get('saenggibu/lock')?.by === KIM, e2?.message);
}

// ── 화면 알림 판정 ──
console.log('\n[화면 알림]');
{
  const d = { id: 'op1', by: KIM, at: '2026-10-31T05:00:00.000Z', phase: 'write' };
  const alive = { id: 'op1', by: KIM, at: new Date(clock.t).toISOString() };
  check('쓰는 중 + 그 작업의 잠금이 살아 있음 → 「올리는 중」', P.sgbDirtyState(d, alive, clock.t) === 'busy');
  check('쓰는 중 표시인데 잠금이 없음 → 「끝나지 않음」', P.sgbDirtyState(d, null, clock.t) === 'broken');
  check('쓰는 중 표시인데 잠금이 묵음 → 「끝나지 않음」', P.sgbDirtyState(d, { ...alive, at: new Date(clock.t - P.SGB_LOCK_MS - 1).toISOString() }, clock.t) === 'broken');
  check('쓰는 중 표시인데 다른 작업이 잠금을 가짐(복구 중) → 「끝나지 않음」', P.sgbDirtyState(d, { ...alive, id: 'op2' }, clock.t) === 'broken');
  check('정리 단계 → 알리지 않음(자료는 이미 맞다)', P.sgbDirtyState({ ...d, phase: 'clean' }, null, clock.t) === '');
  check('표시 없음 → 알리지 않음', P.sgbDirtyState(null, alive, clock.t) === '');
}

console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
