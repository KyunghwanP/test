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
  'return { get todayDay(){return todayDay;}, get currentPeriod(){return currentPeriod;},',
  '         get renders(){return renders;}, recomputeTimeState, syncTimeState };'
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
console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
