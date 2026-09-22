// 위젯 칸이 안 쓰는 자료까지 받아 오지 않는가.
//
// 위젯 한 칸은 `?widget=<패널>` 로 **앱 전체를 띄우고 패널 하나만 보이게** 하는
// 창이다. 그래서 로그인 뒤에 도는 것이 칸마다 한 벌씩 다 돈다.
//
// 제일 무거운 것은 업무 일정이다. loadMytasks 는 '나에게 공유된 것' 을 찾으려고
// uid 가 있는 교사 전원의 일정 컬렉션에 리스너를 하나씩 붙인다. 교사가 마흔이면
// 마흔 개이고, 위젯 여섯 칸이면 이백사십 개다 — 시간표 칸 다섯 개가 남의 업무
// 일정을 계속 듣고 있는 셈이다. Firestore 읽기 한도가 가장 먼저 닿을 곳이라,
// 이건 기능 문제이기 전에 비용 문제다.
//
// 여기서 세는 것은 '몇 개나 켜지나' 다. 규칙(WIDGET_NEEDS)을 옮겨 적지 않고
// 원본에서 그대로 떼어 와, 칸마다 실제로 무엇이 켜지는지 판정을 돌려 본다.
process.env.TZ = 'Asia/Seoul';
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

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

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8"><body><script>
  ${grabConst('WIDGET_NEEDS')}
  let IS_WIDGET_WV = false;
  ${grab('widgetNeeds')}
  window.asPanel_ = (panel, what) => {
    IS_WIDGET_WV = panel !== null;
    if (panel === null) document.documentElement.removeAttribute('data-widget');
    else document.documentElement.setAttribute('data-widget', panel);
    return widgetNeeds(what);
  };
  window.panels_ = () => Object.keys(WIDGET_NEEDS);
  window.kinds_  = () => [...new Set(Object.values(WIDGET_NEEDS).flat())].sort();
<\/script></body>`);

const needs = (panel, what) => pg.evaluate(([p, w]) => window.asPanel_(p, w), [panel, what]);

// 로그인 뒤에 켜지는 '화면 표시용' 리스너들. 이름은 widgetNeeds 에 넘기는 값이다.
const KINDS = ['mytask', 'consult', 'summary', 'weather', 'points'];
// 리스너 하나가 실제로 몇 개를 붙이나. mytask 는 교사 수만큼 붙는 것이 요점이다.
const COST = { mytask: '교사 수만큼', consult: 1, summary: 1, weather: 1, points: 1 };

console.log('\n■ 앱 창(위젯이 아닌 곳)에서는 전부 켠다');
{
  for (const k of KINDS) {
    check(`${k} — 앱 창에서는 켠다`, (await needs(null, k)) === true);
  }
}

console.log('\n■ 칸마다 제가 쓰는 것만 켠다');
{
  const panels = await pg.evaluate(() => window.panels_());
  const 표 = {};
  for (const p of panels) {
    const on = [];
    for (const k of KINDS) if (await needs(p, k)) on.push(k);
    표[p] = on;
  }
  console.log('     ' + JSON.stringify(표).replace(/","/g, '", "'));

  check('시간표 칸은 아무것도 안 켠다', 표.timetable.length === 0, 표.timetable);
  check('전체 시간표 칸도 마찬가지', 표.fulltt.length === 0, 표.fulltt);
  check('급식 칸도 마찬가지', 표.meal.length === 0, 표.meal);
  check('메모 칸도 마찬가지', 표.memo.length === 0, 표.memo);
  check('학급 조직 칸도 마찬가지', 표.classorg.length === 0, 표.classorg);
  check('학사일정 칸도 마찬가지', 표.schedule.length === 0, 표.schedule);

  check('업무 칸은 업무만', JSON.stringify(표.task) === '["mytask"]', 표.task);
  check('날씨 칸은 날씨만', JSON.stringify(표.weather) === '["weather"]', 표.weather);
  check('AI 요약 칸은 요약만', JSON.stringify(표.ai) === '["summary"]', 표.ai);
  check('상담 칸은 상담만', JSON.stringify(표.consult) === '["consult"]', 표.consult);
  check('학급 시간표 칸은 상벌점만 (배지가 붙는다)',
        JSON.stringify(표.classtt) === '["points"]', 표.classtt);
  // 미니 달력에는 업무와 상담이 같이 찍힌다 — 둘 다 있어야 한다.
  check('달력 칸은 업무와 상담 둘 다', 표.cal.includes('mytask') && 표.cal.includes('consult'), 표.cal);

  // 제일 비싼 것이 어디에 켜지는지가 이 검사의 요점이다.
  const mytaskOn = panels.filter(p => 표[p].includes('mytask'));
  check('교사 전원을 듣는 것은 두 칸에서만 켠다',
        JSON.stringify(mytaskOn.sort()) === '["cal","task"]', { mytaskOn, 비용: COST.mytask });
}

console.log('\n■ 모르는 칸에서는 아무것도 안 켠다');
{
  // 새 패널을 만들고 WIDGET_NEEDS 에 적는 것을 잊으면, 자료를 못 받아 화면이
  // 비는 쪽으로 틀린다. 조용히 전부 켜지는 쪽보다 낫다 — 그쪽은 티가 안 난다.
  for (const k of KINDS) {
    check(`${k} — 모르는 칸에서는 안 켠다`, (await needs('내일만드는패널', k)) === false);
  }
}

console.log('\n■ 배선 — 실제로 그 문을 지나는가');
{
  const gate = (what, call) =>
    new RegExp(`if \\(widgetNeeds\\('${what}'\\)\\)[^\\n]*${call}`).test(HTML);
  check('업무 일정', gate('mytask', 'loadMytasks\\(\\)'));
  check('상담', gate('consult', 'startConsultNotifyWatch\\('));
  check('AI 요약', gate('summary', 'watchHomeSummary\\(\\)'));
  check('날씨', gate('weather', 'watchHomeWeather\\(\\)'));
  check('상벌점', gate('points', 'checkHomeroomNewPoints\\('));

  // 알림은 일부러 그대로 둔다. 위젯이 알림을 내보내는 것이 설계이고, 같은 알림이
  // 여러 칸에서 와도 AHK 쪽 gToastSeen 이 한 번만 띄운다. 이 검사는 누군가
  // '리스너 줄이기' 를 하다 알림까지 끄는 것을 막는다.
  check('알림 감시는 건드리지 않았다',
        /if\(!isViewAs\(\)\)\{\s*\n\s*initNotify\(\);\s*\n\s*startTaskNotifyWatch\(user\);/.test(HTML));

  // 공지는 앞서 통째로 막았다(위젯 칸이 공지 창으로 덮이던 건).
  check('공지는 위젯에서 아예 안 켠다',
        /function initNotice\(\)\{[\s\S]{0,700}if \(IS_WIDGET_WV\) return;/.test(HTML));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;

await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
