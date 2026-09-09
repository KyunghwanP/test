// 현황판 날씨가 새로고침 없이 갱신되는지.
//
// GitHub Action 이 30분마다 appdata/weather 를 갱신한다. 그런데 앱은 현황판을
// 열 때 한 번만 읽고 끝이었다 — 캐시 유효시간 30분을 둬 놨지만 다시 부르는 쪽이
// 없어 아무 의미가 없었다. 앱을 열어 둔 채 하루를 보내면 아침 날씨를 저녁까지
// 그대로 봤다.
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

console.log('\n■ 배선 (정적)');
check('스냅샷으로 본다', /onSnapshot\(doc\(fbDb, 'appdata', 'weather'\)/.test(HTML));
check('현황판을 열 때 켠다', /watchHomeWeather\(\);/.test(HTML));
check('두 번 켜지 않는다', /if \(_weatherUnsub\) return;/.test(HTML));
check('initHomePage 밖에 있다 (한 번만 도는 함수 안이면 소용없다)', (() => {
  const i = HTML.indexOf('async function initHomePage() {');
  let d = 0, end = -1;
  for (let j = HTML.indexOf('{', i); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) { end = j; break; }
  }
  return HTML.indexOf('function watchHomeWeather()') > end;
})());
check('두 칸(모바일·데스크톱)에 같이 그린다',
      /\['homeWeather', 'homeWeatherD'\]/.test(HTML));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

// localStorage 를 쓰려면 진짜 출처가 있어야 한다(setContent 로는 막힌다)
await pg.route('https://ynhs.test/**', r => r.fulfill({
  contentType: 'text/html; charset=utf-8',
  body: `<!doctype html><meta charset="utf-8">
<div id="homeWeather"></div><div id="homeWeatherD"></div>
<script>
  const WEATHER_CACHE_KEY = 'ynhs-wx';
  const fbDb = {};
  const doc = (db, coll, id) => ({ coll, id });
  const buildWeatherHtml = d => '<b>' + d.temp + '도</b>';
  let _cb = null;
  function onSnapshot(ref, cb){ _cb = cb; return () => { _cb = null; }; }
  window.__push = d => _cb && _cb({ exists: () => d !== null, data: () => d });
  window.__live = () => !!_cb;
  let _weatherUnsub = null, _weatherAt = 0;
  ${grab('putHomeWeather')}
  ${grab('watchHomeWeather')}
  window.watchHomeWeather = watchHomeWeather;
  window.seed = (html, t) => { _weatherAt = t; putHomeWeather(html); };
  window.mo = () => document.getElementById('homeWeather').innerHTML;
  window.de = () => document.getElementById('homeWeatherD').innerHTML;
  window.cache = () => localStorage.getItem(WEATHER_CACHE_KEY);
  watchHomeWeather();
</script>`,
}));
await pg.goto('https://ynhs.test/harness');

console.log('\n■ 30분마다 오는 것을 받는다');
{
  check('구독이 걸려 있다', await pg.evaluate(() => window.__live()));

  await pg.evaluate(() => window.__push({ t: 1000, data: { temp: 21 } }));
  check('공유 캐시를 그린다', (await pg.evaluate(() => window.mo())) === '<b>21도</b>');
  check('데스크톱 칸도 같이', (await pg.evaluate(() => window.de())) === '<b>21도</b>');

  await pg.evaluate(() => window.__push({ t: 2000, data: { temp: 27 } }));
  check('새로 올라오면 바뀐다', (await pg.evaluate(() => window.mo())) === '<b>27도</b>');

  // 예전 방식으로 저장된 문서({t, html})도 읽는다
  await pg.evaluate(() => window.__push({ t: 3000, html: '<i>비</i>' }));
  check('예전 형식(html)도 그린다', (await pg.evaluate(() => window.mo())) === '<i>비</i>');

  const c = JSON.parse(await pg.evaluate(() => window.cache()));
  check('브라우저 캐시도 같이 갱신한다', c.t === 3000 && c.html === '<i>비</i>', c);
}

console.log('\n■ 옛것으로 되돌리지 않는다');
{
  // 앱이 직접 불러온 값이 더 최신일 수 있다. 그 위에 옛 공유 캐시를 덮으면
  // 화면이 거꾸로 간다.
  await pg.evaluate(() => window.seed('<b>지금</b>', 9000));
  await pg.evaluate(() => window.__push({ t: 5000, data: { temp: 15 } }));
  check('더 오래된 것은 무시한다', (await pg.evaluate(() => window.mo())) === '<b>지금</b>');
  await pg.evaluate(() => window.__push({ t: 9000, data: { temp: 15 } }));
  check('같은 시각도 무시한다', (await pg.evaluate(() => window.mo())) === '<b>지금</b>');
  await pg.evaluate(() => window.__push({ t: 9001, data: { temp: 15 } }));
  check('더 새것이면 바꾼다', (await pg.evaluate(() => window.mo())) === '<b>15도</b>');
}

console.log('\n■ 이상한 문서에 안 죽는다');
{
  const before = await pg.evaluate(() => window.mo());
  for (const [label, d] of [
    ['문서가 없음', null],
    ['시각이 없음', { data: { temp: 30 } }],
    ['알맹이가 없음', { t: 99999 }],
    ['빈 객체', {}],
  ]) {
    await pg.evaluate(x => window.__push(x), d);
    check(`${label} → 화면 그대로`, (await pg.evaluate(() => window.mo())) === before);
  }
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
