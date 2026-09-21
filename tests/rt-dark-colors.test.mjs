// 어두운 화면에서 붙여넣은 글자가 읽히는가.
//
// 붙여넣은 글은 '흰 종이' 를 보고 고른 색을 그대로 들고 온다. 공문의 남색 제목,
// 검은 본문 같은 것들이다. 어두운 화면에서는 그 색이 바탕에 묻혀 안 읽혔다.
//
// 여기서 보는 것은 '색을 바꿨나' 가 아니라 **'읽히나'** 다. 그래서 바꾼 색을
// 문자열로 맞춰 보지 않고, 실제로 그려 놓고 바탕과의 대비(WCAG 명암비)를 잰다.
// 색을 다른 방식으로 고쳐도 읽히기만 하면 통과해야 맞다.
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
const grabConst = name => {
  const m = new RegExp(`^const ${name}\\b[^\\n]*(\\n(?![a-zA-Z/]).*)*`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  return m[0];
};
// 읽기 상자와 어두운 화면의 색은 index.html 에서 그대로 떼어 온다. 여기 옮겨
// 적으면 실제 색이 바뀌어도 통과해 버린다.
const css = [...HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 800, height: 900 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8">
<style>${css}</style>
<body><div class="rt-view" id="v" style="padding:16px;"></div>
<script>
  ${grabConst('RT_DARK_L')}
  ${grabConst('RT_DARK_S')}
  ${grabConst('RT_DARK_GRAY')}
  ${grab('rtRgb')}
  ${grab('rtHsl')}
  ${grab('rtOnOwnBg')}
  ${grab('rtFitDarkColors')}

  const v = document.getElementById('v');
  window.dark_ = on => document.documentElement.classList.toggle('dark', !!on);
  window.put_  = html => { v.innerHTML = html; rtFitDarkColors(v); };
  window.fit_  = () => rtFitDarkColors(v);

  // WCAG 상대 휘도 → 명암비. 두 색이 얼마나 갈리는지를 숫자로 본다.
  const lum = c => {
    const [r,g,b] = rtRgb(c).map(x => x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4));
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  window.ratio_ = sel => {
    const el = v.querySelector(sel);
    // 바탕은 실제로 뒤에 깔린 것을 찾아 올라간다(투명하면 부모 것이다).
    let bg = 'rgba(0, 0, 0, 0)';
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p).backgroundColor;
      if (c && !/rgba\\([^)]*,\\s*0\\s*\\)/.test(c)) { bg = c; break; }
    }
    const a = lum(getComputedStyle(el).color) + 0.05, c = lum(bg) + 0.05;
    return Math.round((Math.max(a,c) / Math.min(a,c)) * 100) / 100;
  };
  window.hue_ = sel => {
    const [r,g,b] = rtRgb(getComputedStyle(v.querySelector(sel)).color);
    return Math.round(rtHsl(r,g,b)[0] * 360);
  };
  window.css_ = sel => v.querySelector(sel).style.color;
<\/script></body>`);

// 본문 글자로 읽으려면 4.5:1 이 기준이다(WCAG AA). 제목처럼 큰 글자는 3:1 이지만,
// 붙여넣은 글은 어느 쪽인지 알 수 없으므로 높은 쪽으로 잡는다.
const AA = 4.5;
const ratio = sel => pg.evaluate(s => window.ratio_(s), sel);
const hue   = sel => pg.evaluate(s => window.hue_(s), sel);

console.log('\n■ 밝은 화면에서는 손대지 않는다');
{
  await pg.evaluate(() => dark_(false));
  await pg.evaluate(() => put_('<p><span id="a" style="color:rgb(31, 78, 156)">남색 제목</span></p>'));
  check('색이 그대로다', (await pg.evaluate(() => css_('#a'))) === 'rgb(31, 78, 156)',
        await pg.evaluate(() => css_('#a')));
  check('밝은 바탕에서는 원래도 읽힌다', (await ratio('#a')) >= AA, await ratio('#a'));
}

console.log('\n■ 어두운 화면 — 공문에서 붙여넣은 남색 제목 (실제로 안 보이던 것)');
{
  await pg.evaluate(() => dark_(true));
  await pg.evaluate(() => put_('<p><span id="a" style="color:rgb(31, 78, 156)">남색 제목</span></p>'));
  check('읽을 수 있게 된다', (await ratio('#a')) >= AA, await ratio('#a'));
  // 뒤집으면 남색이 주황이 된다 — 무슨 색으로 썼는지가 통째로 바뀐다.
  const h = await hue('#a');
  check('그래도 남색이다 (뒤집지 않는다)', h > 195 && h < 250, h);
}

console.log('\n■ 어두운 화면 — 검은 본문');
{
  await pg.evaluate(() => put_('<p><span id="a" style="color:rgb(0, 0, 0)">본문입니다</span></p>'));
  check('읽을 수 있게 된다', (await ratio('#a')) >= AA, await ratio('#a'));
  // 회색을 밝히면 '흐린 회색 글자' 가 된다. 화면 기본 글자색에 맡기는 편이 낫다.
  check('색을 아예 떼고 기본색에 맡긴다', (await pg.evaluate(() => css_('#a'))) === '',
        await pg.evaluate(() => css_('#a')));
}

console.log('\n■ 어두운 화면 — 여러 색을 한꺼번에');
{
  await pg.evaluate(() => put_(`
    <p><span id="a" style="color:rgb(192, 0, 0)">붉은 강조</span></p>
    <p><span id="b" style="color:rgb(0, 100, 0)">짙은 초록</span></p>
    <p><span id="c" style="color:rgb(80, 80, 80)">짙은 회색</span></p>
    <p><span id="d" style="color:rgb(120, 60, 160)">보라</span></p>`));
  for (const [sel, 이름, 색조] of [['#a','붉은색',[340,30]], ['#b','초록',[80,170]],
                                    ['#c','짙은 회색',null], ['#d','보라',[255,300]]]) {
    check(`${이름} — 읽을 수 있다`, (await ratio(sel)) >= AA, { sel, r: await ratio(sel) });
    if (색조) {
      const h = await hue(sel);
      const ok = 색조[0] > 색조[1] ? (h >= 색조[0] || h <= 색조[1]) : (h >= 색조[0] && h <= 색조[1]);
      check(`${이름} — 색조가 살아 있다`, ok, { h, 색조 });
    }
  }
}

console.log('\n■ 이미 밝은 색은 그냥 둔다');
{
  await pg.evaluate(() => put_('<p><span id="a" style="color:rgb(255, 210, 90)">밝은 노랑</span></p>'));
  check('건드리지 않는다', (await pg.evaluate(() => css_('#a'))) === 'rgb(255, 210, 90)',
        await pg.evaluate(() => css_('#a')));
  check('원래 읽힌다', (await ratio('#a')) >= AA, await ratio('#a'));
}

console.log('\n■ 형광펜 친 글자는 건드리지 않는다');
{
  // 노란 바탕에 검은 글자다. 글자를 밝히면 오히려 안 보인다.
  await pg.evaluate(() => put_(
    '<p><span style="background-color:rgb(255, 242, 0)">' +
    '<span id="a" style="color:rgb(0, 0, 0)">형광펜</span></span></p>'));
  check('제 바탕을 깔고 있으면 그대로 둔다',
        (await pg.evaluate(() => css_('#a'))) === 'rgb(0, 0, 0)',
        await pg.evaluate(() => css_('#a')));
  check('그 바탕 위에서는 이미 읽힌다', (await ratio('#a')) >= AA, await ratio('#a'));
}

console.log('\n■ 밝은 화면으로 돌아가면 원래 색으로');
{
  await pg.evaluate(() => put_('<p><span id="a" style="color:rgb(31, 78, 156)">남색 제목</span></p>'));
  const 어두울때 = await pg.evaluate(() => css_('#a'));
  await pg.evaluate(() => { dark_(false); fit_(); });
  check('저장된 색을 그대로 되돌린다',
        (await pg.evaluate(() => css_('#a'))) === 'rgb(31, 78, 156)',
        { 어두울때, 지금: await pg.evaluate(() => css_('#a')) });

  // 검은 글자는 색을 뗐었다 — 그것도 돌아와야 한다.
  await pg.evaluate(() => { dark_(true); put_('<p><span id="a" style="color:rgb(0, 0, 0)">본문</span></p>'); });
  check('뗐던 색도 돌아온다', (await pg.evaluate(() => { dark_(false); fit_(); return css_('#a'); }))
        === 'rgb(0, 0, 0)');
  await pg.evaluate(() => dark_(true));
  check('다시 어둡게 하면 또 고친다', (await pg.evaluate(() => { fit_(); return css_('#a'); })) === '');
}

console.log('\n■ 배선');
{
  check('읽기 상자를 그릴 때마다 부른다',
        (HTML.match(/rtFitFontSizes\(view\); rtFitDarkColors\(view\)/g) || []).length >= 3,
        (HTML.match(/rtFitDarkColors\(/g) || []).length);
  check('밝게/어둡게 바꾸면 다시 맞춘다',
        /MutationObserver\(rtRefitAll\)[\s\S]{0,120}attributeFilter: \['class'\]/.test(HTML));
  check('저장된 값은 안 건드린다 (보여줄 때만)',
        /el\.dataset\.rtCol = el\.style\.color;/.test(HTML) &&
        /el\.style\.color = el\.dataset\.rtCol;/.test(HTML));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
