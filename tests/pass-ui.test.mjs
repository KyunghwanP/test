// 외출증 UI 검증 — 실제 Chromium 에서 DOM 을 본다.
// 하네스는 index.html 에서 코드·마크업·CSS 를 그대로 떼어 온다(tests/build-pass-harness.py).
import { chromium } from 'playwright';
const URL = 'file://' + process.env.PASS_HARNESS;

const STUDENTS = [
  { grade: 1, room: 3, num: 7,  name: '김민준' },
  { grade: 1, room: 3, num: 8,  name: '이서연' },
  { grade: 2, room: 1, num: 12, name: '박지호' }
];
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shift = n => { const d = new Date(); d.setDate(d.getDate()+n); return ymd(d); };

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
page.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });
await page.goto(URL);

// 지난 날짜·앞날 (한 번만 읽는 것) 준비
await page.evaluate(({ f1 }) => {
  window.__future = {
    [f1]: [{ id:'f1', grade:1, room:4, num:2, name:'최도현', kind:'외출', outAt:'13:00', backAt:'14:20',
             reason:'정기 검진', guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동', createdAt:'2026-08-19T02:00:00Z' }]
  };
}, { f1: shift(1) });
await page.evaluate(({ y1, y2 }) => {
  window.__past = {
    [y1]: [{ id:'p1', grade:3, room:5, num:5, name:'오지민', kind:'조퇴', outAt:'11:10',
             reason:'발열', guardian:'전화', issuedBy:'kim@yeungnam.hs.kr', issuedName:'김교사', createdAt:'2026-08-18T01:58:00Z' }],
    [y2]: [{ id:'p2', grade:2, room:2, num:21, name:'임건우', kind:'결과', outAt:'09:40',
             reason:'대회 준비', guardian:'미확인', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동', createdAt:'2026-08-17T00:12:00Z' }]
  };
}, { y1: shift(-1), y2: shift(-2) });

await page.evaluate(s => { window.setStudents(s); window.initPassPage(); }, STUDENTS);
await page.waitForTimeout(80);

console.log('\n■ 오늘 목록 — 사진과 함께');
await page.evaluate(({ PX }) => {
  window.reset();
  window.__photos = { '1-3': { '7': PX } };
  window.pushToday([
    { id:'a', grade:1, room:3, num:7, name:'김민준', kind:'조퇴', outAt:'14:30',
      reason:'몸살', guardian:'문자', issuedBy:'kim@yeungnam.hs.kr', issuedName:'김교사', createdAt:'2026-08-19T05:12:00Z' },
    { id:'b', grade:1, room:3, num:8, name:'이서연', kind:'외출', outAt:'10:00', backAt:'11:30',
      reason:'치과 진료', guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동', createdAt:'2026-08-19T00:41:00Z' }
  ]);
}, { PX });
await page.waitForTimeout(200);
{
  check('오늘 2건이 보인다', (await page.locator('.pass-daygroup').first().locator('.pass-card').count()) === 2);
  const names = await page.$$eval('.pass-daygroup:first-child .pass-name', n => n.map(x => x.textContent));
  check('나가는 시각 순', names[0] === '이서연' && names[1] === '김민준', names);
  await page.waitForFunction(() => document.querySelectorAll('img.pass-photo').length > 0);
  check('사진 있는 학생은 사진', (await page.locator('.pass-card').nth(1).locator('img.pass-photo').count()) === 1);
  check('사진 없는 학생은 첫 글자', (await page.locator('.pass-card').nth(0).locator('.pass-photo-none').textContent()) === '이');
  // innerText 는 inline-flex 자식 사이에 줄바꿈을 넣는다 → 공백을 눌러서 비교
  const t = (await page.textContent('#passTally')).replace(/\s+/g, ' ').trim();
  check('요약 칩: 오늘 2건', t.includes('오늘 2건'), t);
  check('요약 칩: 종류별', t.includes('조퇴 1') && t.includes('외출 1') && t.includes('결과 0'), t);
}

console.log('\n■ 날짜별 묶음 (달력 없음)');
{
  check('달력이 없다', (await page.locator('.grid7, .pass-daynav').count()) === 0);
  check('날짜 그룹이 3개(오늘+지난 2일)', (await page.locator('.pass-daygroup').count()) === 3);
  const heads = await page.$$eval('.pass-dayhead .d', n => n.map(x => x.textContent));
  check('맨 위가 오늘', heads[0] === '오늘', heads);
  check('오늘 그룹만 today 표시', (await page.locator('.pass-dayhead.today').count()) === 1);
  check('그룹마다 건수 표시', (await page.locator('.pass-dayhead .c').first().textContent()) === '2건');
  check('지난 날짜도 보인다', (await page.innerText('#passFeed')).includes('오지민'));
  check('날짜 머리가 sticky',
        (await page.locator('.pass-dayhead').first().evaluate(e => getComputedStyle(e).position)) === 'sticky');
}

console.log('\n■ 카드 누르면 상세 모달');
{
  await page.locator('.pass-card').first().click();   // 이서연 (외출, 내가 발급)
  await page.waitForTimeout(150);
  check('모달이 열린다', await page.locator('#passDetailOverlay.open').isVisible());
  const body = await page.innerText('#passDetailBody');
  check('학년·반·번호가 풀어서 보인다', body.includes('1학년 3반 8번'), body);
  check('이름', body.includes('이서연'));
  check('나가는 시각', body.includes('10:00'));
  check('복귀 예정(외출)', body.includes('복귀 예정') && body.includes('11:30'));
  check('사유·보호자', body.includes('치과 진료') && body.includes('전화'));
  check('발급자와 시각', body.includes('홍길동') && body.includes('00:41'), body);
  check('사진이 크게', (await page.locator('#passDetailBody .pass-photo, #passDetailBody .pass-photo-none')
        .first().evaluate(e => parseInt(getComputedStyle(e).width))) >= 88);
  check('내가 끊은 건은 삭제 버튼', (await page.locator('#passDelBtn').count()) === 1);
}

console.log('\n■ 조퇴는 복귀 줄이 없다 / 남의 것은 삭제 불가');
{
  await page.evaluate(() => window.passCloseDetail());
  await page.locator('.pass-card').nth(1).click();     // 김민준 (조퇴, 김교사 발급)
  await page.waitForTimeout(150);
  const body = await page.innerText('#passDetailBody');
  check('복귀 예정 줄이 없다', !body.includes('복귀 예정'), body);
  check('남이 끊은 건은 삭제 버튼 없음', (await page.locator('#passDelBtn').count()) === 0);
  await page.evaluate(() => { window.__admin = true; });
  await page.evaluate(() => window.passCloseDetail());
  await page.locator('.pass-card').nth(1).click();
  await page.waitForTimeout(150);
  check('관리자는 남의 것도 삭제 가능', (await page.locator('#passDelBtn').count()) === 1);
  await page.evaluate(() => { window.__admin = false; });
}

console.log('\n■ 삭제');
{
  await page.evaluate(() => { window.reset(); window.__admin = true; });
  await page.evaluate(() => window.passCloseDetail());
  await page.locator('.pass-card').first().click();
  await page.waitForTimeout(120);
  await page.locator('#passDelBtn').click();
  await page.waitForTimeout(150);
  const del = await page.evaluate(() => window.__deleted);
  check('오늘 날짜 경로로 지운다', del.length === 1 && /^passes\/\d{4}-\d{2}-\d{2}\/items\/b$/.test(del[0]), del);
  check('삭제 후 모달이 닫힌다', !(await page.locator('#passDetailOverlay.open').isVisible()));
  await page.evaluate(() => { window.reset(); window.__confirm = false; });
  await page.locator('.pass-card').first().click();
  await page.waitForTimeout(120);
  await page.locator('#passDelBtn').click();
  await page.waitForTimeout(120);
  check('취소하면 안 지운다', (await page.evaluate(() => window.__deleted)).length === 0);
  await page.evaluate(() => { window.__confirm = true; window.__admin = false; window.passCloseDetail(); });
}

console.log('\n■ 지난 날짜 삭제는 화면에서 직접 걷어낸다 (구독이 안 걸려 있으므로)');
{
  await page.evaluate(() => { window.reset(); window.__admin = true; });
  const before = await page.locator('.pass-card').count();
  await page.locator('.pass-daygroup').nth(2).locator('.pass-card').first().click();  // 임건우 (그제)
  await page.waitForTimeout(120);
  await page.locator('#passDelBtn').click();
  await page.waitForTimeout(200);
  check('지난 날 카드가 사라진다', (await page.locator('.pass-card').count()) === before - 1);
  check('그 그룹도 사라진다', (await page.locator('.pass-daygroup').count()) === 2);
  await page.evaluate(() => { window.__admin = false; });
}

console.log('\n■ 예정 보기 (미래 건은 오늘 목록에 안 섞인다)');
{
  await page.evaluate(() => { window.reset(); });
  const feed = await page.innerText('#passFeed');
  check('앞날 건이 기본 목록에 없다', !feed.includes('최도현'), feed);
  check('예정 칩이 보인다', (await page.locator('#passUpBtn').count()) === 1);
  check('예정 건수', (await page.textContent('#passUpBtn')).replace(/\s+/g,'').includes('1건'));
  await page.locator('#passUpBtn').click();
  await page.waitForTimeout(150);
  const up = await page.innerText('#passFeed');
  check('예정 보기로 바뀐다', up.includes('최도현'), up);
  check('예정에는 오늘 건이 없다', !up.includes('김민준'), up);
  check('칩이 켜진 상태', await page.locator('#passUpBtn.on').isVisible());
  await page.locator('#passUpBtn').click();
  await page.waitForTimeout(150);
  check('다시 누르면 최근 보기로', (await page.innerText('#passFeed')).includes('김민준'));
}

console.log('\n■ 발급');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(120);
  check('모달이 열린다', await page.locator('#passModalOverlay.open').isVisible());
  check('고르기 전 저장 잠김', await page.locator('#passSaveBtn').isDisabled());
  check('학생을 고르기 전에도 칸이 다 보인다',
        (await page.locator('#passKinds').isVisible()) && (await page.locator('#passReason').isVisible())
        && (await page.locator('#passGuards').isVisible()) && (await page.locator('#passRepeats').isVisible()));
  check('날짜 기본값은 오늘', (await page.inputValue('#passDate')) === ymd(new Date()));
  await page.fill('#passSearch', '1-3');
  await page.waitForTimeout(100);
  check('학년-반으로 검색', (await page.locator('.pass-pick-item').count()) === 2);
  await page.fill('#passSearch', '박지');
  await page.waitForTimeout(100);
  await page.locator('.pass-pick-item').first().click();
  await page.waitForTimeout(100);
  check('고르면 학생 칸만 채워진다', await page.locator('#passPicked').isVisible());
  check('검색창은 사라진다', !(await page.locator('#passPickWrap').isVisible()));
  check('저장 버튼이 풀린다', !(await page.locator('#passSaveBtn').isDisabled()));
  check('조퇴면 복귀 칸 숨김', !(await page.locator('#passBackWrap').isVisible()));
  await page.locator('#passKinds .pass-slot[data-kind="외출"]').click();
  check('외출이면 복귀 칸', await page.locator('#passBackWrap').isVisible());
  await page.fill('#passOutAt', '13:20');
  await page.fill('#passBackAt', '15:00');
  await page.fill('#passReason', '치과');
  await page.locator('#passGuards .pass-slot[data-guard="문자"]').click();
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(200);
  const added = await page.evaluate(() => window.__added);
  check('한 건 저장', added.length === 1, added);
  check('오늘 경로', /^passes\/\d{4}-\d{2}-\d{2}\/items$/.test(added[0].path), added[0].path);
  const d = added[0].data;
  check('학생 정보가 숫자로', d.grade === 2 && d.room === 1 && d.num === 12 && d.name === '박지호', d);
  check('종류·시각·사유·복귀', d.kind === '외출' && d.outAt === '13:20' && d.backAt === '15:00' && d.reason === '치과', d);
  check('보호자·발급자', d.guardian === '문자' && d.issuedBy === 'hong@yeungnam.hs.kr' && d.issuedName === '홍길동', d);
  check('저장하면 닫힌다', !(await page.locator('#passModalOverlay.open').isVisible()));
}

console.log('\n■ 조퇴면 복귀 시각을 저장하지 않는다 / 시각 비면 막는다');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(100);
  await page.fill('#passSearch', '김민'); await page.waitForTimeout(100);
  await page.locator('.pass-pick-item').first().click();
  await page.locator('#passKinds .pass-slot[data-kind="외출"]').click();
  await page.fill('#passBackAt', '15:00');
  await page.locator('#passKinds .pass-slot[data-kind="조퇴"]').click();
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(150);
  check('조퇴면 backAt 이 빈다', (await page.evaluate(() => window.__added))[0].data.backAt === '', await page.evaluate(() => window.__added));

  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(100);
  await page.fill('#passSearch', '김민'); await page.waitForTimeout(100);
  await page.locator('.pass-pick-item').first().click();
  await page.fill('#passOutAt', '');
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(120);
  check('시각 없으면 저장 안 됨', (await page.evaluate(() => window.__added)).length === 0);
  check('안내가 뜬다', (await page.innerText('#passFormMsg')).includes('시각'));
  await page.evaluate(() => window.passCloseForm());
}

console.log('\n■ 날짜 지정 — 앞날 것을 미리 발급하면 예정에 들어간다');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(120);
  await page.fill('#passSearch', '박지'); await page.waitForTimeout(100);
  await page.locator('.pass-pick-item').first().click();
  const d3 = (() => { const x = new Date(); x.setDate(x.getDate()+3); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; })();
  await page.fill('#passDate', d3);
  await page.fill('#passOutAt', '09:00');
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(250);
  const added = await page.evaluate(() => window.__added);
  check('지정한 날짜 경로로 저장', added.length === 1 && added[0].path === `passes/${d3}/items`, added);
  // 새로고침 없이 바로 보여야 한다
  await page.locator('#passUpBtn').click();
  await page.waitForTimeout(150);
  check('새로고침 없이 예정 목록에 바로 뜬다', (await page.innerText('#passFeed')).includes('박지호'));
  await page.locator('#passUpBtn').click();
  await page.waitForTimeout(120);
}

console.log('\n■ 반복 발급');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(120);
  await page.fill('#passSearch', '김민'); await page.waitForTimeout(100);
  await page.locator('.pass-pick-item').first().click();
  check('처음엔 반복 옵션이 숨어 있다', !(await page.locator('#passRepeatOpts').isVisible()));
  await page.locator('#passRepeats .pass-slot[data-rep="daily"]').click();
  check('매일을 고르면 종료일 칸이 열린다', await page.locator('#passRepeatOpts').isVisible());
  check('매일에는 요일 칸이 없다', !(await page.locator('#passWdayWrap').isVisible()));
  await page.locator('#passRepeats .pass-slot[data-rep="weekly"]').click();
  check('요일을 고르면 요일 칸이 열린다', await page.locator('#passWdayWrap').isVisible());
  check('요일 5개(월~금)', (await page.locator('#passWdays .pass-wday').count()) === 5);

  // 월요일부터 2주, 월·수만
  const mon = (() => { const x = new Date(); x.setDate(x.getDate() + ((8 - x.getDay()) % 7 || 7)); return x; })();
  const f = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const end = new Date(mon); end.setDate(end.getDate() + 13);
  await page.fill('#passDate', f(mon));
  await page.fill('#passUntil', f(end));
  await page.locator('#passWdays .pass-wday[data-wd="1"]').click();
  await page.locator('#passWdays .pass-wday[data-wd="3"]').click();
  await page.waitForTimeout(120);
  check('만들어질 건수를 미리 알려준다', (await page.textContent('#passRepeatNote')).includes('4일치'),
        await page.textContent('#passRepeatNote'));
  await page.fill('#passOutAt', '10:00');
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(400);
  const added = await page.evaluate(() => window.__added);
  check('월·수 4건이 만들어진다', added.length === 4, added.map(a => a.path));
  const days = added.map(a => a.day);
  check('전부 월요일 또는 수요일',
        days.every(d => [1,3].includes(new Date(d + 'T00:00:00').getDay())), days);
  check('모두 같은 내용', added.every(a => a.data.name === '김민준' && a.data.outAt === '10:00'));
}

console.log('\n■ 반복 — 주말은 건너뛴다');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(120);
  await page.fill('#passSearch', '김민'); await page.waitForTimeout(100);
  await page.locator('.pass-pick-item').first().click();
  await page.locator('#passRepeats .pass-slot[data-rep="daily"]').click();
  const f = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const mon = (() => { const x = new Date(); x.setDate(x.getDate() + ((8 - x.getDay()) % 7 || 7)); return x; })();
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  await page.fill('#passDate', f(mon));
  await page.fill('#passUntil', f(sun));
  await page.fill('#passOutAt', '10:00');
  await page.waitForTimeout(120);
  check('월~일 이면 평일 5일치', (await page.textContent('#passRepeatNote')).includes('5일치'),
        await page.textContent('#passRepeatNote'));
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(400);
  const days = (await page.evaluate(() => window.__added)).map(a => a.day);
  check('토·일이 없다', days.every(d => ![0,6].includes(new Date(d + 'T00:00:00').getDay())), days);
}

console.log('\n■ 모바일 — FAB');
{
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  m.on('pageerror', e => { console.log('  ⚠ 모바일 오류:', e.message); fail++; });
  await m.goto(URL);
  await m.evaluate(s => { window.setStudents(s); window.initPassPage(); }, STUDENTS);
  await m.evaluate(() => window.pushToday([]));
  await m.waitForTimeout(150);
  check('FAB 이 보인다', await m.locator('#passFab').isVisible());
  check('헤더 버튼은 숨는다', !(await m.locator('.pass-add-btn').isVisible()));
  await m.locator('#passFab').click();
  await m.waitForTimeout(150);
  check('FAB 로 발급 모달이 열린다', await m.locator('#passModalOverlay.open').isVisible());
  await m.close();
}

console.log('\n■ 상태 — 대기 → 나감 → 완료');
{
  // 시계를 잡아 놓고 같은 자료를 다시 그린다. 시각만으로 갈리는 판단이라 이게 유일한 검사법이다.
  const at = async hhmm => {
    await page.evaluate(h => {
      const d = new Date(); d.setHours(+h.slice(0,2), +h.slice(3,5), 0, 0);
      window.__nowMs = d.getTime();
    }, hhmm);
    await page.evaluate(() => window.passRender());
    await page.waitForTimeout(60);
  };
  // 카드 순서가 상태에 따라 바뀌므로 위치가 아니라 이름으로 찾는다
  const card = nm => page.locator('.pass-card').filter({ has: page.locator('.pass-name', { hasText: nm }) });
  const st = async nm => (await card(nm).locator('.pass-state').textContent()).trim();
  const done = nm => card(nm).evaluate(e => e.classList.contains('done'));
  // 다른 날짜 묶음(앞 테스트에서 남은 것)이 섞이지 않게 '오늘' 묶음만 본다
  const order = () => page.evaluate(() => {
    const g = document.querySelector('.pass-dayhead.today')?.closest('.pass-daygroup');
    return [...(g ? g.querySelectorAll('.pass-name') : [])].map(x => x.textContent);
  });

  await page.evaluate(() => {
    window.reset(); window.__past = {}; window.__future = {};
    window.pushToday([
      { id:'e', grade:1, room:3, num:7, name:'김학생', kind:'조퇴', outAt:'13:00',
        guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' },
      { id:'g', grade:1, room:3, num:8, name:'이학생', kind:'외출', outAt:'14:00', backAt:'15:30',
        guardian:'문자', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' },
      { id:'h', grade:2, room:1, num:12, name:'박학생', kind:'외출', outAt:'16:00',
        guardian:'방문', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' }
    ]);
  });
  await page.waitForTimeout(120);

  await at('09:00');
  check('나가기 전에는 대기', (await st('김학생')) === '대기' && (await st('이학생')) === '대기');
  check('대기는 가라앉히지 않는다', !(await done('김학생')) && !(await done('이학생')));
  check('아무도 안 나갔으면 시각 순 그대로',
        JSON.stringify(await order()) === JSON.stringify(['김학생','이학생','박학생']), await order());

  await at('13:30');
  check('조퇴는 나간 시각이 지나면 완료', (await st('김학생')) === '완료', await st('김학생'));
  check('완료 카드는 가라앉는다', await done('김학생'));
  check('아직 안 나간 외출은 대기', (await st('이학생')) === '대기', await st('이학생'));
  check('끝난 건은 뒤로 밀린다',
        JSON.stringify(await order()) === JSON.stringify(['이학생','박학생','김학생']), await order());

  await at('14:30');
  check('외출은 나간 뒤 복귀 전까지 나감', (await st('이학생')) === '나감', await st('이학생'));
  check('나감은 완료로 죽이지 않는다', !(await done('이학생')));
  check('나간 건도 아직 안 나간 건보다 뒤로',
        JSON.stringify(await order()) === JSON.stringify(['박학생','이학생','김학생']), await order());
  const tally = async () => (await page.innerText('#passTally')).replace(/\s+/g, ' ');
  check('요약에 나가 있음이 뜬다', (await tally()).includes('나가 있음 1'), await tally());

  await at('15:45');
  check('복귀 시각이 지나면 완료로 바뀐다', (await st('이학생')) === '완료', await st('이학생'));
  check('완료 카드는 배경에 묻히지 않는다', await card('이학생').evaluate(c =>
    getComputedStyle(c).backgroundColor !== getComputedStyle(document.getElementById('passPage')).backgroundColor));
  check('카드 상태는 한 줄로 끝난다', await page.evaluate(() =>
    [...document.querySelectorAll('.pass-state')].every(e => e.getBoundingClientRect().height < 30)));
  check('요약에 완료 건수가 뜬다', (await tally()).includes('완료 2'), await tally());

  await at('16:30');
  check('복귀 시각을 안 적은 외출은 나감에 머문다', (await st('박학생')) === '나감', await st('박학생'));

  check('지난 날은 통째로 완료',
        await page.evaluate(() => passState({ kind:'조퇴', outAt:'23:59' }, '2000-01-01').label === '완료'));
  check('앞날은 예정',
        await page.evaluate(() => passState({ kind:'조퇴', outAt:'00:01' }, '2999-01-01').label === '예정'));

  await at('14:30');
  await card('이학생').click();
  await page.waitForTimeout(120);
  check('상세에도 상태가 보인다', (await page.innerText('#passDetailBody')).includes('나감'),
        await page.innerText('#passDetailBody'));
  await page.evaluate(() => window.passCloseDetail());
  await at('15:45');
  await card('이학생').click();
  await page.waitForTimeout(120);
  check('상세에는 왜 완료인지까지 적는다',
        (await page.innerText('#passDetailBody')).includes('복귀 예정 15:30 지남'),
        await page.innerText('#passDetailBody'));
  await page.evaluate(() => window.passCloseDetail());
  await page.evaluate(() => { window.__nowMs = null; });
}

console.log('\n■ 상세 모달 — 사진을 크게');
{
  await page.evaluate(({ PX }) => {
    window.reset();
    window.__photos = { '1-3': { '7': PX } };
    window.pushToday([{ id:'p', grade:1, room:3, num:7, name:'김학생', kind:'조퇴', outAt:'13:00',
      guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' }]);
  }, { PX });
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelectorAll('img.pass-photo').length > 0);
  await page.locator('.pass-card').first().click();
  await page.waitForTimeout(150);
  const box = await page.locator('#passDetailBody .pass-photo').boundingBox();
  check('상세 사진이 200px 이상', box.width >= 200, box);
  check('세로가 가로보다 길다(증명사진 비율)', box.height > box.width, box);
  const modal = await page.locator('#passDetailOverlay .pass-modal').boundingBox();
  check('사진이 모달 안에서 가운데',
        Math.abs((box.x + box.width/2) - (modal.x + modal.width/2)) < 2, [box, modal]);
  await page.evaluate(() => window.passCloseDetail());
}

console.log('\n■ 넓은 화면 — 카드를 여러 열로 깐다');
{
  const rows = n => Array.from({ length: n }, (_, i) => ({
    id: 'w' + i, grade: 1, room: 3, num: 7, name: '학생' + i, kind: '조퇴', outAt: '13:00',
    guardian: '전화', issuedBy: 'hong@yeungnam.hs.kr', issuedName: '홍길동' }));
  const cols = async () => page.evaluate(() =>
    getComputedStyle(document.querySelector('.pass-cards')).gridTemplateColumns.split(' ').length);

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.evaluate(r => { window.reset(); window.pushToday(r); }, rows(6));
  await page.waitForTimeout(150);
  check('1500px 에서 3열', (await cols()) === 3, await cols());
  check('보호자 확인이 함께 보인다', await page.locator('.pass-wide-only').first().isVisible());
  const wrapW = (await page.locator('.pass-wrap').boundingBox()).width;
  check('넓은 화면에서 폭을 760px 에 가두지 않는다', wrapW > 1000, wrapW);

  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(80);
  check('1000px 에서 2열', (await cols()) === 2, await cols());

  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(80);
  check('700px 에서 1열', (await cols()) === 1, await cols());
  check('좁은 화면에선 보호자 확인을 접는다', !(await page.locator('.pass-wide-only').first().isVisible()));

  await page.setViewportSize({ width: 900, height: 900 });
}

console.log('\n■ 모바일 좌우 여백');
{
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  m.on('pageerror', e => { console.log('  ⚠ 모바일 오류:', e.message); fail++; });
  await m.goto(URL);
  await m.addStyleTag({ content: 'body{margin:0;}' });   // 하네스 body 여백 제거 — 앱에는 없다
  await m.evaluate(s => { window.setStudents(s); window.initPassPage(); }, STUDENTS);
  await m.evaluate(() => window.pushToday([
    { id:'m', grade:1, room:3, num:7, name:'김학생', kind:'조퇴', outAt:'13:00',
      guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' }]));
  await m.waitForTimeout(150);
  const card = await m.locator('.pass-card').first().boundingBox();
  check('좌우 여백이 12px 로 좁다', card.x === 12 && Math.round(card.x + card.width) === 378, card);
  check('가로 스크롤이 생기지 않는다',
        await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await m.close();
}

console.log('\n■ 다크 모드 — 파랑 채도를 낮춘다');
{
  const val = async v => page.evaluate(k =>
    getComputedStyle(document.getElementById('passPage')).getPropertyValue(k).trim(), v);
  const light = await val('--cal-500');
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.waitForTimeout(50);
  const dark = await val('--cal-500');
  check('라이트는 명세 그대로 #006BFF', light.toUpperCase() === '#006BFF', light);
  check('다크는 다른 파랑을 쓴다', dark.toUpperCase() !== '#006BFF', dark);
  const sat = hex => {                       // HSL 채도
    const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i, i+2), 16) / 255);
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
    return mx === mn ? 0 : (mx-mn) / (1 - Math.abs(2*l - 1));
  };
  check('다크 파랑은 채도가 낮다', sat(dark) < 0.6, [dark, sat(dark)]);
  check('그래도 같은 파랑 계열', (() => {                 // 파랑 성분이 가장 크다
    const [r,g,b] = [1,3,5].map(i => parseInt(dark.slice(i, i+2), 16));
    return b > r && b > g; })(), dark);
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
}

console.log('\n■ 검색 결과 — 얼굴을 함께 띄운다');
{
  await page.setViewportSize({ width: 900, height: 900 });
  await page.evaluate(({ PX }) => {
    window.reset();
    window.__photos = { '1-3': { '7': PX } };            // 김학생만 사진 있음
    window.setStudents([
      { grade:1, room:3, num:7,  name:'김학생' },
      { grade:1, room:3, num:8,  name:'이학생' },
      { grade:2, room:1, num:12, name:'박학생' }
    ]);
    window.pushToday([]);
    window.passOpenForm();
  }, { PX });
  await page.waitForTimeout(80);
  await page.fill('#passSearch', '1-3');
  await page.waitForTimeout(80);
  await page.waitForFunction(() => document.querySelectorAll('#passSearchResult img.pass-photo').length > 0);
  const items = page.locator('.pass-pick-item');
  check('사진 있는 학생은 사진', (await items.nth(0).locator('img.pass-photo.sm').count()) === 1);
  check('사진 없는 학생은 이름 첫 글자',
        (await items.nth(1).locator('.pass-photo-none.sm').textContent()) === '이');
  const box = await items.nth(0).locator('img.pass-photo').boundingBox();
  check('목록 사진보다 작게', box.width <= 40 && box.height <= 50, box);
}

console.log('\n■ 검색 — 키보드로 고른다');
{
  check('첫 결과가 미리 짚혀 있다', (await page.locator('.pass-pick-item.on').count()) === 1);
  check('짚힌 것은 첫 번째',
        await page.locator('.pass-pick-item').nth(0).evaluate(e => e.classList.contains('on')));

  await page.focus('#passSearch');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(50);
  check('↓ 로 다음으로 내려간다',
        await page.locator('.pass-pick-item').nth(1).evaluate(e => e.classList.contains('on')));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(50);
  check('↑ 는 위로, 끝에서는 돌아간다',
        await page.locator('.pass-pick-item').nth(1).evaluate(e => e.classList.contains('on')));

  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  check('Enter 로 골라진다', await page.locator('#passFields, #passPicked').first().isVisible());
  check('짚고 있던 학생이 골라진다', (await page.innerText('#passPicked')).includes('이학생'),
        await page.innerText('#passPicked'));
  check('저장 버튼이 풀린다', !(await page.locator('#passSaveBtn').isDisabled()));
}

console.log('\n■ 검색 — 결과가 하나면 Enter 한 번');
{
  await page.evaluate(() => window.passUnpick());
  await page.fill('#passSearch', '박학생');
  await page.waitForTimeout(80);
  check('결과가 하나', (await page.locator('.pass-pick-item').count()) === 1);
  await page.focus('#passSearch');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  check('바로 골라진다', (await page.innerText('#passPicked')).includes('박학생'),
        await page.innerText('#passPicked'));

  await page.evaluate(() => window.passUnpick());
  await page.fill('#passSearch', '없는이름');
  await page.waitForTimeout(80);
  await page.focus('#passSearch');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  check('결과가 없으면 Enter 가 아무것도 안 한다',
        !(await page.locator('#passPicked').isVisible()));
  await page.evaluate(() => window.passCloseForm());
}

console.log('\n■ 상세 사진 — 고화질로 바꿔 끼운다');
{
  await page.evaluate(({ PX }) => {
    window.reset();
    window.__photos = { '1-3': { '7': PX } };
    window.__big = 'data:image/png;base64,BIGPHOTO';      // 워커가 준 고화질인 척
    window.pushToday([{ id:'q', grade:1, room:3, num:7, name:'김학생', kind:'조퇴', outAt:'13:00',
      guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' }]);
  }, { PX });
  await page.waitForTimeout(120);
  await page.waitForFunction(() => document.querySelectorAll('.pass-card img.pass-photo').length > 0);
  await page.locator('.pass-card').first().click();
  await page.waitForFunction(() =>
    document.querySelector('#passDetailBody img.pass-photo')?.src.includes('BIGPHOTO'), null, { timeout: 3000 })
    .then(() => check('고화질로 교체된다', true))
    .catch(async () => check('고화질로 교체된다', false,
      await page.getAttribute('#passDetailBody img.pass-photo', 'src')));
  check('목록 카드는 작은 사진 그대로',
        !(await page.getAttribute('.pass-card img.pass-photo', 'src')).includes('BIGPHOTO'));
  await page.evaluate(() => { window.__big = null; window.passCloseDetail(); });
}

console.log('\n■ 나이스 출결 문구를 지웠다');
{
  check('페이지 하단에 없다', !(await page.innerText('#passPage')).includes('나이스'));
  await page.locator('.pass-card').first().click();
  await page.waitForTimeout(120);
  check('상세 모달에도 없다', !(await page.innerText('#passDetailOverlay')).includes('나이스'));
  await page.evaluate(() => window.passCloseDetail());
}

console.log('\n■ 수정·삭제 권한');
{
  const put = rows => page.evaluate(r => { window.reset(); window.pushToday(r); }, rows);
  const MINE   = { id:'m1', grade:1, room:3, num:7, name:'김학생', kind:'조퇴', outAt:'13:00',
                   reason:'병원', guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동' };
  const OTHERS = { id:'o1', grade:1, room:3, num:8, name:'이학생', kind:'외출', outAt:'10:00', backAt:'11:30',
                   reason:'치과', guardian:'문자', issuedBy:'kim@yeungnam.hs.kr', issuedName:'김교사' };

  await put([MINE, OTHERS]);
  await page.waitForTimeout(120);
  const open = async nm => {
    await page.locator('.pass-card').filter({ has: page.locator('.pass-name', { hasText: nm }) }).click();
    await page.waitForTimeout(100);
  };

  await open('김학생');
  check('내가 끊은 건 — 수정 버튼', (await page.locator('#passEditBtn').count()) === 1);
  check('내가 끊은 건 — 삭제 버튼', (await page.locator('#passDelBtn').count()) === 1);
  await page.evaluate(() => window.passCloseDetail());

  await open('이학생');
  check('남이 끊은 건 — 수정 버튼 없음', (await page.locator('#passEditBtn').count()) === 0);
  check('남이 끊은 건 — 삭제 버튼도 없음', (await page.locator('#passDelBtn').count()) === 0);
  await page.evaluate(() => window.passCloseDetail());

  await page.evaluate(() => { window.__admin = true; });
  await open('이학생');
  check('관리자는 남의 것도 삭제할 수 있다', (await page.locator('#passDelBtn').count()) === 1);
  check('관리자라도 남의 것은 수정 못 한다', (await page.locator('#passEditBtn').count()) === 0);
  await page.evaluate(() => { window.passCloseDetail(); window.__admin = false; });
}

console.log('\n■ 수정 — 틀은 그대로, 값만 바뀐다');
{
  await page.locator('.pass-card').filter({ has: page.locator('.pass-name', { hasText: '김학생' }) }).click();
  await page.waitForTimeout(100);
  const heroBefore = await page.innerText('.pass-detail-hero');
  const rowsBefore = await page.$$eval('.pass-row .k', n => n.map(x => x.textContent));

  await page.locator('#passEditBtn').click();
  await page.waitForTimeout(100);
  check('모달은 그대로 열려 있다', await page.locator('#passDetailOverlay.open').isVisible());
  check('사진·이름 영역은 안 변한다', (await page.innerText('.pass-detail-hero')) === heroBefore);
  check('줄 구조(항목 이름)는 유지된다',
        JSON.stringify(await page.$$eval('.pass-row .k', n => n.map(x => x.textContent)))
          .includes('나가는 시각'));
  check('값 자리가 입력칸으로 바뀐다', (await page.locator('.pass-row .pass-edit').count()) >= 4);
  check('날짜는 못 고친다', (await page.locator('#passEdDate').count()) === 0);
  check('학생을 바꾸는 칸은 없다', (await page.locator('#passDetailBody #passSearch').count()) === 0);
  check('현재 값이 채워져 있다',
        (await page.inputValue('#passEdOut')) === '13:00' &&
        (await page.inputValue('#passEdReason')) === '병원', rowsBefore);
  check('조퇴라 복귀 줄은 숨어 있다', !(await page.locator('#passEdBackRow').isVisible()));
}

console.log('\n■ 수정 — 저장');
{
  await page.selectOption('#passEdKind', '외출');
  await page.waitForTimeout(50);
  check('외출로 바꾸면 복귀 줄이 나온다', await page.locator('#passEdBackRow').isVisible());
  await page.fill('#passEdBack', '15:00');
  await page.fill('#passEdOut', '13:40');
  await page.fill('#passEdReason', '치과 진료');
  await page.selectOption('#passEdGuard', '방문');
  await page.locator('#passEdSave').click();
  await page.waitForTimeout(150);

  const up = await page.evaluate(() => window.__updated);
  check('한 건만 저장된다', up.length === 1, up);
  check('그 외출증 문서로 간다', /^passes\/\d{4}-\d{2}-\d{2}\/items$/.test(up[0].path.replace(/\/m1$/, '')) || up[0].path.endsWith('/m1'), up[0].path);
  check('merge 로 덮어쓴다', up[0].opt && up[0].opt.merge === true, up[0].opt);
  check('바꾼 값이 담긴다',
        up[0].data.kind === '외출' && up[0].data.outAt === '13:40' &&
        up[0].data.backAt === '15:00' && up[0].data.reason === '치과 진료' &&
        up[0].data.guardian === '방문', up[0].data);
  check('발급자는 건드리지 않는다', !('issuedBy' in up[0].data) && !('issuedName' in up[0].data), up[0].data);
  check('학생도 건드리지 않는다',
        !('grade' in up[0].data) && !('num' in up[0].data) && !('name' in up[0].data), up[0].data);

  check('저장하면 보기로 돌아온다', (await page.locator('.pass-row .pass-edit').count()) === 0);
  check('모달은 열린 채', await page.locator('#passDetailOverlay.open').isVisible());
  const body = await page.innerText('#passDetailBody');
  check('바뀐 내용이 상세에 보인다', body.includes('13:40') && body.includes('치과 진료') && body.includes('방문'), body);
  const listTxt = await page.innerText('#passList, #passFeed');
  check('목록에도 바로 반영된다', listTxt.includes('13:40') && listTxt.includes('치과 진료'), listTxt);
}

console.log('\n■ 수정 — 취소와 실수 방지');
{
  await page.locator('#passEditBtn').click();
  await page.waitForTimeout(80);
  await page.fill('#passEdReason', '지워질 내용');
  // 수정 중에 바깥을 눌러도 닫히면 안 된다
  await page.locator('#passDetailOverlay').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(80);
  check('수정 중에는 바깥을 눌러도 안 닫힌다', await page.locator('#passDetailOverlay.open').isVisible());
  await page.evaluate(() => { window.__updated = []; });
  await page.locator('#passEdCancel').click();
  await page.waitForTimeout(80);
  check('취소하면 저장하지 않는다', (await page.evaluate(() => window.__updated)).length === 0);
  check('취소하면 보기로 돌아온다', (await page.locator('.pass-row .pass-edit').count()) === 0);
  check('취소해도 값은 그대로', (await page.innerText('#passDetailBody')).includes('치과 진료'));

  await page.locator('#passEditBtn').click();
  await page.waitForTimeout(80);
  await page.fill('#passEdOut', '');
  await page.evaluate(() => { window.__updated = []; });
  await page.locator('#passEdSave').click();
  await page.waitForTimeout(100);
  check('시각을 비우면 저장을 막는다', (await page.evaluate(() => window.__updated)).length === 0);
  check('안내가 뜬다', (await page.innerText('#passEdMsg')).includes('시각'));
  await page.evaluate(() => { window.passEditing = false; window.passCloseDetail(); });
  await page.evaluate(() => window.passCloseDetail());
}

console.log('\n■ 데스크톱은 FAB 을 쓰지 않는다');
{
  check('FAB 숨김', !(await page.locator('#passFab').isVisible()));
  check('헤더 버튼 보임', await page.locator('.pass-add-btn').isVisible());
}

await browser.close();
console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
