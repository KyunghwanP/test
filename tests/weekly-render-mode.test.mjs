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
// 괄호 깊이를 세어 선언 끝의 ';' 을 찾는다. 정규식 리터럴 안의 괄호까지 세면
// 깊이가 틀어져 뒤 코드를 통째로 삼킨다 — 실제로 두 번 당했다. 그래서 문자열과
// 정규식은 건너뛴다. '/' 가 나눗셈인지 정규식 시작인지는 바로 앞 글자로 가린다.
const grabConst = name => {
  const m = new RegExp(`^const ${name} = `, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음(const): ' + name);
  let d = 0, q = null, re = false, prev = '';
  for (let j = m.index; j < HTML.length; j++) {
    const c = HTML[j];
    if (re) { if (c === '\\') j++; else if (c === '[') re = 'cls';
              else if (c === ']' && re === 'cls') re = true;
              else if (c === '/' && re !== 'cls') re = false; continue; }
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '/' && '=(,:[!&|?{};\n'.includes(prev)) { re = true; continue; }
    if ('{[('.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) return HTML.slice(m.index, j + 1);
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error('끝을 못 찾음(const): ' + name);
};
// index.html 의 <style> 을 통째로 가져온다 — 실제로 덮어쓰는 그 규칙들이다
const STYLES = [...HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

console.log('\n■ 배선 (정적)');
check('네 가지 방식이 있다',
      /const WK_MODES = \[\['app','지금'\], \['plain','글꼴·색'\], \['orig','원본'\], \['plus','원본\+'\]\]/.test(HTML));
// 사이트를 통째로 iframe 으로 띄우는 것은 해 봤고 안 된다(구글이 삽입 차단).
// 지워 놓고 나중에 또 넣지 않도록 못 박는다.
check('iframe 으로 띄우려 하지 않는다',
      !/wk-frame-el|renderWeeklyFrame/.test(HTML) && /다시 시도하지 말 것/.test(HTML));
check('고른 것을 기억한다', /localStorage\.getItem\(WK_MODE_KEY\)/.test(HTML));
check('전환은 관리자에게만 보인다',
      /fbAuth\.currentUser\?\.email === ADMIN_EMAIL && !isViewAs\(\)/.test(grab('renderWeeklyModeBar')));
check('전환할 때 다시 받아오지 않는다',
      /_wkLast = safe;/.test(HTML) && /if\(_wkLast\) renderContent\(_wkLast\)/.test(HTML));
check('원본 방식은 그림자 영역을 쓴다', /attachShadow\(\{ mode: 'open' \}\)/.test(HTML));
check('그림자 안에 스티키가 있다', /position:sticky/.test(grabConst('WK_SHADOW_CSS')));
// 한글은 사이트와 똑같이 시스템 글꼴로 흘려보내야 한다. 여기서 Noto Sans KR 을
// 쓰면 사이트보다 '예뻐지고', 그게 곧 사이트와 달라지는 것이다.
{
  // 주석에 'Noto Sans KR' 을 언급할 수 있으니 선언만 본다.
  const decls = grabConst('WK_SHADOW_CSS').replace(/\/\*[\s\S]*?\*\//g, '');
  check('한글 글꼴을 앱 것으로 바꾸지 않는다',
        /font-family:'Noto Sans',Arial,sans-serif/.test(decls) && !/Noto Sans KR/.test(decls));
}
// 사이트가 쓰는 굵기 600·800 을 안 실으면 브라우저가 700 으로 뭉갠다.
check('사이트가 쓰는 굵기를 싣는다',
      /family=Noto\+Sans:wght@400;500;600;700;800/.test(HTML));
// 클래스 선택자(.wk-shadow-host)는 :host 를 이긴다. 바깥에서 여백을 주면
// 안쪽이 계산한 좌우 여백이 통째로 무시되고 스티키 제목만 삐져나온다.
check('바깥에서 그림자 상자에 여백을 주지 않는다',
      !/\.wk-shadow-host\{[^}]*padding/.test(STYLES));
check('죽은 코드가 아니라 실제로 그리는 곳에 붙였다',
      /if\(wkIsOrig\(\)\)\{/.test(grab('renderContent')));
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
  <p><small>· 일시: 9. 2.(수)</small><small>· 대상: 3학년</small></p>
`;

await pg.setContent(`<!doctype html><meta charset="utf-8">
<style>${STYLES}</style>
<!-- 실제 앱 뼈대 그대로: .weekly-body 가 스크롤 상자이고 좌우 4px 여백을 준다.
     원본 모드 카드는 휴대폰에서 그 4px 을 음수 마진으로 되돌려 화면을 꽉 채운다. -->
<div class="weekly-body">
  <div id="weeklyTopBar" style="height:44px"></div>
  <div class="weekly-page-content" id="weeklyPageContent"></div>
</div>
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
  ${grabConst('wkIsOrig')}
  ${grabConst('WK_SHADOW_CSS')}
  ${grabConst('WK_OPEN')}
  ${grabConst('WK_TOKEN')}
  ${grab('wkBlockOf')}
  ${grabConst('WK_INLINE')}
  ${grab('wkLineBox')}
  ${grab('wkSplitBr')}
  ${grabConst('wkIsHead')}
  ${grab('wkLead')}
  ${grabConst('WK_LEVEL')}
  ${grabConst('WK_STEP')}
  ${grab('wkLevelOf')}
  ${grabConst('WK_NUM')}
  ${grabConst('WK_HEAD_NUM')}
  ${grab('wkDropLeadWs')}
  ${grab('wkFirstTextX')}
  ${grab('wkHangIndent')}
  ${grabConst('WK_JUSTIFY_SLACK')}
  ${grab('wkJustifyEasy')}
  ${grabConst('WK_TIGHTEN')}
  ${grab('wkTightenTails')}
  ${grab('wkPlusTune')}
  ${grabConst('wkSquash')}
  ${grab('wkSameTitle')}
  ${grab('wkTitleEl')}
  ${grab('wkStripDupTitle')}
  ${grab('wkGroupDepts')}
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
  // 사이트 제목은 상자 밖으로 꺼내 앱 제목으로 다시 쓴다.
  const ttl = await pg.evaluate(() => {
    const el = document.querySelector('.wk-orig-title');
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    return { text: el?.textContent.trim(),
             ff: el && getComputedStyle(el).fontFamily,
             inBox: r.querySelectorAll('h1').length,
             // 제목이 상자보다 위에 있어야 한다
             above: el.getBoundingClientRect().bottom
                    <= document.querySelector('.wk-shadow-host').getBoundingClientRect().top };
  });
  check('사이트 제목을 상자 위 앱 제목으로 옮긴다',
        ttl.text === '2026학년도 9월 1주' && ttl.inBox === 0 && ttl.above, ttl);
  check('제목은 앱 글꼴로 쓴다', /Pretendard|Noto Sans KR/.test(ttl.ff), ttl.ff);
  // 프록시가 사이트 CSS 를 지워 보내서 한 줄씩이던 항목이 옆으로 붙는다.
  // 받아온 내용에 <br> 을 끼워 넣지 않고 표시 방식만 바꿔 되살린다.
  const sm = await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const a = r.querySelectorAll('small');
    return { disp: getComputedStyle(a[0]).display,
             sameLine: a[0].getBoundingClientRect().top === a[1].getBoundingClientRect().top,
             brAdded: r.querySelectorAll('br').length };
  });
  check('항목이 한 줄씩 나뉜다', sm.disp === 'block' && !sm.sameLine, sm);
  check('받아온 내용에 <br> 을 끼워 넣지 않는다', sm.brAdded === 0, sm);
}

// ── 사이트와 똑같은 글자 ────────────────────────────────────────────────
// 프록시는 사이트의 <style> 과 class 를 지우고 인라인 style 만 6가지 속성으로
// 걸러 넘긴다. 그래서 구글 사이트가 class 로만 정해 둔 글꼴·크기·굵기·줄간격은
// 아무것도 안 실려 온다. 아래 값은 실제 사이트에서 재 온 것이고, 그림자 안에서
// 태그별로 다시 적어 준다. 여기 숫자가 곧 '사이트와 같은가'의 기준이다.
console.log('\n■ 원본 그대로 — 사이트에서 잰 값과 같은가');
{
  // 프록시가 실제로 넘겨 주는 모습: class 도 style 도 없다.
  const BARE = `
    <h1>2026학년도 9월 1주 주간교육활동</h1>
    <h2>1. 학사 일정</h2>
    <h3>가. 전교조회</h3>
    <p>9월 2일(수) 1교시 체육관</p>
    <p><small>· 대상: 전교생</small></p>
    <p><a href="https://example.com">첨부 파일</a></p>
  `;
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, BARE);
  const measure = sel => pg.evaluate(s => {
    const el = document.querySelector('.wk-shadow-host').shadowRoot.querySelector(s);
    if (!el) return null;
    const c = getComputedStyle(el);
    return { ff: c.fontFamily, px: parseFloat(c.fontSize), w: c.fontWeight,
             lh: parseFloat(c.lineHeight) / parseFloat(c.fontSize), color: c.color };
  }, sel);
  const near = (a, b) => Math.abs(a - b) < 0.5;

  // 사이트 값: 본문 'Noto Sans' 500 / 14pt / 줄간격 1.38 / #1C1C1C
  const p1 = await measure('p');
  check('본문 글꼴이 사이트와 같다', /Noto Sans/.test(p1.ff) && !/Noto Sans KR/.test(p1.ff), p1.ff);
  check('본문 크기 14pt', near(p1.px, 14 * 96 / 72), p1.px);
  check('본문 굵기 500', p1.w === '500', p1.w);
  check('본문 줄간격 1.38', near(p1.lh * 100, 138), p1.lh);
  check('본문 글자색 #1C1C1C', p1.color === 'rgb(28, 28, 28)', p1.color);

  // h1(페이지 제목)은 상자 밖 앱 제목으로 빠졌다 — 여기서는 안 잰다.
  const h2 = await measure('h2'), h3 = await measure('h3');
  check('소제목(h2) 20pt · 800', near(h2.px, 20 * 96 / 72) && h2.w === '800', h2);
  check('중제목(h3) 16pt · 600', near(h3.px, 16 * 96 / 72) && h3.w === '600', h3);

  const sm = await measure('small');
  check('작은 글씨 12.5pt · 400', near(sm.px, 12.5 * 96 / 72) && sm.w === '400', sm);

  const a = await measure('a');
  check('링크 색 #0041A5', a.color === 'rgb(0, 65, 165)', a.color);

  // 사이트는 좁은 화면에서 소제목을 줄인다(20→19→18pt).
  await pg.setViewportSize({ width: 400, height: 800 });
  const h2s = await measure('h2');
  check('좁은 화면에서 부서 이름이 줄어든다', near(h2s.px, 18 * 96 / 72), h2s.px);
  // 스티키 제목이 배경으로 좌우를 덮어야 뒤 글자가 비쳐 보이지 않는다.
  // 여백이 16px 로 줄었으니 밀어내는 폭도 16px 이어야 한다.
  const bleed = await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const host = document.querySelector('.wk-shadow-host');
    return { h2: r.querySelector('h2').getBoundingClientRect().width,
             host: host.getBoundingClientRect().width };
  });
  check('스티키 제목이 좌우를 꽉 덮는다', near(bleed.h2, bleed.host), bleed);
  await pg.setViewportSize({ width: 1200, height: 800 });
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, SITE);
}

// ── 부서 구분 ───────────────────────────────────────────────────────────
// 사이트는 부서마다 배경 띠를 깔아 구분하는데, 그 띠는 class 로만 칠해져 있어
// 프록시를 못 넘어온다. 넘어오는 것 중 부서 경계를 알려 주는 건 h2 하나뿐이라,
// h2 부터 다음 h2 직전까지를 묶어 여기서 다시 칠한다.
console.log('\n■ 부서 구분');
{
  const DEPT = `
    <h1><span style="color:#FFD966">주간 교육활동 및 업무 안내</span></h1>
    <!-- 사이트는 제목을 한 번 더 싣는다. 이건 h1 이 아니라 색만 인라인으로
         실린 평범한 글이라 h1 규칙에 안 걸리고 흰 바탕에 옅은 노랑으로 남는다.
         두 군데의 띄어쓰기가 다를 수 있어서('업무 안내' / '업무안내'), 글자를
         그대로 맞대면 못 잡는다. 둘 다 넣어 둔다. -->
    <p><span style="color:#FFD966">주간 교육활동 및 업무 안내</span></p>
    <div><span style="color:#FFD966">주간 교육활동 및 업무안내</span></div>
    <h2>교무기획부</h2>
    <p>9월 2일(수) 전교조회</p>
    <p><small>· 대상: 전교생</small></p>
    <h2>학생안전부</h2>
    <p>9월 3일(목) 안전교육</p>
    <h2>진로진학부</h2>
    <p>9월 4일(금) 진학 설명회</p>
    <h2>교육연구부</h2>
    <p>9월 5일(토) 공개수업</p>
  `;
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, DEPT);
  const d = await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const secs = [...r.querySelectorAll('section.wk-dept')];
    return {
      n: secs.length,
      heads: secs.map(s => s.querySelector('h2')?.textContent.trim()),
      // 부서 안에 자기 항목만 들어 있는가 — 다음 부서 것까지 삼키면 안 된다
      items: secs.map(s => s.querySelectorAll('p').length),
      bg: secs.map(s => getComputedStyle(s).backgroundColor),
      // 띠와 띠 사이에 틈이 있으면 그리로 흰 바탕이 비친다
      gaps: secs.slice(1).map((s, i) =>
        Math.round(s.getBoundingClientRect().top - secs[i].getBoundingClientRect().bottom)),
      // 간격은 띠 안쪽에서 만든다 — 앞 부서 마지막 줄과 다음 부서 이름 사이
      inner: secs.slice(1).map((s, i) => {
        const prev = [...secs[i].children].pop();
        return Math.round(s.querySelector('h2').getBoundingClientRect().top
                          - prev.getBoundingClientRect().bottom);
      }),
      // 부서 이름: 밑줄 · 아래 여백 · 배경(자기 띠 색을 물려받아야 한다)
      h2: secs.map(s => {
        const c = getComputedStyle(s.querySelector('h2'));
        return { bw: c.borderBottomWidth, mb: parseFloat(c.marginBottom),
                 pb: parseFloat(c.paddingBottom), bg: c.backgroundColor };
      }),
    };
  });
  const dup = await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const sq = s => s.replace(/[\s\u00A0]+/g, '');
    const t = sq('주간 교육활동 및 업무 안내');
    return [...r.querySelectorAll('*')].filter(e => !e.children.length
             && sq(e.textContent) === t).length;
  });
  check('상자 안에 제목이 한 번 더 남지 않는다', dup === 0, dup);
  check('부서마다 하나씩 묶인다', d.n === 4, d.n);
  check('부서 이름이 제자리에 있다',
        JSON.stringify(d.heads) === JSON.stringify(['교무기획부','학생안전부','진로진학부','교육연구부']), d.heads);
  check('다음 부서 것까지 삼키지 않는다',
        JSON.stringify(d.items) === JSON.stringify([2,1,1,1]), d.items);
  // 사이트를 그대로 따른다: 맨 위(교감선생님)와 맨 아래(행정실)가 파랑,
  // 그 사이는 회색·흰색 번갈아.
  check('맨 위와 맨 아래가 파랑',
        d.bg[0] === 'rgb(224, 238, 245)' && d.bg[d.bg.length - 1] === 'rgb(224, 238, 245)', d.bg);
  check('사이는 회색·흰색이 번갈아 나온다',
        d.bg.slice(1, -1).every((c, i) =>
          c === (i % 2 === 0 ? 'rgb(241, 241, 241)' : 'rgb(255, 255, 255)')), d.bg);
  check('이웃한 부서는 배경색이 다르다',
        d.bg.slice(1).every((c, i) => c !== d.bg[i]), d.bg);
  check('띠와 띠가 맞붙어 흰 줄이 안 생긴다', d.gaps.every(g => g === 0), d.gaps);
  check('간격은 띠 안쪽에서 만든다', d.inner.every(g => g >= 30), d.inner);
  check('부서 이름에 밑줄이 있다', d.h2.every(h => h.bw === '1px'), d.h2.map(h => h.bw));
  check('부서 이름 아래에 여백이 있다',
        d.h2.every(h => h.mb >= 18 && h.pb >= 6), d.h2.map(h => [h.mb, h.pb]));
  // 흰색으로 박아 두면 회색·파랑 띠 위에서 부서 이름만 흰 판으로 떠 보인다.
  check('부서 이름 배경이 그 부서 띠와 같다',
        d.h2.every((h, i) => h.bg === d.bg[i]), { h2: d.h2.map(h => h.bg), sec: d.bg });

  // 사이트 제목은 어두운 띠 위의 밝은 글자인데, 띠는 class 라 안 넘어오고
  // 글자색(노랑)만 인라인으로 넘어와 흰 바탕에 노란 글자가 됐었다. 이제 글만
  // 가져와 앱 제목으로 다시 쓰므로, 실려 온 색이 따라오면 안 된다.
  const con = await pg.evaluate(() => {
    const el = document.querySelector('.wk-orig-title');
    const lum = c => {
      const [R, G, B] = c.match(/\d+/g).slice(0, 3).map(v => {
        const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
    const hex = h => `rgb(${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)})`;
    const a = lum(getComputedStyle(el).color), b = lum(hex(bg));
    return { ratio: Math.round(((Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05)) * 10) / 10,
             yellow: el.innerHTML.includes('FFD966') || el.children.length > 0 };
  });
  check('사이트가 실어 보낸 글자색이 따라오지 않는다', !con.yellow, con);
  check('제목 글자가 배경과 충분히 대비된다(4.5:1 이상)', con.ratio >= 4.5, con);

  // 여백을 색 있는 상자에 주면 색이 그만큼 안쪽으로 물러난다. 여백은 글에만
  // 물려야 띠가 좌우 끝까지 닿는다. 아래 두 검사가 그걸 잰다.
  const bleed = await pg.evaluate(() => {
    const host = document.querySelector('.wk-shadow-host');
    const r = host.shadowRoot, H = host.getBoundingClientRect();
    const box = el => { const b = el.getBoundingClientRect();
                        return { l: Math.round(b.left - H.left), w: Math.round(b.width) }; };
    return { host: Math.round(H.width),
             secs: [...r.querySelectorAll('section.wk-dept')].map(box),
             // 글은 여백만큼 안으로 들어와 있어야 한다
             pPad: parseFloat(getComputedStyle(r.querySelector('p')).paddingLeft) };
  });
  check('부서 띠가 상자 좌우 끝까지 닿는다',
        bleed.secs.every(s => s.l === 0 && s.w === bleed.host), bleed);
  check('띠는 끝까지 가도 글은 안으로 들어와 있다', bleed.pPad > 0, bleed.pPad);

  // 넓은 화면에서는 상자로 담고(좌우가 남고 모서리가 둥글다), 휴대폰에서는
  // 상자가 안 보이고 화면을 꽉 채운다.
  const boxAt = async w => {
    await pg.setViewportSize({ width: w, height: 800 });
    return pg.evaluate(() => {
      const host = document.querySelector('.wk-shadow-host');
      const c = getComputedStyle(host);
      const b = host.getBoundingClientRect();
      return { r: parseFloat(c.borderRadius), sh: c.boxShadow,
               left: Math.round(b.left), w: Math.round(b.width),
               vw: Math.round(document.documentElement.clientWidth) };
    });
  };
  const wide = await boxAt(1400), narrow = await boxAt(390);
  check('넓은 화면에서는 상자에 담긴다',
        wide.r > 0 && wide.sh !== 'none' && wide.left > 0 && wide.w < wide.vw, wide);
  check('휴대폰에서는 상자가 안 보이고 꽉 찬다',
        narrow.r === 0 && narrow.sh === 'none'
        && narrow.left === 0 && narrow.w === narrow.vw, narrow);

  // 좁아질수록 좌우 여백이 줄고, 휴대폰에서는 거의 없어야 한다.
  const padAt = async w => {
    await pg.setViewportSize({ width: w, height: 800 });
    return pg.evaluate(() => parseFloat(getComputedStyle(
      document.querySelector('.wk-shadow-host').shadowRoot.querySelector('p')).paddingLeft));
  };
  const pads = [];
  for (const w of [1600, 1200, 900, 700, 500, 380]) pads.push(await padAt(w));
  check('좁아질수록 좌우 여백이 준다',
        pads.every((v, i) => i === 0 || v <= pads[i - 1]), pads);
  check('휴대폰에서는 여백이 거의 없다', pads[pads.length - 1] <= 8, pads);
  // 넓은 화면에서 글줄이 끝없이 길어지면 읽기 어렵다 — 상자가 1200px 로 묶는다.
  await pg.setViewportSize({ width: 1600, height: 800 });
  const line = await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const p = r.querySelector('p');
    const c = getComputedStyle(p);
    return Math.round(p.getBoundingClientRect().width
                      - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight));
  });
  await pg.setViewportSize({ width: 1200, height: 800 });
  check('넓은 화면에서도 글줄은 상자 안에 묶인다', line <= 1200, line);
}

// ── 원본+ ───────────────────────────────────────────────────────────────
// 원본과 같은 길로 그리되 읽기 편하도록 네 가지를 손본다. 원본과 달라지는 것을
// 아는 채로 하는 손질이라, '원본' 은 그대로 두고 별도 방식으로 뒀다.
console.log('\n■ 원본+ — 읽기 편하게 손본 것');
{
  await pg.setViewportSize({ width: 420, height: 900 });
  // 실제로 오는 모양이다. 앱에서 찍어 본 진단이 전부 SPAN 이었고, 그중 하나는
  // 내용이 '·' 하나뿐이었다 — 기호가 자기 혼자 조각을 차지한다. 기호 뒤에
  // 공백이 이어질 거라고 보면 하나도 안 걸린다. 그래서 그 모양 그대로 둔다.
  const LONG = `
    <h1><span>2026학년도 9월 1주</span></h1>
    <h2><span>교무기획부</span></h2>
    <p><span>·</span><span> 2학기 학생 학부모 상담주간 운영에 관한 안내입니다 협조 부탁드립니다</span></p>
    <div><span>■</span><span> 대상: 전 교직원과 학부모 및 관련 부서 담당자 전원이 참여합니다</span></div>
    <p><span>·</span><span> 장소: 각 학급 교실 또는 상담실을 이용해 주시기 바랍니다</span></p>
    <p><span>「</span><span>초·중등교육법」 개정에 따른 안내이며 여는 괄호로 시작하는 줄입니다</span></p>
    <p><span>01_</span><span>2학기 영어듣기평가 안내</span></p>
    <!-- 사이트는 들여쓰기를 &nbsp; 로 한다. 그건 줄바꿈에서 사라지지 않아서
         첫 줄만 안으로 들어가고 넘어간 줄은 상자 맨 왼쪽까지 튀어나간다.
         화면에서 제일 눈에 띄던 문제가 이것이었다. -->
    <p><span>\u00A0\u00A0\u00A01.</span><span> 물리학 실험(18명)(박경환): (월,목) / 물리실 / 18:50-21:20 / 매주 진행합니다</span></p>
    <p><span>앞머리가 없는 평범한 줄입니다 여기는 손대지 않아야 합니다</span></p>
    <!-- 줄 끝이 잘 차는 문단. 어절이 짧아 남는 자리가 적으니 양쪽 맞춤을 해도
         어절 사이가 안 벌어진다. -->
    <p class="fit"><span>가 나 다 라 마 바 사 아 자 차 카 타 파 하 거 너 더 러 머 버 서 어 저 처 커 터 퍼 허 고 노 도 로 모 보 소 오 조 초 코 토 포 호</span></p>
    <!-- 긴 어절 하나가 통째로 다음 줄로 넘어가면서 앞 줄에 큰 구멍이 남는 문단.
         여기에 양쪽 맞춤을 걸면 그 구멍이 어절 사이로 퍼져 흉해진다. -->
    <p class="hole"><span>짧은 말 뒤에 대구광역시교육청진로진학지원센터운영협의회자료집 이 옵니다</span></p>
    <!-- 소제목. 번호로 시작하고 &nbsp; 로 들여쓴 모양이 본문 줄과 똑같지만,
         제목은 한 덩어리라 내어쓰기도 양쪽 맞춤도 걸면 안 된다. -->
    <h3><span>\u00A0\u00A001.</span><span> 9월 3차 정보 공시 내용 입력과 각 부서 확인 절차 안내</span></h3>
    <!-- 여러 줄이 <br> 로 한 상자에 들어오는 모양. 내어쓰기는 상자의 첫 줄에만
         걸리므로, 가르지 않으면 둘째 줄부터는 안 먹는다. 화면에서 잘 되는 줄과
         안 되는 줄이 번갈아 보이던 이유가 이것이다. -->
    <p class="multi"><span>\u00A0■</span><span> 1,2학년 33개 동아리 활동에 대한 안내이며 자세한 내용은 아래를 보십시오</span><br><span>\u00A0·</span><span> 예산 배정: 아래 시트참조(공개 여부: 부분공개-예산파일, 10월 2주까지 신청마감)</span><br><span>\u00A0·</span><span> 문의는 담당 부서로 주시기 바라며 기한을 꼭 지켜 주시기 바랍니다</span></p>
    <!-- 사이트의 &nbsp; 개수는 사람이 손으로 넣은 것이라 같은 단계인데도 줄마다
         다르다. 그대로 존중하면 ■ 가 어떤 줄은 60px, 어떤 줄은 75px 에서
         시작한다 — 화면에서 '열이 안 맞는다' 던 것이 이것이다. -->
    <p class="col"><span>■</span><span> 일시: 9.9.(수) 18:00~21:00</span></p>
    <p class="col"><span>\u00A0■</span><span> 장소: 달서구 월광수변공원</span></p>
    <p class="col"><span>\u00A0\u00A0\u00A0■</span><span> 내용: 수밭골 늦반딧불이 탐사</span></p>
    <p class="col2"><span>·</span><span> 대상: 1학년 희망자 20명</span></p>
    <p class="col2"><span>\u00A0\u00A0·</span><span> 참가신청: 8.20.(목)~8.25.(화)</span></p>
    <p class="col3"><span>-</span><span> 준비물은 개별 안내합니다</span></p>
    <p class="col3"><span>\u00A0\u00A0※</span><span> 우천 시 순연됩니다</span></p>
    <!-- 진단이 보여 준 실제 모양. 글머리 줄이 <ul><li><p> 로 오고, 한 줄이
         <ul> 하나씩이다. 글머리 모양(■)은 class 에 있어 프록시를 못 넘어온다. -->
    <ul><li dir="ltr"><p dir="ltr" style="background-color: transparent;"><span style="color:#000000; font-weight:700">아침 8시 교실 환기하면서 청소 실시</span></p></li></ul>
    <ul><li dir="ltr"><p dir="ltr" style="background-color: transparent;"><span style="color:#000000; font-weight:700">교실, 복도 구석구석 깨끗하게 쓸기, 밀대 빨아 닦기</span></p></li></ul>
    <h2><span>행정실</span></h2>
    <p><span>·</span><span> 물품 구입 신청은 9. 5.(금)까지 제출해 주시기 바랍니다</span></p>
  `;
  const readOrig = async mode => {
    await pg.evaluate(([m, h]) => { window.setMode(m); window.render(h); }, [mode, LONG]);
    return pg.evaluate(() => {
      const r = document.querySelector('.wk-shadow-host').shadowRoot;
      // '줄'은 그 안의 첫 글자가 자기를 가리키는 상자다 — 본 코드와 같은 기준.
      const isLine = el => {
        const first = [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim())
          || [...el.querySelectorAll('*')].map(k => [...k.childNodes]
               .find(n => n.nodeType === 3 && n.nodeValue.trim())).find(Boolean);
        return !!first && wkBlockOf(first) === el;
      };
      const ps = [...r.querySelectorAll('p, div')].filter(isLine);
      const c = ps.map(el => getComputedStyle(el));
      return {
        align: c.map(x => x.textAlign),
        brk: c.map(x => x.wordBreak),
        // ④ 기호로 시작하는 줄만 내어쓰기가 붙는다
        hang: ps.map(el => ({ mark: el.textContent.trim()[0],
                              ml: parseFloat(el.style.marginLeft) || 0,
                              ti: parseFloat(el.style.textIndent) || 0 })),
        // ② 자간은 넘치는 줄에만, 그것도 -0.03em 안에서만 손댄다
        ls: ps.map(el => el.style.letterSpacing || ''),
      };
    });
  };

  const plus = await readOrig('plus');
  // ① 양쪽 맞춤은 넣었다가 뺐다 — 좁은 화면에서 어절 사이가 흉하게 벌어진다.
  // ① 양쪽 맞춤은 문단마다 켜고 끈다. 어절 단위로만 끊으면 줄 끝에 늘 어절
  //    하나만큼 자리가 남는데, 켜면 그 자리가 어절 사이로 퍼져 벌어지고 끄면
  //    그대로 오른쪽 여백이 된다. 그래서 조금만 남는 문단만 맞춘다.
  const just = await pg.evaluate(([slack]) => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const gapsOf = el => {
      const cs = getComputedStyle(el);
      const right = el.getBoundingClientRect().right - parseFloat(cs.paddingRight || 0);
      const rg = document.createRange(); rg.selectNodeContents(el);
      const lines = new Map();
      for (const rc of rg.getClientRects()) {
        if (rc.width < 0.5) continue;
        const k = Math.round(rc.top);
        lines.set(k, Math.max(lines.get(k) ?? 0, rc.right));
      }
      const tops = [...lines.keys()].sort((a, b) => a - b);
      return { fs: parseFloat(cs.fontSize),
               worst: tops.slice(0, -1).reduce((m, k) => Math.max(m, right - lines.get(k)), 0),
               lines: tops.length };
    };
    const all = [...r.querySelectorAll('p, div')].filter(e => !e.querySelector('p, div'));
    return {
      fit:  r.querySelector('.fit')?.style.textAlign,
      hole: r.querySelector('.hole')?.style.textAlign,
      holeLines: gapsOf(r.querySelector('.hole')).lines,
      // 맞춘 문단은 전부 '조금만 남는' 문단이어야 한다
      bad: all.filter(e => e.style.textAlign === 'justify')
              .map(gapsOf).filter(g => g.worst > slack * g.fs + 1).length,
    };
  }, [1.5]);
  check('① 줄 끝이 잘 차는 문단은 양쪽 맞춤', just.fit === 'justify', just);
  check('① 크게 남는 문단은 맞추지 않는다',
        just.holeLines >= 2 && just.hole !== 'justify', just);
  check('① 맞춘 문단은 모두 조금만 남는 문단이다', just.bad === 0, just);
  check('③ 어절 단위로 끊는다', plus.brk.every(b => b === 'keep-all'), plus.brk);
  const marked = plus.hang.filter(h => '·■'.includes(h.mark));
  const plain = plus.hang.filter(h => !'·■'.includes(h.mark));
  // 왼쪽 여백 = 단계 들여쓰기 + 기호 폭, 내어쓰기 = -기호 폭.
  // 그래야 첫 줄은 단계 자리에서 시작하고 넘어간 줄은 기호 뒤에 붙는다.
  check('④ 기호로 시작하는 줄은 기호 뒤로 내어쓴다',
        marked.length >= 4 && marked.every(h => h.ti < 0 && h.ml > -h.ti), plus.hang);
  // 기호가 자기 혼자 조각을 차지하는 모양('<span>·</span><span> 대상…')이 실제
  // 사이트가 보내는 모양이다. 이걸 놓쳐서 두 번 안 먹었다.
  check('④ 기호가 딴 조각에 떨어져 있어도 잡는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const lone = [...r.querySelectorAll('span')]
      .filter(e => e.textContent.trim() === '·' || e.textContent.trim() === '■');
    return lone.length >= 3
        && lone.every(e => parseFloat(e.parentElement.style.marginLeft) > 0);
  }));
  // div 로 온 줄이 빠지면 여기서 걸린다 — 태그 이름으로 고르던 시절의 버그다.
  check('④ p 든 div 든 가리지 않는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    return [...r.querySelectorAll('div')]
      .filter(e => '·■'.includes(e.textContent.trim()[0])
                   && !e.querySelector('div, p'))
      .every(e => parseFloat(e.style.marginLeft) > 0);
  }));
  // 앞머리가 아예 없는 줄은 그대로 둔다. (여는 괄호·숫자 소제목은 따로 본다)
  // <br> 로 한 상자에 여러 줄이 들어오면 내어쓰기가 첫 줄에만 걸린다.
  // 줄마다 상자를 만들어 줘야 전부 먹는다.
  check('④ <br> 로 이어 붙은 줄도 전부 맞춘다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const box = r.querySelector('.multi');
    const lines = [...box.querySelectorAll('.wk-line')];
    return { n: lines.length, br: box.querySelectorAll('br').length,
             ml: lines.map(e => Math.round(parseFloat(e.style.marginLeft) || 0)),
             txt: lines.map(e => e.textContent.trim().slice(0, 6)) };
  }).then(v => v.n === 3 && v.br === 0 && v.ml.every(m => m > 0)));
  check('④ 가른 줄의 글이 순서대로 남는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const lines = [...r.querySelectorAll('.multi .wk-line')];
    return lines.length === 3
        && /1,2학년 33개/.test(lines[0].textContent)
        && /예산 배정/.test(lines[1].textContent)
        && /문의는 담당/.test(lines[2].textContent)
        // 색·링크 같은 안쪽 구조가 끊기면 안 된다
        && lines[1].querySelectorAll('span').length >= 2;
  }));
  // 이게 '열이 안 맞는다' 에 대한 답이다. 같은 기호는 &nbsp; 가 몇 개였든
  // 같은 자리에서 시작해야 한다.
  check('④ 같은 기호끼리 열이 맞고, 기호마다 단계가 다르다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const leftOf = el => {
      const rg = document.createRange(); rg.selectNodeContents(el);
      return Math.round([...rg.getClientRects()].filter(x => x.width > 0.5)[0].left);
    };
    const a = [...r.querySelectorAll('.col')].map(leftOf);
    const b = [...r.querySelectorAll('.col2')].map(leftOf);
    const c = [...r.querySelectorAll('.col3')].map(leftOf);
    return { a, b, c, ok: a.length === 3 && b.length === 2 && c.length === 2
             && new Set(a).size === 1 && new Set(b).size === 1 && new Set(c).size === 1
             // ■ → · → - ※ 순으로 한 칸씩 더 안쪽
             && b[0] > a[0] && c[0] > b[0] };
  }).then(v => v.ok));
  // 글머리(■)가 통째로 사라지던 자리. 좌우 여백 규칙이 ul 의 기본 안쪽 여백을
  // 덮어써서 글머리표가 상자 밖으로 밀려나 있었다.
  // 번호는 소제목이다. 제 항목들보다 안으로 들어가면 위계가 뒤집힌다.
  check('④ 번호 소제목은 제 항목들보다 앞 칸에 선다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const num = [...r.querySelectorAll('p')].find(e => /물리학 실험/.test(e.textContent));
    const ul = r.querySelector('ul');
    const box = e => { const rg = document.createRange(); rg.selectNodeContents(e);
                       return Math.round([...rg.getClientRects()].filter(x => x.width > 0.5)[0].left); };
    return !!num && !!ul && box(num) < box(ul);
  }));
  check('④ 목록의 글머리표가 보인다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const uls = [...r.querySelectorAll('ul')];
    if (uls.length !== 2) return false;
    return uls.every(ul => {
      const cs = getComputedStyle(ul);
      const li = ul.querySelector('li');
      // 글머리표가 그려질 자리가 상자 안에 있어야 한다
      return parseFloat(cs.paddingLeft) > 16
          && getComputedStyle(li).listStyleType === 'square'
          && ul.getBoundingClientRect().left >= 0;
    });
  }));
  check('④ 목록 줄에 여백을 두 번 주지 않는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    return [...r.querySelectorAll('li p')].every(e => !e.style.marginLeft);
  }));
  check('④ 목록 줄끼리 유난히 벌어지지 않는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const uls = [...r.querySelectorAll('ul')];
    return uls.every(u => parseFloat(getComputedStyle(u).marginTop) === 0);
  }));
  check('제목에는 내어쓰기·양쪽 맞춤을 걸지 않는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    return [...r.querySelectorAll('h1, h2, h3, h4')]
      .every(e => !e.style.marginLeft && !e.style.textIndent && !e.style.textAlign);
  }));
  // 기호 없는 줄은 앞 줄에 딸린 말이다. '(학생이 직접 …)' 처럼 여는 괄호로
  // 시작하는 줄이 왼쪽 끝으로 떨어지면 남처럼 보인다 — 앞 줄 단계를 물려받되,
  // 내어쓰기(기호 폭)는 없다.
  check('④ 앞머리 없는 줄은 앞 줄 단계를 물려받는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const paren = [...r.querySelectorAll('p')].find(e => e.textContent.startsWith('「'));
    const prev = paren?.previousElementSibling;   // · 로 시작하는 줄
    return !!paren && !!prev
        && parseFloat(paren.style.marginLeft) > 0
        && !parseFloat(paren.style.textIndent || 0)
        && Math.abs(parseFloat(paren.style.marginLeft)
                    - (parseFloat(prev.style.marginLeft) + parseFloat(prev.style.textIndent))) < 1;
  }), plus.hang);
  // 부서 이름을 지나면 단계가 0 으로 돌아간다 — 앞 부서 것이 넘어오면 안 된다.
  check('④ 부서가 바뀌면 단계가 처음으로 돌아간다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const h = [...r.querySelectorAll('h2')].pop();
    const first = h.nextElementSibling;
    return !!first && parseFloat(first.style.marginLeft) > 0;   // · 줄이라 2단계
  }));
  // 여는 괄호와 숫자 소제목(01_)은 머리 기호가 아니다. 단계는 앞 줄을 따라가되
  // 내어쓰기(기호 폭만큼 당기는 것)는 주면 안 된다 — 기호가 없으니 당길 것도 없다.
  check('④ 여는 괄호·숫자 소제목에는 내어쓰기를 주지 않는다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const els = [...r.querySelectorAll('p')]
      .filter(e => e.textContent.startsWith('「') || e.textContent.startsWith('01_'));
    return els.length === 2 && els.every(e => !parseFloat(e.style.textIndent || 0));
  }));
  // 첫 줄만 &nbsp; 로 들어가 있고 넘어간 줄은 맨 왼쪽까지 튀어나가던 줄.
  // 앞 공백까지 재야 맞는다 — 기호 폭만 재면 한참 모자란다.
  check('④ &nbsp; 들여쓰기 + 번호 줄도 맞춘다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const el = [...r.querySelectorAll('p')].find(e => /물리학 실험/.test(e.textContent));
    if (!el) return false;
    const ml = parseFloat(el.style.marginLeft);
    // 넘어간 줄의 왼쪽 끝이 첫 줄 글자('물')와 같은 자리인가 — 실제로 재 본다.
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, seen = 0, x0 = null;
    while ((n = walk.nextNode())) {
      const ld = wkLead(el.textContent);
      const skip = ld.ws1.length + ld.tok.length + ld.ws2.length;
      if (seen + n.nodeValue.length > skip) {
        const rg = document.createRange();
        rg.setStart(n, skip - seen); rg.setEnd(n, skip - seen + 1);
        x0 = rg.getBoundingClientRect().left; break;
      }
      seen += n.nodeValue.length;
    }
    // 블록의 getClientRects 는 테두리 상자 하나뿐이다. 줄 상자를 보려면
    // 내용 전체에 Range 를 걸어야 한다.
    const all = document.createRange();
    all.selectNodeContents(el);
    const rects = [...all.getClientRects()].filter(r => r.width > 1);
    // 한 줄에 조각이 여럿일 수 있으니(span 마다 따로 잡힌다) 세로 위치로 묶는다.
    const byLine = new Map();
    for (const rc of rects) {
      const k = Math.round(rc.top);
      byLine.set(k, Math.min(byLine.get(k) ?? Infinity, rc.left));
    }
    const tops = [...byLine.keys()].sort((a, b) => a - b);
    // 양쪽 맞춤이 켜진 문단은 첫 줄의 공백이 조금 늘어난다. 앞머리 안의 공백도
    // 같이 늘어나므로 첫 줄 글자가 몇 px 밀린다. 내어쓰기 폭은 늘어나기 전
    // 기준으로 잡히니, 그만큼은 어긋나는 것이 맞다 — 글자 폭의 1/3 까지 본다.
    const slack = parseFloat(getComputedStyle(el).fontSize) / 3;
    return tops.length >= 2 && ml > 0 && x0 !== null
        && Math.abs(byLine.get(tops[1]) - x0) < slack;
  }));
  check('② 자간을 조여도 -0.03em 을 넘지 않는다',
        plus.ls.every(v => v === '' || (parseFloat(v) < 0 && parseFloat(v) >= -0.03)), plus.ls);
  // 자간을 건드려 놓고 줄은 그대로면 아무 소용 없이 글자만 빽빽해진 것이다.
  check('② 자간을 건드린 줄은 실제로 한 줄이 줄었다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    return [...r.querySelectorAll('p, li, small, h2, h3, h4')]
      .filter(el => el.style.letterSpacing)
      .every(el => {
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        const n = () => Math.round(el.getBoundingClientRect().height / lh);
        const tight = n(); const keep = el.style.letterSpacing;
        el.style.letterSpacing = ''; const loose = n(); el.style.letterSpacing = keep;
        return tight < loose;
      });
  }));
  // 한두 글자 넘치는 줄이 실제로 한 줄로 접히는지, 폭을 그렇게 맞춰 놓고 본다.
  check('② 한두 글자 넘치면 한 줄로 접힌다', await pg.evaluate(() => {
    const r = document.querySelector('.wk-shadow-host').shadowRoot;
    const box = document.createElement('div');
    const p = document.createElement('p');
    p.textContent = '2학기 학생 학부모 상담주간 운영 협조 안내드립니다';
    p.style.cssText = 'word-break:keep-all;margin:0;';
    box.style.cssText = 'position:absolute;visibility:hidden;';
    box.appendChild(p); r.querySelector('.wk-plus').appendChild(box);
    // 한 줄일 때의 폭보다 1.5% 만 좁히면 한두 글자가 넘어간다
    p.style.whiteSpace = 'nowrap';
    const w1 = p.getBoundingClientRect().width;
    p.style.whiteSpace = '';
    box.style.width = Math.floor(w1 * 0.985) + 'px';
    const lh = parseFloat(getComputedStyle(p).lineHeight);
    const before = Math.round(p.getBoundingClientRect().height / lh);
    wkTightenTails(box);
    const after = Math.round(p.getBoundingClientRect().height / lh);
    const ls = p.style.letterSpacing;
    box.remove();
    return { before, after, ls };
  }).then(v => v.before === 2 && v.after === 1 && v.ls !== ''));

  // 손질은 '원본+' 만의 것이다. '원본' 은 사이트 그대로여야 한다.
  const orig = await readOrig('orig');
  check('원본은 그대로 둔다',
        orig.align.every(a => a !== 'justify')
        && orig.brk.every(b => b !== 'keep-all')
        && orig.hang.every(h => h.ml === 0) && orig.ls.every(v => v === ''), orig);

  await pg.setViewportSize({ width: 1200, height: 800 });
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, SITE);
}

// ── 제목이 heading 으로 안 올 때 ────────────────────────────────────────
// 이 사이트는 페이지 제목을 heading 으로 안 보낸다 — 그냥 span 이다. h1 만
// 찾다가 못 찾으면 제목 글자를 못 얻고, 그러면 중복 제거가 시작도 못 한다.
// 흰 바탕의 노란 제목이 계속 남아 있던 이유다.
// ── 번호가 두 가지로 쓰인다 ──────────────────────────────────────────────
// 같은 '1.' 이 어떤 데서는 소제목이고 어떤 데서는 ■ 에 딸린 목록이다.
// 가르는 단서는 '번호가 이어지는가' 뿐이다.
console.log('\n■ 번호가 두 가지로 쓰인다');
{
  const NB = '\u00A0';
  const LI = t => `<ul><li dir="ltr"><p dir="ltr"><span style="color:#000000">${t}</span></p></li></ul>`;
  const NUM = `
    <h2><span>교육지원부</span></h2>
    <p class="t1"><span>${NB}1.</span><span> 교내 환경 정화</span></p>
    ${LI('아침 8시 교실 환기하면서 청소 실시')}
    ${LI('교실, 복도 구석구석 깨끗하게 쓸기')}
    <p class="t2"><span>${NB}2.</span><span> 방과후학교 수업, 학습집중채움 프로그램</span></p>
    ${LI('신청자 해당 수업일에 빠지지 않도록 훈화 지도 부탁')}
    <h2><span>교육과정부</span></h2>
    <h3><span>${NB}01._</span><span>2026. 2학기 공동교육과정 개설 완료</span></h3>
    <p class="b1"><span>■</span><span> 대상: 1,2학년</span></p>
    <p class="b2"><span>■</span><span> 8.24.(월) 부터 운영하는 강좌 안내</span></p>
    <p class="s1"><span>1.</span><span> 물리학 실험(18명)(박경환): (월,목) / 물리실</span></p>
    <p class="s2"><span>2.</span><span> 물리 과제연구(13명)(정선우): (화,금) / 물리실</span></p>
    <p class="s3"><span>3.</span><span> 통계이론 과제연구(11명)(정승호): (화,금) / 멀티실</span></p>
  `;
  await pg.evaluate(([m, h]) => { window.setMode(m); window.render(h); }, ['plus', NUM]);
  const r = await pg.evaluate(() => {
    const sh = document.querySelector('.wk-shadow-host').shadowRoot;
    const box = sel => { const e = sh.querySelector(sel); if (!e) return null;
      const rg = document.createRange(); rg.selectNodeContents(e);
      const rc = [...rg.getClientRects()].filter(x => x.width > 0.5)[0];
      return rc ? Math.round(rc.left) : null; };
    return { t1: box('.t1'), t2: box('.t2'), ul: box('ul li'),
             b1: box('.b1'), b2: box('.b2'),
             s: ['.s1', '.s2', '.s3'].map(box) };
  });
  // 이어지는 번호(1. → 2.)는 소제목이다. 제 항목들보다 앞 칸에 선다.
  check('이어지는 번호는 소제목 — 맨 앞 칸', r.t1 === r.t2 && r.t1 < r.ul, r);
  // 흐름을 벗어나 1 부터 다시 시작하는 번호는 앞 줄에 딸린 목록이다.
  check('흐름을 벗어난 번호는 앞 줄보다 한 칸 안', r.s.every(x => x > r.b2), r);
  check('딸린 번호끼리는 열이 맞는다', new Set(r.s).size === 1, r);
  check('■ 끼리도 열이 맞는다', r.b1 === r.b2, r);
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, SITE);
}

console.log('\n■ 제목이 heading 으로 안 올 때');
{
  const NOH1 = `
    <div><span style="color:#FFD966">주간 교육활동 및 업무 안내</span></div>
    <div><span style="color:#FFD966">주간 교육활동 및 업무 안내</span></div>
    <h2><span>교감 선생님</span></h2>
    <p><span>·</span><span> 안전에 유의해 주십시오</span></p>
  `;
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, NOH1);
  const r = await pg.evaluate(() => {
    const sh = document.querySelector('.wk-shadow-host').shadowRoot;
    const sq = s => s.replace(/[\s\u00A0]+/g, '');
    const t = sq('주간 교육활동 및 업무 안내');
    return { title: document.querySelector('.wk-orig-title').textContent.trim(),
             left: [...sh.querySelectorAll('*')]
                     .filter(e => !e.children.length && sq(e.textContent) === t).length,
             dept: !!sh.querySelector('h2') };
  });
  check('h1 이 없어도 제목을 찾아낸다', r.title === '주간 교육활동 및 업무 안내', r);
  check('노란 제목이 상자 안에 남지 않는다', r.left === 0, r);
  check('부서는 그대로 남는다', r.dept, r);
  await pg.evaluate(h => { window.setMode('orig'); window.render(h); }, SITE);
}

console.log('\n■ 전환 막대');
{
  check('관리자에게는 보인다', await pg.evaluate(() => !!document.getElementById('wkModes')));
  check('네 칸이다', (await pg.$$eval('#wkModes button', e => e.length)) === 4);
  check('고른 것이 켜져 있다',
        (await pg.$eval('#wkModes button.on', e => e.dataset.wkMode)) === 'orig');
  await pg.evaluate(() => { window.__setWho('kim@yeungnam.hs.kr'); window.render('<p>x</p>'); });
  check('다른 교사에게는 안 보인다', await pg.evaluate(() => !document.getElementById('wkModes')));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
