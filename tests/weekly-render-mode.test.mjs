// 주간교육활동을 어떻게 그리는가.
//
// 받아온 것은 구글 사이트의 마크업이다. 앱이 그걸 통째로 고쳐 그리면(글꼴 강제,
// 크기·색 덮어쓰기) 읽기는 편한데 원본과 디테일이 달라진다. 세 가지 방식을
// 놓고 고를 수 있게 해 뒀고, 여기서는 **각 방식이 실제로 무엇을 바꾸는지**를
// 실제 브라우저에서 계산된 스타일로 확인한다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,300) : ''));

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
const grabConst = name => {
  const m = new RegExp(`^const ${name} = `, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음(const): ' + name);
  let d = 0, q = null;
  for (let j = m.index; j < HTML.length; j++) {
    const c = HTML[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('{[('.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('끝을 못 찾음(const): ' + name);
};
// index.html 의 <style> 을 통째로 가져온다 — 실제로 덮어쓰는 그 규칙들이다
const STYLES = [...HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

console.log('\n■ 배선 (정적)');
check('세 가지 방식이 있다', /const WK_MODES = \[\['app'/.test(HTML));
check('고른 것을 기억한다', /localStorage\.getItem\(WK_MODE_KEY\)/.test(HTML));
check('전환은 관리자에게만 보인다',
      /fbAuth\.currentUser\?\.email === ADMIN_EMAIL && !isViewAs\(\)/.test(grab('renderWeeklyModeBar')));
check('전환할 때 다시 받아오지 않는다',
      /_wkLast = safe;/.test(HTML) && /if\(_wkLast\) renderContent\(_wkLast\)/.test(HTML));
check('원본 방식은 그림자 영역을 쓴다', /attachShadow\(\{ mode: 'open' \}\)/.test(HTML));
check('그림자 안에는 스티키만 넣는다',
      /position:sticky/.test(grabConst('WK_SHADOW_CSS'))
      && !/font-family/.test(grabConst('WK_SHADOW_CSS')));
check('죽은 코드가 아니라 실제로 그리는 곳에 붙였다',
      /weeklyMode === 'orig'/.test(grab('renderContent')));
check('스티키가 상단 바 높이를 따른다',
      /top:var\(--weekly-top-offset, 44px\)/.test(grabConst('WK_SHADOW_CSS')));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

// 사이트에서 오는 마크업을 흉내 낸다 — 인라인 글꼴·색·형광펜이 그대로 실려 온다
const SITE = `
  <h1 style="font-family:Georgia;color:#123456;font-size:30px">2026학년도 9월 1주</h1>
  <h2 style="font-family:Georgia;color:#800000;font-size:22px">1. 학사 일정</h2>
  <p style="font-family:'Courier New';font-size:13px;color:#333">9월 2일(수) 전교조회</p>
  <p><span style="background-color:#ffff00;font-size:13px">형광펜 강조</span></p>
  <p><a href="https://example.com" style="color:#0b57d0">첨부 파일</a></p>
  <p><b style="color:#c00000">굵은 빨강</b></p>
`;

await pg.setContent(`<!doctype html><meta charset="utf-8">
<style>${STYLES}</style>
<div id="weeklyTopBar" style="height:44px"></div>
<div class="weekly-page-content" id="weeklyPageContent"></div>
<script>
  const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';
  let _who = ADMIN_EMAIL;
  const fbAuth = { get currentUser(){ return { email: _who }; } };
  const isViewAs = () => false;
  window.__setWho = e => { _who = e; };
  const weeklyPageContent = document.getElementById('weeklyPageContent');
  let weeklyCurrentUrl = 'https://sites.google.com/x';
  function updateWeeklyTopOffset(){
    const h = document.getElementById('weeklyTopBar').getBoundingClientRect().height;
    document.querySelector('.weekly-html-content')?.style.setProperty('--weekly-top-offset', h + 'px');
  }
  ${grabConst('_wkColorCtx')}
  ${grab('wkParseColor')}
  ${grab('wkRgbToHsl')}
  ${grab('applyWeeklyDarkColors')}
  ${grabConst('WK_MODE_KEY')}
  ${grabConst('WK_MODES')}
  let weeklyMode = 'app';
  let _wkLast = null;
  ${grabConst('WK_SHADOW_CSS')}
  ${grab('renderWeeklyModeBar')}
  ${grab('renderContent')}
  window.setMode = m => { weeklyMode = m; };
  window.render = h => renderContent(h);
<\/script>`);

// 제목바에도 a 가 있다(원본보기 버튼). 본문 안에서만 재야 실제 차이가 보인다.
const styleOf = async (sel, inShadow) => pg.evaluate(([s, sh]) => {
  const root = sh ? document.querySelector('.wk-shadow-host').shadowRoot
                  : document.querySelector('.weekly-html-content');
  // 제목바로 개조된 h1 안에도 a 가 있다(원본보기). 본문 것만 골라야 한다.
  const el = [...root.querySelectorAll(s)].find(e => !e.closest('.weekly-forced-title')) || null;
  if (!el) return null;
  const c = getComputedStyle(el);
  return { ff: c.fontFamily, fs: c.fontSize, color: c.color, pos: c.position, top: c.top };
}, [sel, inShadow]);

console.log('\n■ 지금 방식 — 앱이 통째로 고쳐 그린다');
{
  await pg.evaluate(h => { window.setMode('app'); window.render(h); }, SITE);
  const p = await styleOf('p', false), a = await styleOf('a', false), h2 = await styleOf('h2', false);
  check('사이트 글꼴을 앱 글꼴로 바꾼다', /Noto Sans KR/.test(p.ff), p.ff);
  // 색 규칙에도 !important 가 없다. 사이트가 인라인으로 적어 준 색은 그대로 남는다.
  // 실제로 앱이 힘으로 덮는 것은 '글꼴' 하나뿐이다.
  check('인라인으로 적힌 색도 원본이 이긴다', a.color === 'rgb(11, 87, 208)', a.color);
  // 크기 규칙에는 !important 가 없다 → 사이트가 인라인으로 적어 준 크기는 살아남는다.
  // '앱이 크기까지 다 덮는다'는 것은 사실이 아니다.
  check('인라인으로 적힌 크기는 원본이 이긴다', p.fs === '13px' && h2.fs === '22px', { p: p.fs, h2: h2.fs });
}

console.log('\n■ 글꼴·색만 원본 — 실제로는 글꼴만 달라진다');
{
  await pg.evaluate(h => { window.setMode('plain'); window.render(h); }, SITE);
  const p = await styleOf('p', false), a = await styleOf('a', false), h2 = await styleOf('h2', false);
  check('사이트 글꼴이 살아난다', /Courier/.test(p.ff), p.ff);
  check('링크 색도 사이트 것', a.color === 'rgb(11, 87, 208)', a.color);
  check('크기는 그대로(원래도 인라인이 이겼다)', h2.fs === '22px', h2.fs);
}

console.log('\n■ 원본 그대로 — 앱 CSS 가 아예 안 닿는다');
{
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, SITE);
  check('그림자 영역에 들어간다', await pg.evaluate(() => !!document.querySelector('.wk-shadow-host')?.shadowRoot));
  const p = await styleOf('p', true), a = await styleOf('a', true), h2 = await styleOf('h2', true);
  check('사이트 글꼴 그대로', /Courier/.test(p.ff), p.ff);
  check('사이트 글자 크기 그대로', p.fs === '13px', p.fs);
  check('사이트 링크 색 그대로', a.color === 'rgb(11, 87, 208)', a.color);
  check('사이트 제목 크기 그대로', h2.fs === '22px', h2.fs);
  check('제목은 스티키다 — 이것만 손댄다', h2.pos === 'sticky', h2);
  check('상단 바(44px) 아래에 붙는다', h2.top === '44px', h2.top);
  // 앱의 h1 타이틀바 규칙이 사이트 h1 을 잡아먹으면 안 된다
  const h1 = await styleOf('h1', true);
  check('사이트 h1 도 제 모양', h1.fs === '30px' && !/Noto Sans KR/.test(h1.ff), h1);
}

console.log('\n■ 전환 막대');
{
  check('관리자에게는 보인다', await pg.evaluate(() => !!document.getElementById('wkModes')));
  check('세 칸이다', (await pg.$$eval('#wkModes button', e => e.length)) === 3);
  check('고른 것이 켜져 있다',
        (await pg.$eval('#wkModes button.on', e => e.dataset.wkMode)) === 'orig');
  await pg.evaluate(() => { window.__setWho('kim@yeungnam.hs.kr'); window.render('<p>x</p>'); });
  check('다른 교사에게는 안 보인다', await pg.evaluate(() => !document.getElementById('wkModes')));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
