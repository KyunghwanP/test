// 초과근무 화면(overtime.html) — 진짜 브라우저에서 눌러 보고, 화면이 부르는 Apps Script 는
// 진짜 gas/overtime/Code.gs 를 가짜 구글 환경(overtime-fake.mjs)에서 돌려 답한다.
// 그래서 화면과 스크립트가 서로 같은 말을 하는지(요청 이름·인자·응답 모양)까지 함께 본다.
//
// Firebase 는 모듈 주소를 가로채 작은 대역으로 바꾼다 — 로그인한 계정만 정해 주면 된다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { makeGas } from './overtime-fake.mjs';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const HTML = fs.readFileSync(new URL('../overtime.html', import.meta.url), 'utf8');
const ORIGIN = 'https://kyunghwanp.github.io';
const PAGE = ORIGIN + '/test/overtime.html?in=1';
const API = 'https://script.google.com/macros/s/AKfycbTESTDEPLOYMENT0123456789abcdef/exec';
const D = l => l + '@yeungnam.hs.kr';
const OP = D('pkh910518'), VP = D('vp'), P1 = D('p1'), KIM = D('kim'), LEE = D('lee'), JANG = D('jang'),
      HAN = D('han'), OH = D('oh'), LIM = D('lim'), PARK = D('park');

const G = makeGas({ people: { [OP]: { displayName: '박경환' } } });
G.setup();
G.setCfg('운영 담당', OP);

const ROSTER = [['박경환', '교무기획부', OP], ['정교감', '교감', VP], ['김일기', '1학년부', P1], ['김민수', '1학년부', KIM],
  ['이서연', '1학년부', LEE], ['장미래', '1학년부', JANG], ['한도윤', '3학년부', HAN], ['오세린', '3학년부', OH],
  ['임동건', '3학년부', LIM], ['박지훈', '2학년부', PARK], ['<img src=x onerror=window.__xss=1>', '보안', D('xss')]];

// ── Firebase 대역 ──
const STUB = {
  'firebase-app.js': 'export function initializeApp(){ return {}; }',
  'firebase-auth.js': `
    const u = window.__TEST_EMAIL__ ? { email: window.__TEST_EMAIL__, getIdToken: async () => 'tok:' + window.__TEST_EMAIL__ } : null;
    const auth = { currentUser: u };
    export function getAuth(){ return auth; }
    export function onAuthStateChanged(a, cb){ setTimeout(() => cb(a.currentUser), 0); return () => {}; }
    export function setPersistence(){ return Promise.resolve(); }
    export const indexedDBLocalPersistence = {}, browserLocalPersistence = {};`,
  'firebase-firestore.js': `
    export function getFirestore(){ return {}; }
    export function doc(db, c, id){ return c + '/' + id; }
    export async function getDoc(ref){ const d = (window.__FS__ || {})[ref]; return { exists: () => !!d, data: () => d }; }`,
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const apiCalls = [];
let apiDelay = 0;
// email: 로그인한 계정. open: OPEN_TO_ALL 을 켠 판(여러 선생님께 연 뒤의 모습). wired: 앱에 주소를 넣은 판
async function openAs(email, { open = true, wired = true, device = '', dark = false, width = 1100, part = '' } = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  let html = HTML;
  // 검사는 진짜 워커 대신 가짜 주소로 — 「주소가 아직 없는 판」 은 wired: false
  html = html.replace(/const OVERTIME_API = '[^']*';/, `const OVERTIME_API = '${wired ? API : ''}';`);
  if (open) html = html.replace('const OPEN_TO_ALL = false;', 'const OPEN_TO_ALL = true;');
  await ctx.route(ORIGIN + '/test/overtime.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  await ctx.route(ORIGIN + '/test/favicon-32.png', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://www.gstatic.com/firebasejs/**', r => {
    const name = r.request().url().split('/').pop();
    return r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB[name] || '' });
  });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.route('https://script.google.com/**', async r => {
    if (apiDelay) await new Promise(res => setTimeout(res, apiDelay));
    const req = r.request();
    apiCalls.push({ url: req.url(), headers: req.headers(), method: req.method(), body: req.postData() || '' });
    const out = G.post(req.postData() || '{}');
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
  });
  await ctx.addInitScript(([email, device, dark, roster]) => {
    window.__TEST_EMAIL__ = email;
    window.__FS__ = { 'acl/emailByName': Object.fromEntries(roster.map(([n, , e]) => [n, e])),
                      'contacts/main': { staff: roster.map(([name, dept]) => ({ name, dept })) } };
    try { if (device) localStorage.setItem('ynhs-overtime-api', device); if (dark) localStorage.setItem('ynhs-dark', '1'); } catch (e) {}
  }, [email, device, dark, ROSTER]);
  const pg = await ctx.newPage();
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push(e.message));
  pg.on('dialog', d => d.accept());
  await pg.goto(PAGE + (part ? '&part=' + part : ''));
  await pg.waitForFunction(() => !document.querySelector('#app .loading'), null, { timeout: 8000 }).catch(() => {});
  return pg;
}
const text = pg => pg.locator('#app').innerText();
// 알림이 뜰 때까지 — 앞서 뜬 알림이 아직 남아 있을 수 있으니 기대한 글이 나올 때까지 기다린다
const toastText = async (pg, re) => {
  await pg.waitForFunction(src => { const t = document.querySelector('#toast.show'); return t && (!src || new RegExp(src).test(t.textContent)); },
                           re ? re.source : null, { timeout: 6000 }).catch(() => {});
  return pg.locator('#toast').innerText();
};
const toastIs = async (pg, re) => re.test(await toastText(pg, re));
const idle = pg => pg.waitForFunction(() => ![...document.querySelectorAll('button')].some(x => x.textContent === '처리 중…'), null, { timeout: 8000 });
async function pick(pg, key, query, name) {
  await pg.fill(`[data-pick="${key}"]`, query);
  await pg.click(`#pick-${key} button:has-text("${name}")`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 들어오기 전 — 로그인·준비·연결');
let pg = await openAs('', { open: false });
check('로그인 안 했으면 안내만', /로그인한 뒤 열어/.test(await text(pg)));
await pg.context().close();
pg = await openAs(KIM, { open: false });
check('지금은 관리자만 — 다른 선생님에게는 「준비 중」', /준비 중인 화면/.test(await text(pg)) && apiCalls.length === 0);
await pg.context().close();
pg = await openAs(OP, { open: false, wired: false });
check('주소가 없으면 관리자에게 연결 안내 (붙여 넣기 칸)', /아직 연결 전/.test(await text(pg)) && await pg.locator('[data-field="deviceApi"]').count() === 1);
await pg.fill('[data-field="deviceApi"]', 'https://evil.example.com/exec');
await pg.click('[data-act="saveDevice"]');
check('워커·웹앱 주소 꼴이 아니면 받지 않는다 (토큰을 엉뚱한 곳에 보내지 않게)', await toastIs(pg, /워커 주소/) && apiCalls.length === 0);
await pg.fill('[data-field="deviceApi"]', API.replace('https://', ''));
await pg.click('[data-act="saveDevice"]');
await pg.waitForSelector('.top', { timeout: 8000 });
check('https:// 없이 붙여 넣어도 붙여서 받는다', await pg.evaluate(() => localStorage.getItem('ynhs-overtime-api')) === API);
check('붙여 넣은 주소로 연결 확인(ping) 뒤 이 기기에 기억', apiCalls[0] && /"action":"ping"/.test(apiCalls[0].body)
      && await pg.evaluate(() => localStorage.getItem('ynhs-overtime-api')) === API);
const call0 = apiCalls.find(c => /"action":"me"/.test(c.body));
check('요청은 text/plain POST, 토큰은 본문에 (머리글 없음 — 사전 요청이 안 가게)',
      call0 && call0.method === 'POST' && /^text\/plain/.test(call0.headers['content-type']) && !call0.headers.authorization
      && JSON.parse(call0.body).idToken === 'tok:' + OP, call0 && call0.headers);
check('명렬에 없을 때는 구글 계정 이름 + 안내', /박경환/.test(await text(pg)) && /교원 명렬에서 찾지 못해/.test(await text(pg)));
check('운영 담당에게는 「운영」 화면 단추', await pg.locator('[data-view="ops"]').count() === 1 && await pg.locator('[data-view="admin"]').count() === 0);

console.log('\n■ 운영 — 설치 상태, 교원 명렬 보내기');
await pg.click('[data-view="ops"]');
await pg.waitForSelector('dl.kv');
let t = await text(pg);
check('설치 상태 — 메일 끔, 시계 돌고 있음, 명렬 0명', /메일 알림\s*끔/.test(t) && /돌고 있음/.test(t) && /교원 명렬\s*0명/.test(t), t.slice(0, 400));
await pg.click('[data-act="rosterSync"]');
check('명렬 보내기 — 앱의 명렬(이름·계정)에 연락망 부서를 붙여 시트로', await toastIs(pg, /11명/) && G.sheet('교원 명렬').table().length === 11
      && G.sheet('교원 명렬').table()[3].join('|') === `김민수|1학년부|${KIM}`);
await idle(pg);
check('보낸 뒤 상태가 새로 고쳐진다 (명렬 11명, 이름이 명렬 것으로)', /교원 명렬\s*11명/.test(await text(pg)) && !/교원 명렬에서 찾지 못해/.test(await text(pg)));
check('이 기기 주소 지우기 단추가 보인다', await pg.locator('[data-act="clearDevice"]').count() === 1);
check('화면 오류 없음', pg.errors.length === 0, pg.errors);
await pg.context().close();

G.setCfg('승인 (관리자)', '정교감');
G.setCfg('1학년 기획 담당', P1);
G.setCfg('메일 알림', '켬');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 교사 — 4시간 초과 신청 (2026-10-05 월)');
pg = await openAs(KIM);
t = await text(pg);
check('초과근무 탭 — 이름·부서, 내 신청만 (감독 일정·교체는 감독표 탭)', /김민수/.test(t) && /1학년부/.test(t) && /낸 신청이 없습니다/.test(t)
      && !/내 감독 일정/.test(t) && await pg.locator('[data-act="openEmergency"]').count() === 0);
check('권한 없는 교사에게는 다른 화면 단추가 없다', await pg.locator('.views').count() === 0);
check('교사 화면에 이메일이 보이지 않는다', !/@/.test(await pg.locator('#app').innerHTML()));
await pg.click('[data-act="openSubmit"]');
check('신청 창 — 근무일 기본값은 내일, 오늘 이전은 못 고름', await pg.inputValue('[data-field="date"]') === '2026-10-06' && await pg.getAttribute('[data-field="date"]', 'min') === '2026-10-05');
check('구간 다섯·유형 넷은 스크립트가 준 목록 그대로', await pg.locator('[data-k="band"]').count() === 5 && await pg.locator('[data-k="typ"]').count() === 4);
await pg.click('[data-act="submit"]');
check('구간을 안 고르면 막는다 (보내지 않음)', await toastIs(pg, /구간/) && !apiCalls.some(c => /"action":"submit"/.test(c.body)));
await pg.fill('[data-field="date"]', '2026-10-05');
check('오늘을 고르면 「당일 신청」 안내', await pg.isVisible('#sameDayHint'));
await pg.fill('[data-field="date"]', '2026-10-08');
check('다른 날로 바꾸면 안내가 사라진다', !(await pg.isVisible('#sameDayHint')));
await pg.click('[data-k="band"][data-v="5시간 초과 ~ 6시간 이하"]');
await pg.click('[data-k="typ"][data-v="상담"]');
check('고른 칩은 켜진다', await pg.getAttribute('[data-k="band"][data-v="5시간 초과 ~ 6시간 이하"]', 'class') === 'chip on');
await pg.fill('[data-field="reason"]', '수시 원서 접수 전 학부모 상담 4건 <img src=x onerror=window.__xss=2>');
await pg.click('[data-act="submit"]');
check('신청 — 알림이 뜨고 창이 닫힌다', await toastIs(pg, /신청했습니다/) && await pg.locator('#scrim').isHidden());
await idle(pg);
t = await text(pg);
check('내 신청에 대기로 보인다', /10\.08 \(목\) · 5~6시간/.test(t) && /대기/.test(t), t.slice(0, 300));
check('시트 ② 에 들어갔다', G.sheet('② 기타 업무').table()[0][3] === '김민수');
await pg.click('[data-act="toggle"][data-key="qR0001"]');
check('줄을 누르면 사유·접수 시각·취소 단추', /수시 원서 접수 전/.test(await text(pg)) && await pg.locator('[data-act="cancelReq"]').count() === 1);
check('사유 속 태그는 글자로만 (실행되지 않음)', await pg.evaluate(() => window.__xss) === undefined && /<img src=x/.test(await text(pg)));
apiDelay = 2500;
await pg.reload();
await pg.waitForSelector('.top', { timeout: 1500 }).catch(() => {});
t = await text(pg);
check('다시 열면 지난번 내용을 바로 보여 준다 (답을 기다리지 않음)', /10\.08 \(목\) · 5~6시간/.test(t) && /새로 불러오는 중/.test(t), t.slice(0, 200));
apiDelay = 0;
await pg.waitForFunction(() => !document.getElementById('staleHint'), null, { timeout: 6000 }).catch(() => {});
check('새 내용이 오면 「새로 불러오는 중」 이 사라진다', !(await text(pg)).includes('새로 불러오는 중'));
check('지난번 내용은 내 계정 이름으로만 이 기기에 남는다', await pg.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ynhs-overtime-last:'))).then(k => k.length === 1 && k[0] === 'ynhs-overtime-last:kim@yeungnam.hs.kr'));
check('화면 오류 없음', pg.errors.length === 0, pg.errors);
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 관리자 — 승인·반려');
pg = await openAs(LEE);
await pg.click('[data-act="openSubmit"]');
await pg.fill('[data-field="date"]', '2026-10-07');
await pg.click('[data-k="band"][data-v="4시간 초과 ~ 5시간 이하"]');
await pg.click('[data-k="typ"][data-v="기타"]');
await pg.fill('[data-field="reason"]', '업무 정리 및 자료 작성');
await pg.click('[data-act="submit"]');
await toastText(pg, /신청했습니다/);
await pg.context().close();
// 하나 더 — 여러 건 한꺼번에 승인을 보려고 대기를 셋으로
pg = await openAs(PARK);
await pg.click('[data-act="openSubmit"]');
await pg.fill('[data-field="date"]', '2026-10-09');
await pg.click('[data-k="band"][data-v="6시간 초과 ~ 7시간 이하"]');
await pg.click('[data-k="typ"][data-v="정기고사 출제·채점"]');
await pg.fill('[data-field="reason"]', '2학기 중간고사 수학 출제 및 검토');
await pg.click('[data-act="submit"]');
await toastText(pg, /신청했습니다/);
await pg.context().close();
pg = await openAs(VP);
check('승인 관리자에게 「승인」 단추와 대기 수', await pg.locator('[data-view="admin"] .badge-n').innerText() === '3');
await pg.click('[data-view="admin"]');
await pg.waitForSelector('[data-act="approve"]');
t = await text(pg);
check('대기 카드 — 이름·부서·날짜·구간·유형, 사유는 처음부터 보인다', /김민수 · 1학년부/.test(t) && /10\.08 \(목\) · 5시간 초과 ~ 6시간 이하 · 상담/.test(t)
      && /수시 원서 접수 전/.test(t) && /업무 정리 및 자료 작성/.test(t) && !/사유 보기/.test(t));
const firstName = await pg.locator('.box .row .l b').nth(1).innerText();
await pg.locator('[data-act="rejectStart"]').first().click();
await pg.click('[data-act="rejectSend"]');
check('반려는 사유 없이는 안 보낸다', await toastIs(pg, /반려 사유/));
await pg.fill('[data-field="reject"]', '하는 일이 구체적이지 않습니다');
await pg.click('[data-act="rejectSend"]');
check('반려 — 알림 문구가 맞다 (목록과 섞이지 않음)', await toastIs(pg, /선생님 신청을 반려했습니다/), await pg.locator('#toast').innerText());
await idle(pg);
check('남은 둘에 「전체 선택」 · 「선택 0건 승인」(잠김)', await pg.locator('[data-act="pickAll"]').count() === 1 && await pg.isDisabled('[data-act="bulkApprove"]'));
await pg.locator('[data-act="pickReq"]').first().check();
check('하나 고르면 「선택 1건 승인」', /선택 1건 승인/.test(await pg.locator('[data-act="bulkApprove"]').innerText()) && await pg.locator('.box.picked').count() === 1);
await pg.click('[data-act="pickAll"]');
check('전체 선택', /선택 2건 승인/.test(await pg.locator('[data-act="bulkApprove"]').innerText()));
apiDelay = 1500;
const callsBefore = apiCalls.length;
await pg.click('[data-act="bulkApprove"]');
await pg.waitForTimeout(250);
t = await text(pg);
check('누르는 즉시 카드가 빠진다 (답을 기다리지 않음)', /기다리는 신청이 없습니다/.test(t) && /2건 승인하는 중/.test(await pg.locator('#toast').innerText()), t.slice(0, 300));
apiDelay = 0;
check('여러 건이 요청 하나로 간다', await toastIs(pg, /2건을 승인했습니다/) && apiCalls.slice(callsBefore).filter(c => /"action":"decide"/.test(c.body)).length === 1);
await pg.waitForTimeout(200);
t = await text(pg);
check('처리한 신청에 셋 (0 은 붉은 표시 없이)', /기다리는 신청이 없습니다/.test(t) && /처리한 신청\s*3건/.test(t) && await pg.locator('.badge-n').count() === 0, t.slice(0, 500));
check('월 요약 — 승인 · 반려 · 대기 2 · 1 · 0', /승인 · 반려 · 대기\s*2 · 1 · 0/.test(t));
check('시트에서도 처리됨', G.sheet('② 기타 업무').table().map(r => r[8]).sort().join() === '반려,승인,승인', firstName);
await pg.context().close();
// 저장에 실패하면 되살린다
pg = await openAs(PARK);
await pg.click('[data-act="openSubmit"]');
await pg.fill('[data-field="date"]', '2026-10-13');
await pg.click('[data-k="band"][data-v="4시간 초과 ~ 5시간 이하"]');
await pg.click('[data-k="typ"][data-v="상담"]');
await pg.fill('[data-field="reason"]', '학부모 상담 일정 네 건');
await pg.click('[data-act="submit"]');
await toastText(pg, /신청했습니다/);
await pg.context().close();
pg = await openAs(VP);
await pg.click('[data-view="admin"]');
await pg.waitForSelector('[data-act="approve"]');
G.setLock(false);
await pg.click('[data-act="approve"]');
check('저장에 실패하면 알리고 카드를 되살린다', await toastIs(pg, /되돌렸습니다/) && await pg.waitForSelector('[data-act="approve"]', { timeout: 4000 }).then(() => true).catch(() => false));
G.setLock(true);
await pg.click('[data-act="approve"]');
check('다시 누르면 된다', await toastIs(pg, /선생님 신청을 승인했습니다/));
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 학년 기획 담당 — 감독 배정 붙여넣기');
pg = await openAs(P1, { part: 'duty' });
await pg.click('[data-view="assign"]');
await pg.waitForSelector('[data-field="assignText"]');
await pg.fill('[data-field="assignText"]', '10/06\t김민수\t이서연\t장미래\n10/07\t이서연\t이서연\t없는이\n10/08\t장미래\t\t김민수');
await pg.click('[data-act="assignPreview"]');
await pg.waitForSelector('#assignPrev');
t = await text(pg);
check('미리보기 — 잘못된 칸에 까닭', /같은 사람이 두 칸/.test(t) && /명렬에 없음/.test(t) && /확인 필요 1/.test(t));
check('확인이 필요하면 확정 단추가 잠긴다', await pg.isDisabled('[data-act="assignCommit"]'));
await pg.fill('[data-field="assignText"]', '10/06\t김민수\t이서연\t장미래\n10/07\t이서연\t장미래\t김민수\n10/08\t장미래\t\t김민수');
check('붙여 넣은 글을 고치면 낡은 미리보기는 치운다', await pg.locator('#assignPrev').count() === 0);
await pg.click('[data-act="assignPreview"]');
await pg.waitForSelector('#assignPrev');
await pg.click('[data-act="assignCommit"]');
check('확정 — 알림', await toastIs(pg, /3일을 배정했습니다/));
await idle(pg);
t = await text(pg);
check('아래 감독표에 바로 보인다', /10\.06 \(화\)/.test(t) && await pg.locator('td.cell button:has-text("장미래")').count() === 3, t.slice(-600));
check('시트 ① 에 들어갔다', G.sheet('① 자율학습 감독').table(2).length === 3);
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 교체 — 장미래가 요청, 한도윤이 수락');
pg = await openAs(JANG, { part: 'duty' });
t = await text(pg);
check('내 감독 일정 — 세 칸, 심야는 표시', /10\.06 \(화\) · 1학년 감독3 \(심야\)/.test(t) && /심야 · 통합조회에 올라감/.test(t) && await pg.locator('[data-act="openSwap"]').count() === 3);
await pg.click('[data-act="openSwap"][data-slot="2026-10-06|1|3"]');
await pg.fill('[data-pick="to"]', '3학년');
check('이름이나 부서로 찾는다 (나는 빠짐)', await pg.locator('#pick-to button').count() === 3 && !(await pg.locator('#pick-to').innerText()).includes('장미래'));
await pg.click('#pick-to button:has-text("한도윤")');
await pg.fill('[data-field="reason"]', '가족 행사');
await pg.click('[data-act="swapSend"]');
check('요청 — 알림', await toastIs(pg, /한도윤 선생님께 교체를 요청했습니다/));
await idle(pg);
t = await text(pg);
check('그 칸에 「수락 대기 · 기한」 과 요청 취소 단추', /한도윤 선생님 수락 대기 · 기한 10\.06 18:30/.test(t) && await pg.locator('[data-act="withdraw"]').count() === 1);
await pg.context().close();
pg = await openAs(HAN, { part: 'duty' });
t = await text(pg);
check('받는 사람 — 맨 위에 요청 카드 (사유·기한)', /감독 교체 요청 — 10\.06 \(화\) 1학년 감독3 \(심야\)/.test(t) && /사유: 가족 행사/.test(t) && /수락 기한 10\.06 18:30/.test(t));
await pg.click('[data-act="respond"][data-yes="1"]');
check('수락 — 알림', await toastIs(pg, /교체를 수락했습니다/));
await idle(pg);
t = await text(pg);
check('카드가 사라지고 내 감독 일정에 들어온다', !/감독 교체 요청 —/.test(t) && /10\.06 \(화\) · 1학년 감독3 \(심야\)/.test(t));
check('시트도 바뀌었다', G.sheet('① 자율학습 감독').table(2)[0][3] === '한도윤');
await pg.context().close();

console.log('\n■ 맞교환 — 상대 칸을 불러와 고른다');
pg = await openAs(LEE, { part: 'duty' });
await pg.click('[data-act="openSwap"][data-slot="2026-10-06|1|2"]');
await pg.click('[data-k="mode"][data-v="trade"]');
await pick(pg, 'to', '오세린', '오세린');
check('상대에게 배정이 없으면 그렇다고 알려 준다', await pg.waitForSelector('text=앞으로 배정된 감독이 없습니다', { timeout: 5000 }).then(() => true).catch(() => false));
await pg.click('[data-act="unpick"][data-key="to"]');
await pick(pg, 'to', '장미', '장미래');
await pg.waitForSelector('[data-act="set2"]');
check('장미래 선생님의 오늘·이후 감독 칸이 칩으로 (넘겨준 10.06 은 없음)', await pg.locator('[data-act="set2"]').count() === 2);
await pg.click('[data-act="swapSend"]');
check('맞바꿀 칸을 안 고르면 막는다', await toastIs(pg, /맞바꿀 칸/));
await pg.click('[data-act="set2"][data-slot="2026-10-07|1|2"]');
await pg.click('[data-act="swapSend"]');
check('스크립트가 막은 까닭을 그대로 보여 준다 (그날 이미 감독)', await toastIs(pg, /이서연 선생님은 10\.07 \(수\)에 이미 1학년 감독1/));
await pg.click('[data-act="set2"][data-slot="2026-10-08|1|1"]');
await pg.click('[data-act="swapSend"]');
check('맞교환 요청 — 알림', await toastIs(pg, /장미래 선생님께 교체를 요청했습니다/));
await idle(pg);
check('그 칸에 「(맞교환)」 표시', /장미래 선생님 수락 대기 \(맞교환\)/.test(await text(pg)));
await pg.click('[data-act="withdraw"]');
check('요청 취소', await toastIs(pg, /요청을 취소했습니다/));
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 긴급 교체 — 다른 선생님 감독 맡기');
pg = await openAs(OH, { part: 'duty' });
await pg.click('[data-act="openEmergency"]');
await pick(pg, 'who', '김민수', '김민수');
await pg.waitForSelector('[data-act="setSlot"]');
check('그 선생님의 오늘·이후 칸이 칩으로', await pg.locator('[data-act="setSlot"]').count() === 3);
await pg.click('[data-act="setSlot"][data-slot="2026-10-08|1|3"]');
check('즉시 반영된다는 안내', /등록하는 즉시 10\.08 \(목\) 1학년 감독3 \(심야\) 칸이 내 이름으로 바뀝니다/.test(await pg.locator('#sheet').innerText()));
await pg.click('[data-k="mode"][data-v="trade"]');
check('맞바꿀 내 감독이 없으면 그렇다고', /맞바꿀 수 있는 내 감독이 없습니다/.test(await pg.locator('#sheet').innerText()));
await pg.click('[data-k="mode"][data-v="cover"]');
await pg.click('[data-act="emergencySend"]');
check('사유 없이는 안 보낸다', await toastIs(pg, /사유/));
await pg.fill('[data-field="reason"]', '김민수 선생님 상고');
await pg.click('[data-act="emergencySend"]');
check('긴급 교체 — 알림', await toastIs(pg, /감독을 맡았습니다/));
await idle(pg);
check('내 감독 일정에 바로 들어온다', /10\.08 \(목\) · 1학년 감독3 \(심야\)/.test(await text(pg)));
check('시트도 바뀌고 빨간 칸', G.sheet('① 자율학습 감독').table(2)[2][3] === '오세린' && G.sheet('① 자율학습 감독').cell(5, 4).bg === '#FEE2E2');
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 지난 감독 정정 — 둘 다 확인');
G.setNow('2026-10-09T08:00:00+09:00');
pg = await openAs(JANG, { part: 'duty' });
await pg.click('[data-act="openCorrect"]');
check('지난 내 감독만 칩으로', await pg.locator('[data-act="setSlot"]').count() === 2);
await pg.click('[data-act="setSlot"][data-slot="2026-10-07|1|2"]');
await pick(pg, 'actual', '임동', '임동건');
await pg.fill('[data-field="reason"]', '구두로 바꾸고 등록을 잊음');
await pg.click('[data-act="correctSend"]');
check('정정 요청 — 상대 확인 안내', await toastIs(pg, /임동건 선생님이 확인하면/));
await idle(pg);
check('보낸 정정 요청 목록', /보낸 정정 요청/.test(await text(pg)) && /기록 장미래 → 실제 임동건/.test(await text(pg)));
await pg.context().close();
pg = await openAs(LIM, { part: 'duty' });
check('확인할 사람에게 카드', /지난 감독 정정 확인 — 10\.07 \(수\) 1학년 감독2/.test(await text(pg)));
await pg.click('[data-act="respond"][data-yes="1"]');
check('확인 — 기록이 바뀐다', await toastIs(pg, /정정을 확인했습니다/) && G.sheet('① 자율학습 감독').table(2)[1][2] === '임동건');
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 담당자 정정 — 감독표 칸을 눌러');
pg = await openAs(P1, { part: 'duty' });
await pg.click('[data-view="grid"]');
await pg.waitForSelector('td.cell button');
check('바뀐 칸은 색으로 (교체·긴급·사후 정정)', await pg.locator('td.k-교체').count() === 1 && await pg.locator('td.k-긴급').count() === 1 && await pg.locator('td.k-사후').count() === 1);
check('칸에 마우스를 올리면 바뀐 내력', /장미래 → 한도윤 · 교체 수락/.test(await pg.getAttribute('td.k-교체', 'title')));
await pg.click('[data-act="openFix"][data-slot="2026-10-08|1|1"]');
await pg.click('[data-act="set"][data-k="clear"][data-v="1"]');
await pg.click('[data-act="fixSend"]');
check('정정 사유 없이는 안 보낸다', await toastIs(pg, /사유/));
await pg.fill('[data-field="reason"]', '그날 자율학습 없음');
await pg.click('[data-act="fixSend"]');
check('정정 — 알림, 감독표가 그 자리에서 바뀐다', await toastIs(pg, /고쳤습니다/));
await idle(pg);
check('보라 칸', await pg.locator('td.k-정정').count() === 1);
check('다른 학년 칸은 누를 수 없다', await pg.locator('[data-act="openFix"][data-slot^="2026-10-06|2|"]').count() === 0);
await pg.context().close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n■ 두 탭 — 초과근무와 감독표');
pg = await openAs(KIM, { part: 'duty' });
t = await text(pg);
check('감독표 탭 — 제목 감독표, 화면 단추는 교체·감독표 (교사는 배정 없음)', /감독표/.test(await pg.locator('.top h1').textContent())
      && JSON.stringify(await pg.locator('.view-btn').allInnerTexts()) === JSON.stringify(['교체', '감독표']), await pg.locator('.view-btn').allInnerTexts());
check('교체 화면 — 내 감독 일정·맡기·정정, 4시간 초과 신청 단추는 없음', /내 감독 일정/.test(t) && await pg.locator('[data-act="openEmergency"]').count() === 1
      && await pg.locator('[data-act="openSubmit"]').count() === 0);
await pg.click('[data-view="grid"]');
await pg.waitForSelector('table');
check('교사도 한 달 감독표를 본다 — 고칠 칸은 없다', await pg.locator('td.cell').count() > 0 && await pg.locator('[data-act="openFix"]').count() === 0);
check('화면 오류 없음', pg.errors.length === 0, pg.errors);
await pg.context().close();

console.log('\n■ 모양');
pg = await openAs(KIM, { dark: true, width: 360 });
const bg = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('앱의 다크모드를 따른다', await pg.evaluate(() => document.documentElement.classList.contains('dark')) && bg === 'rgb(11, 18, 32)', bg);
check('휴대폰 폭(360)에서 가로로 넘치지 않는다', await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await pg.click('[data-act="openSubmit"]');
check('휴대폰에서 신청 창도 넘치지 않는다', await pg.evaluate(() => document.querySelector('#sheet').scrollWidth <= document.querySelector('#sheet').clientWidth));
await pg.keyboard.press('Escape');
check('ESC 로 창을 닫는다', await pg.locator('#scrim').isHidden());
check('앱 안(?in=1)에서는 큰 제목을 숨긴다', await pg.locator('.top h1').isHidden());
check('화면 오류 없음', pg.errors.length === 0, pg.errors);
await pg.context().close();

console.log('\n■ 워커로 옮긴 뒤 — 기기에 남은 옛 Apps Script 주소');
G.props.set('MAIL_SECRET', 'q'.repeat(32));
pg = await openAs(OP, { open: false, wired: false, device: API });
check('「주소가 바뀌었습니다」 와 함께 새 주소를 넣을 칸이 바로 뜬다', /주소가 바뀌었습니다/.test(await text(pg)) && await pg.locator('[data-field="deviceApi"]').count() === 1, (await text(pg)).slice(0, 200));
await pg.context().close();
G.props.delete('MAIL_SECRET');

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
