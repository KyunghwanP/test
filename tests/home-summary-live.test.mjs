// 현황판의 '주간교육활동 요약'이 새로고침 없이 바뀌는지.
//
// 요약은 GitHub Action 이 밤에 긁어서 만들어 weeklyData/summary 에 넣는다.
// 예전에는 앱이 한 번만 읽었고, 그것도 initHomePage 안이라 현황판을 나갔다
// 들어와도 다시 안 읽었다 — 앱을 열어 둔 채 날이 바뀌면 어제 요약을 계속 봤다.
// 주차 칩·전체 공지에서 겪은 것과 같은 자리다.
//
// index.html 은 Firebase 없이는 못 뜬다. 요약 배선만 원본에서 그대로 떼어내
// 붙인 하네스로 확인한다.
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
check('한 번만 읽지 않는다',
      !/getDoc\(doc\(fbDb, 'weeklyData', 'summary'\)\)/.test(HTML));
check('스냅샷으로 본다', /onSnapshot\(doc\(fbDb, 'weeklyData', 'summary'\)/.test(HTML));
check('현황판을 열 때 켠다', /watchHomeSummary\(\);/.test(HTML));
check('두 번 켜지 않는다', /if \(_homeSummaryUnsub\) return;/.test(HTML));
check('initHomePage 밖에 있다 (한 번만 도는 함수 안이면 소용없다)', (() => {
  const i = HTML.indexOf('async function initHomePage() {');
  let d = 0, end = -1;
  for (let j = HTML.indexOf('{', i); j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) { end = j; break; }
  }
  return HTML.indexOf('function watchHomeSummary()') > end;
})());

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8">
<div id="homeAISummary"></div><div id="homeAISummaryD"></div>
<script>
  const fbDb = {};
  const doc = (db, coll, id) => ({ coll, id });
  const escapeHtml = v => String(v).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // 가짜 onSnapshot — window.__push(data) 로 서버가 문서를 바꾼 척한다
  let _cb = null, _err = null;
  function onSnapshot(ref, cb, onErr){ _cb = cb; _err = onErr; return () => { _cb = null; }; }
  window.__push = d => _cb && _cb({ exists: () => d !== null, data: () => d });
  window.__fail = () => _err && _err(new Error('권한 없음'));
  window.__live = () => !!_cb;
  let _homeSummaryUnsub = null;
  ${grab('watchHomeSummary')}
  window.watchHomeSummary = watchHomeSummary;
  window.mo = () => document.getElementById('homeAISummary').innerHTML;
  window.de = () => document.getElementById('homeAISummaryD').innerHTML;
  watchHomeSummary();
</script>`);

console.log('\n■ 요약이 새로고침 없이 바뀐다');
{
  check('구독이 걸려 있다', await pg.evaluate(() => window.__live()));

  await pg.evaluate(() => window.__push({
    summary: '9.8.(화) 영어듣기평가\n9.10.(목)~9.11.(금) 2학년 수학여행',
    weekText: '9월 2주', updatedAt: new Date(2026, 8, 7, 2, 0).getTime() }));
  let mo = await pg.evaluate(() => window.mo());
  check('요약이 그려진다', mo.includes('영어듣기평가'), mo.slice(0, 160));
  check('줄마다 나뉜다', (mo.match(/border-bottom:1px dashed/g) || []).length === 2, mo.slice(0, 200));
  check('날짜가 굵게', /<strong>9\.8\.\(화\)<\/strong>/.test(mo), mo.slice(0, 200));
  check('주차와 기준일이 붙는다', mo.includes('9월 2주') && mo.includes('9월 7일'), mo.slice(0, 120));
  check('데스크톱 칸도 같이 채워진다', (await pg.evaluate(() => window.de())) === mo);

  // 밤에 Action 이 새 요약을 올렸다 — 새로고침 없이 바뀌어야 한다
  await pg.evaluate(() => window.__push({
    summary: '9.14.(월) 3학년 모의고사', weekText: '9월 3주',
    updatedAt: new Date(2026, 8, 14, 2, 0).getTime() }));
  mo = await pg.evaluate(() => window.mo());
  check('새 요약으로 바뀐다', mo.includes('모의고사') && !mo.includes('영어듣기평가'), mo.slice(0, 160));
  check('주차 표시도 따라간다', mo.includes('9월 3주'), mo.slice(0, 120));
  check('데스크톱 칸도 따라간다', (await pg.evaluate(() => window.de())) === mo);
}

console.log('\n■ 없거나 실패했을 때');
{
  await pg.evaluate(() => window.__push(null));
  check('문서가 없으면 그렇게 적는다',
        (await pg.evaluate(() => document.getElementById('homeAISummary').textContent)) === '요약 정보가 없습니다.');
  await pg.evaluate(() => window.__push({ weekText: '9월 3주' }));
  check('알맹이가 비어도 안 죽는다',
        (await pg.evaluate(() => document.getElementById('homeAISummary').textContent)) === '요약 정보가 없습니다.');
  await pg.evaluate(() => window.__push({ summary: '9.8.(화) 시험', weekText: '9월 2주' }));
  check('기준일이 없어도 그려진다',
        (await pg.evaluate(() => window.mo())).includes('시험'));
  await pg.evaluate(() => window.__fail());
  check('읽기가 막히면 안내로 바뀐다',
        (await pg.evaluate(() => document.getElementById('homeAISummary').textContent)) === '불러오기 실패');
}

console.log('\n■ 요약 글이 화면을 건드리지 못한다');
{
  // 요약은 Gemini 가 쓴 글이 그대로 들어온다. 태그가 살아 있으면 현황판이 망가진다.
  await pg.evaluate(() => window.__push({
    summary: '9.8.(화) <img src=x onerror=alert(1)> 시험', weekText: '<b>주</b>' }));
  const mo = await pg.evaluate(() => window.mo());
  check('요약 속 태그는 글자로만 남는다', !/<img/i.test(mo) && mo.includes('&lt;img'), mo.slice(0, 200));
  check('주차 표시도 마찬가지', !/<b>주<\/b>/.test(mo), mo.slice(0, 120));
  check('그래도 날짜 굵게는 살아 있다', /<strong>9\.8\.\(화\)<\/strong>/.test(mo), mo.slice(0, 200));
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
