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

// 등록을 빠뜨리면 모달은 그대로 있고 뒷페이지가 뒤로 가 버린다(실제로 그랬다).
// 두 곳 모두 상벌점 상세 팝업 바로 옆에 나란히 있어야 한다.
{
  const pop = HTML.slice(HTML.indexOf("window.addEventListener('popstate'"),
                         HTML.indexOf('// 2. 교체/보강 모달 뎁스'));
  check('뒤로가기가 이 모달을 먼저 닫는다',
        /ptsNewModal'\)\?\.classList\.contains\('show'\)\) \{ closePtsNewModalBtn\(\); armExitGuard\(\);/.test(pop), pop.slice(-400));
  const esc = HTML.slice(HTML.indexOf('// ESC 키로 열린 모달 닫기'),
                         HTML.indexOf('// ESC 키로 열린 모달 닫기') + 2500);
  check('ESC 로도 닫힌다', /ptsNewModal'\)\?\.classList\.contains\('show'\)[\s\S]{0,80}closePtsNewModalBtn\(\)/.test(esc));
}
check('배지는 조회 페이지로 던지지 않고 모달을 연다',
      /tag\.onclick[\s\S]{0,420}renderPtsNewModal\(hr, recent,/.test(HTML));
// 한 번 누르면 사라지는 배지는 그 뒤로 현황판에서 최근 상황을 알 길이 없다
check('배지는 안 본 것이 아니라 최근 것을 센다',
      /const recent = ptsEntriesWithin\(students, room, null, PTS_RECENT_DAYS\)[\s\S]{0,600}tag\.textContent = `🆕 \$\{recent\.length\}`/.test(HTML));
check('눌러도 배지를 지우지 않는다(NEW 표시만 걷는다)',
      /tag\.classList\.remove\('unseen'\)/.test(HTML) && !/tag\.remove\(\);/.test(HTML));
check('모달 안에서 조회 페이지로 갈 길은 남겨 둔다', /ptsNewGoToPoints\(\)[\s\S]{0,120}navigateTo\('points'\)/.test(HTML));

console.log('\n■ 기준선과 무관하게 "최근 항목"을 볼 수 있는가 (정적)');
check('조회 화면에 최근 항목 버튼이 있다', /id="ptsViewRecentBtn"[\s\S]{0,120}openPtsRecentModal\(\)/.test(HTML));
check('최근 창은 7일', /const PTS_RECENT_DAYS = 7;/.test(HTML));
check('최근 7일 모달에 누적 경고를 함께 넘긴다',
      /const warns = ptsWarnStudents\(ptsViewData, room, grade\)/.test(HTML)
      && /renderPtsNewModal\(hr, within, title, [^,]+, warns\)/.test(HTML));
check('그 주에 아무것도 없을 때만 이전 것으로 물러난다',
      /if \(within\.length\)[\s\S]{0,200}ptsRecentEntries\([\s\S]{0,80}PTS_FALLBACK_LIMIT\)/.test(HTML));
check('담임(관리자는 고른 반)일 때만 보인다',
      /recentBtn\.style\.display = hr \? '' : 'none'/.test(HTML));
check('열기 함수가 window 에 있다', /window\.openPtsRecentModal\s*=/.test(HTML));

const ptsRecentEntriesSrc  = grab('ptsRecentEntries');
const ptsEntriesWithinSrc  = grab('ptsEntriesWithin');
const ptsWarnStudentsSrc   = grab('ptsWarnStudents');
const ptsRememberAckSrc    = grab('ptsRememberAck');
const ptsDateKeySrc        = grab('ptsDateKey');
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
    <div id="ptsNewWarn"></div>
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

  ${ptsDateKeySrc}
  ${ptsEntriesForSrc}
  ${ptsSignaturesForSrc}
  ${ptsNewSinceSrc}
  ${ptsRecentEntriesSrc}
  ${ptsEntriesWithinSrc}
  const PTS_WARN_TOTAL = -5;
  const PTS_RECENT_DAYS = 7;
  ${ptsWarnStudentsSrc}
  ${ptsRememberAckSrc}
  window.ptsRecentEntries = ptsRecentEntries;
  window.ptsEntriesWithin = ptsEntriesWithin;
  window.ptsWarnStudents = ptsWarnStudents;
  window.ptsDateKey = ptsDateKey;
  ${renderPtsNewModalSrc}
  ${closePtsNewModalBtnSrc}
  ${checkHomeroomNewPointsSrc}
  window.checkHomeroomNewPoints = checkHomeroomNewPoints;
  window.ptsSignaturesFor = ptsSignaturesFor;
  window.ptsNewSince = ptsNewSince;
  window.closePtsNewModalBtn = closePtsNewModalBtn;
  window.renderPtsNewModal = renderPtsNewModal;
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

// 오늘을 2026-09-04 로 고정한다 — '최근 7일' 이 흐르는 시각에 딸려 가면 안 된다
const FIXED_TODAY = '2026-09-04T09:00:00';
await pg.addInitScript(iso => {
  const R = Date;
  const F = new R(iso).getTime();
  // eslint-disable-next-line no-global-assign
  Date = class extends R {
    constructor(...a) { return a.length ? new R(...a) : new R(F); }
    static now() { return F; }
  };
}, FIXED_TODAY);
await pg.goto('https://ynhs.test/h.html');

console.log('\n■ 우리반(1-1) 오늘 시간표 헤더 — 첫 실행은 이력을 새 것으로 취급하지 않는다');
{
  await pg.evaluate(() => { window.__mockStudents = [
    { num: '3', room: '1', name: '김민준', records: [{ date: '09.01', detail: '지각 3회' }] },
  ]; });
  await pg.evaluate(() => window.checkHomeroomNewPoints());
  const acked = await pg.evaluate(() => JSON.parse(localStorage.getItem('ynhsPtsAck_1-1')));
  check('지금 상태를 기준으로 조용히 저장해 둔다',
        JSON.stringify(acked) === JSON.stringify(['3|09.01|지각 3회']), acked);
  // 배지는 '안 본 것'이 아니라 '최근 것'을 센다 — 처음 켠 기기에서도 최근이면 뜬다
  const tag = await pg.$eval('#homeClassTimetable .home-pts-tag',
    e => ({ text: e.textContent, unseen: e.classList.contains('unseen') })).catch(() => null);
  check('그래도 배지는 뜬다(최근 1건)', tag && tag.text === '🆕 1', tag);
  check('다 본 상태라 옅게 뜬다', tag && !tag.unseen, tag);
}

console.log('\n■ 다음 날 — 우리 반에 2건이 새로 반영되면');
{
  await pg.evaluate(() => { window.__mockStudents = [
    { num: '3', room: '1', name: '김민준', records: [
      { date: '09.01', detail: '지각 3회' },     // 이미 확인함
      { date: '09.02', detail: '수업 태도 우수(상점)' },  // 새 것
    ] },
    { num: '5', room: '1', name: '이서준', records: [
      { date: '09.02', detail: '휴대폰 사용' },          // 새 것
    ] },
    { num: '9', room: '2', name: '박지후', records: [
      { date: '09.02', detail: '벌점 5점' },             // 옆 반 — 무시돼야 함
    ] },
  ]; });
  await pg.evaluate(() => window.checkHomeroomNewPoints());

  const tag = await pg.$eval('#homeClassTimetable .home-pts-tag',
    e => ({ text: e.textContent, unseen: e.classList.contains('unseen'), title: e.title })).catch(() => null);
  check('배지는 최근 7일 전체 건수(3건)를 센다', tag && tag.text === '🆕 3', tag);
  check('안 본 것이 있으면 진하게', tag && tag.unseen, tag);
  check('안 본 건수는 툴팁에 적는다', tag && tag.title.includes('안 본 것 2건'), tag && tag.title);

  const inHeader = await pg.$eval('#homeClassTimetable .home-section-title',
    e => e.textContent.includes('우리반(1-1) 오늘 시간표') && e.querySelector('.home-pts-tag') !== null);
  check("'우리반(1-1) 오늘 시간표' 제목 안에 배지가 붙는다(새 섹션이 아니라)", inHeader);
}

console.log('\n■ 배지를 눌러도 사라지지 않는다 — 계속 떠 있고 NEW 표시만 걷힌다');
{
  await pg.click('#homeClassTimetable .home-pts-tag');
  const after = await pg.$eval('#homeClassTimetable .home-pts-tag',
    e => ({ text: e.textContent, unseen: e.classList.contains('unseen') })).catch(() => null);
  check('배지가 그대로 남는다', after && after.text === '🆕 3', after);
  check('다 봤으니 옅어진다', after && !after.unseen, after);
  check('바로 페이지를 옮기지 않는다', JSON.stringify(await pg.evaluate(() => window.navLog)) === '[]',
        await pg.evaluate(() => window.navLog));
  check('모달이 열린다', await pg.$eval('#ptsNewModal', e => e.classList.contains('show')));
  check('머리글에 반과 건수가 뜬다',
        (await pg.$eval('#ptsNewInfo', e => e.textContent)) === '1-1 · 3건',
        await pg.$eval('#ptsNewInfo', e => e.textContent));

  const rows = await pg.$$eval('#ptsNewRecords .pts-detail-record-item', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check('최근 7일 3건이 다 나온다(이미 본 것 포함)', rows.length === 3, rows);
  check('그중 새로 생긴 것만 NEW 로 표시된다',
        rows.filter(r => r.includes('NEW')).length === 2, rows);
  check('이미 봤던 항목엔 NEW 가 없다',
        !rows.find(r => r.includes('지각 3회')).includes('NEW'), rows);
  check('옆 반(1-2) 학생은 안 섞인다', !rows.join(' ').includes('박지후'), rows);

  const acked = await pg.evaluate(() => JSON.parse(localStorage.getItem('ynhsPtsAck_1-1')));
  check('확인한 것으로 3건 전부 저장된다', acked.length === 3, acked);

  await pg.evaluate(() => window.closePtsNewModalBtn());
  check('닫으면 모달이 사라진다', !(await pg.$eval('#ptsNewModal', e => e.classList.contains('show'))));

  await pg.evaluate(() => window.checkHomeroomNewPoints());
  const again = await pg.$eval('#homeClassTimetable .home-pts-tag',
    e => ({ text: e.textContent, unseen: e.classList.contains('unseen') })).catch(() => null);
  check('다시 그려도 배지는 계속 있다', again && again.text === '🆕 3', again);
  check('NEW 는 다시 안 붙는다', again && !again.unseen, again);
}

console.log('\n■ 최근 7일에 아무것도 없으면 배지도 없다');
{
  await pg.evaluate(() => {
    localStorage.removeItem('ynhsPtsAck_1-1');
    window.__mockStudents = [
      { num: '3', room: '1', name: '김민준', records: [{ date: '05.02', detail: '한참 전' }] },
    ];
  });
  await pg.evaluate(() => window.checkHomeroomNewPoints());
  check('오래된 것만 있으면 배지가 안 뜬다', (await pg.$('#homeClassTimetable .home-pts-tag')) === null);
}

console.log('\n■ 최근 항목 — 기준선을 이미 잡아 둔 뒤에도 볼 수 있다');
{
  const students = [
    { grade: '1', num: '3', room: '1', name: '김민준', records: [
      { date: '2026-09-04', detail: '오늘 것' },
      { date: '2026-05-02', detail: '한참 전 것' },
    ] },
    { grade: '1', num: '9', room: '2', name: '박지후', records: [{ date: '2026-09-04', detail: '옆 반' }] },
    // 조회 화면의 ptsViewData 는 세 학년이 한 배열에 들어 있다 — 반만 보면 딸려 온다
    { grade: '2', num: '1', room: '1', name: '다른학년', records: [{ date: '2026-09-04', detail: '2학년 1반' }] },
  ];
  const recent = await pg.evaluate(s => window.ptsRecentEntries(s, '1', '1', '2026-09-04'), students);
  check('우리 반(1학년 1반) 것만 나온다', recent.length === 2, recent);
  check('같은 반 번호의 다른 학년이 안 섞인다', !recent.some(e => e.detail === '2학년 1반'), recent);
  check('옆 반도 안 섞인다', !recent.some(e => e.detail === '옆 반'), recent);
  check('최신 날짜가 위로 온다', recent[0].date === '2026-09-04', recent.map(e => e.date));

  // 기준선을 이미 잡아 둔(= 새 것이 하나도 없는) 상태여도 볼 수 있어야 한다
  const seeded = await pg.evaluate(s =>
    window.ptsNewSince(s, '1', window.ptsSignaturesFor(s, '1', '1'), '1'), students);
  check('새 것이 하나도 없어도 최근 항목은 남는다', seeded.length === 0 && recent.length === 2);
}

// 건수로 자르면 한 반의 한 해 이력이 그보다 적어서 사실상 전부 나온다 — 날짜로 자른다
console.log('\n■ 최근 7일 — 날짜로 자른다');
{
  const students = [{ grade: '1', num: '3', room: '1', name: 'ㄱ', records: [
    { date: '09.04', detail: '오늘' },
    { date: '08.30', detail: '닷새 전' },
    { date: '08.20', detail: '보름 전' },
    { date: '05.29', detail: '한참 전' },
  ] }];
  const week = await pg.evaluate(s => window.ptsEntriesWithin(s, '1', '1', 7, '2026-09-04'), students);
  check('7일 안의 것만 남는다', week.length === 2, week.map(e => e.date));
  check('창 밖(보름 전)은 빠진다', !week.some(e => e.date === '08.20'), week.map(e => e.date));
  check('그래도 최신순', week[0].date === '09.04', week.map(e => e.date));

  const all = await pg.evaluate(s => window.ptsRecentEntries(s, '1', '1', '2026-09-04'), students);
  check('전체 보기는 여전히 다 준다(물러날 때 쓴다)', all.length === 4, all.length);

  const none = await pg.evaluate(s => window.ptsEntriesWithin(s, '1', '1', 7, '2026-12-25'), students);
  check('그 주에 아무 일도 없으면 빈 배열', none.length === 0, none);
}

// 리로스쿨 실제 형식은 '[ 09.04 ]' — 연도가 없다. 전에 'YYYY-MM-DD' 로 가정하고
// 날짜 창으로 자르다가 비교가 전부 실패해 '해당 항목 없음'만 떴다.
console.log('\n■ 연도 없는 리로스쿨 날짜(MM.DD)');
{
  const key = await pg.evaluate(() => [
    window.ptsDateKey('09.04', '2026-09-04'), window.ptsDateKey('[ 09.04 ]', '2026-09-04'),
    window.ptsDateKey('9.4', '2026-09-04'),   window.ptsDateKey('2026-09-04', '2026-09-04'),
    window.ptsDateKey('01.15', '2026-09-04'),
  ]);
  check('대괄호·한 자리 수도 같은 키가 된다', key[0] === key[1] && key[1] === key[2], key);
  check('연도 없는 09.04 가 실제 날짜가 된다', key[0] === '2026-09-04', key[0]);
  check('연도가 있으면 그대로 쓴다', key[3] === '2026-09-04', key[3]);
  // 학년도가 3월 시작이라 1·2월은 다음 해로 붙어야 12월보다 뒤가 된다
  check('1·2월은 다음 해로 붙는다', key[4] === '2027-01-15', key[4]);

  const real = await pg.evaluate(() => window.ptsRecentEntries(
    [{ grade: '1', num: '10101', room: '1', name: '김도욱', records: [
      { date: '09.04', detail: '지각 ( 학급 담임 요청 시 ) ( -1 ) 등교지도 정선욱(-1)' },
      { date: '06.12', detail: '#벌점을 상계하기 위한 교내봉사활동 ( 1 ) 아침 김영순(1)' },
      { date: '05.29', detail: '실내생활 ( 공놀이, 소란, 욕설, 가래침, 심한 장난 등 ) ( -1 )' },
    ] }], '1', '1', '2026-09-04'));
  check('실제 형식으로도 항목이 나온다', real.length === 3, real.length);
  check('최신(09.04)이 맨 위', real[0].date === '09.04', real.map(e => e.date));
  check('그 다음이 06.12', real[1].date === '06.12', real.map(e => e.date));

  const wrap = await pg.evaluate(() => window.ptsRecentEntries(
    [{ grade: '1', num: '1', room: '1', name: 'ㄱ', records: [
      { date: '03.05', detail: '3월(학년도 시작)' },
      { date: '01.15', detail: '1월(학년도 끝 무렵)' },
      { date: '12.20', detail: '12월' },
    ] }], '1', '1', '2026-09-04'));
  check('학년도 순서대로 1월 > 12월 > 3월',
        wrap.map(e => e.date).join(',') === '01.15,12.20,03.05', wrap.map(e => e.date));
  // 1월에 열어도 같은 학년도로 읽어야 한다(그때는 09월이 작년 9월이다)
  const inJan = await pg.evaluate(() => [
    window.ptsDateKey('09.04', '2027-01-15'), window.ptsDateKey('01.15', '2027-01-15'),
  ]);
  check('해가 바뀐 뒤에 열어도 같은 학년도로 읽는다',
        inJan[0] === '2026-09-04' && inJan[1] === '2027-01-15', inJan);
}

console.log('\n■ 누적 벌점 경고');
{
  const students = [
    // 합계 = 상점 + 벌점 + 상계 감점. 상계까지 반영된 실질 점수로 본다
    { grade: '1', room: '1', num: '1',  name: '김도욱', total: -3, demerit: -7, deducted: 3 },
    { grade: '1', room: '1', num: '7',  name: '위험학생', total: -8, demerit: -9, deducted: 1 },
    { grade: '1', room: '1', num: '9',  name: '딱기준',   total: -5, demerit: -5, deducted: 0 },
    { grade: '1', room: '1', num: '12', name: '착한학생', total: 3,  demerit: 0,  deducted: 0 },
    { grade: '1', room: '2', num: '4',  name: '옆반위험', total: -9, demerit: -9, deducted: 0 },
    { grade: '2', room: '1', num: '4',  name: '2학년위험', total: -9, demerit: -9, deducted: 0 },
  ];
  const warns = await pg.evaluate(s => window.ptsWarnStudents(s, '1', '1'), students);
  check('기준(-5) 이하만 걸린다', warns.length === 2, warns.map(w => w.name));
  check('기준값 자체도 포함된다(-5)', warns.some(w => w.name === '딱기준'), warns.map(w => w.name));
  check('상계로 올라온 학생(-3)은 안 걸린다', !warns.some(w => w.name === '김도욱'), warns.map(w => w.name));
  check('옆 반·다른 학년은 안 섞인다',
        !warns.some(w => w.name === '옆반위험' || w.name === '2학년위험'), warns.map(w => w.name));
  check('나쁜 쪽부터 위로', warns[0].name === '위험학생', warns.map(w => w.total));

  const strict = await pg.evaluate(s => window.ptsWarnStudents(s, '1', '1', -8), students);
  check('기준을 바꿀 수 있다', strict.length === 1 && strict[0].name === '위험학생', strict.map(w => w.name));

  // 모달에 실제로 붙는지
  await pg.evaluate(w => window.renderPtsNewModal('1-1', [], '🗓 최근 7일 상벌점', '1-1 · 0건', w), warns);
  const warnText = await pg.$eval('#ptsNewWarn', e => e.textContent.replace(/\s+/g, ' ').trim());
  check('모달에 경고 줄이 뜬다', warnText.includes('누적 벌점 주의') && warnText.includes('2명'), warnText);
  check('이름·번호·합계가 보인다',
        warnText.includes('위험학생') && warnText.includes('7번') && warnText.includes('합계 -8'), warnText);
  check('상계 점수도 같이 적힌다', warnText.includes('상계 +1'), warnText);

  await pg.evaluate(() => window.renderPtsNewModal('1-1', [], '제목', '정보', []));
  check('걸린 학생이 없으면 경고 줄 자체가 없다',
        (await pg.$eval('#ptsNewWarn', e => e.innerHTML)) === '');
}

// 시크릿 모드 등에서는 setItem 이 예외를 던진다. 배지 onclick 은 나중에 실행되는
// 클로저라 checkHomeroomNewPoints 를 감싼 바깥 try 가 못 잡는다 — 그대로 두면
// 저장에서 멈춰 모달이 아예 안 뜬다.
console.log('\n■ 저장이 막힌 브라우저에서도 배지·모달이 뜬다');
{
  await pg.evaluate(() => {
    // 앞 블록이 열어 둔 모달을 닫고 시작한다 — 안 그러면 '모달이 뜬다'가 거저 통과한다
    window.closePtsNewModalBtn();
    localStorage.clear();
    window.__writes = 0;
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...a) { window.__writes++; throw new Error('QuotaExceededError'); };
    window.__restore = () => { Storage.prototype.setItem = real; };
    window.__mockStudents = [
      { num: '3', room: '1', name: '김민준', records: [{ date: '09.03', detail: '지각' }] },
    ];
  });
  await pg.evaluate(() => window.checkHomeroomNewPoints());
  check('저장이 막혀도 배지는 뜬다',
        (await pg.$('#homeClassTimetable .home-pts-tag')) !== null);
  check('저장을 시도는 했다', (await pg.evaluate(() => window.__writes)) > 0);

  await pg.click('#homeClassTimetable .home-pts-tag');
  check('눌렀을 때 모달도 뜬다(여기서 멈추던 것)',
        await pg.$eval('#ptsNewModal', e => e.classList.contains('show')));

  await pg.evaluate(() => { window.__restore(); window.closePtsNewModalBtn(); localStorage.clear(); });
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
