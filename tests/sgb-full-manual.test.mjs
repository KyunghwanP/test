// 생기부 보조자료 탭 — 전체화면 · 사용설명서 모달(앱 쪽, index.html). 선생님 요청 2026-10-29: "탭으로 들어왔을 때 답답하다".
// 단추는 생기부 화면(saenggibu.html) 위쪽 줄에 있고 누르면 앱에 알린다(그쪽은 saenggibu.test.mjs 가 본다).
// 여기서는 index.html 에서 실제 코드(CSS · 모달 껍데기 · 함수)를 떼어 와 작은 앱 화면을 만들고, 안쪽 창이 보내는 알림대로
// ① 생기부 화면이 앱 머리·메뉴를 덮고 창을 꽉 채우는지(다시 끄면 원래대로) ② 설명서 모달이 맞는 탭으로 열리고 닫히는지 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const ROOT = import.meta.dirname + '/..';
const HTML = fs.readFileSync(ROOT + '/index.html', 'utf8');
const MANUAL = fs.readFileSync(ROOT + '/saenggibu-manual.html', 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));
const between = (a, z) => { const i = HTML.indexOf(a); if (i < 0) throw new Error('못 찾음: ' + a); const j = HTML.indexOf(z, i); if (j < 0) throw new Error('못 찾음: ' + z); return HTML.slice(i, j + z.length); };

console.log('\n■ 배선 (정적)');
const CSS = between('/* 적정 대학 진단(jindan.html) 모달', 'html.dark .sgbm-head b{color:#E8EEF7;}');
const MODAL = between('<div class="jd-overlay" id="sgbManualModal">', '</iframe>\n  </div>\n</div>');
const JS = between('// ── 생기부 보조자료 — 전체화면 · 사용설명서 ──', "if (k.key === 'Escape') closeSgbManual(); }); } catch (err) {}\n});");
check('전체화면 CSS — 생기부 화면이 창 가득(앱 머리·메뉴 위, 모달 아래)', /#saenggibuPage\.sgb-full\.active\{position:fixed;inset:0;z-index:8900;/.test(CSS));
check('설명서 모달 — 진단 모달 껍데기(jd-overlay) + 제목 줄 + 닫기 + iframe', MODAL.includes('class="sgbm-head"') && MODAL.includes('id="sgbManualClose"') && MODAL.includes('<iframe id="sgbManualFrame"'));
check('뒤로가기 — 설명서 모달, 그다음 전체화면', /getElementById\('sgbManualModal'\)\?\.classList\.contains\('open'\)\) \{ closeSgbManual\(\); armExitGuard\(\); return; \}/.test(HTML)
  && /if \(_sgbFull\) \{ setSgbFull\(false\); armExitGuard\(\); return; \}/.test(HTML));
check('다른 탭으로 옮기면 전체화면을 푼다', /if\(page === 'saenggibu'\) openSaenggibuFrame\(\);\n\s*else if\(_sgbFull\) setSgbFull\(false\);/.test(HTML));
check('생기부 화면이 (다시) 뜨면 전체화면 상태를 알려 준다(단추 글자)', /f\.dataset\.ready = '1'; sgbFlushGo\(\);\s*\n\s*try \{ f\.contentWindow\.postMessage\(\{ type: 'sgb-full-state', on: _sgbFull \}/.test(HTML));

console.log('\n■ 작은 앱 화면에서');
const ORIGIN = 'https://kyunghwanp.github.io';
const APP = `<!doctype html><meta charset="utf-8"><style>
  :root{--bg-base:#f8fafc} body{margin:0;font-family:sans-serif}
  .app-header{height:56px;background:#123;color:#fff;position:relative;z-index:50}
  .shell{display:flex;height:calc(100vh - 56px)} .main-nav{width:200px;background:#ddd}
  .page-view{display:none;flex:1;overflow:auto;} .page-view.active{display:flex;flex-direction:column;}
  ${CSS}</style>
  <div class="app-header">앱 머리</div>
  <div class="shell"><div class="main-nav">메뉴</div>
    <div class="page-view active" id="saenggibuPage"><iframe id="saenggibuPageFrame" src="child.html" style="flex:1;width:100%;border:0"></iframe></div></div>
  ${MODAL}
  <script type="module">
    let exitArmTimer = null; const APP_VER = 'tver';
    function isOutsideClick(e){ return e.target === e.currentTarget; }
    function armExitGuard(){}
    ${JS}
    window.__api = { setSgbFull, closeSgbManual, state: () => ({ full: _sgbFull }) };
  </script>`;
const CHILD = `<!doctype html><meta charset="utf-8"><body>생기부<script>
  window.__got = []; addEventListener('message', e => { if (e.origin === location.origin) window.__got.push(e.data); });
  window.send = d => parent.postMessage(d, location.origin);
</script>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route(ORIGIN + '/test/app.html', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: APP }));
await ctx.route(ORIGIN + '/test/child.html', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CHILD }));
await ctx.route(ORIGIN + '/test/saenggibu-manual.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: MANUAL }));
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(ORIGIN + '/test/app.html');
const child = await (await p.waitForSelector('#saenggibuPageFrame')).contentFrame();
await child.waitForFunction(() => typeof window.send === 'function');
const box = () => p.evaluate(() => { const pg = document.getElementById('saenggibuPage'), r = pg.getBoundingClientRect();
  return { full: pg.classList.contains('sgb-full'), pos: getComputedStyle(pg).position, x: r.x, y: r.y, w: r.width, h: r.height, z: getComputedStyle(pg).zIndex }; });

const b0 = await box();
check('처음 — 앱 머리·메뉴 안쪽에 있다(답답한 그 상태)', !b0.full && b0.x === 200 && b0.y === 56, b0);
await child.evaluate(() => window.send({ type: 'sgb-full', on: true }));
await p.waitForTimeout(150);
const b1 = await box();
check('「⛶ 전체화면」 — 창을 꽉 채운다(앱 머리·메뉴를 덮음)', b1.full && b1.pos === 'fixed' && b1.x === 0 && b1.y === 0 && b1.w === 1280 && b1.h === 800 && +b1.z > 50, b1);
check('— 안쪽 창에 「전체화면 켜짐」 을 알려 준다(단추가 「원래 크기」 로)', (await child.evaluate(() => window.__got)).some(m => m.type === 'sgb-full-state' && m.on === true));
const top = await p.evaluate(() => { const el = document.elementFromPoint(100, 20); return el && (el.id || el.className || el.tagName); });
check('— 앱 머리 자리를 눌러도 생기부 화면이 받는다', top === 'saenggibuPageFrame', top);
await child.evaluate(() => window.send({ type: 'sgb-full', on: false }));
await p.waitForTimeout(150);
const b2 = await box();
check('다시 누르면 원래 자리로', !b2.full && b2.x === 200 && b2.y === 56, b2);
check('— 안쪽 창에 「꺼짐」 도 알려 준다', (await child.evaluate(() => window.__got)).filter(m => m.type === 'sgb-full-state').map(m => m.on).join() === 'true,false');
await p.evaluate(() => window.postMessage({ type: 'sgb-full', on: true }, location.origin));   // 생기부 창이 아닌 곳에서 온 알림
await p.waitForTimeout(100);
check('생기부 창이 보낸 것이 아니면 듣지 않는다', !(await box()).full);

await child.evaluate(() => window.send({ type: 'sgb-manual', tab: 'upload' }));
await p.waitForTimeout(150);
const m1 = await p.evaluate(() => ({ open: document.getElementById('sgbManualModal').classList.contains('open'),
  src: document.getElementById('sgbManualFrame').getAttribute('src'), nt: document.getElementById('sgbManualNewTab').getAttribute('href') }));
check('「📖 사용설명서」 — 앱 모달로, 부서·교과 탭(#upload) · 새 탭 단추도 같은 주소', m1.open && m1.src === 'saenggibu-manual.html?v=tver#upload' && m1.nt === m1.src, m1);
const man = await (await p.$('#sgbManualFrame')).contentFrame();
await man.waitForSelector('#upload');
const tabs = await man.evaluate(() => ({ u: getComputedStyle(document.getElementById('upload')).display !== 'none', w: getComputedStyle(document.getElementById('write')).display !== 'none' }));
check('— 모달 안 설명서가 부서·교과 탭을 보여 준다', tabs.u && !tabs.w, tabs);
const cover = await p.evaluate(() => { const r = document.querySelector('#sgbManualModal .jd-box').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
check('— 모달이 앱 화면 대부분을 쓴다(1240px · 94vh 안)', cover.w >= 1200 && cover.h >= 700, cover);
await man.click('#upload h1');
await man.press('body', 'Escape');
await p.waitForTimeout(150);
check('— 설명서 안을 누른 뒤에도 Esc 로 닫힌다', !(await p.evaluate(() => document.getElementById('sgbManualModal').classList.contains('open'))));
await child.evaluate(() => window.send({ type: 'sgb-manual', tab: 'write' }));
await p.waitForTimeout(150);
check('담임은 담임 탭(#write)', (await p.getAttribute('#sgbManualFrame', 'src')).endsWith('#write'));
await p.click('#sgbManualClose');
check('— ✕ 로 닫힌다(프레임도 비움)', !(await p.evaluate(() => document.getElementById('sgbManualModal').classList.contains('open')))
  && (await p.getAttribute('#sgbManualFrame', 'src')) === 'about:blank');
await child.evaluate(() => window.send({ type: 'sgb-full', on: true }));
await child.evaluate(() => window.send({ type: 'sgb-manual', tab: 'write' }));
await p.waitForTimeout(200);
const stack = await p.evaluate(() => { const el = document.elementFromPoint(640, 400); return !!el?.closest('#sgbManualModal'); });
check('전체화면 위에도 설명서 모달이 뜬다', stack);
check('오류 없음', !errs.length, errs);
await b.close();

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
