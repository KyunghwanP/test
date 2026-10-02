// 초과근무 워커(workers/overtime-api.js) — 구글 없이 돌려 본다.
//
// 워커는 gas/overtime/Code.gs 를 그대로 품고, 시트 읽기·쓰기만 구글 시트 API 로 바꿔 끼운다.
// 그래서 가장 강한 검사는 '같은 일을 Apps Script 와 워커에 똑같이 시키고 시트가 칸 하나까지
// 같은지' 보는 것이다(비교 검사). 그 밖에 워커에만 있는 것 — 잠금, 보기 요청은 안 쓰는 것,
// 쓰기에 실패하면 메일도 안 나가는 것, 크론 — 을 따로 본다.
//
// 가짜 구글: 시트 API 는 overtime-fake.mjs 의 가짜 시트 위에서 돈다(batchGet·batchUpdate).
// batchUpdate 는 실제처럼 전부 반영되거나 하나도 안 된다.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { makeGas } from './overtime-fake.mjs';
import { buildOvertime } from '../workers/build-overtime.mjs';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 500) : ''));

console.log('\n■ 배포본');
const built = fs.readFileSync(new URL('../workers/overtime-api.js', import.meta.url), 'utf8');
check('배포본이 지금 Code.gs 로 만든 것과 같다 (빌드를 잊지 않았다)', built === buildOvertime());
check('배포본에 비밀값이 없다', !/BEGIN PRIVATE KEY|MAIL_SECRET\s*=\s*['"]/.test(built));
const worker = (await import('../workers/overtime-api.js')).default;

// ── 가짜 구글 ──────────────────────────────────────────────────────────────
const D = l => l + '@yeungnam.hs.kr';
const OP = D('pkh910518'), VP = D('vp'), PR = D('pr'), P1 = D('p1'), P2 = D('p2');
const KIM = D('kim'), LEE = D('lee'), PARK = D('park'), JUNG = D('jung'), HAN = D('han'), OH = D('oh'),
      YOON = D('yoon'), JANG = D('jang'), LIM = D('lim');
const people = { [OP]: { displayName: '박경환' } };
const GA = makeGas({ people });       // Apps Script 로 돌리는 쪽
const GW = makeGas({ people });       // 워커가 쓰는 시트(가짜 구글 시트 API 뒤)
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'overtime@ynhs-7b5ba.iam.gserviceaccount.com', project_id: 'ynhs-7b5ba',
             private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
let clock = new Date('2026-10-05T09:00:00+09:00');
const env = { SA_JSON: JSON.stringify(SA), SHEET_ID: 'SHEET-ID-1', MAILER_URL: 'https://script.google.com/macros/s/MAILER/exec',
              MAIL_SECRET: 'm'.repeat(32), ALLOWED_ORIGINS: 'https://kyunghwanp.github.io/', TEST_NOW: () => new Date(clock.getTime()) };
const setNow = iso => { clock = new Date(iso); GA.setNow(iso); };

const stats = { token: 0, lookup: 0, meta: 0, batchGet: 0, batchUpdate: 0, lockCreate: 0, lockHeld: 0, lockMax: 0, mailCalls: 0 };
const relayed = [];
const docs = new Map();
let stamp = 0, failUpdates = 0, sheet403 = false, emptyStrings = 0;
const ids = new WeakMap(); let nextId = 100;
const sid = sh => { if (!ids.has(sh)) ids.set(sh, nextId++); return ids.get(sh); };
const hex = c => c ? '#' + ['red', 'green', 'blue'].map(k => Math.round((c[k] || 0) * 255).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
const reply = (status, obj) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

function sheetsBatchUpdate(body) {
  const ss = GW.ss;
  // 전부 아니면 전무 — 칸을 통째로 복사해 두었다가 실패하면 되돌린다
  const snap = ss.sheets.map(s => ({ s, cells: new Map([...s.cells].map(([k, v]) => [k, { ...v }])), maxRows: s.maxRows }));
  try {
    for (const rq of body.requests) {
      const k = Object.keys(rq)[0], q = rq[k];
      const sh = ss.sheets.find(s => sid(s) === (q.sheetId ?? (q.range && q.range.sheetId)));
      if (!sh) throw new Error('없는 시트');
      if (k === 'appendDimension') { sh.maxRows += q.length; continue; }
      if (k === 'updateCells') {
        const r = q.range;
        if (r.endRowIndex > sh.maxRows || r.endColumnIndex > sh.maxCols) throw new Error('grid limits');
        const f = q.fields.split(',');
        q.rows.forEach((row, i) => row.values.forEach((cd, j) => {
          const c = sh.cell(r.startRowIndex + 1 + i, r.startColumnIndex + 1 + j, true);
          if (cd.userEnteredValue && 'formulaValue' in cd.userEnteredValue) ss.formulas.push(cd.userEnteredValue.formulaValue);
          if (cd.userEnteredValue && cd.userEnteredValue.stringValue === '') emptyStrings++;
          if (f.includes('userEnteredValue')) c.v = (cd.userEnteredValue && cd.userEnteredValue.stringValue) || '';
          if (f.includes('userEnteredFormat.backgroundColor')) c.bg = hex(cd.userEnteredFormat && cd.userEnteredFormat.backgroundColor);
          if (f.includes('note')) c.note = cd.note || '';
        }));
        continue;
      }
      if (k === 'appendCells') {
        let last = sh.getLastRow();
        q.rows.forEach(row => { last++; if (last > sh.maxRows) sh.maxRows = last;
          row.values.forEach((cd, j) => { sh.cell(last, j + 1, true).v = (cd.userEnteredValue && cd.userEnteredValue.stringValue) || ''; }); });
        continue;
      }
      throw new Error('모르는 요청 ' + k);
    }
  } catch (e) {
    snap.forEach(x => { x.s.cells = x.cells; x.s.maxRows = x.maxRows; });
    return reply(400, { error: { message: e.message } });
  }
  return reply(200, { replies: [] });
}

globalThis.fetch = async (input, opt = {}) => {
  await new Promise(r => setTimeout(r, 1 + Math.random() * 4));     // 요청이 서로 엇갈리게
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (opt.method || 'GET').toUpperCase();
  const body = opt.body;
  if (url.host === 'oauth2.googleapis.com') { stats.token++; return reply(200, { access_token: 'AT', expires_in: 3600 }); }
  if (url.host === 'identitytoolkit.googleapis.com') {
    stats.lookup++;
    const m = /^tok:(.+)$/.exec(JSON.parse(body).idToken);
    if (!m) return reply(400, { error: { message: 'INVALID_ID_TOKEN' } });
    return reply(200, { users: [{ email: m[1], emailVerified: true, displayName: (people[m[1]] || {}).displayName || '' }] });
  }
  if (url.host === 'sheets.googleapis.com') {
    if (sheet403) return reply(403, { error: { message: 'The caller does not have permission' } });
    const ss = GW.ss;
    if (url.pathname.endsWith(':batchUpdate')) {
      stats.batchUpdate++;
      if (failUpdates > 0) { failUpdates--; return reply(500, { error: { message: 'backend' } }); }
      return sheetsBatchUpdate(JSON.parse(body));
    }
    if (url.pathname.endsWith('/values:batchGet')) {
      stats.batchGet++;
      const ranges = url.searchParams.getAll('ranges').map(r => r.replace(/^'|'$/g, '').replace(/''/g, "'"));
      const out = [];
      for (const t of ranges) {
        const sh = ss.getSheetByName(t);
        if (!sh) return reply(400, { error: { message: `Unable to parse range: ${t}` } });
        const vals = [];
        for (let r = 1; r <= sh.getLastRow(); r++) {
          const row = []; for (let c = 1; c <= sh.maxCols; c++) row.push(sh.cell(r, c) ? String(sh.cell(r, c).v) : '');
          while (row.length && row[row.length - 1] === '') row.pop();
          vals.push(row);
        }
        out.push(vals.length ? { range: t, values: vals } : { range: t });
      }
      return reply(200, { valueRanges: out });
    }
    stats.meta++;
    return reply(200, { spreadsheetUrl: ss.getUrl(), sheets: ss.sheets.map(s => ({ properties: {
      sheetId: sid(s), title: s.name, gridProperties: { rowCount: s.maxRows, columnCount: s.maxCols } } })) });
  }
  if (url.host === 'firestore.googleapis.com') {
    const path = url.pathname.replace(/^.*\/documents\//, '');
    if (method === 'POST') {
      const name = path + '/' + url.searchParams.get('documentId');
      stats.lockCreate++;
      if (docs.has(name)) return reply(409, { error: { status: 'ALREADY_EXISTS' } });
      const doc = { fields: JSON.parse(body).fields, updateTime: 't' + (++stamp) };
      docs.set(name, doc); stats.lockHeld++; stats.lockMax = Math.max(stats.lockMax, stats.lockHeld);
      return reply(200, doc);
    }
    if (method === 'GET') return docs.has(path) ? reply(200, docs.get(path)) : reply(404, {});
    if (method === 'DELETE') {
      const d = docs.get(path);
      if (!d || d.updateTime !== url.searchParams.get('currentDocument.updateTime')) return reply(400, { error: { status: 'FAILED_PRECONDITION' } });
      docs.delete(path); stats.lockHeld--;
      return reply(200, {});
    }
  }
  if (url.href === env.MAILER_URL) {
    stats.mailCalls++;
    const b = JSON.parse(body);
    if (b.secret !== env.MAIL_SECRET) return reply(200, { ok: false, error: 'AUTH' });
    b.mails.forEach(m => relayed.push(m));
    return reply(200, { ok: true, sent: b.mails.length });
  }
  throw new Error('예상 밖 요청: ' + method + ' ' + url.href);
};

// 워커 부르기 — 뒤에서 하는 일(잠금 풀기·메일)까지 끝난 뒤에 돌려준다
async function wpost(body, origin = 'https://kyunghwanp.github.io') {
  const pending = [];
  const res = await worker.fetch(new Request('https://overtime-api.example.workers.dev/', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }),
    env, { waitUntil: p => pending.push(p) });
  await Promise.all(pending);
  return { res, json: await res.json() };
}
const wcall = async (email, action, params = {}) => (await wpost(Object.assign({ action, idToken: 'tok:' + email }, params))).json;
async function wcron(cron) { const pending = []; await worker.scheduled({ cron }, env, { waitUntil: p => pending.push(p) }); await Promise.all(pending); }

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 입구');
let r = await wpost({ action: 'ping' });
check('ping — 워커가 답한다', r.json.ok && r.json.via === 'worker' && r.res.headers.get('Access-Control-Allow-Origin') === 'https://kyunghwanp.github.io');
r = await wpost({ action: 'ping' }, 'https://evil.example.com');
check('허용 안 된 출처는 막는다', r.json.error === 'ORIGIN' && r.res.headers.get('Access-Control-Allow-Origin') === 'null');
const pre = await worker.fetch(new Request('https://x/', { method: 'OPTIONS', headers: { Origin: 'https://kyunghwanp.github.io' } }), env, { waitUntil() {} });
check('사전 요청(OPTIONS)에도 답한다', pre.status === 204);
check('메일 중계는 워커 입구로 못 부른다', (await wcall(OP, 'mail', { secret: env.MAIL_SECRET })).error === 'ACTION');
check('엉터리 토큰 → AUTH', (await wpost({ action: 'me', idToken: 'x'.repeat(40) })).json.error === 'AUTH');
check('탭이 없으면(setup 전) 그렇다고 알려 준다', /setup/.test((await wcall(OP, 'me')).msg));
sheet403 = true;
check('시트를 못 열면 공유·API 를 확인하라고', /편집자로 공유/.test((await wcall(OP, 'me')).msg));
sheet403 = false;

// ── 두 시트를 똑같이 준비 ──
for (const G of [GA, GW]) {
  G.setup();
  G.setCfg('승인 (관리자)', '정교감'); G.setCfg('보기 (관리자)', PR); G.setCfg('1학년 기획 담당', '김일기');
  G.setCfg('2학년 기획 담당', P2); G.setCfg('운영 담당', OP); G.setCfg('메일 알림', '켬');
}
const ROSTER = [['박경환', '교무기획부', OP], ['정교감', '교감', VP], ['한교장', '교장', PR], ['김일기', '1학년부', P1],
  ['이이기', '2학년부', P2], ['김민수', '1학년부', KIM], ['이서연', '1학년부', LEE], ['박지훈', '2학년부', PARK],
  ['정하늘', '2학년부', JUNG], ['한도윤', '3학년부', HAN], ['오세린', '3학년부', OH], ['윤재현', '2학년부', YOON],
  ['장미래', '1학년부', JANG], ['임동건', '3학년부', LIM]].map(([name, dept, email]) => ({ name, dept, email }));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 비교 — 같은 일을 Apps Script 와 워커에 시키고 응답·시트·메일이 같은지');
const TABS = ['① 자율학습 감독', '② 기타 업무', '③ 통합조회', '교체·정정', '변경 이력', '설정', '교원 명렬', '감독 상세'];
const dump = G => TABS.map(t => { const sh = G.sheet(t); const rows = [];
  for (let r = 1; r <= sh.getLastRow(); r++) { const row = [];
    for (let c = 1; c <= sh.maxCols; c++) { const x = sh.cell(r, c); row.push([x ? x.v : '', x ? x.note || '' : '', x ? x.bg || null : null]); }
    rows.push(row); }
  return [t, rows]; });
const mailKey = m => [m.to, m.subject, m.body].join('¦');
let diffs = 0, steps = 0, mailA = 0, mailW = 0;
async function same(label, email, action, params) {
  steps++;
  const a = GA.call(email, action, params);
  const w = await wcall(email, action, params);
  const ja = JSON.stringify(a), jw = JSON.stringify(w);
  const da = JSON.stringify(dump(GA)), dw = JSON.stringify(dump(GW));
  const ma = GA.mails.slice(mailA).map(mailKey), mw = relayed.slice(mailW).map(mailKey);
  mailA = GA.mails.length; mailW = relayed.length;
  const ok = ja === jw && da === dw && JSON.stringify(ma) === JSON.stringify(mw);
  if (!ok) {
    diffs++;
    const where = ja !== jw ? ['응답', ja.slice(0, 300), jw.slice(0, 300)]
      : da !== dw ? ['시트', TABS.find((t, i) => JSON.stringify(dump(GA)[i]) !== JSON.stringify(dump(GW)[i]))]
      : ['메일', ma, mw];
    console.log('  ❌ 다름:', label, JSON.stringify(where).slice(0, 600));
  }
  return w;
}
await same('명렬 보내기', OP, 'roster', { rows: ROSTER });
await same('신청', KIM, 'submit', { date: '2026-10-08', band: '5시간 초과 ~ 6시간 이하', type: '상담', reason: '수시 원서 접수 전 학부모 상담 4건 (상담일지 작성)' });
await same('당일 신청 + 수식처럼 생긴 사유', LEE, 'submit', { date: '2026-10-05', band: '4시간 초과 ~ 5시간 이하', type: '기타', reason: '=IMPORTXML("http://x","//a") 자료 정리' });
await same('같은 날 또 신청 (거절)', KIM, 'submit', { date: '2026-10-08', band: '5시간 초과 ~ 6시간 이하', type: '상담', reason: '다시 내 보는 신청입니다' });
await same('관리자 목록', VP, 'adminList', {});
await same('승인', VP, 'decide', { id: 'R0001', decision: '승인' });
await same('반려', VP, 'decide', { id: 'R0002', decision: '반려', reason: '하는 일이 구체적이지 않습니다' });
await same('1학년 배정 미리보기', P1, 'assign', { grade: 1, text: '10/06\t김민수\t이서연\t장미래\n10/07\t이서연\t이서연\t없는이', dryRun: true });
await same('1학년 배정', P1, 'assign', { grade: 1, text: '10/06\t김민수\t이서연\t장미래\n10/07\t이서연\t장미래\t김민수\n10월 8일 (목)\t장미래\t\t김민수\n2026-10-12\t김민수\t장미래\t이서연\n10.9\t이서연\t김민수\t장미래' });
await same('2학년 배정', P2, 'assign', { grade: 2, text: '10/06\t박지훈\t정하늘\t윤재현\n10/07\t오세린\t정하늘\t박지훈\n10/13\t박지훈\t오세린\t정하늘' });
const ids0 = GA.call(JANG, 'me').state.staff;
const idOf = n => ids0.find(p => p.name === n).id;
check('명렬 번호(id)가 Apps Script 와 워커에서 같다 (SHA-256 직접 구현)', JSON.stringify((await wcall(JANG, 'me')).state.staff) === JSON.stringify(ids0));
await same('교체 요청', JANG, 'swapRequest', { slot: { date: '2026-10-06', g: 1, r: 3 }, to: idOf('한도윤'), reason: '가족 행사' });
await same('내 화면', HAN, 'me', {});
await same('교체 수락', HAN, 'respond', { id: 'S0001', accept: true });
await same('맞교환 요청', LEE, 'swapRequest', { slot: { date: '2026-10-12', g: 1, r: 3 }, mode: 'trade', to: idOf('오세린'), slot2: { date: '2026-10-13', g: 2, r: 2 } });
await same('맞교환 수락', OH, 'respond', { id: 'S0002', accept: true });
await same('거절될 요청', KIM, 'swapRequest', { slot: { date: '2026-10-09', g: 1, r: 2 }, to: idOf('임동건') });
await same('거절', LIM, 'respond', { id: 'S0003', accept: false });
await same('만료될 요청', KIM, 'swapRequest', { slot: { date: '2026-10-08', g: 1, r: 3 }, to: idOf('오세린'), reason: '출장' });
setNow('2026-10-08T18:31:00+09:00');
await same('기한 지난 뒤 수락 (만료)', OH, 'respond', { id: 'S0004', accept: true });
await same('긴급 교체', OH, 'emergency', { slot: { date: '2026-10-08', g: 1, r: 3 }, reason: '김민수 선생님 상고' });
setNow('2026-10-08T18:35:00+09:00');
await same('걸려 있게 될 요청', JANG, 'swapRequest', { slot: { date: '2026-10-09', g: 1, r: 3 }, to: idOf('임동건') });
await same('긴급 맞교환 (걸린 요청 자동 취소)', JUNG, 'emergency', { slot: { date: '2026-10-09', g: 1, r: 3 }, mode: 'trade', mySlot: { date: '2026-10-13', g: 2, r: 3 }, reason: '장미래 선생님 상고' });
await same('담당자 정정', P2, 'fix', { slot: { date: '2026-10-13', g: 2, r: 3 }, to: idOf('윤재현'), reason: '배정 실수 바로잡음' });
await same('관리자 정정 (비우기)', VP, 'fix', { slot: { date: '2026-10-09', g: 1, r: 1 }, to: '', reason: '그날 자율학습 없음' });
await same('감독표', P1, 'grid', { month: '2026-10' });
setNow('2026-10-14T08:00:00+09:00');
await same('사후 정정 요청', JANG, 'correct', { slot: { date: '2026-10-07', g: 1, r: 2 }, actual: idOf('임동건'), reason: '구두로 바꾸고 등록을 잊음' });
await same('사후 정정 확인', LIM, 'respond', { id: 'S0010', accept: true });
await same('승인된 신청 취소', KIM, 'cancel', { id: 'R0001' });
await same('설치 상태', OP, 'status', {});
await same('권한 없음', KIM, 'adminList', {});
check(`${steps}단계 모두 응답·시트(값·메모·색)·메일이 같다`, diffs === 0, diffs);

console.log('\n■ 시계 — Apps Script 의 tick 과 워커의 크론');
await same('16일 배정', P1, 'assign', { grade: 1, text: '10/16\t김민수\t이서연\t장미래' });
await same('만료될 요청 (16일)', JANG, 'swapRequest', { slot: { date: '2026-10-16', g: 1, r: 3 }, to: idOf('한도윤') });
await same('내일(17일) 근무 신청', KIM, 'submit', { date: '2026-10-17', band: '4시간 초과 ~ 5시간 이하', type: '상담', reason: '학부모 상담 일정 네 건' });
const sameNow = label => {
  const ok = JSON.stringify(dump(GA)) === JSON.stringify(dump(GW))
          && JSON.stringify(GA.mails.slice(mailA).map(mailKey)) === JSON.stringify(relayed.slice(mailW).map(mailKey));
  const got = relayed.slice(mailW);
  mailA = GA.mails.length; mailW = relayed.length;
  return { ok, got };
};
setNow('2026-10-16T16:00:00+09:00');
GA.props.set('REMINDED', '2026-10-16'); GA.tick();
await wcron('*/15 * * * *');
let t1 = sameNow();
check('15분 크론은 오후 4시에도 미처리 알림을 보내지 않는다 (Apps Script 와 같음)', t1.ok && t1.got.length === 0, t1);
GA.props.delete('REMINDED'); GA.tick();
await wcron('0 7 * * *');
t1 = sameNow();
check('하루 한 번(한국 16:00) 크론 — 내일 근무 미처리 신청을 관리자에게 (Apps Script 와 같음)',
      t1.ok && t1.got.some(m => m.to === VP && /처리 안 된 신청 1건/.test(m.subject)), t1.got.map(m => m.subject));
setNow('2026-10-16T18:45:00+09:00');
GA.props.set('REMINDED', '2026-10-16'); GA.tick();
await wcron('*/15 * * * *');
t1 = sameNow();
check('15분 크론 — 18:30 지난 교체 요청을 닫는다 (시트·메일이 Apps Script 와 같음)',
      t1.ok && GW.sheet('교체·정정').table().slice(-1)[0][11] === '만료' && t1.got.some(m => m.to === JANG && /만료/.test(m.subject)), t1.got.map(m => m.subject));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 보기 요청은 잠그지도 쓰지도 않는다');
const s0 = { ...stats };
const meRes = await wcall(KIM, 'me');
check('내 화면 — 잠금·쓰기 없이 시트 읽기 두 번(칸 크기·값을 동시에)', meRes.ok && stats.lockCreate === s0.lockCreate && stats.batchUpdate === s0.batchUpdate
      && stats.meta - s0.meta === 1 && stats.batchGet - s0.batchGet === 1, { lock: stats.lockCreate - s0.lockCreate, upd: stats.batchUpdate - s0.batchUpdate });
const l1 = stats.lookup; await wcall(KIM, 'me');
check('같은 토큰이면 구글에 다시 묻지 않고, 서비스 계정 토큰도 다시 받지 않는다', stats.lookup === l1 && stats.token === s0.token, { lookup: stats.lookup - l1, token: stats.token - s0.token });
// 기한이 지난 대기 요청 — 보기에서는 만료로 보이지만 시트는 그대로, 메일도 없다
setNow('2026-10-20T09:00:00+09:00');
await wcall(P1, 'assign', { grade: 1, text: '10/21\t김민수\t이서연\t장미래' });
const sq = await wcall(LEE, 'swapRequest', { slot: { date: '2026-10-21', g: 1, r: 2 }, to: idOf('임동건') });
const nPend = () => GW.sheet('교체·정정').table().filter(r => r[11] === '대기').length;
const pendBefore = nPend();
const n0 = relayed.length;
setNow('2026-10-21T19:00:00+09:00');
const lateView = await wcall(LIM, 'me');
check('보기에서는 기한 지난 요청이 대기로 안 보인다', sq.ok && pendBefore === 1 && lateView.ok && lateView.state.inbox.length === 0, { sq: sq.msg, pendBefore });
check('그래도 시트는 안 바꾸고 메일도 안 보낸다 (크론·다음 쓰기가 한다)', nPend() === 1 && relayed.length === n0);
await wcall(LIM, 'submit', { date: '2026-10-22', band: '4시간 초과 ~ 5시간 이하', type: '상담', reason: '학부모 상담 일정 네 건' });
check('다음 쓰기에서 만료가 시트에 남고 메일이 나간다', nPend() === 0 && relayed.slice(n0).some(m => m.to === LEE && /만료/.test(m.subject)));

console.log('\n■ 잠금 — 한 번에 하나씩');
setNow('2026-11-02T09:00:00+09:00');
stats.lockMax = 0;
const who = [KIM, LEE, PARK, JUNG, HAN, OH, YOON];
const many = await Promise.all(who.map((e, i) => wcall(e, 'submit', { date: '2026-11-1' + (i % 9), band: '4시간 초과 ~ 5시간 이하', type: '부서 업무', reason: '동시에 낸 신청 ' + i })));
const reqRows = GW.sheet('② 기타 업무').table();
const newIds = reqRows.slice(-7).map(r => r[0]);
check('일곱 명이 동시에 내도 모두 들어간다', many.every(x => x.ok) && reqRows.filter(r => /^동시에 낸 신청/.test(r[7])).length === 7, many.filter(x => !x.ok));
check('번호가 겹치지 않는다', new Set(newIds).size === 7, newIds);
check('잠금을 동시에 둘이 잡은 적이 없다', stats.lockMax === 1, stats.lockMax);
check('끝나면 잠금이 풀려 있다', !docs.has('locks/overtime'));
docs.set('locks/overtime', { fields: { until: { integerValue: String(Date.now() - 1000) } }, updateTime: 'old' });
stats.lockHeld++;
check('죽은 워커가 남긴 잠금(시간 지남)은 치우고 잡는다', (await wcall(KIM, 'submit', { date: '2026-11-20', band: '8시간 초과', type: '기타', reason: '남은 잠금 치우기 확인' })).ok && !docs.has('locks/overtime'));

console.log('\n■ 쓰기에 실패하면');
const before = JSON.stringify(dump(GW));
const m0 = relayed.length;
failUpdates = 1;
const bad = await wcall(KIM, 'submit', { date: '2026-11-21', band: '8시간 초과', type: '기타', reason: '쓰기가 실패하는 신청' });
check('실패라고 알린다 (성공처럼 보이지 않는다)', !bad.ok && bad.error === 'SHEET', bad);
check('시트는 그대로 (한꺼번에 쓰므로 반쯤 쓰인 것이 없다)', JSON.stringify(dump(GW)) === before);
check('메일도 안 나간다', relayed.length === m0);
check('잠금은 풀린다', !docs.has('locks/overtime'));
check('다시 누르면 들어간다', (await wcall(KIM, 'submit', { date: '2026-11-21', band: '8시간 초과', type: '기타', reason: '쓰기가 실패하는 신청' })).ok);

console.log('\n■ 수식 · 메일 중계');
check('어느 칸에도 수식이 들어가지 않았다 (글자는 stringValue)', GW.ss.formulas.length === 0, GW.ss.formulas);
check('비울 칸에는 빈 글자를 넣지 않고 값을 빼서 비운다', emptyStrings === 0, emptyStrings);
check('메일 중계에 비밀값을 실어 보냈다 (틀렸으면 가짜 중계가 거절)', stats.mailCalls > 0 && relayed.length > 0);
GW.setCfg('메일 알림', '끔');
const mm = relayed.length, mc = stats.mailCalls;
await wcall(KIM, 'submit', { date: '2026-11-22', band: '8시간 초과', type: '기타', reason: '메일 끈 뒤의 신청' });
check('메일 알림을 끄면 중계도 안 부른다', relayed.length === mm && stats.mailCalls === mc);

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
