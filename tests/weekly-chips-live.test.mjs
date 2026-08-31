// 주간교육활동의 주차 칩이 새로고침 없이 늘어나는지.
//
// 주차 목록은 GitHub Action 이 긁어 weeklyData/index 에 넣는다. 예전에는 앱이
// 한 번만 읽어서, 앱을 열어 둔 사이에 새 주차가 올라와도 새로고침해야 보였다.
// 지금은 스냅샷으로 받는다 — 문서가 바뀌면 칩만 다시 그린다.
//
// index.html 은 Firebase 없이는 못 뜬다. 여기서는 주차 칩 배선만 원본에서
// 그대로 떼어내 붙인 하네스로 확인한다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,300) : ''));

const grab = name => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

console.log('\n■ 배선 (정적)');
check('주차 목록을 한 번만 읽지 않는다',
      !/getDoc\(doc\(fbDb, 'weeklyData', 'index'\)\)/.test(HTML));
check('스냅샷으로 본다', /onSnapshot\(doc\(fbDb, 'weeklyData', 'index'\)/.test(HTML));
check('탭을 나가면 구독을 끊는다',
      /function stopWeeklyWatch\(\)/.test(HTML) && /else stopWeeklyWatch\(\);/.test(HTML));
check('다시 들어오면 다시 켠다',
      /page === 'weekly'\)\{ if\(!weeklyInitialized\) initWeeklyPage\(\); else watchWeeklyIndex\(\); \}/.test(HTML));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1100, height: 800 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8">
<div id="weeklyWeekBar"></div>
<script>
  const weeklyWeekBar = document.getElementById('weeklyWeekBar');
  let weeklyCurrentUrl = 'BASE';
  const weeklyOpenLink = { href: '' };
  const weeklyPageContent = document.createElement('div');
  const fbDb = {};
  const doc = (db, coll, id) => ({ coll, id });
  const getDoc = async () => ({ exists: () => false, data: () => ({}) });
  // 가짜 onSnapshot — window.__push(weeks) 로 서버가 문서를 바꾼 척한다
  let _cb = null;
  function onSnapshot(ref, cb){ _cb = cb; return () => { _cb = null; }; }
  window.__push = weeks => _cb && _cb({ exists: () => true, data: () => ({ weeks }) });
  window.__live = () => !!_cb;
  const formatWeekChipText = t => t;
  function renderContent(){}
  function fetchViaProxy(){ return Promise.resolve(''); }
  function parseSitesResponse(){ return { navLinks: [], contentHtml: '' }; }

  ${grab('watchWeeklyIndex')}
  ${grab('stopWeeklyWatch')}
  ${grab('renderWeekChipsFromFirestore')}

  let weeklyIndexUnsub = null, weeklyWeeksSig = '';
  window.watchWeeklyIndex = watchWeeklyIndex;
  window.stopWeeklyWatch = stopWeeklyWatch;
  window.pick = href => { weeklyCurrentUrl = href; };
  window.chips = () => [...weeklyWeekBar.querySelectorAll('.weekly-week-chip')]
    .map(c => c.textContent + (c.classList.contains('active') ? '*' : ''));
  watchWeeklyIndex();
</script>`);

const W = n => Array.from({ length: n }, (_, i) => ({ text: `${i + 1}주차`, href: 'w' + (i + 1) }));

console.log('\n■ 스크랩이 끝나면 칩이 늘어난다');
{
  check('구독이 걸려 있다', await pg.evaluate(() => window.__live()));
  await pg.evaluate(w => window.__push(w), W(3));
  check('처음 3주차가 그려진다',
        JSON.stringify(await pg.evaluate(() => window.chips())) === '["1주차*","2주차","3주차"]',
        await pg.evaluate(() => window.chips()));

  // 스크래핑이 4주차를 올렸다 — 새로고침 없이 칩이 늘어야 한다
  await pg.evaluate(w => window.__push(w), W(4));
  const after = await pg.evaluate(() => window.chips());
  check('새 주차가 새로고침 없이 붙는다', after.length === 4 && after[3] === '4주차', after);
}

console.log('\n■ 보고 있던 주차가 그대로 켜져 있어야 한다');
{
  // 2주차를 보는 중에 5주차가 올라오면, 첫 칩으로 튀면 안 된다
  await pg.evaluate(() => window.pick('w2'));
  await pg.evaluate(w => window.__push(w), W(5));
  const c = await pg.evaluate(() => window.chips());
  check('선택이 유지된다', c.filter(x => x.endsWith('*')).join() === '2주차*', c);
  check('5주차까지 늘었다', c.length === 5, c);

  // 목록에 없는 주차를 보고 있으면(캐시 등) 첫 칩을 켠다
  await pg.evaluate(() => window.pick('없는주차'));
  await pg.evaluate(w => window.__push(w), W(6));
  const c2 = await pg.evaluate(() => window.chips());
  check('선택한 게 목록에 없으면 첫 칩', c2.filter(x => x.endsWith('*')).join() === '1주차*', c2);
}

console.log('\n■ 같은 목록이면 다시 그리지 않는다');
{
  await pg.evaluate(() => window.pick('w3'));
  await pg.evaluate(w => window.__push(w), W(6));   // 아까와 같은 6주차 목록
  const c = await pg.evaluate(() => window.chips());
  // 다시 그렸다면 w3 가 켜졌을 것이다 — 안 그렸으니 1주차가 그대로여야 한다
  check('같은 목록에는 손대지 않는다', c.filter(x => x.endsWith('*')).join() === '1주차*', c);
}

console.log('\n■ 탭을 나가면 끊는다');
{
  await pg.evaluate(() => window.stopWeeklyWatch());
  check('구독이 끊겼다', !(await pg.evaluate(() => window.__live())));
  await pg.evaluate(() => window.watchWeeklyIndex());
  check('다시 켜면 붙는다', await pg.evaluate(() => window.__live()));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
