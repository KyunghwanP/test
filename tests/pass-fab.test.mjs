// 외출증 FAB 이 '외출증 화면에서만' 뜨는지 — 실제 Chromium 에서 본다.
// FAB 은 position:fixed 라 #passPage 바깥에 있다. 그래서 화면 전환과 무관하게
// 떠 있기 쉽고, 실제로 모든 화면에 떠 있었다.
// CSS·마크업을 index.html 에서 그대로 떼어 온다 — 여기 옮겨 적으면 검사가 안 된다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const pick = (re, what) => { const m = re.exec(html); if (!m) throw new Error('못 찾음: ' + what); return m[0]; };

// 외출증 CSS 덩어리(FAB · 미디어쿼리 포함)
const ca = html.indexOf('/* ══════════════════════════════════════════\n     외출증 (조퇴·외출·결과)');
const cb = html.indexOf('/* 비상연락망 상세 팝업 */', ca);
if (ca < 0 || cb < 0) throw new Error('외출증 CSS 구간 못 찾음');
const css = html.slice(ca, cb);

// 화면 전환 규칙도 원본 그대로 쓴다
const pageCss = [pick(/^\s*\.page-view\{display:none;.*$/m, '.page-view'),
                 pick(/^\s*\.page-view\.active\{.*$/m, '.page-view.active')].join('\n');

// 외출증 마크업(#passPage + FAB + 모달) — 그 앞에 다른 화면을 하나 세워 둔다
const a = html.indexOf('<!-- 외출증 (조퇴·외출·결과) -->');
const b = html.indexOf('<!-- 시간표 페이지 -->', a);
const markup = html.slice(a, b);

const page_ = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{--rule:#ddd;--paper:#fff;--paper-soft:#f7f7f5;--ink:#222;--ink-soft:#777;}
  body{margin:0;}
${pageCss}
${css}
</style>
<div class="page-view active" id="otherPage">다른 화면</div>
${markup}`;

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
page.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });
await page.setContent(page_);

const fabShown = () => page.evaluate(() =>
  getComputedStyle(document.getElementById('passFab')).display !== 'none');
const setActive = on => page.evaluate(v => {
  document.getElementById('passPage').classList.toggle('active', v);
  document.getElementById('otherPage').classList.toggle('active', !v);
}, on);

console.log('\n── 모바일 폭(390px) ──');
await page.setViewportSize({ width: 390, height: 800 });
await setActive(false);
check('다른 화면에서는 안 보인다', await fabShown() === false);
await setActive(true);
check('외출증 화면에서는 보인다', await fabShown() === true);
await setActive(false);
check('화면을 옮기면 다시 사라진다', await fabShown() === false);

console.log('\n── 경계 폭 ──');
await page.setViewportSize({ width: 700, height: 800 });
await setActive(true);
check('700px 에서는 보인다(미디어쿼리 max-width:700px)', await fabShown() === true);
await page.setViewportSize({ width: 701, height: 800 });
check('701px 에서는 안 보인다', await fabShown() === false);

console.log('\n── 넓은 화면(1000px) ──');
await page.setViewportSize({ width: 1000, height: 800 });
await setActive(true);
check('외출증 화면이어도 안 보인다(헤더 버튼을 쓴다)', await fabShown() === false);
await setActive(false);
check('다른 화면에서도 안 보인다', await fabShown() === false);

console.log('\n── 위젯 모드 ──');
await page.setViewportSize({ width: 390, height: 800 });
await setActive(true);
await page.evaluate(() => document.documentElement.classList.add('widget-mode'));
check('위젯에서는 안 보인다', await fabShown() === false);
await page.evaluate(() => document.documentElement.classList.remove('widget-mode'));

await browser.close();
console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
