// seating.html 을 실제 브라우저에 띄운다. Firebase 모듈은 가짜로 갈아끼워
// 명렬 30명·빈 문서 상태를 만들고, 버튼을 눌러 런타임 오류가 없는지 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';

// 정적 검사(tests/seating.test.mjs)가 못 보는 것 — 실제로 눌렀을 때 터지지 않는가.

const PAGE = import.meta.dirname + '/../seating.html';
const html = fs.readFileSync(PAGE, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();

const errs = [];
pg.on('pageerror', e => errs.push('pageerror: ' + e.message));
pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

// gstatic 의 firebase 모듈 요청을 가로채 가짜로 응답
await pg.route('https://www.gstatic.com/firebasejs/**', route => {
  const u = route.request().url();
  let body = 'export {};';
  if (u.includes('firebase-app'))  body = 'export const initializeApp = () => ({});';
  if (u.includes('firebase-auth')) body = `
    export const getAuth = () => ({});
    export const onAuthStateChanged = (a, cb) =>
      setTimeout(() => cb({ email:'kim@yeungnam.hs.kr', displayName:'김민준' }), 0);`;
  if (u.includes('firebase-firestore')) body = `
    const STU = Array.from({length:30},(_,i)=>({grade:2,room:3,num:i+1,name:'학생'+(i+1)}));
    export const getFirestore = () => ({});
    export const doc = (db, coll, id) => ({ coll, id });
    export const getDoc = async ref => ref.coll === 'students'
      ? { exists: () => true, data: () => ({ students: STU }) }
      : { exists: () => false, data: () => ({}) };
    export const setDoc = async (ref, data) => { window.__saved = data; };`;
  route.fulfill({ status: 200, contentType: 'text/javascript', body });
});
await pg.route('https://fonts.googleapis.com/**', r => r.fulfill({ status:200, contentType:'text/css', body:'' }));

await pg.goto('file://' + PAGE + '?class=2-3&hr=2-3&embed=1', { waitUntil:'networkidle' });
await pg.waitForFunction(() => document.querySelectorAll('.seat').length > 0, null, { timeout: 5000 });

const say = (n, c, x) => console.log(c ? '  ✅ ' + n : '  ❌ ' + n + (x!==undefined?'\n       → '+JSON.stringify(x):''));

say('자리판이 그려졌다', await pg.$$eval('.seat', e => e.length) === 24);
say('편집 가능 표시', (await pg.$eval('#who', e => e.textContent)).includes('편집'));
say('아직 안 앉은 학생 30명', (await pg.$eval('#unseatedCnt', e => e.textContent)) === '30명');

// 30명 > 24자리 → 진단이 떠야 한다
await pg.click('#bOrder');
const err1 = await pg.$eval('#err', e => e.textContent);
say('자리보다 학생이 많으면 이유를 말한다', /자리가 24개인데 학생이 30명/.test(err1), err1);

// 판을 넓히면 배정된다
await pg.fill('#nRows', '8'); await pg.dispatchEvent('#nRows', 'change');
await pg.click('#bOrder');
say('줄을 늘리면 번호순이 된다', await pg.$$eval('.seat .s-name', e => e.length) === 30);
say('1번이 맨 앞 왼쪽', (await pg.$eval('.seat .s-name', e => e.textContent)) === '학생1');
say('전원 착석', (await pg.$eval('#unseatedCnt', e => e.textContent)) === '없음');

await pg.click('#bRandom');
say('랜덤도 전원 착석', (await pg.$$eval('.seat .s-name', e => e.length)) === 30);

// 되돌리기
const before = await pg.$$eval('.seat .s-name', e => e.map(x => x.textContent).join(','));
await pg.click('#bUndo');
const after = await pg.$$eval('.seat .s-name', e => e.map(x => x.textContent).join(','));
say('되돌리기가 동작한다', before !== after);

// 빈칸 모드
await pg.click('#mOff');
await pg.click('.seat');
say('빈칸이 생긴다', await pg.$$eval('.seat.off', e => e.length) === 1);

// 저장
await pg.click('#mMove');
await pg.click('#bSave');
await pg.waitForFunction(() => window.__saved, null, { timeout: 3000 });
const saved = await pg.evaluate(() => window.__saved);
say('저장 내용에 seats 가 있다', !!saved.seats && Object.keys(saved.seats).length > 0);
say('이력이 한 장 쌓였다', Array.isArray(saved.history) && saved.history.length === 1, saved.history?.length);
say('이력에 저장자가 남는다', saved.history[0].by === 'kim@yeungnam.hs.kr', saved.history[0].by);
say('저장 알림', (await pg.$eval('#ok', e => e.textContent)).includes('저장'));
say('교탁 방향도 저장된다', 'flip' in saved, Object.keys(saved));

// 교탁 위/아래 — 그리는 방향만 바뀌고 자리 데이터는 그대로여야 한다
await pg.click('#bOrder');
const topFirst = await pg.$eval('.grid .seat .s-name', e => e.textContent);
const seatsBefore = await pg.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.grid .seat')].map(s => s.dataset.cell + ':' + (s.querySelector('.s-name')?.textContent || ''))
    .sort()));
await pg.click('#bFlip');
say('교탁이 아래로 간다', await pg.$eval('.board', e => e.classList.contains('flip')));
say('버튼 글자가 바뀐다', (await pg.$eval('#bFlip', e => e.textContent)).includes('아래'));
const bottomFirst = await pg.$eval('.grid .seat .s-name', e => e.textContent);
say('처음 그려지는 학생이 달라진다(뒷줄부터)', topFirst !== bottomFirst, { topFirst, bottomFirst });
const seatsAfter = await pg.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.grid .seat')].map(s => s.dataset.cell + ':' + (s.querySelector('.s-name')?.textContent || ''))
    .sort()));
say('자리 데이터는 그대로다', seatsBefore === seatsAfter);
// 뒤집으면 앞줄(0행)이 맨 나중에 그려진다 — 그래야 교탁 옆에 붙는다
const lastRow = await pg.$$eval('.grid .seat', e => e[e.length - 1].dataset.cell.split(',')[0]);
say('뒤집으면 앞줄이 맨 나중에 그려진다', lastRow === '0', { lastRow });
await pg.click('#bFlip');
say('다시 누르면 교탁이 위로', !(await pg.$eval('.board', e => e.classList.contains('flip'))));

// 학생 추가
await pg.fill('#addNum', '31'); await pg.fill('#addName', '전입생');
await pg.click('#bAdd');
say('전입생이 명렬에 들어간다',
    (await pg.$eval('#rosterEdit', e => e.textContent)).includes('전입생'));

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.join('\n') : '\n✅ 런타임 오류 없음');
await b.close();
process.exit(errs.length ? 1 : 0);
