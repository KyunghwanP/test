// 상담 예약을 주말에도 열고 받을 수 있는지.
//
// 2026-08(고3 수시 상담기간): 학부모 화면과 워커에는 요일 제한이 없는데
// 교사 앱만 두 곳에서 주말을 막고 있었다 —
//   · 주간 보기가 월~금 5칸만 그림 (토·일 슬롯은 만들어도 안 보임)
//   · 기간 만들기가 주말을 무조건 건너뜀
import { chromium } from 'playwright';
import fs from 'node:fs';

const html   = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
const parent = fs.readFileSync(import.meta.dirname + '/../parent.html', 'utf8');
const worker = fs.readFileSync(import.meta.dirname + '/../workers/consult-api.js', 'utf8');

const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = html.indexOf('{', m.index), d = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// 날짜 계산은 실제 함수를 떼어 쓴다
const CONSULT_WD2 = JSON.parse(/const CONSULT_WD2 = (\[[^\]]*\]);/.exec(html)[1].replace(/'/g, '"'));

const { consultWeekStart, consultAddDays } = new Function(
  grab('consultLocalYmd') + grab('consultWeekStart') + grab('consultAddDays') +
  '\nreturn { consultWeekStart, consultAddDays };')();

console.log('\n■ 주 시작은 월요일이고 7일을 센다');
{
  // 2026-08-24 는 월요일
  check('월요일 기준', consultWeekStart('2026-08-26') === '2026-08-24', consultWeekStart('2026-08-26'));
  check('일요일도 그 주(월요일)로 묶인다', consultWeekStart('2026-08-30') === '2026-08-24', consultWeekStart('2026-08-30'));
  check('토요일은 +5', consultAddDays('2026-08-24', 5) === '2026-08-29');
  check('일요일은 +6', consultAddDays('2026-08-24', 6) === '2026-08-30');
}

console.log('\n■ 주간 보기가 월~일 7칸을 그리는가');
{
  check('5칸으로 못박지 않는다', !/for\(let i=0;i<5;i\+\+\)\{/.test(html));
  check('항상 7칸이다', /const dayCount = 7;/.test(html));
  check('되돌리는 법을 적어 뒀다', /되돌리려면 이 값만 5 로 바꾸면 된다/.test(html));
  check('칸 수만큼 돈다', /for\(let i=0;i<dayCount;i\+\+\)\{/.test(html));
  check('CSS 가 5칸으로 되돌리지 않는다',
        !/\.cweek-body\{grid-template-columns:repeat\(5,minmax/.test(html));
  check('주말 칸을 구분 표시한다', /class="cday\$\{i >= 5 \? ' weekend' : ''\}"/.test(html));
  check('7번째 칸이 일요일이다', CONSULT_WD2[6] === '일', CONSULT_WD2);
}

console.log('\n■ 헤더 날짜 범위가 실제 칸 수를 따라가는가');
{
  // +4(금)로 고정돼 있어, 일요일 칸을 보여 주면서 제목은 '8/24~8/28' 이라고 적었다.
  check('금요일로 못박지 않는다', !/const wkEnd = consultAddDays\(wk, 4\);/.test(html));
  check('마지막 칸까지 센다', /const wkEnd = consultAddDays\(wk, dayCount - 1\);/.test(html));

  // 7칸이므로 월요일 + 6 = 일요일
  check('일요일까지 센다', consultAddDays('2026-08-24', 6) === '2026-08-30');
  check('달을 넘겨도 맞다', consultAddDays('2026-08-31', 6) === '2026-09-06');
}

console.log('\n■ 쓰기 전에 정의되는가 (TDZ)');
{
  // const 는 선언 전에 쓰면 ReferenceError 로 상담 화면이 통째로 안 그려진다.
  const fn = grab('renderConsultList');
  const def = fn.indexOf('const wkEnd =');
  const use = fn.indexOf('consultRangeLabel(wk, wkEnd)');
  check('wkEnd 정의를 찾았다', def >= 0);
  check('consultRangeLabel 호출을 찾았다', use >= 0);
  check('정의가 사용보다 앞이다', def >= 0 && use >= 0 && def < use, { def, use });

  const d = fn.indexOf('const dayCount =');
  const u = fn.indexOf('${dayCount}');
  check('dayCount 은 선언 뒤에 쓰인다', d >= 0 && (u < 0 || d < u), { d, u });
}

console.log('\n■ 좁은 화면에서 칸이 찌그러지지 않는가');
{
  // 인라인으로 grid-template-columns 를 직접 주면 미디어쿼리의 minmax(92px) 가 죽는다
  // (인라인이 이긴다). 7칸이면 360px 폰에서 한 칸 44px 이 된다.
  check('인라인으로 열을 직접 정하지 않는다',
        !/style="grid-template-columns:repeat\(\$\{dayCount\}/.test(html));
  check('칸 수만 변수로 넘긴다', /style="--cday-count:\$\{dayCount\};"/.test(html));
  check('기본 규칙이 변수를 쓴다',
        /\.cweek-body\{[\s\S]{0,400}?grid-template-columns:repeat\(var\(--cday-count,5\),1fr\)/.test(html));
  check('좁은 화면 규칙이 최소폭을 지킨다',
        /\.cweek-body\{grid-template-columns:repeat\(var\(--cday-count,5\),minmax\(92px,1fr\)\);overflow-x:auto;\}/.test(html));
}

console.log('\n■ 기간 만들기에서 주말을 고를 수 있는가');
{
  check('체크박스가 있다', /id="consultIncludeWeekend"/.test(html));
  check('무조건 건너뛰지 않는다', !/if\(wd === 0 \|\| wd === 6\) continue;/.test(html));
  check('체크했을 때만 포함한다', /if\(!incWeekend && \(wd === 0 \|\| wd === 6\)\) continue;/.test(html));
  check('안내 문구도 바뀌었다', /주말만 골랐다면/.test(html));

  // 실제 걸러내는 식을 그대로 돌려 본다
  const pick = (from, to, inc) => {
    const out = [];
    for (let d = from; d <= to; d = consultAddDays(d, 1)) {
      const wd = new Date(d + 'T00:00:00').getDay();
      if (!inc && (wd === 0 || wd === 6)) continue;
      out.push(d);
    }
    return out;
  };
  check('기본은 평일만 (8/24~8/30 → 5일)', pick('2026-08-24', '2026-08-30', false).length === 5);
  check('켜면 7일 전부',                  pick('2026-08-24', '2026-08-30', true).length === 7);
  check('토요일 하루만 골라도 켜면 나온다', pick('2026-08-29', '2026-08-29', true).length === 1);
}

console.log('\n■ 하루만 만들 때는 요일을 안 따진다');
{
  // endDate 를 비우면 그대로 push 한다(예전부터 그랬다) — 이제 주간 보기에 실제로 보인다
  check('단일 날짜는 그대로 만든다', /\} else \{\s*\n\s*days\.push\(date\);\s*\n\s*\}/.test(html));
}

console.log('\n■ 학부모 화면과 워커는 원래 막지 않는다');
{
  check('parent.html 에 요일 제한 없음', !/getDay\(\)\s*===?\s*[06]/.test(parent));
  check('워커에 요일 제한 없음', !/getDay\(\)/.test(worker));
}

console.log('\n■ 공강 고르기는 평일만 (시간표가 없다)');
{
  check('주말 가드는 남아 있다', /if\(dowIdx < 1 \|\| dowIdx > 5\)\{/.test(html));
  check('대신 어디서 만드는지 알려준다', /상담 시간 열기<\/b> 에서 시각을 직접 넣어/.test(html));
}

// ── 실제 브라우저에서 칸 폭을 잰다 ────────────────────────────────
// 7칸으로 늘리기로 한 근거가 '좁아져도 쓸 만하다' 이므로, 산수로 단언하지 않고
// index.html 의 <style> 을 그대로 물려 Chromium 에서 재 본다.
console.log('\n■ 7칸일 때 실제 칸 폭과 글자 넘침 (Chromium)');
{
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const slot = nm => `<div class="cslot booked"><span class="cslot-t">14:00</span>`
                   + `<span class="cslot-name">${nm}</span>`
                   + `<span class="cslot-m face">대면</span></div>`;
  const grid = nm => `<div class="cweek-body" style="--cday-count:7;">`
    + Array.from({ length: 7 }, (_, i) =>
        `<div class="cday${i >= 5 ? ' weekend' : ''}">`
        + `<div class="cday-head">8/${24 + i} (${CONSULT_WD2[i]})</div>`
        + `<div class="cday-slots">${slot(nm)}</div></div>`).join('')
    + `</div>`;
  const doc = nm => `<!doctype html><meta charset="utf-8"><style>${css}</style>`
    + `<div class="page-view active" id="consultPage"><div class="consult-wrap"><div class="consult-cols">`
    + `<div class="consult-section consult-col-make">왼쪽</div>`
    + `<div class="consult-section consult-col-status"><div id="consultList">${grid(nm)}</div></div>`
    + `</div></div></div>`;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });

  const measure = async (w, nm) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.setContent(doc(nm));
    return page.evaluate(() => {
      const day = document.querySelector('.cday');
      const box = document.querySelector('.cweek-body');
      const nameEl = document.querySelector('.cslot-name');
      return {
        cols  : document.querySelectorAll('.cday').length,
        col   : Math.round(day.getBoundingClientRect().width),
        over  : nameEl.scrollWidth > nameEl.clientWidth + 1
             || nameEl.getBoundingClientRect().width > day.getBoundingClientRect().width,
        scroll: box.scrollWidth > box.clientWidth + 1
      };
    });
  };

  // 칸이 7개 나오는지 + 최소폭이 무너지지 않는지
  for (const w of [1920, 1440, 1280, 1024, 768]) {
    const r = await measure(w, '김민준');
    check(`${w}px — 7칸, 칸 ${r.col}px`, r.cols === 7 && r.col >= 88, r);
  }

  // 폰: 최소폭 92px 을 지키고 대신 가로 스크롤이 걸려야 한다
  for (const w of [430, 360]) {
    const r = await measure(w, '김민준');
    check(`${w}px — 칸 ${r.col}px 유지 + 가로 스크롤`, r.col >= 92 && r.scroll, r);
  }

  // 긴 이름도 칸 밖으로 삐져나오지 않아야 한다(줄바꿈은 허용)
  for (const nm of ['김민준', '남궁민수', '박서연 학부모']) {
    const r = await measure(1024, nm);   // 가장 좁은 데스크탑 조건
    check(`1024px · "${nm}" 글자가 안 넘친다`, !r.over, r);
  }

  await browser.close();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
