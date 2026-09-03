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
  ${grabConst('WK_SHADOW_CSS')}
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
         실린 평범한 글이라 h1 규칙에 안 걸리고 흰 바탕에 옅은 노랑으로 남는다. -->
    <p><span style="color:#FFD966">주간 교육활동 및 업무 안내</span></p>
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
    const t = '주간 교육활동 및 업무 안내';
    return [...r.querySelectorAll('*')].filter(e => !e.children.length
             && e.textContent.trim() === t).length;
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
