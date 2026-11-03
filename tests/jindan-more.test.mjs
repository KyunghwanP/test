// 적정 대학 진단 — 결과 더 보기 / 내리면 더 보이기.
//
// 신고(2026-11): '결과 더 보기' 를 누르면 스크롤이 항상 위로 올라간다(카드·자세히·막대 모두).
//   원인: 더 보기가 목록을 통째로 지우고 다시 그린다. 앱처럼 iframe 안에서 실제로 누르면
//   페이지가 맨 위 근처로 튄다(13,480 → 672). '자세히' 는 표가 자기 안에서 스크롤되는
//   상자(max-height 72vh)라 그 상자의 스크롤도 0 으로 돌아간다.
//   그래서 이 검사는 앱처럼 iframe 에 넣고 마우스로 누른다 — page.evaluate 로 click() 을
//   부르면 고치기 전 코드도 튀지 않아 검사가 장식이 된다.
// 요청: 카드 말고(자세히·막대)는 아래로 내리면 저절로 더 나오고, 스크롤도 그대로.
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-more.test.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.env.JINDAN_FILE || 'jindan.html';
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.hostname !== 't.local') return r.abort();
  if (u.pathname === '/host.html')   // 앱이 진로진학 탭에서 여는 모양 그대로 — iframe 안
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
      body: `<!doctype html><body style="margin:0"><iframe id="f" src="/${FILE}?embed=1" style="width:100%;height:100vh;border:0"></iframe>` });
  const f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
  const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : 'text/plain';
  return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': type + '; charset=utf-8' } });
});
await pg.goto('http://t.local/host.html');
await pg.waitForFunction(() => document.getElementById('f').contentWindow?.document.getElementById('main-ui')?.classList.contains('show'), null, { timeout: 30000 });
const fr = pg.frames().find(f => f.url().includes(FILE));
const ev = (fn, a) => fr.evaluate(fn, a);
const btn = pg.frameLocator('#f').locator('#load-more-wrap button');
await ev(() => setRange('all'));   // 결과가 넉넉해야 더 보기가 생긴다

const ROW = { list: '.uni-table tbody tr', bar: '.bar-row', card: '.uni-card' };
const count = v => ev(sel => document.querySelectorAll(sel).length, ROW[v]);
const waitMore = async (v, n, ms = 2500) => {
  try { await fr.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [ROW[v], n], { timeout: ms }); return true; }
  catch { return false; }
};
const Y = () => ev(() => Math.round(scrollY));
const wrapTop = () => ev(() => { const w = document.querySelector('.uni-table-wrap'); return w ? Math.round(w.scrollTop) : -1; });
const settle = () => pg.waitForTimeout(400);

console.log(`\n■ 카드 (${FILE})`);
await ev(() => { setViewMode('card'); render(); });
let n0 = await count('card');
await btn.scrollIntoViewIfNeeded(); await settle();
let y0 = await Y();
await btn.click(); await settle();
let n1 = await count('card'), y1 = await Y();
check('단추를 누르면 150개 더', n1 === n0 + 150, { n0, n1 });
check('누른 뒤에도 페이지 스크롤 그대로 (재현: 13,480 → 672)', y0 > 3000 && Math.abs(y1 - y0) < 3, { y0, y1 });
await ev(() => scrollTo(0, document.documentElement.scrollHeight));
check('카드는 내려도 저절로 늘지 않는다 (단추로만)', !(await waitMore('card', n1, 1200)), await count('card'));

console.log('\n■ 자세히(표)');
await ev(() => { setViewMode('list'); render(); scrollTo(0, 0); });
n0 = await count('list');
check('처음엔 150줄', n0 === 150, n0);
await btn.scrollIntoViewIfNeeded();
await ev(() => { document.querySelector('.uni-table-wrap').scrollTop = 1500; }); await settle();
y0 = await Y(); let t0 = await wrapTop();
await btn.click(); await settle();
n1 = await count('list'); y1 = await Y(); let t1 = await wrapTop();
check('더 보기 → 300줄', n1 === 300, n1);
check('누른 뒤에도 표 안 스크롤 그대로 (재현: 0 으로)', t0 >= 1400 && Math.abs(t1 - t0) < 3, { t0, t1 });
check('누른 뒤에도 페이지 스크롤 그대로', Math.abs(y1 - y0) < 3, { y0, y1 });
await ev(() => { const w = document.querySelector('.uni-table-wrap'); w.scrollTop = w.scrollHeight; });
check('표 끝까지 내리면 저절로 더 나온다', await waitMore('list', n1), await count('list'));
check('저절로 늘 때도 표 스크롤이 위로 안 간다', (await wrapTop()) > t1, await wrapTop());

console.log('\n■ 막대');
await ev(() => { setViewMode('bar'); render(); scrollTo(0, 0); });
n0 = await count('bar');
check('처음엔 150줄', n0 === 150, n0);
await ev(() => scrollTo(0, 3000)); await settle();
check('중간까지만 내리면 그대로 150줄', (await count('bar')) === 150, await count('bar'));
await ev(() => scrollTo(0, document.documentElement.scrollHeight - innerHeight)); await settle();
y0 = await Y();
check('끝까지 내리면 저절로 더 나온다', await waitMore('bar', 150), await count('bar'));
await settle();
y1 = await Y();
check('저절로 늘 때 스크롤이 그 자리 그대로', y0 > 3000 && Math.abs(y1 - y0) < 3, { y0, y1 });
n1 = await count('bar');
check('한 번에 다 불러오지 않는다 (150개씩)', n1 <= 450, n1);

console.log('\n■ 조건을 바꾸면 처음부터');
await ev(() => { setViewMode('list'); render(); });
await ev(() => { document.querySelector('.uni-table-wrap').scrollTop = 2000; });
await ev(() => setRange(0.3));
check('범위를 바꾸면 표가 맨 위에서 다시 시작', (await wrapTop()) === 0, await wrapTop());

check('페이지 오류 없음', errs.length === 0, errs);
await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
