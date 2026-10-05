// 업무캘린더 패널 — 날짜(기간) 필터는 목록에만 걸린다.
//
// 예전에는 목록에서 고른 기간(예: 이번달)이 패널에 남은 채 달력으로 바꾸면, 기간 단추는
// 안 보이는데 거르는 것은 그대로였다. 지난달로 넘기면 완료 업무가 하나도 안 떴다.
// 달력은 ‹ › 로 넘기는 달이 곧 날짜 필터다. 목록의 날짜 필터는 머리 오른쪽에 늘 보인다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));
const grab = name => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) { if (HTML[j] === '{') d++; else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1); }
};

console.log('\n■ 원본 (정적)');
check('목록 패널 머리 오른쪽에 날짜 필터(선택 상자)', /panel\.type==='list' \? `<select class="phd-period/.test(HTML) && /onchange="setPanelPeriod\(\$\{row\.id\},\$\{panel\.id\},this\.value\)"/.test(HTML));
check('기간을 고르면(전체 말고) 색으로 드러난다', /\.phd-period\.on\{/.test(HTML));

console.log('\n■ 실제로 그려 본다 — 오늘 2026-10-05, 패널 기간 = 이번달');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
await pg.clock.setFixedTime(new Date('2026-10-05T10:00:00+09:00'));
await pg.setContent('<div id="pc_1"></div><div id="pc_2"></div>');
await pg.addScriptTag({ content: `
  let mytaskYear = 2026, mytaskMonth = 9;
  window.seen = {};
  const mytaskTasks = [
    { id:'a', title:'지난달 완료', status:'done', startDate:'2026-09-10', endDate:'2026-09-10' },
    { id:'b', title:'이번달 완료', status:'done', startDate:'2026-10-02', endDate:'2026-10-02' },
    { id:'c', title:'지난달 진행', status:'doing', startDate:'2026-09-20', endDate:'2026-09-21' },
  ];
  const mytaskEffTask = t => t;
  const buildPanelCalendar = (tasks) => { seen.cal = tasks.map(t => t.id); return ''; };
  const buildPanelList = (tasks) => { seen.list = tasks.map(t => t.id); return ''; };
  const adjustCalChips = () => {}, bindDayPreview = () => {}, consultCalItems = () => [];
  ${grab('filterByPanelPeriod')}
  ${grab('renderPanelContent')}
`});
const r = await pg.evaluate(() => {
  renderPanelContent({ id: 1, type: 'calendar', period: 'month', calYear: 2026, calMonth: 8, filters: { status: ['done'] } });
  renderPanelContent({ id: 2, type: 'list', period: 'month', filters: { status: ['done'] } });
  return seen;
});
check('달력 — 목록에서 고른 「이번달」 이 남아 있어도 지난달 완료 업무가 나온다', JSON.stringify(r.cal) === '["a","b"]', r.cal);
check('목록 — 「이번달」 이면 이번 달 것만 (날짜 필터는 그대로)', JSON.stringify(r.list) === '["b"]', r.list);
const r2 = await pg.evaluate(() => {
  renderPanelContent({ id: 1, type: 'calendar', period: 'month', calYear: 2026, calMonth: 8, filters: { status: ['done','doing'] } });
  return seen.cal;
});
check('달력 — 상태 필터(완료·진행중)는 그대로 걸린다', JSON.stringify(r2) === '["a","b","c"]', r2);
await b.close();

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
