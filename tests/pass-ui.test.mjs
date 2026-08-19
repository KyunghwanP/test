// 외출증 UI 검증 — 실제 Chromium에서 DOM을 본다.
import { chromium } from 'playwright';
const URL = 'file://' + process.env.PASS_HARNESS + '';

const STUDENTS = [
  { grade: 1, room: 3, num: 7,  name: '김학생' },
  { grade: 1, room: 3, num: 8,  name: '이학생' },
  { grade: 2, room: 1, num: 12, name: '박학생' }
];
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on('pageerror', e => { console.log('  ⚠ 페이지 오류:', e.message); fail++; });
await page.goto(URL);
await page.evaluate(s => { window.setStudents(s); window.initPassPage(); }, STUDENTS);

console.log('\n■ 목록 — 사진과 함께 보이는가');
await page.evaluate(({ PX }) => {
  window.reset();
  window.__photos = { '1-3': { '7': PX } };          // 김학생만 사진 있음
  window.pushSnap([
    { id:'a', grade:1, room:3, num:7, name:'김학생', kind:'조퇴', outAt:'14:30',
      reason:'병원 진료', guardian:'전화', issuedBy:'hong@yeungnam.hs.kr', issuedName:'홍길동', createdAt:'1' },
    { id:'b', grade:1, room:3, num:8, name:'이학생', kind:'외출', outAt:'10:00', backAt:'11:30',
      reason:'', guardian:'문자', issuedBy:'kim@yeungnam.hs.kr', issuedName:'김교사', createdAt:'2' }
  ]);
}, { PX });
await page.waitForTimeout(120);
{
  check('두 건이 보인다', (await page.locator('.pass-card').count()) === 2);
  // outAt 순 정렬: 이학생(10:00)이 김학생(14:30)보다 위
  const names = await page.$$eval('.pass-name', n => n.map(x => x.textContent));
  check('나가는 시각 순으로 정렬', names[0] === '이학생' && names[1] === '김학생', names);
  await page.waitForFunction(() => document.querySelectorAll('.pass-photo').length > 0);
  check('사진 있는 학생은 사진이 뜬다', (await page.locator('.pass-card').nth(1).locator('img.pass-photo').count()) === 1);
  check('사진 없는 학생은 이름 첫 글자', (await page.locator('.pass-card').nth(0).locator('.pass-photo-none').textContent()) === '이');
  const txt = await page.innerText('#passList');
  check('복귀 시각은 외출에만 표시', txt.includes('복귀 11:30'), txt);
  check('조퇴에는 복귀가 없다', (txt.match(/복귀/g) || []).length === 1, txt);
  check('사유·보호자 확인이 보인다', txt.includes('병원 진료') && txt.includes('보호자 전화'), txt);
  check('발급자가 보인다', txt.includes('홍길동 발급') && txt.includes('김교사 발급'), txt);
}

console.log('\n■ 삭제 버튼 — 발급자 본인에게만');
{
  const cards = page.locator('.pass-card');
  check('내가 끊은 건에는 삭제 버튼', (await cards.nth(1).locator('.pass-del').count()) === 1);
  check('남이 끊은 건에는 없다',   (await cards.nth(0).locator('.pass-del').count()) === 0);
  await page.evaluate(() => { window.__admin = true; window.pushSnap([
    { id:'b', grade:1, room:3, num:8, name:'이학생', kind:'외출', outAt:'10:00',
      issuedBy:'kim@yeungnam.hs.kr', issuedName:'김교사', createdAt:'2' }]); });
  await page.waitForTimeout(80);
  check('관리자는 남의 것도 지울 수 있다', (await page.locator('.pass-del').count()) === 1);
  await page.evaluate(() => { window.__admin = false; });
}

console.log('\n■ 삭제 동작');
{
  await page.evaluate(() => { window.reset(); window.__admin = true; });
  await page.locator('.pass-del').first().click();
  await page.waitForTimeout(80);
  check('확인을 누르면 지운다', (await page.evaluate(() => window.__deleted)).length === 1);
  await page.evaluate(() => { window.reset(); window.__confirm = false; });
  await page.locator('.pass-del').first().click();
  await page.waitForTimeout(80);
  check('취소하면 안 지운다', (await page.evaluate(() => window.__deleted)).length === 0);
  await page.evaluate(() => { window.__confirm = true; window.__admin = false; });
}

console.log('\n■ 빈 날짜');
{
  await page.evaluate(() => window.pushSnap([]));
  await page.waitForTimeout(60);
  check('안내 문구가 뜬다', (await page.innerText('#passList')).includes('외출증이 없습니다'));
}

console.log('\n■ 날짜 이동');
{
  const today = await page.evaluate(() => document.getElementById('passDayLabel').textContent);
  check('오늘 표시', today.includes('(오늘)'), today);
  await page.evaluate(() => window.passMoveDay(-1));
  const prev = await page.evaluate(() => document.getElementById('passDayLabel').textContent);
  check('어제로 이동하면 (오늘) 표시가 사라진다', !prev.includes('(오늘)'), prev);
  check('날짜가 하루 줄었다',
        (new Date(today.slice(0,10)) - new Date(prev.slice(0,10))) === 86400000, [today, prev]);
  await page.evaluate(() => window.passMoveDay(0));
  check('오늘 버튼으로 복귀',
        (await page.evaluate(() => document.getElementById('passDayLabel').textContent)).includes('(오늘)'));
}

console.log('\n■ 발급 — 학생 고르기');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(80);
  check('모달이 열린다', await page.locator('#passModalOverlay.open').isVisible());
  check('고르기 전에는 저장 버튼이 잠겨 있다', await page.locator('#passSaveBtn').isDisabled());
  check('고르기 전에는 입력칸이 숨겨져 있다', !(await page.locator('#passFields').isVisible()));
  await page.fill('#passSearch', '김학');
  await page.waitForTimeout(80);
  check('검색 결과가 뜬다', (await page.locator('.pass-pick-item').count()) === 1);
  await page.fill('#passSearch', '1-3');
  await page.waitForTimeout(80);
  check('학년-반으로도 찾는다', (await page.locator('.pass-pick-item').count()) === 2);
  await page.fill('#passSearch', '없는이름');
  await page.waitForTimeout(80);
  check('없으면 안내', (await page.innerText('#passSearchResult')).includes('검색 결과 없음'));
  await page.fill('#passSearch', '김학');
  await page.waitForTimeout(80);
  await page.locator('.pass-pick-item').first().click();
  await page.waitForTimeout(80);
  check('고르면 입력칸이 열린다', await page.locator('#passFields').isVisible());
  check('저장 버튼이 풀린다', !(await page.locator('#passSaveBtn').isDisabled()));
  check('고른 학생이 표시된다', (await page.innerText('#passPicked')).includes('김학생'));
  check('나가는 시각 기본값이 채워져 있다',
        /^\d{2}:\d{2}$/.test(await page.inputValue('#passOutAt')));
}

console.log('\n■ 발급 — 종류에 따라 복귀 칸');
{
  check('조퇴면 복귀 칸이 없다', !(await page.locator('#passBackWrap').isVisible()));
  await page.locator('.pass-kind-btn[data-kind="외출"]').click();
  check('외출이면 복귀 칸이 나온다', await page.locator('#passBackWrap').isVisible());
  await page.locator('.pass-kind-btn[data-kind="결과"]').click();
  check('결과면 다시 숨는다', !(await page.locator('#passBackWrap').isVisible()));
}

console.log('\n■ 발급 — 저장');
{
  await page.locator('.pass-kind-btn[data-kind="외출"]').click();
  await page.fill('#passOutAt', '13:20');
  await page.fill('#passBackAt', '15:00');
  await page.fill('#passReason', '치과');
  await page.locator('.pass-guard-btn[data-guard="문자"]').click();
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(120);
  const added = await page.evaluate(() => window.__added);
  check('한 건만 저장된다', added.length === 1, added);
  const d = added[0].data;
  check('오늘 날짜 아래로 들어간다', /^passes\/\d{4}-\d{2}-\d{2}\/items$/.test(added[0].path), added[0].path);
  check('학생 정보가 숫자로 들어간다', d.grade === 1 && d.room === 3 && d.num === 7 && d.name === '김학생', d);
  check('종류·시각·사유', d.kind === '외출' && d.outAt === '13:20' && d.reason === '치과', d);
  check('외출이면 복귀 시각도', d.backAt === '15:00', d);
  check('보호자 확인', d.guardian === '문자', d);
  check('발급자는 로그인한 사람', d.issuedBy === 'hong@yeungnam.hs.kr' && d.issuedName === '홍길동', d);
  check('저장하면 모달이 닫힌다', !(await page.locator('#passModalOverlay.open').isVisible()));
}

console.log('\n■ 발급 — 조퇴면 복귀 시각을 저장하지 않는다');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(80);
  await page.fill('#passSearch', '박학생');
  await page.waitForTimeout(80);
  await page.locator('.pass-pick-item').first().click();
  await page.locator('.pass-kind-btn[data-kind="외출"]').click();
  await page.fill('#passBackAt', '15:00');
  await page.locator('.pass-kind-btn[data-kind="조퇴"]').click();   // 다시 조퇴로
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(120);
  const d = (await page.evaluate(() => window.__added))[0].data;
  check('조퇴면 backAt 이 비어 있다', d.backAt === '', d);
  check('다른 반 학생도 정상', d.grade === 2 && d.room === 1 && d.num === 12, d);
}

console.log('\n■ 발급 — 시각을 비우면 막는다');
{
  await page.evaluate(() => { window.reset(); window.passOpenForm(); });
  await page.waitForTimeout(80);
  await page.fill('#passSearch', '김학');
  await page.waitForTimeout(80);
  await page.locator('.pass-pick-item').first().click();
  await page.fill('#passOutAt', '');
  await page.locator('#passSaveBtn').click();
  await page.waitForTimeout(100);
  check('저장되지 않는다', (await page.evaluate(() => window.__added)).length === 0);
  check('안내가 뜬다', (await page.innerText('#passFormMsg')).includes('시각'));
  check('모달은 열린 채로', await page.locator('#passModalOverlay.open').isVisible());
}

console.log('\n■ 다시 고르기 / 모달 재사용');
{
  await page.evaluate(() => window.passUnpick());
  check('다시 고르기로 돌아간다', await page.locator('#passPickWrap').isVisible());
  check('저장 버튼이 다시 잠긴다', await page.locator('#passSaveBtn').isDisabled());
  await page.evaluate(() => window.passCloseForm());
  await page.evaluate(() => window.passOpenForm());
  await page.waitForTimeout(80);
  check('다시 열면 검색어가 비어 있다', (await page.inputValue('#passSearch')) === '');
  check('다시 열면 종류가 조퇴로 초기화', await page.locator('.pass-kind-btn[data-kind="조퇴"]').evaluate(e => e.classList.contains('active')));
  check('다시 열면 사유도 비어 있다', (await page.inputValue('#passReason')) === '');
}

await browser.close();
console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
