// 학생 종합검색 — 상세의 「📈 성적 / 📑 생기부 보조자료」 탭.
// 보조자료는 saenggibu.html 을 '한 학생만 보기'(?embed=1&k=학년-반-번호)로 띄운다.
// 성적 권한이 없는 반이면 성적 탭을 흐리게 하고 보조자료를 연다.
// index.html 의 탭 함수를 그대로 떼어 와 진짜 브라우저에서 누른다.
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
};

console.log('\n■ 원본 배선 (정적)');
const detail = grab('s360ShowDetail');
check('밑줄 탭 — 회색 상자 대신 파란 줄', /\.s360-tabs\{[^}]*background:transparent[^}]*border-bottom:1px solid/.test(HTML) && /\.s360-ink\{[^}]*transition:left \.25s/.test(HTML));
check('탭에 회색 음영 없음(마우스를 올려도 글자색만)', !/\.s360-tabs \.students-tab:hover\{[^}]*background/.test(HTML));
check('탭 줄과 보조자료 칸은 s360SgbOn() 일 때만', /\$\{s360SgbOn\(\) \? `<div class="students-tab-row s360-tabs"/.test(detail) && /\$\{s360SgbOn\(\) \? `<div class="s360-pane-sgb"/.test(detail));
check('모든 교사(생기부 탭과 같은 조건)', /const s360SgbOn = \(\) => true;/.test(HTML));
check('권한 없는 반 — 성적 탭을 흐리게 하고 보조자료로', /gt\.disabled = true;[^\n]*\n?[^\n]*s360ShowTab\('sgb', s, true\)/.test(detail));
check('상세를 그린 뒤 탭을 붙인다', /s360BindTabs\(s\);/.test(detail));
check('그 반 담임·관리자에게만 탭 줄 오른쪽 「✏️ 작성하러 가기」', /\$\{s360CanWrite\(s\) \? '<button type="button" class="s360-write" id="s360WriteBtn"/.test(detail));

console.log('\n■ 눌러 보기');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage();
await page.route('https://kyunghwanp.github.io/test/**', r => r.request().url().includes('saenggibu.html')
  ? r.fulfill({ status: 200, contentType: 'text/html', body: '<p>sgb</p>' })
  : r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' }));
await page.goto('https://kyunghwanp.github.io/test/index.html');
const mount = async (opts = {}) => page.evaluate(([fns, opts]) => {
  document.body.innerHTML = `
    <div class="students-tab-row s360-tabs" id="s360Tabs2">
      <button type="button" class="students-tab" data-tab="grade">📈 성적</button>
      <button type="button" class="students-tab" data-tab="sgb">📑 생기부 보조자료</button>
      <span class="s360-ink" style="position:absolute;bottom:0;height:3px"></span>
    </div>
    <div class="spot-sec s360-pane-grade">성적</div>
    <div class="s360-pane-sgb" style="display:none;"><iframe id="s360SgbFrame" style="height:240px"></iframe></div>`;
  window.APP_VER = 'ver9.99';
  if (!window.__bound) { (0, eval)(fns); window.__bound = true; }
  s360BindTabs({ grade: '2', room: '03', num: '7' });
}, [grab('s360MoveInk') + grab('s360ShowTab') + grab('s360BindTabs') + "\nconst S360_TAB_LS = 'ynhs-s360-tab';\n"
     + HTML.match(/window\.addEventListener\('message', e => \{\n  if \(e\.origin !== location\.origin \|\| e\.data\?\.type !== 'sgb-height'\)[\s\S]*?\n\}\);/)[0], opts]);
await page.evaluate(() => localStorage.clear());
// 앱의 스타일을 그대로 얹는다 — 같은 이름 규칙이 뒤에서 덮는지까지 보려고(학생 비상연락망의 .students-tab-row 가 회색 상자를 덮어씌웠었다)
await page.addStyleTag({ content: [...HTML.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n') });
await mount();
const box = await page.$eval('#s360Tabs2', el => { const c = getComputedStyle(el); return { bg: c.backgroundColor, pad: c.paddingTop, r: c.borderTopLeftRadius,
  w: Math.round(el.getBoundingClientRect().width), pw: Math.round(el.parentElement.getBoundingClientRect().width), line: c.borderBottomStyle }; });
check('탭 뒤 회색 상자 없음 — 배경 투명·안쪽 여백 0·둥근 모서리 없음, 아래 회색 줄은 칸 너비 가득(선생님 요청 2026-10-28)',
  box.bg === 'rgba(0, 0, 0, 0)' && box.pad === '0px' && box.r === '0px' && box.line === 'solid' && box.w === box.pw, box);
const shown = () => page.evaluate(() => [getComputedStyle(document.querySelector('.s360-pane-grade')).display !== 'none',
  getComputedStyle(document.querySelector('.s360-pane-sgb')).display !== 'none']);
check('처음엔 성적 탭', JSON.stringify(await shown()) === '[true,false]' && await page.$eval('[data-tab="grade"]', x => x.classList.contains('active')));
const inkAt = () => page.evaluate(() => { const i = document.querySelector('.s360-ink'), on = document.querySelector('.students-tab.active');
  return Math.abs(parseFloat(i.style.left) - on.offsetLeft) < 1 && Math.abs(parseFloat(i.style.width) - on.offsetWidth) < 1; });
check('파란 줄이 고른 탭 아래(성적)', await inkAt());
check('보조자료는 누르기 전엔 안 띄운다(읽기 아끼기)', !(await page.$eval('#s360SgbFrame', f => f.getAttribute('src'))));
await page.click('[data-tab="sgb"]');
check('탭을 옮기면 파란 줄도 옮겨 간다(보조자료)', await inkAt());
check('보조자료 탭 — 그 학생 한 명만 보기로 띄운다(앞 0 없는 학년-반-번호)',
  (await page.$eval('#s360SgbFrame', f => f.getAttribute('src'))) === 'saenggibu.html?in=1&embed=1&k=2-3-7&v=ver9.99' && JSON.stringify(await shown()) === '[false,true]');
await page.evaluate(() => window.postMessage({ type: 'sgb-height', h: 777 }, location.origin));
await page.waitForTimeout(100);
check('다른 곳에서 온 높이 알림은 무시(그 프레임이 보낸 것만)', (await page.$eval('#s360SgbFrame', f => f.style.height)) === '240px');
await page.evaluate(() => {
  const f = document.getElementById('s360SgbFrame');
  f.contentWindow.eval("parent.postMessage({ type: 'sgb-height', h: 777 }, location.origin)");
});
await page.waitForFunction(() => document.getElementById('s360SgbFrame').style.height === '777px');
check('프레임이 알려 준 높이로 늘린다', true);
await mount();
check('마지막에 고른 탭을 기억한다(다음 학생도 보조자료)', JSON.stringify(await shown()) === '[false,true]');
await page.evaluate(() => { localStorage.setItem('ynhs-s360-tab', 'grade'); });
await mount();
await page.evaluate(() => { const gt = document.querySelector('[data-tab="grade"]'); gt.disabled = true; s360ShowTab('sgb', { grade: 2, room: 3, num: 7 }, true); });
check('권한 없는 반 — 성적 탭은 흐리고 보조자료가 열린다', JSON.stringify(await shown()) === '[false,true]' && await page.$eval('[data-tab="grade"]', x => x.disabled));
await page.click('[data-tab="grade"]', { force: true });
check('흐린 성적 탭은 눌러도 안 바뀐다', JSON.stringify(await shown()) === '[false,true]');
check('자동 전환은 기억하지 않는다(다른 반 학생은 다시 성적부터)', (await page.evaluate(() => localStorage.getItem('ynhs-s360-tab'))) === 'grade');

console.log('\n■ 「✏️ 작성하러 가기」');
const cw = await page.evaluate(([fn, same]) => {
  (0, eval)(same + fn + "\nvar ADMIN_EMAIL = 'admin@x';");
  const r = (email, hr, va, g, c) => { window.fbAuth = { currentUser: { email } }; window.getMyHomeroom = () => hr; window.isViewAs = () => va; return s360CanWrite({ grade: g, room: c }); };
  return [r('kim@x', '1-1', false, '1', '01'), r('kim@x', '1-1', false, '1', '2'), r('admin@x', null, false, '3', '2'), r('kim@x', '1-1', true, '1', '1'), r('lee@x', null, false, '1', '1')];
}, [grab('s360CanWrite'), grab('sameClassKey')]);
check('그 반 담임(\'01\' 표기도)·관리자만 — 다른 반 담임·가장 모드·담임 아님은 단추 없음', JSON.stringify(cw) === '[true,false,true,false,false]', cw);
const go = await page.evaluate(src => {
  document.body.insertAdjacentHTML('beforeend', '<iframe id="saenggibuPageFrame"></iframe>');
  (0, eval)(src);
  window.__nav = []; window.navigateTo = p => window.__nav.push(p);
  const f = document.getElementById('saenggibuPageFrame'), sent = [];
  f.contentWindow.postMessage = (m, o) => sent.push([m, o]);
  openSaenggibuWrite('1-1-3');
  const before = sent.length;
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'sgb-ready' }, origin: location.origin, source: window }));   // 다른 곳에서 온 「다 떴음」 은 무시
  const stranger = sent.length;
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'sgb-ready' }, origin: location.origin, source: f.contentWindow }));
  const afterReady = sent.length;
  openSaenggibuWrite('2-1-1');                                   // 이미 떠 있으면 바로
  return { nav: window.__nav, before, stranger, afterReady, sent };
}, 'var _sgbGo = null;\n' + grab('openSaenggibuWrite') + grab('sgbFlushGo')
   + HTML.match(/window\.addEventListener\('message', e => \{\n  if \(e\.origin !== location\.origin \|\| e\.data\?\.type !== 'sgb-ready'\)[\s\S]*?\n\}\);/)[0]);
check('누르면 생기부 탭으로 옮기고, 탭이 다 뜨면(그 프레임의 sgb-ready) 그 학생을 작성 칸 열기로 보낸다', go.nav.join() === 'saenggibu,saenggibu' && go.before === 0 && go.stranger === 0
  && go.afterReady === 1 && JSON.stringify(go.sent[0]) === JSON.stringify([{ type: 'sgb-open', k: '1-1-3', dr: 1 }, 'https://kyunghwanp.github.io']), go);
check('— 탭이 이미 떠 있으면 바로 보낸다', go.sent.length === 2 && go.sent[1][0].k === '2-1-1', go.sent);
check('탭을 새로 띄우면 「다 떴음」 표시를 지운다(다시 뜰 때까지 기다리게)', /f\.dataset\.ready = ''; f\.src = `saenggibu\.html\?in=1/.test(grab('openSaenggibuFrame')));
await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
