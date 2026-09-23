// 업무 D-day 가 아침에 하루씩 밀려 보이던 것.
//
// `new Date().toISOString().slice(0,10)` 은 **UTC 날짜**다. 한국은 UTC+9 라
// 새벽 0시부터 아침 9시 사이에는 UTC 가 아직 어제다. 그 시간대에는 '오늘'이
// 하루 전으로 잡혀 D-day 가 하나씩 크게 나왔다.
//
// 하필 선생님들이 출근해서 현황판을 여는 시간이 그 안이다. 틀려야 할 때 딱
// 틀리는 종류의 버그다.
//
// 같은 뿌리로 두 군데가 더 있었다.
//   · 새 일정의 기본 날짜 — 아침에 만들면 어제가 기본값
//   · 반복 일정 펼치기 — 기기 시계 자정을 UTC 로 찍어 **전부 하루씩 앞당겨짐**
//
// 그래서 이 검사는 **가짜 시계**를 그 시간대에 놓고 돌린다. 기계의 시간대가
// 무엇이든(검사 기계는 UTC 다) 결과가 같아야 한다.
process.env.TZ = 'Asia/Seoul';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// 한국 시각으로 돌려야 ttISO 가 실제와 같게 동작한다.
const ctx = await b.newContext({ timezoneId: 'Asia/Seoul' });
const pg = await ctx.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent('<!doctype html><meta charset="utf-8"><body>');

// 스크립트는 HTML 에 끼워 넣지 않고 따로 주입한다. 원본 함수에 템플릿 문자열과
// 태그 조각이 잔뜩 들어 있어, <script> 안에 붙이면 HTML 파서를 먼저 지나며 깨진다.
await pg.addScriptTag({ content: `
  ${grab('ttISO')}
  ${grab('_makeHomeTaskRow')}
  const escapeHtml = v => String(v).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 원본 행 그리기가 부르는 것들 — 여기서 보는 것은 D-day 뿐이라 자리만 채운다.
  function formatMytaskDateRange(t){ return t.endDate || ''; }
  function mytaskInlineStatusHtml(){ return '<span></span>'; }
  window._myUid = 'me';

  // 원본이 '오늘'을 잡는 방식을 그대로 떼어 온다. 여기 날짜를 옮겨 적으면
  // 원본이 UTC 로 되돌아가도 검사가 통과해 버린다.
  ${(() => {
    const src = grab('renderHomeTaskSection');
    const m = /const todayStr   = [^\n]+/.exec(src);
    if (!m) throw new Error("renderHomeTaskSection 에서 todayStr 을 못 찾음");
    return `window.today_ = () => { ${m[0]} return todayStr; };`;
  })()}

  // 행을 통째로 돌려주고 D-day 만 골라내는 일은 바깥(Node)에서 한다.
  // 여기 안은 템플릿 문자열이라 정규식의 역슬래시가 먹혀 버린다.
  window.row_ = (endDate, status) => _makeHomeTaskRow(
    { id:'t', title:'x', startDate: endDate, endDate, status: status || 'todo', ownerUid: 'me' },
    window.today_(), { todo:'#000', doing:'#000' });
` });

if (errs.length) { console.log('하네스 오류:', errs.join('\n')); process.exit(1); }

const setClock = kst => pg.evaluate(iso => {
  const t = new Date(iso).getTime();
  const Real = Date;
  class Fake extends Real {
    constructor(...a){ if (!a.length) super(t); else super(...a); }
    static now(){ return t; }
  }
  window.Date = Fake;
}, kst);

const today = () => pg.evaluate(() => window.today_());
const dday  = async (end, st) => {
  const html = await pg.evaluate(([e, s]) => window.row_(e, s), [end, st]);
  const m = /(D-day|D-\d+|D\+\d+)/.exec(html);
  return m ? m[1] : null;
};

// 2026-09-23 08:00 KST = 2026-09-22 23:00 UTC  ← UTC 는 아직 어제다
const MORNING = '2026-09-23T08:00:00+09:00';
// 2026-09-23 20:00 KST = 2026-09-23 11:00 UTC  ← 둘이 같은 날
const EVENING = '2026-09-23T20:00:00+09:00';

console.log('\n■ 아침 8시 — UTC 는 아직 어제인 시각 (실제로 틀리던 자리)');
{
  await setClock(MORNING);
  check("'오늘'을 기기 시계로 잡는다", (await today()) === '2026-09-23', await today());
  check('오늘 마감 → D-day', (await dday('2026-09-23')) === 'D-day', await dday('2026-09-23'));
  check('내일 마감 → D-1',   (await dday('2026-09-24')) === 'D-1',   await dday('2026-09-24'));
  check('모레 마감 → D-2',   (await dday('2026-09-25')) === 'D-2',   await dday('2026-09-25'));
  check('어제 마감 → D+1',   (await dday('2026-09-22')) === 'D+1',   await dday('2026-09-22'));
}

console.log('\n■ 저녁 8시 — UTC 와 같은 날 (원래도 맞던 자리)');
{
  await setClock(EVENING);
  check("'오늘'이 그대로다", (await today()) === '2026-09-23');
  check('오늘 마감 → D-day', (await dday('2026-09-23')) === 'D-day');
  check('내일 마감 → D-1',   (await dday('2026-09-24')) === 'D-1');
  check('어제 마감 → D+1',   (await dday('2026-09-22')) === 'D+1');
}

console.log('\n■ 자정 직후 — 제일 어긋나던 시각');
{
  await setClock('2026-09-23T00:05:00+09:00');
  check("'오늘'이 벌써 23일이다", (await today()) === '2026-09-23', await today());
  check('오늘 마감 → D-day', (await dday('2026-09-23')) === 'D-day', await dday('2026-09-23'));
}

console.log('\n■ 9시를 넘기면 (UTC 도 같은 날이 된다)');
{
  await setClock('2026-09-23T09:30:00+09:00');
  check("'오늘'이 안 바뀐다", (await today()) === '2026-09-23');
  check('오늘 마감 → D-day', (await dday('2026-09-23')) === 'D-day');
}

console.log('\n■ 완료한 업무에는 D-day 를 안 붙인다');
{
  await setClock(MORNING);
  check('완료면 비어 있다', (await dday('2026-09-20', 'done')) === null,
        await dday('2026-09-20', 'done'));
}

console.log('\n■ 같은 뿌리의 다른 두 자리');
{
  // 새 일정의 기본 날짜 — 아침에 만들면 어제가 기본값이 됐다.
  check('새 일정 기본 날짜도 기기 시계로',
        /const todayDefault = ttISO\(new Date\(\)\);/.test(HTML));
  // 반복 일정 — 기기 시계 자정을 UTC 로 찍으면 하루 앞당겨진다.
  check('반복 일정 시작일도 기기 시계로', /const curStr = ttISO\(cur\);/.test(HTML));
  check('반복 일정 마감일도 기기 시계로', /endDate: ttISO\(endCur\)/.test(HTML));

  // 업무 쪽에 UTC 로 날짜를 찍는 자리가 남아 있으면 안 된다.
  // (사용현황 usageDate 는 KST 로 미리 밀어 두고 쓰므로 예외다)
  const left = [...HTML.matchAll(/^.*toISOString\(\)\.slice\(0, ?10\).*$/gm)]
    .map(m => m[0].trim())
    .filter(l => !/usageKst\(\)/.test(l));
  check('UTC 로 날짜를 찍는 자리가 남아 있지 않다', left.length === 0, left);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
