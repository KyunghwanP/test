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
      /window\._renderHomeClassTt\(\);\s*checkHomeroomNewPoints\(homeroomKey\);/.test(HTML));

// 관리자는 담임반이 없다. 상담 화면은 이미 테스트용 1-1 로 폴백하는데 현황판만 안 해서
// '우리반 오늘 시간표' 자체가 안 떴고, 그래서 배지도 볼 수가 없었다.
{
  const blk = HTML.slice(HTML.indexOf('// ── 담임 학급 시간표 ──'),
                         HTML.indexOf('window._renderHomeClassTt();'));
  check('현황판도 관리자면 1-1 로 폴백한다',
        /isTestHomeroom = !myTeacher\.homeroom[\s\S]{0,160}ADMIN_EMAIL/.test(blk), blk.slice(0, 320));
  check('보기 모드에서는 폴백하지 않는다(대상 교사 기준)', /!isViewAs\(\)/.test(blk));
  check('폴백한 학급으로 시간표를 그린다', /classSchedule\[homeroomKey\]/.test(HTML));
  check('폴백한 학급 이름을 헤더에 쓴다', /homeClassName'\)\.textContent = homeroomKey/.test(HTML));
  check('폴백일 때만 반 고르기 드롭다운을 붙인다', /if\(isTestHomeroom\) renderTestHomeroomPicker\(homeroomKey\)/.test(blk));
}

console.log('\n■ 모달 배선 (정적)');
check('새 상벌점 모달이 있다', /id="ptsNewModal"/.test(HTML) && /id="ptsNewRecords"/.test(HTML));
check('닫기·이동 핸들러가 window 에 있다',
      /window\.closePtsNewModalBtn\s*=/.test(HTML) && /window\.ptsNewGoToPoints\s*=/.test(HTML));
check('배지는 조회 페이지로 던지지 않고 모달을 연다',
      /tag\.onclick[\s\S]{0,220}renderPtsNewModal\(hr, newEntries\)/.test(HTML));
check('모달 안에서 조회 페이지로 갈 길은 남겨 둔다', /ptsNewGoToPoints\(\)[\s\S]{0,120}navigateTo\('points'\)/.test(HTML));

console.log('\n■ 기준선과 무관하게 "최근 항목"을 볼 수 있는가 (정적)');
check('조회 화면에 최근 항목 버튼이 있다', /id="ptsViewRecentBtn"[\s\S]{0,120}openPtsRecentModal\(\)/.test(HTML));
check('담임(관리자는 고른 반)일 때만 보인다',
      /recentBtn\.style\.display = hr \? '' : 'none'/.test(HTML));
check('열기 함수가 window 에 있다', /window\.openPtsRecentModal\s*=/.test(HTML));

const ptsRecentEntriesSrc  = grab('ptsRecentEntries');
const ptsEntriesForSrc     = grab('ptsEntriesFor');
const ptsSignaturesForSrc  = grab('ptsSignaturesFor');
const ptsNewSinceSrc       = grab('ptsNewSince');
const renderPtsNewModalSrc = grab('renderPtsNewModal');
const closePtsNewModalBtnSrc = grab('closePtsNewModalBtn');
const checkHomeroomNewPointsSrc = grab('checkHomeroomNewPoints');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

// 나를 1학년 1반 담임처럼 꾸민다 — 실제 index.html 이 그리는 것과 같은 마크업
// setContent 로 띄우면 localStorage 가 막힌 출처가 된다(SecurityError) — usage-stats.test.mjs 와
// 같은 방식으로 가짜 https 출처에 라우트로 응답해 실제 저장 경로를 그대로 검사한다.
const HARNESS = `<!doctype html><meta charset="utf-8">
<style>.pts-detail-modal{display:none}.pts-detail-modal.show{display:flex}</style>
<div id="homeClassTimetable">
  <div class="home-section-header">
    <span class="home-section-title">🏫 우리반(<span id="homeClassName">1-1</span>) 오늘 시간표</span>
    <span class="home-section-arrow">›</span>
  </div>
</div>
<div class="pts-detail-modal" id="ptsNewModal">
  <div class="pts-detail-box">
    <div class="pts-detail-head-name" id="ptsNewTitle"></div>
    <div class="pts-detail-head-info" id="ptsNewInfo"></div>
    <div class="pts-detail-records" id="ptsNewRecords"></div>
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
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.navLog = navLog;

  ${ptsEntriesForSrc}
  ${ptsSignaturesForSrc}
  ${ptsNewSinceSrc}
  ${ptsRecentEntriesSrc}
  window.ptsRecentEntries = ptsRecentEntries;
  ${renderPtsNewModalSrc}
  ${closePtsNewModalBtnSrc}
  ${checkHomeroomNewPointsSrc}
  window.checkHomeroomNewPoints = checkHomeroomNewPoints;
  window.ptsSignaturesFor = ptsSignaturesFor;
  window.ptsNewSince = ptsNewSince;
  window.closePtsNewModalBtn = closePtsNewModalBtn;
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
  check('이미 확인한 서명은 빼고 새 것만 남는다',
        news.length === 1 && news[0].sig === '3|2026-09-02|흡연', news);
  // 서명만 돌려주면 모달에 '무엇이' 새로 생겼는지 못 적는다
  check('새 항목에 학생·날짜·사유가 함께 실린다',
        news[0].date === '2026-09-02' && news[0].detail === '흡연' && news[0].num === '3', news[0]);
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

console.log('\n■ 배지를 누르면 — 조회 페이지로 던지지 않고 바뀐 것만 모아 보여 준다');
{
  await pg.click('#homeClassTimetable .home-pts-tag');
  check('배지가 사라진다', (await pg.$('#homeClassTimetable .home-pts-tag')) === null);
  check('바로 페이지를 옮기지 않는다', JSON.stringify(await pg.evaluate(() => window.navLog)) === '[]',
        await pg.evaluate(() => window.navLog));
  check('모달이 열린다', await pg.$eval('#ptsNewModal', e => e.classList.contains('show')));
  check('머리글에 반과 건수가 뜬다',
        (await pg.$eval('#ptsNewInfo', e => e.textContent)) === '1-1 · 2건',
        await pg.$eval('#ptsNewInfo', e => e.textContent));

  const rows = await pg.$$eval('#ptsNewRecords .pts-detail-record-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('새로 생긴 2건만 나온다', rows.length === 2, rows);
  check('학생 이름·번호·날짜·사유가 다 보인다',
        rows[0].includes('김민준') && rows[0].includes('3번') &&
        rows[0].includes('2026-09-02') && rows[0].includes('수업 태도 우수'), rows[0]);
  check('옆 반(1-2) 학생은 안 섞인다', !rows.join(' ').includes('박지후'), rows);
  check('이미 확인했던 예전 항목은 안 나온다', !rows.join(' ').includes('지각 3회'), rows);

  const acked = await pg.evaluate(() => JSON.parse(localStorage.getItem('ynhsPtsAck_1-1')));
  check('확인한 것으로 3건 전부 저장된다', acked.length === 3, acked);

  await pg.evaluate(() => window.closePtsNewModalBtn());
  check('닫으면 모달이 사라진다', !(await pg.$eval('#ptsNewModal', e => e.classList.contains('show'))));

  await pg.evaluate(() => window.checkHomeroomNewPoints());
  check('같은 데이터로 다시 확인해도 배지가 다시 안 뜬다', (await pg.$('#homeClassTimetable .home-pts-tag')) === null);
}

console.log('\n■ 최근 항목 — 기준선을 이미 잡아 둔 뒤에도 날짜로 볼 수 있다');
{
  const students = [
    { num: '3', room: '1', name: '김민준', records: [
      { date: '2026-09-04', detail: '오늘 것' },
      { date: '2026-08-20', detail: '보름 전 것' },   // 14일 밖
    ] },
    { num: '9', room: '2', name: '박지후', records: [{ date: '2026-09-04', detail: '옆 반' }] },
  ];
  const recent = await pg.evaluate(s => window.ptsRecentEntries(s, '1', 14, '2026-09-04'), students);
  check('창 안의 우리 반 항목만 나온다', recent.length === 1 && recent[0].detail === '오늘 것', recent);

  const wide = await pg.evaluate(s => window.ptsRecentEntries(s, '1', 30, '2026-09-04'), students);
  check('기간을 넓히면 예전 것도 들어온다', wide.length === 2, wide);
  check('최신 날짜가 위로 온다', wide[0].date === '2026-09-04', wide.map(e => e.date));

  // 기준선을 이미 잡아 둔(= 새 것이 하나도 없는) 상태여도 볼 수 있어야 한다
  const seeded = await pg.evaluate(s => window.ptsNewSince(s, '1', window.ptsSignaturesFor(s, '1')), students);
  check('새 것이 하나도 없어도 최근 항목은 남는다', seeded.length === 0 && recent.length === 1);
}

console.log('\n■ 사유에 태그가 들어 있어도 실행되지 않는다');
{
  await pg.evaluate(() => {
    localStorage.setItem('ynhsPtsAck_1-1', JSON.stringify([]));
    window.__mockStudents = [
      { num: '1', room: '1', name: '<img src=x onerror=alert(1)>', records: [
        { date: '2026-09-03', detail: '<script>window.__pwned=1<\\/script>' },
      ] },
    ];
  });
  await pg.evaluate(() => window.checkHomeroomNewPoints());
  await pg.click('#homeClassTimetable .home-pts-tag');
  check('태그가 글자로 보인다', (await pg.$eval('#ptsNewRecords', e => e.textContent)).includes('<script>'));
  check('실행되지는 않았다', (await pg.evaluate(() => window.__pwned)) === undefined);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0,4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
