// 상담 예약을 주말에도 열고 받을 수 있는지.
//
// 2026-08(고3 수시 상담기간): 학부모 화면과 워커에는 요일 제한이 없는데
// 교사 앱만 두 곳에서 주말을 막고 있었다 —
//   · 주간 보기가 월~금 5칸만 그림 (토·일 슬롯은 만들어도 안 보임)
//   · 기간 만들기가 주말을 무조건 건너뜀
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

console.log('\n■ 주간 보기가 주말 칸을 낼 수 있는가');
{
  check('5칸으로 못박지 않는다', !/for\(let i=0;i<5;i\+\+\)\{\s*\n\s*const dStr = consultAddDays\(wk, i\);/.test(html));
  check('칸 수를 계산한다', /const dayCount = hasSun \? 7 : \(hasSat \? 6 : 5\);/.test(html));
  check('토·일 슬롯이 있는지 본다',
        /const hasSat = !!days\[consultAddDays\(wk, 5\)\];/.test(html)
     && /const hasSun = !!days\[consultAddDays\(wk, 6\)\];/.test(html));
  check('그리드 열 수를 칸 수에 맞춘다', /style="--cday-count:\$\{dayCount\};"/.test(html));
  check('CSS 가 5칸으로 되돌리지 않는다',
        !/\.cweek-body\{grid-template-columns:repeat\(5,minmax/.test(html));
  check('주말 칸을 구분 표시한다', /class="cday\$\{i >= 5 \? ' weekend' : ''\}"/.test(html));

  // 칸 수 계산을 실제 식으로 돌려 본다
  const count = (sat, sun) => sun ? 7 : (sat ? 6 : 5);
  check('평일만 있으면 5칸', count(false, false) === 5);
  check('토요일이 있으면 6칸', count(true, false) === 6);
  check('일요일이 있으면 7칸', count(false, true) === 7);
  check('둘 다 있으면 7칸', count(true, true) === 7);
}

console.log('\n■ 헤더 날짜 범위가 실제 칸 수를 따라가는가');
{
  // +4(금)로 고정돼 있어, 일요일 칸을 보여 주면서 제목은 '8/24~8/28' 이라고 적었다.
  check('금요일로 못박지 않는다', !/const wkEnd = consultAddDays\(wk, 4\);/.test(html));
  check('마지막 칸까지 센다', /const wkEnd = consultAddDays\(wk, dayCount - 1\);/.test(html));

  const wkEnd = n => consultAddDays('2026-08-24', n - 1);
  check('평일만이면 금요일까지', wkEnd(5) === '2026-08-28', wkEnd(5));
  check('토요일 칸이 있으면 토요일까지', wkEnd(6) === '2026-08-29', wkEnd(6));
  check('일요일 칸이 있으면 일요일까지', wkEnd(7) === '2026-08-30', wkEnd(7));
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

  for (const name of ['hasSat', 'hasSun', 'dayCount']) {
    const d = fn.indexOf(`const ${name} =`);
    const u = fn.indexOf(`\${${name === 'dayCount' ? 'dayCount' : name}}`);
    check(`${name} 은 선언 뒤에 쓰인다`, d >= 0 && (u < 0 || d < u), { d, u });
  }
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

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
