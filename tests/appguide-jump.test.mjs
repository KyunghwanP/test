// 모집요강 조회(appguide.html) — 주소로 쪽·검색어를 받아 그 자리로 가기.
//
// 진단 상세 창에서 '수능최저 쪽 보기' 를 누르면 그 대학 요강의 최저 표가 있는 쪽으로 바로 가야 한다.
//   ?code=대학코드&page=쪽        → 그 쪽으로
//   ?code=대학코드&q=최저학력      → 본문 검색(첫 자리로)
//   ?code=대학코드&page=쪽&q=낱말  → 그 쪽부터 찾은 첫 자리로(목차의 같은 낱말로 가지 않게)
// 바깥(어디가 프록시·cdnjs)은 막고, pdf.js 는 저장소의 pdfjs/build, PDF 는 저장소 docs/plan2026.pdf(140쪽)로 대신한다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PDF = path.join(ROOT, 'docs/plan2026.pdf');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const open = async (qs) => {
  const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('/pdf.min.js'))
      return r.fulfill({ status: 200, body: fs.readFileSync(path.join(ROOT, 'pdfjs/build/pdf.js')), headers: { 'content-type': 'text/javascript' } });
    if (u.hostname === 'cdnjs.cloudflare.com' && u.pathname.endsWith('/pdf.worker.min.js'))
      return r.fulfill({ status: 200, body: fs.readFileSync(path.join(ROOT, 'pdfjs/build/pdf.worker.js')), headers: { 'content-type': 'text/javascript' } });
    if (u.hostname.endsWith('workers.dev'))
      return r.fulfill({ status: 200, body: fs.readFileSync(PDF), headers: { 'content-type': 'application/pdf', 'access-control-allow-origin': '*' } });
    if (u.hostname !== 't.local') return r.abort();
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'text/javascript' : 'text/plain';
    return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': type + '; charset=utf-8' } });
  });
  await pg.goto('http://t.local/appguide.html?' + qs);
  await pg.waitForFunction(() => document.getElementById('pdfPageTotal').textContent === '140', null, { timeout: 30000 });
  return { pg, errs };
};
// 컨테이너 맨 위에 걸친 쪽
const topPage = pg => pg.evaluate(() => {
  const c = document.getElementById('pdfContainer'), top = c.getBoundingClientRect().top + 60;
  const ps = [...c.querySelectorAll('.pdf-page')];
  const i = ps.findIndex(d => d.getBoundingClientRect().bottom >= top);
  return i + 1;
});
// 화면 가운데 근처 쪽 (검색은 표시 자리를 가운데로 둔다)
const midPage = pg => pg.evaluate(() => {
  const c = document.getElementById('pdfContainer'), r = c.getBoundingClientRect(), y = (r.top + r.bottom) / 2;
  const ps = [...c.querySelectorAll('.pdf-page')];
  const i = ps.findIndex(d => { const q = d.getBoundingClientRect(); return q.top <= y && q.bottom >= y; });
  return i + 1;
});

console.log('\n■ page=');
{
  const { pg, errs } = await open('code=0002748&page=57');
  await pg.waitForTimeout(2200);   // 앞쪽 페이지가 그려지며 높이가 바뀌어도 다시 맞추는 시간(settleOnPage)
  check('57쪽으로 간다(맨 위에 57쪽)', await topPage(pg) === 57, await topPage(pg));
  check('쪽 번호 칸도 57', await pg.inputValue('#pdfPageInput') === '57', await pg.inputValue('#pdfPageInput'));
  check('오류 없음', errs.length === 0, errs);
  await pg.close();
}

console.log('\n■ q=');
{
  const { pg, errs } = await open('code=0002748&q=' + encodeURIComponent('안전'));
  await pg.waitForFunction(() => /\d+ \/ \d+/.test(document.getElementById('pdfCount').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(1500);
  const cnt = await pg.textContent('#pdfCount');
  check('검색 칸에 낱말이 들어가 있다', await pg.inputValue('#pdfSearch') === '안전');
  check('찾은 자리 수가 보인다(1 / N)', /^1 \/ \d+$/.test(cnt), cnt);
  const p = await midPage(pg);
  check('첫 자리(4쪽 근처)로 간다', p >= 3 && p <= 5, p);
  check('오류 없음', errs.length === 0, errs);
  await pg.close();
}

console.log('\n■ page= + q=');
{
  const { pg, errs } = await open('code=0002748&page=60&q=' + encodeURIComponent('안전'));
  await pg.waitForFunction(() => /\d+ \/ \d+/.test(document.getElementById('pdfCount').textContent), null, { timeout: 30000 });
  await pg.waitForTimeout(1500);
  const cnt = await pg.textContent('#pdfCount');
  const p = await midPage(pg);
  check('60쪽부터 찾은 첫 자리(79쪽 근처)로 간다 — 앞쪽 자리로 돌아가지 않는다', p >= 78 && p <= 80, { p, cnt });
  check('검색 번호는 1 이 아니다(앞쪽 자리를 건너뛰었다)', !/^1 \//.test(cnt), cnt);
  // 그 뒤 새로 검색하면 처음부터
  await pg.fill('#pdfSearch', '교육과정');
  await pg.waitForFunction(() => /^1 \/ \d+$/.test(document.getElementById('pdfCount').textContent), null, { timeout: 15000 });
  check('손으로 새로 찾으면 처음 자리부터(1 / N)', /^1 \//.test(await pg.textContent('#pdfCount')), await pg.textContent('#pdfCount'));
  check('오류 없음', errs.length === 0, errs);
  await pg.close();
}

console.log('\n■ 주소에 아무것도 없으면 예전 그대로');
{
  const { pg, errs } = await open('code=0002748');
  await pg.waitForTimeout(1000);
  check('1쪽에서 시작', await topPage(pg) === 1, await topPage(pg));
  check('검색 칸은 비어 있다', await pg.inputValue('#pdfSearch') === '');
  check('오류 없음', errs.length === 0, errs);
  await pg.close();
}

await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
