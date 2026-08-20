// '지금 이 교시' 갱신 로직 검증.
// index.html 에서 실제 코드를 떼어내 가짜 시계로 돌린다(중복 정의하면 원본이 바뀌어도 통과).
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  return html.slice(m.index, html.indexOf('\n}\n', m.index) + 3);
}
const pick = re => { const m = re.exec(html); if (!m) throw new Error('못 찾음: ' + re); return m[0]; };

const src = [
  pick(/^const DAYS = \[[^\]]*\];/m),
  pick(/^const BELL_SCHEDULE = \[[\s\S]*?\n\];/m),
  grab('toMinutes'), grab('getCurrentPeriod'), grab('recomputeTimeState'),
  grab('syncTimeState'),
  'let todayDay = null, currentPeriod = null;',
  // refreshCurrentView 대신 호출 횟수만 센다
  'let renders = 0; function refreshCurrentView(){ renders++; recomputeTimeState(); }',
  // syncTimeState 는 현황판(위젯)도 챙긴다 — 그쪽은 여기서 호출 횟수만 센다.
  // 자정 넘김 자체는 아래 별도 블록에서 따로 확인한다.
  'let homes = 0; let homeInitialized = true; let _mealOffset = 0, _scheduleOffset = 0;',
  'function initHomePage(){ homes++; }',
  'const window = { _lastHomeDate: undefined, _renderHomeMyTt(){} };',
  'return { get todayDay(){return todayDay;}, get currentPeriod(){return currentPeriod;},',
  '         get renders(){return renders;}, get homes(){return homes;},',
  '         recomputeTimeState, syncTimeState };'
].join('\n\n');

const mk = new Function(src);

// 가짜 시계
let NOW = new Date();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  static now() { return NOW.getTime(); }
};
const at = (day, hh, mm) => {           // day: 1=월 … 5=금, 0=일
  const d = new RealDate(2026, 7, 17 + (day === 0 ? 6 : day - 1), hh, mm, 0); // 2026-08-17 = 월
  NOW = d;
  return d;
};

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

console.log('\n■ 교시 판정 (시작 5분 전 ~ 끝난 5분 후)');
{
  at(1, 8, 35); const s = mk(); s.recomputeTimeState();
  check('8:35 → 1교시', s.currentPeriod === 1, s.currentPeriod);
  at(1, 8, 26); s.recomputeTimeState();
  check('8:26 (시작 4분 전) → 1교시', s.currentPeriod === 1, s.currentPeriod);
  at(1, 8, 20); s.recomputeTimeState();
  check('8:20 (시작 10분 전) → 없음', s.currentPeriod === null, s.currentPeriod);
  at(1, 12, 45); s.recomputeTimeState();
  check('12:45 → 점심', s.currentPeriod === 'lunch', s.currentPeriod);
  at(1, 17, 0); s.recomputeTimeState();
  check('17:00 (하교 후) → 없음', s.currentPeriod === null, s.currentPeriod);
  at(0, 10, 0); s.recomputeTimeState();
  check('일요일 10:00 → 없음(요일 자체가 없음)', s.currentPeriod === null && s.todayDay === null, [s.todayDay, s.currentPeriod]);
}

console.log('\n■ 이번 수정의 핵심 — 시간이 흘러도 따라가는가');
{
  at(1, 8, 35); const s = mk(); s.recomputeTimeState();
  check('아침에 앱을 열면 1교시', s.currentPeriod === 1);
  // 예전 동작: 여기서 아무것도 안 하면 화면은 1교시인 채로 남았다
  at(1, 10, 40);                       // 두 시간 뒤 (3교시)
  check('(수정 전) 계산을 안 하면 1교시 그대로', s.currentPeriod === 1);
  s.syncTimeState();
  check('syncTimeState 후 3교시', s.currentPeriod === 3, s.currentPeriod);
  check('바뀌었으니 다시 그렸다', s.renders === 1, s.renders);
}

console.log('\n■ 바뀐 게 없으면 다시 그리지 않는가 (60초마다 돌아도 부담 없게)');
{
  at(1, 10, 40); const s = mk(); s.recomputeTimeState();
  const before = s.renders;
  for (let i = 0; i < 20; i++) { at(1, 10, 40 + (i % 5)); s.syncTimeState(); }   // 계속 3교시
  check('같은 교시 안에서는 한 번도 안 그린다', s.renders === before, s.renders);
  at(1, 11, 26); s.syncTimeState();
  check('4교시로 넘어가면 그때 한 번', s.renders === before + 1, s.renders);
  at(1, 11, 40); s.syncTimeState(); at(1, 12, 10); s.syncTimeState();
  check('4교시 안에서는 더 안 그린다', s.renders === before + 1, s.renders);
}

console.log('\n■ 교시 경계 — 수업 시간 중에는 빈 구간이 없다');
// 각 교시 창이 [시작-5, 종료+5] 라 서로 맞닿는다(1교시는 9:25에 끝나고 2교시가 9:25에 시작).
// 그래서 08:25~16:25 사이에는 '아무 교시도 아닌' 시각이 생기지 않는다.
{
  at(1, 9, 25); const s = mk(); s.recomputeTimeState();
  check('9:25 (겹치는 순간) → 앞 교시가 이긴다', s.currentPeriod === 1, s.currentPeriod);
  at(1, 9, 26); s.syncTimeState();
  check('9:26 → 2교시로 이어진다(빈 구간 없음)', s.currentPeriod === 2, s.currentPeriod);
  check('넘어갈 때 다시 그렸다', s.renders === 1, s.renders);
  at(1, 16, 26); s.syncTimeState();
  check('16:26 (7교시 창이 끝난 뒤) → 없음', s.currentPeriod === null, s.currentPeriod);
  check('없음으로 갈 때도 다시 그린다', s.renders === 2, s.renders);
  at(2, 8, 35); s.syncTimeState();
  check('다음 날 화요일 1교시', s.todayDay === '화' && s.currentPeriod === 1, [s.todayDay, s.currentPeriod]);
  check('요일이 바뀌어도 다시 그린다', s.renders === 3, s.renders);
}

console.log('\n■ 자정을 넘겨 앱을 켜 둔 경우 (타이머가 얼었다 깨어난 상황)');
{
  at(1, 15, 40); const s = mk(); s.recomputeTimeState();
  check('금요일 전 월요일 7교시', s.currentPeriod === 7, s.currentPeriod);
  at(2, 9, 35);                        // 다음 날 아침까지 아무 갱신 없이 방치
  s.syncTimeState();
  check('깨어난 뒤 화요일 2교시로 정정', s.todayDay === '화' && s.currentPeriod === 2, [s.todayDay, s.currentPeriod]);
}

globalThis.Date = RealDate;
// ── 자정 넘김 — 현황판/위젯이 어제 요일에 멈추지 않는가 ────────────────────
// 컴퓨터를 켜 둔 채 밤을 넘기면 위젯에 어제 요일이 그대로 남았다.
// syncTimeState 가 시간표 페이지만 다시 그리고 현황판은 손대지 않아서였다.
// index.html 에서 그 함수를 그대로 떼어내 가짜 시계로 돌린다.
{
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs2 = await import('node:fs');
  const tmp = path.join(os.tmpdir(), 'sync-' + Date.now() + '.js');
  execFileSync('python3', [new URL('./build-sync-harness.py', import.meta.url).pathname, tmp]);
  const src = fs2.readFileSync(tmp, 'utf8');
  fs2.unlinkSync(tmp);

  console.log('\n■ 자정을 넘기면 현황판·위젯도 오늘 기준으로 다시 그린다');

  // 함수가 참조하는 것들을 전부 쥐고 돌린다
  function run({ dayChanges, periodChanges, dateStr, lastHomeDate, homeInit }){
    const calls = { refreshCurrentView: 0, initHomePage: 0, renderHomeMyTt: 0 };
    const win = { _lastHomeDate: lastHomeDate, _renderHomeMyTt: () => calls.renderHomeMyTt++ };
    let todayDay = '수', currentPeriod = 3;
    const ctx = {
      get todayDay(){ return todayDay; }, get currentPeriod(){ return currentPeriod; },
      recomputeTimeState(){ if(dayChanges) todayDay = '목'; if(periodChanges) currentPeriod = 1; },
      refreshCurrentView(){ calls.refreshCurrentView++; },
      initHomePage(){ calls.initHomePage++; },
      homeInitialized: homeInit,
      _mealOffset: 5, _scheduleOffset: -2,
      window: win,
      Date: class extends Date { toDateString(){ return dateStr; } }
    };
    const fn = new Function('ctx', `
      let { todayDay, currentPeriod, homeInitialized, _mealOffset, _scheduleOffset } = ctx;
      const { recomputeTimeState: _r, refreshCurrentView, initHomePage, window, Date } = ctx;
      const recomputeTimeState = () => { _r(); todayDay = ctx.todayDay; currentPeriod = ctx.currentPeriod; };
      ${src}
      syncTimeState();
      return { homeInitialized, _mealOffset, _scheduleOffset };
    `);
    const after = fn(ctx);
    return { calls, win, after };
  }

  // 날짜가 그대로면 아무것도 재구성하지 않는다
  let r = run({ dayChanges:false, periodChanges:true, dateStr:'Wed Aug 19 2026',
                lastHomeDate:'Wed Aug 19 2026', homeInit:true });
  check('같은 날 교시만 바뀌면 시간표만 다시 그린다', r.calls.refreshCurrentView === 1 && r.calls.initHomePage === 0, r.calls);
  check('같은 날에도 현황판 시간표는 갱신한다', r.calls.renderHomeMyTt === 1, r.calls);

  // 자정을 넘겼다 — 이게 위젯이 어제에 멈춰 있던 경우다
  r = run({ dayChanges:true, periodChanges:true, dateStr:'Thu Aug 20 2026',
            lastHomeDate:'Wed Aug 19 2026', homeInit:true });
  check('날짜가 넘어가면 현황판을 통째로 다시 만든다', r.calls.initHomePage === 1, r.calls);
  check('시간표 페이지도 함께', r.calls.refreshCurrentView === 1, r.calls);
  check('급식·학사일정 오프셋을 오늘로 되돌린다',
        r.after._mealOffset === 0 && r.after._scheduleOffset === 0, r.after);
  check('_lastHomeDate 를 새 날짜로 옮긴다', r.win._lastHomeDate === 'Thu Aug 20 2026', r.win);

  // 두 번 연달아 불러도 한 번만 재구성한다(현황판 자체 타이머와 겹쳐도 안전)
  r = run({ dayChanges:true, periodChanges:false, dateStr:'Thu Aug 20 2026',
            lastHomeDate:'Thu Aug 20 2026', homeInit:true });
  check('이미 오늘로 맞춰져 있으면 다시 만들지 않는다', r.calls.initHomePage === 0, r.calls);

  // 현황판을 한 번도 안 연 상태면 건드리지 않는다
  r = run({ dayChanges:true, periodChanges:false, dateStr:'Thu Aug 20 2026',
            lastHomeDate:'Wed Aug 19 2026', homeInit:false });
  check('현황판을 연 적 없으면 초기화하지 않는다', r.calls.initHomePage === 0, r.calls);
}

// ── 운영시간표가 현황판에 언제 반영되는가 ────────────────────────────────
// OPERATING 은 로그인 뒤 따로 받아온다. 도착했을 때 현황판을 다시 그리지 않으면
// '내 시간표'는 자체 1분 타이머가 돌 때까지 기초로 남고, '우리반 시간표'는
// 한 번만 그리는 구조라 아예 바뀌지 않았다. 배선이 걸렸는지 원본에서 확인한다.
{
  console.log('\n■ 운영시간표 도착 → 현황판 즉시 반영');
  const i = html.indexOf("getDoc(doc(fbDb, 'appdata', 'operating'))");
  const arrival = html.slice(i, html.indexOf('.catch', i));
  check('운영표를 받는 곳이 있다', i > 0);

  // 순서대로 받으면 왕복이 두 번이라, 현황판이 그려질 때까지 못 와서 기초로 한 번
  // 그렸다가 바뀐다. 나란히 시작하고, 그리기 전에 잠깐 기다려야 처음부터 운영표로 뜬다.
  const load = html.slice(html.indexOf('async function loadDataFromFirestore'),
                          html.indexOf('} catch (e) {', html.indexOf('async function loadDataFromFirestore')));
  check('appdata/main 과 나란히 시작한다',
        load.indexOf("'operating'") < load.indexOf('await Promise.race([fetchPromise'), load.slice(0, 200));
  check('현황판을 그리기 전에 잠깐 기다린다', /await Promise\.race\(\[opPromise/.test(load), load.slice(-400));
  check('오래 막지는 않는다(상한이 있다)', /opPromise, new Promise\(r => setTimeout\(r, \d+\)\)/.test(load));
  check('도착하면 내 시간표를 다시 그린다',   /_renderHomeMyTt/.test(arrival), arrival.slice(0, 300));
  check('도착하면 우리반 시간표도 다시 그린다', /_renderHomeClassTt/.test(arrival), arrival.slice(0, 300));

  check('우리반 시간표가 다시 그릴 수 있는 함수다',
        /window\._renderHomeClassTt\s*=\s*function/.test(html));
  check('우리반 시간표도 운영표를 본다',
        /_renderHomeClassTt[\s\S]{0,900}ttResolveCellOp\(_opH/.test(html));
  check('우리반 시간표가 부를 때마다 요일·시각을 새로 잡는다',
        /_renderHomeClassTt[\s\S]{0,400}const nowDate = new Date\(\)/.test(html));

  const timer = html.slice(html.indexOf('window._homeTtTimer = setInterval'),
                           html.indexOf('}, 60000);') + 10);
  check('1분 타이머가 둘 다 챙긴다',
        /_renderHomeMyTt/.test(timer) && /_renderHomeClassTt/.test(timer), timer.slice(-400));

  const sync = html.slice(html.indexOf('function syncTimeState'),
                          html.indexOf('setInterval(syncTimeState'));
  check('교시가 바뀔 때도 둘 다 챙긴다',
        /_renderHomeMyTt/.test(sync) && /_renderHomeClassTt/.test(sync), sync.slice(-400));

  // 배지를 붙이기만 하면 운영일이 아니게 돼도 남는다 → 다시 그릴 때 지우고 판단해야 한다
  const cls = html.slice(html.indexOf('window._renderHomeClassTt = function'),
                         html.indexOf('window._renderHomeClassTt();'));
  check('운영 배지를 다시 그릴 때 정리한다', /home-op-tag'\)\?\.remove\(\)/.test(cls), cls.slice(-500));
}

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
