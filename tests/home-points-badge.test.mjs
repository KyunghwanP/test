// 홈 현황판 '우리반 오늘 시간표' 헤더에 붙는 새 상벌점 배지.
//
// riro_points 는 밤마다 학년 전체가 통째로 덮어써지는 스냅샷이라 원래 '새로
// 추가된 것'이라는 개념이 없다. 학생별 records(개별 항목)를 서명으로 바꿔
// 직전에 확인한 서명 목록과 비교하는 방식으로 흉내낸다 — 그 비교 로직과
// 배지 배선을 index.html 에서 그대로 떼어 내 담임 학급(1학년 1반)처럼
// 꾸민 하네스에서 확인한다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,300) : ''));

// 원본에서 그대로 떼어 온다 — 베껴 적으면 원본이 바뀌어도 통과해 버린다
const grab = (name) => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

console.log('\n■ 원본 배선 (정적)');
check('배지 CSS가 있다', /\.home-pts-tag\{/.test(HTML));
check('우리반 시간표를 그릴 때 배지 진단도 부른다',
      /window\._renderHomeClassTt\(\);\s*checkHomeroomNewPoints\(\);/.test(HTML));

const ptsSignaturesForSrc  = grab('ptsSignaturesFor');
const ptsNewSinceSrc       = grab('ptsNewSince');
const checkHomeroomNewPointsSrc = grab('checkHomeroomNewPoints');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

// 나를 1학년 1반 담임처럼 꾸민다 — 실제 index.html 이 그리는 것과 같은 마크업
// setContent 로 띄우면 localStorage 가 막힌 출처가 된다(SecurityError) — usage-stats.test.mjs 와
// 같은 방식으로 가짜 https 출처에 라우트로 응답해 실제 저장 경로를 그대로 검사한다.
const HARNESS = `<!doctype html><meta charset="utf-8">
<div id="homeClassTimetable">
  <div class="home-section-header">
    <span class="home-section-title">🏫 우리반(<span id="homeClassName">1-1</span>) 오늘 시간표</span>
    <span class="home-section-arrow">›</span>
  </div>
</div>
<script>
  // checkHomeroomNewPoints 가 쓰는 것만 가짜로 채운다
  const myTeacher = { homeroom: '1-1' };
  window.__mockStudents = [];                 // 테스트마다 여기를 바꿔 '오늘 밤 스냅샷'을 흉내
  const doc = (...args) => args;
  const getDoc = async () => ({ exists: () => true, data: () => ({ students: window.__mockStudents }) });
  const fbDb = {};
  const navLog = [];
  function navigateTo(page){ navLog.push(page); }
  window.navLog = navLog;

  ${ptsSignaturesForSrc}
  ${ptsNewSinceSrc}
  ${checkHomeroomNewPointsSrc}
  window.checkHomeroomNewPoints = checkHomeroomNewPoints;
  window.ptsSignaturesFor = ptsSignaturesFor;
  window.ptsNewSince = ptsNewSince;
</script>`;

await pg.route('https://ynhs.test/**', r =>
  r.fulfill({ contentType: 'text/html; charset=utf-8', body: HARNESS }));
await pg.goto('https://ynhs.test/h.html');

console.log('\n■ 순수 함수 — 서명 만들기 · 반 필터');
{
  const sigs = await pg.evaluate(() => window.ptsSignaturesFor([
    { num: '3', room: '1', records: [{ date: '2026-09-01', detail: '지각' }] },
    { num: '7', room: '2', records: [{ date: '2026-09-01', detail: '수업 태도' }] }, // 다른 반
  ], '1'));
  check('내 반 학생 것만 서명으로 남는다', JSON.stringify(sigs) === JSON.stringify(['3|2026-09-01|지각']), sigs);

  const news = await pg.evaluate(() => window.ptsNewSince([
    { num: '3', room: '1', records: [
      { date: '2026-09-01', detail: '지각' },
      { date: '2026-09-02', detail: '흡연' },
    ] },
  ], '1', ['3|2026-09-01|지각']));
  check('이미 확인한 서명은 빼고 새 것만 남는다', JSON.stringify(news) === JSON.stringify(['3|2026-09-02|흡연']), news);
}

console.log('\n■ 우리반(1-1) 오늘 시간표 헤더 — 첫 실행은 이력을 새 것으로 취급하지 않는다');
{
  await pg.evaluate(() => { window.__mockStudents = [
    { num: '3', room: '1', name: '김민준', records: [{ date: '2026-09-01', detail: '지각 3회' }] },
  ]; });
  await pg.evaluate(() => window.checkHomeroomNewPoints());
  check('배지가 안 뜬다(처음 켠 기기)', (await pg.$('#homeClassTimetable .home-pts-tag')) === null);
  const acked = await pg.evaluate(() => JSON.parse(localStorage.getItem('ynhsPtsAck_1-1')));
  check('대신 지금 상태를 기준으로 조용히 저장해 둔다', JSON.stringify(acked) === JSON.stringify(['3|2026-09-01|지각 3회']), acked);
}

console.log('\n■ 다음 날 — 우리 반에 2건이 새로 반영되면');
{
  await pg.evaluate(() => { window.__mockStudents = [
    { num: '3', room: '1', name: '김민준', records: [
      { date: '2026-09-01', detail: '지각 3회' },     // 이미 확인함
      { date: '2026-09-02', detail: '수업 태도 우수(상점)' },  // 새 것
    ] },
    { num: '5', room: '1', name: '이서준', records: [
      { date: '2026-09-02', detail: '휴대폰 사용' },          // 새 것
    ] },
    { num: '9', room: '2', name: '박지후', records: [
      { date: '2026-09-02', detail: '벌점 5점' },             // 옆 반 — 무시돼야 함
    ] },
  ]; });
  await pg.evaluate(() => window.checkHomeroomNewPoints());

  const tagText = await pg.$eval('#homeClassTimetable .home-pts-tag', e => e.textContent).catch(() => null);
  check('배지에 정확히 2건이라고 뜬다', tagText === '🆕 2', tagText);

  const inHeader = await pg.$eval('#homeClassTimetable .home-section-title',
    e => e.textContent.includes('우리반(1-1) 오늘 시간표') && e.querySelector('.home-pts-tag') !== null);
  check("'우리반(1-1) 오늘 시간표' 제목 안에 배지가 붙는다(새 섹션이 아니라)", inHeader);
}

console.log('\n■ 배지를 누르면');
{
  await pg.click('#homeClassTimetable .home-pts-tag');
  check('배지가 사라진다', (await pg.$('#homeClassTimetable .home-pts-tag')) === null);
  check("상벌점 조회·입력('points') 으로 이동한다",
        JSON.stringify(await pg.evaluate(() => window.navLog)) === '["points"]',
        await pg.evaluate(() => window.navLog));

  const acked = await pg.evaluate(() => JSON.parse(localStorage.getItem('ynhsPtsAck_1-1')));
  check('확인한 것으로 3건 전부 저장된다', acked.length === 3, acked);

  await pg.evaluate(() => window.checkHomeroomNewPoints());
  check('같은 데이터로 다시 확인해도 배지가 다시 안 뜬다', (await pg.$('#homeClassTimetable .home-pts-tag')) === null);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
