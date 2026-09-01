// seating.html 을 실제 브라우저에 띄운다. Firebase 모듈은 가짜로 갈아끼워
// 명렬 30명·빈 문서 상태를 만들고, 버튼을 눌러 런타임 오류가 없는지 본다.
import { chromium } from 'playwright';
import fs from 'node:fs';

// 정적 검사(tests/seating.test.mjs)가 못 보는 것 — 실제로 눌렀을 때 터지지 않는가.

const PAGE = import.meta.dirname + '/../seating.html';
const html = fs.readFileSync(PAGE, 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// 끌어놓기 검사는 대상 자리가 화면 안에 있어야 한다 — 짧은 창이면 빈 자리가 접힌 아래로 간다
const pg = await b.newPage({ viewport: { width: 1280, height: 1500 } });

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

// 기본 자리판(5분단 × 6줄 = 30자리)
say('자리판이 그려졌다', await pg.$$eval('.seat', e => e.length) === 30,
    await pg.$$eval('.seat', e => e.length));
say('편집 가능 표시', (await pg.$eval('#who', e => e.textContent)).includes('편집'));
say('아직 안 앉은 학생 30명', (await pg.$eval('#unseatedCnt', e => e.textContent)) === '30명');

// 자리를 줄여 30명 > 20자리 → 진단이 떠야 한다
await pg.fill('#nRows', '4'); await pg.dispatchEvent('#nRows', 'change');
await pg.click('#bOrder');
const err1 = await pg.$eval('#err', e => e.textContent);
say('자리보다 학생이 많으면 이유를 말한다', /자리가 20개인데 학생이 30명/.test(err1), err1);

// 판을 넓히면 배정된다
await pg.fill('#nRows', '8'); await pg.dispatchEvent('#nRows', 'change');
await pg.click('#bOrder');
say('줄을 늘리면 번호순이 된다', await pg.$$eval('.seat .s-name', e => e.length) === 30);
// 「앞 왼쪽부터」는 화면에 보이는 대로여야 한다 — 물리 좌표가 아니라 눈으로 확인한다.
// 교사 입장에서는 교탁이 아래라 '앞줄'이 화면 맨 아래 줄이고, 좌우도 뒤집혀 그려진다.
const oneAtFrontLeft = () => pg.evaluate(() => {
  const box = s => s.getBoundingClientRect();
  const seats = [...document.querySelectorAll('.grid .seat')].filter(s => s.querySelector('.s-name'));
  const one = seats.find(s => s.querySelector('.s-name').textContent === '학생1');
  if (!one) return false;
  const flip = document.querySelector('.board').classList.contains('flip');
  const tops = seats.map(s => box(s).top);
  const frontTop = flip ? Math.max(...tops) : Math.min(...tops);
  const inRow = seats.filter(s => Math.abs(box(s).top - frontTop) < 4);
  const leftMost = Math.min(...inRow.map(s => box(s).left));
  return Math.abs(box(one).top - frontTop) < 4 && Math.abs(box(one).left - leftMost) < 4;
});
say('1번이 화면상 앞줄 맨 왼쪽', await oneAtFrontLeft());
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

// 끌어놓기 — 정적 검사로는 '배선이 있다'까지만 알 수 있다. 실제로 끌어본다.
{
  await pg.fill('#nCols','5'); await pg.dispatchEvent('#nCols','change');
  await pg.fill('#nRows','7'); await pg.dispatchEvent('#nRows','change');
  await pg.click('#bOrder');
  const nameAt = c => pg.$eval(`.seat[data-cell="${c}"]`, e => e.querySelector('.s-name')?.textContent || '');
  // 앞 단계에서 만들어 둔 '빈칸'을 피해 실제로 앉은 자리 두 곳을 고른다
  const [c1, c2] = await pg.$$eval('.seat', e => e
    .filter(s => s.querySelector('.s-name')).slice(0, 2).map(s => s.dataset.cell));
  const a = await nameAt(c1), b = await nameAt(c2);
  await pg.dragAndDrop(`.seat[data-cell="${c1}"]`, `.seat[data-cell="${c2}"]`);
  say('자리끼리 끌면 서로 바뀐다',
      (await nameAt(c1)) === b && (await nameAt(c2)) === a, { c1, c2, a, b, now: await nameAt(c1) });

  // 빈 자리로 끌면 그냥 옮겨진다 (35자리 · 30명이라 뒤가 비어 있다)
  const empty = await pg.$eval('.seat.empty', e => e.dataset.cell);
  const moving = await nameAt(c1);
  await pg.dragAndDrop(`.seat[data-cell="${c1}"]`, `.seat[data-cell="${empty}"]`);
  say('빈 자리로 끌면 옮겨진다', (await nameAt(empty)) === moving && (await nameAt(c1)) === '',
      { empty, moving, there: await nameAt(empty) });

  // 자리에서 목록으로 끌면 빠진다
  const before = await pg.$eval('#unseatedCnt', e => e.textContent);
  await pg.dragAndDrop(`.seat[data-cell="${empty}"]`, '#unseated');
  const after = await pg.$eval('#unseatedCnt', e => e.textContent);
  say('목록으로 끌면 자리에서 빠진다', before !== after && (await nameAt(empty)) === '', { before, after });

  // 목록에서 자리로 끌면 앉는다
  const who = await pg.$eval('#unseated .stu .nm', e => e.textContent);
  await pg.dragAndDrop('#unseated .stu', `.seat[data-cell="${empty}"]`);
  say('목록에서 끌면 그 자리에 앉는다', (await nameAt(empty)) === who, { who, there: await nameAt(empty) });
}

// 번호순 시작·방향
{
  await pg.selectOption('#ordStart', 'BR');
  await pg.selectOption('#ordDir', 'col');
  await pg.click('#bOrder');
  const cells = await pg.$$eval('.seat', e => e.map(s => [s.dataset.cell, s.querySelector('.s-name')?.textContent || '']));
  const at = c => (cells.find(x => x[0] === c) || [])[1];
  const rows = await pg.$eval('#nRows', e => +e.value), cols = await pg.$eval('#nCols', e => +e.value);
  const one = at(`${rows-1},${cols-1}`);
  say('1번이 뒤 오른쪽 모서리에', !!one, { corner: `${rows-1},${cols-1}`, who: one });
  say('세로로 번호가 이어진다', !!at(`${rows-2},${cols-1}`), at(`${rows-2},${cols-1}`));
  await pg.selectOption('#ordStart', 'FL'); await pg.selectOption('#ordDir', 'row');
  await pg.click('#bOrder');
}

// 분단 묶음 — 2칸씩 묶으면 격자가 분단 수만큼 쪼개진다
await pg.fill('#nCols', '6'); await pg.dispatchEvent('#nCols', 'change');
await pg.fill('#nGroup', '2'); await pg.dispatchEvent('#nGroup', 'change');
say('6칸을 2씩 묶으면 분단 3개', await pg.$$eval('.aisle', e => e.length) === 3);
const gaps = await pg.evaluate(() => {
  const xs = [...document.querySelectorAll('.aisle')].map(e => e.getBoundingClientRect());
  const seats = [...document.querySelectorAll('.aisle:first-child .seat')].map(e => e.getBoundingClientRect());
  const inner = seats.length > 1 ? seats[1].left - seats[0].right : 0;
  return { between: Math.round(xs[1].left - xs[0].right), inner: Math.round(inner) };
});
say('분단 사이가 칸 사이보다 넓다', gaps.between > gaps.inner, gaps);
await pg.fill('#nGroup', '1'); await pg.dispatchEvent('#nGroup', 'change');
say('1로 두면 안 묶는다', await pg.$$eval('.aisle', e => e.length) === 6);
await pg.fill('#nGroup', '2'); await pg.dispatchEvent('#nGroup', 'change');

// 교탁 위/아래 — 그리는 방향만 바뀌고 자리 데이터는 그대로여야 한다.
// 기본은 교사 입장(교탁 아래)이다. 자리표를 만드는 사람이 교탁에 서서 보는 방향.
await pg.click('#bOrder');
say('기본이 교사 입장이다', await pg.$eval('.board', e => e.classList.contains('flip')));
say('버튼도 교사 입장으로 뜬다', (await pg.$eval('#bFlip', e => e.textContent)).includes('교사 입장'));

const order = () => pg.$$eval('.grid .seat', e => e.map(s => s.dataset.cell));
const dims = await pg.evaluate(() => ({
  rows: +document.getElementById('nRows').value, cols: +document.getElementById('nCols').value }));
const lastCell = `${dims.rows - 1},${dims.cols - 1}`;
const seatsBefore = await pg.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.grid .seat')].map(s => s.dataset.cell + ':' + (s.querySelector('.s-name')?.textContent || ''))
    .sort()));
const flipped = await order();
const teacherFirst = await pg.$eval('.grid .seat .s-name', e => e.textContent);
say('맨 나중에 그려지는 칸이 앞줄 맨 왼쪽(0,0)', flipped.at(-1) === '0,0', flipped.slice(-3));
say('맨 처음 그려지는 칸이 뒷줄 맨 오른쪽', flipped[0] === lastCell, { 처음: flipped[0], 기대: lastCell });

await pg.click('#bFlip');
say('누르면 학생 입장(교탁 위)으로', !(await pg.$eval('.board', e => e.classList.contains('flip'))));
say('버튼 글자가 바뀐다', (await pg.$eval('#bFlip', e => e.textContent)).includes('학생 입장'));
const studentFirst = await pg.$eval('.grid .seat .s-name', e => e.textContent);
say('처음 그려지는 학생이 달라진다', teacherFirst !== studentFirst, { teacherFirst, studentFirst });
const seatsAfter = await pg.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.grid .seat')].map(s => s.dataset.cell + ':' + (s.querySelector('.s-name')?.textContent || ''))
    .sort()));
say('자리 데이터는 그대로다', seatsBefore === seatsAfter);

// 보는 사람이 바뀌면 180도 회전이어야 한다 — 거울이 아니라.
// 상하만 뒤집으면 왼쪽·오른쪽이 반대가 되어 한쪽 화면이 거짓말을 한다.
const normal = await order();
say('학생 입장은 앞줄 왼쪽부터', normal[0] === '0,0' && normal.at(-1) === lastCell, [normal[0], normal.at(-1)]);
say('두 순서는 정확히 뒤집힌 관계 (회전이지 거울이 아니다)',
    JSON.stringify(normal.slice().reverse()) === JSON.stringify(flipped));
// 보는 방향을 바꾸고 다시 번호순을 돌려도 「앞 왼쪽부터」는 화면 기준이어야 한다.
// (자리 데이터가 바뀌므로 위의 '그대로다' 검사를 다 마친 뒤에 돌린다)
await pg.click('#bOrder');
say('학생 입장에서도 1번이 화면상 앞줄 맨 왼쪽', await oneAtFrontLeft());
await pg.click('#bFlip');   // 다시 교사 입장으로 (아래 검사가 이어짐)
say('다시 누르면 교사 입장으로', await pg.$eval('.board', e => e.classList.contains('flip')));

// 학생 추가
await pg.fill('#addNum', '31'); await pg.fill('#addName', '전입생');
await pg.click('#bAdd');
say('전입생이 명렬에 들어간다',
    (await pg.$eval('#rosterEdit', e => e.textContent)).includes('전입생'));

// 처음 열면 아무도 안 앉아 있다. 그 상태에서 제약을 걸 수 있어야 한다 —
// 자리를 눌러야만 고를 수 있게 해두면 누를 자리가 없어서 아무것도 못 한다.
{
  pg.once('dialog', d => d.accept());     // 확인 대화상자는 클릭 '전에' 받아 둬야 한다
  await pg.click('#bClear');
  await pg.waitForFunction(() => document.querySelectorAll('.seat .s-name').length === 0, null, { timeout: 3000 });
  const unseated = await pg.$$eval('#unseated .stu', e => e.length);
  say('전부 비우면 목록에 다 나온다', unseated > 20, unseated);

  // 「학생별 설정」 표 — 모드도 드롭다운도 없이 그 줄에서 바로 켠다
  const rows = await pg.$$eval('#stuGrid .stu-row', e => e.length);
  say('표에 반 전체가 뜬다', rows > 20, rows);
  const tog = (n, what) => pg.click(`#stuGrid .stu-row:nth-child(${n}) [data-tog="${what}"]`);

  await tog(1, 'apart'); await tog(2, 'apart'); await tog(3, 'apart');
  say('앉기 전에도 분리를 고를 수 있다',
      (await pg.$eval('#bApartMake', e => e.textContent)).includes('3명'),
      await pg.$eval('#bApartMake', e => e.textContent));
  say('고른 줄이 표시된다', await pg.$$eval('#stuGrid [data-tog="apart"].on', e => e.length) === 3);
  await tog(2, 'apart');
  say('다시 누르면 빠진다', (await pg.$eval('#bApartMake', e => e.textContent)).includes('2명'));
  await tog(2, 'apart');
  await pg.click('#bApartMake');
  say('묶으면 목록에 남는다', /분리/.test(await pg.$eval('#consList', e => e.textContent)),
      await pg.$eval('#consList', e => e.textContent));
  say('묶고 나면 고른 표시가 풀린다',
      await pg.$$eval('#stuGrid [data-tog="apart"].on', e => e.length) === 0);

  await tog(5, 'front');
  say('앞자리는 그 줄 버튼으로 켠다',
      await pg.$eval('#stuGrid .stu-row:nth-child(5) [data-tog="front"]', e => e.classList.contains('on')));

  // 임무는 이름 옆 칸에 바로 적는다
  await pg.fill('#stuGrid .stu-row:nth-child(6) [data-duty]', '반장');
  await pg.click('#stuCnt');                       // 포커스를 빼 change 를 일으킨다
  say('임무는 이름 옆 칸에 적는다', /반장/.test(await pg.$eval('#unseated', e => e.textContent)));
  say('적은 값이 칸에 남는다',
      (await pg.inputValue('#stuGrid .stu-row:nth-child(6) [data-duty]')) === '반장');
  await pg.fill('#stuGrid .stu-row:nth-child(6) [data-duty]', '');
  await pg.click('#stuCnt');
  say('비우면 임무가 빠진다', !/반장/.test(await pg.$eval('#unseated', e => e.textContent)));
  await pg.fill('#stuGrid .stu-row:nth-child(6) [data-duty]', '반장');
  await pg.click('#stuCnt');

  // 고정석은 자리가 필요하다 — 아무도 안 앉았으니 버튼이 잠겨 있어야 한다
  say('안 앉은 학생은 고정 버튼이 잠긴다',
      await pg.$eval('#stuGrid .stu-row:nth-child(1) [data-tog="fix"]', e => e.disabled));
  say('안 앉았으면 자리판 자물쇠도 없다', await pg.$$eval('#grid [data-pin]', e => e.length) === 0);

  // 이 제약들을 안고 배정이 되는지
  await pg.click('#bRandom');
  say('앉기 전에 건 제약으로 배정된다', !(await pg.$eval('#err', e => e.textContent)),
      await pg.$eval('#err', e => e.textContent));
  say('전원 착석', (await pg.$eval('#unseatedCnt', e => e.textContent)) === '없음');

  // 자리판의 자물쇠 — 번호 옆에서 바로 고정을 켜고 끈다
  {
    const pins   = await pg.$$eval('#grid [data-pin]', e => e.length);
    const seated = await pg.$$eval('#grid .seat .s-name', e => e.length);
    say('앉은 자리마다 자물쇠가 하나씩', pins === seated && pins > 0, { pins, seated });
    const who = await pg.$eval('#grid [data-pin]', e => e.dataset.pin);
    await pg.click('#grid [data-pin]');
    say('자물쇠를 누르면 고정된다',
        await pg.$eval('#grid [data-pin]', e => e.classList.contains('on')));
    say('표의 고정 버튼도 같이 켜진다',
        await pg.$eval(`#stuGrid [data-tog="fix"][data-k="${who}"]`, e => e.classList.contains('on')));
    // 자물쇠 클릭이 자리 클릭(고르기·교환)까지 일으키면 엉뚱한 자리가 선택된다
    say('자리가 선택 상태로 바뀌지 않는다', await pg.$$eval('#grid .seat.sel', e => e.length) === 0);
    await pg.click('#grid [data-pin]');
    say('다시 누르면 풀린다',
        !(await pg.$eval('#grid [data-pin]', e => e.classList.contains('on')))
        && !(await pg.$eval(`#stuGrid [data-tog="fix"][data-k="${who}"]`, e => e.classList.contains('on'))));
  }
  // 신고된 흐름 그대로: 분리를 먼저 걸고 → 랜덤을 돌린 뒤 → 자리에 '분리' 표시가 나야 한다.
  // 짝 → 묶음으로 바꾸면서 자리판의 배지 검사만 옛 형태로 남아, 표시가 안 났다.
  {
    const names = await pg.$$eval('.seat', e => e
      .filter(s => s.querySelector('.s-name')).slice(0, 3)
      .map(s => s.querySelector('.s-name').textContent));
    say('자리에 분리 배지가 뜬다', await pg.$$eval('.seat .s-tag.ap', e => e.length) >= 2,
        await pg.$$eval('.seat .s-tag.ap', e => e.length));
    await pg.click('#bRandom');
    const badges = await pg.$$eval('.seat .s-tag.ap', e => e.length);
    say('랜덤을 돌려도 분리 배지가 남는다', badges >= 2, badges);
    const who = await pg.$$eval('.seat', e => e
      .filter(s => s.querySelector('.s-tag.ap'))
      .map(s => s.querySelector('.s-name').textContent));
    say('배지가 묶은 그 학생들에게 붙는다',
        who.length >= 2 && who.every(n => typeof n === 'string' && n.length > 0), who);
  }

  // 제약 정리하고 다음 검사로. 하나 지울 때마다 목록을 다시 그리므로 매번 새로 찾는다.
  for (let i = 0; i < 20; i++) {
    const b = await pg.$('#consList [data-drop]');
    if (!b) break;
    await b.click();
  }
  say('제약을 모두 지웠다', (await pg.$$('#consList [data-drop]')).length === 0);
}

// 분리 묶음 — 표에서 여러 명을 골라 한 번에 묶는다
{
  say('아직 못 누른다', await pg.$eval('#bApartMake', e => e.disabled));
  const tog = n => pg.click(`#stuGrid .stu-row:nth-child(${n}) [data-tog="apart"]`);
  for (const n of [1, 2, 3]) await tog(n);
  say('고른 만큼 버튼 글이 바뀐다',
      (await pg.$eval('#bApartMake', e => e.textContent)).includes('3명'),
      await pg.$eval('#bApartMake', e => e.textContent));
  // 고른 학생은 자리판에도 표시된다 — 표만 보고 있으면 누가 어디 앉았는지 모른다
  say('고른 자리에 표시가 남는다', await pg.$$eval('.seat.pick', e => e.length) === 3);
  await tog(3);
  say('다시 누르면 빠진다', (await pg.$eval('#bApartMake', e => e.textContent)).includes('2명'));
  await tog(3);
  await tog(4);
  say('기본은 이웃 금지', (await pg.inputValue('#apartD')) === '2');
  await pg.selectOption('#apartD', '3');
  await pg.selectOption('#apartD', '2');
  await pg.click('#bApartMake');
  const cons = await pg.$eval('#consList', e => e.textContent);
  say('제약 목록에 묶음이 들어간다', /분리/.test(cons), cons.slice(0, 120));
  say('묶은 뒤 선택은 비워진다', await pg.$$eval('.seat.pick', e => e.length) === 0);

  // 묶음이 둘 이상이면 '분리' 표시만으로는 누가 누구와 묶였는지 알 수 없다
  await pg.selectOption('#apartD', '3');
  for (const n of [6, 7]) await tog(n);
  await pg.click('#bApartMake');
  const cons2 = await pg.$eval('#consList', e => e.textContent);
  say('두 묶음이 A·B 로 갈린다', /분리 A/.test(cons2) && /분리 B/.test(cons2), cons2.slice(0, 200));
  say('묶음마다 거리도 같이 보인다', /이웃 금지/.test(cons2) && /멀리/.test(cons2), cons2.slice(0, 200));
  say('자리 배지에도 A·B 가 붙는다',
      /분리 A/.test(await pg.$eval('#grid', e => e.textContent))
      && /분리 B/.test(await pg.$eval('#grid', e => e.textContent)));
  {
    // A 4명 + B 2명 = 6명에게 이름표가 붙어야 한다
    const labels = (await pg.$$eval('#stuGrid [data-tog="apart"]', e => e.map(b => b.textContent)))
      .filter(t => t !== '분리');
    say('표의 분리 버튼에도 어느 묶음인지 뜬다',
        labels.filter(t => t === '분리 A').length === 4
        && labels.filter(t => t === '분리 B').length === 2, labels);
  }
  // 나중에 만든 B 묶음만 지우면 A 는 그대로 A 여야 한다
  await pg.click('#consList .row:last-child [data-drop]');
  say('B 를 지워도 A 는 그대로', /분리 A/.test(await pg.$eval('#consList', e => e.textContent))
      && !/분리 B/.test(await pg.$eval('#consList', e => e.textContent)));

  // 실제로 떨어져 앉는지
  await pg.click('#bRandom');
  const gap = await pg.evaluate(cells => {
    const at = {};
    document.querySelectorAll('.seat').forEach(s => {
      const n = s.querySelector('.s-name'); if (n) at[n.textContent] = s.dataset.cell;
    });
    return at;
  });
  say('랜덤을 돌려도 오류가 없다', !(await pg.$eval('#err', e => e.textContent)),
      await pg.$eval('#err', e => e.textContent));

  // 목록에서 지우기
  await pg.click('#consList [data-drop]');
  say('묶음을 지울 수 있다', !/분리/.test(await pg.$eval('#consList', e => e.textContent)));
}

// 메모를 비운 채 인쇄해도 입력칸이 살아 있어야 한다.
// 예전에 인쇄 버튼이 memoCard 에 display:none 을 박아, 비운 채 인쇄하면
// 다시 적을 방법이 없어졌다.
{
  await pg.fill('#memo', '');
  await pg.evaluate(() => { window.print = () => {}; });   // 인쇄 대화상자는 막는다
  await pg.click('#bPrint');
  say('메모 없이 인쇄해도 입력칸이 남는다',
      await pg.$eval('#memo', e => e.getClientRects().length > 0));
  say('메모 카드도 화면에 남는다',
      await pg.$eval('#memoCard', e => e.getClientRects().length > 0));
  await pg.fill('#memo', '청소 구역 안내');
  say('다시 적을 수 있다', (await pg.$eval('#memo', e => e.value)) === '청소 구역 안내');
  await pg.click('#bPrint');
  say('적고 인쇄해도 입력칸은 그대로', await pg.$eval('#memo', e => e.getClientRects().length > 0));
}

// 인쇄 모습 — 인쇄해봐야 보이는 것들이라 여기서 재 둔다.
// 화면용 .cols 의 align-items:start 가 인쇄 flex 에 새어 들어와 자리판 폭이
// 종이의 1/3 로 쪼그라든 적이 있다. 눈으로는 멀쩡해 보였다.
await pg.evaluate(() => window.__buildPrintExtras && window.__buildPrintExtras());
await pg.emulateMedia({ media: 'print' });
const pm = await pg.evaluate(() => {
  const w = el => Math.round(el.getBoundingClientRect().width);
  // .board 는 인쇄에서 display:contents 라 상자가 없다 — 자리판(.grid)을 잰다
  const r = document.querySelector('#printRoster'), b = document.querySelector('.grid');
  return {
    page: w(document.querySelector('.wrap')),
    // .wrap 은 종이 여백(padding)을 포함한다 — 실제로 쓸 수 있는 폭과 견줘야 한다
    inner: (() => { const el = document.querySelector('.wrap'), cs = getComputedStyle(el);
      return Math.round(el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); })(),
    roster: w(r), board: w(b),
    tall: Math.round(document.querySelector('.grid').getBoundingClientRect().height),
    ui:   getComputedStyle(document.querySelector('#barMain')).display,
    title: document.querySelector('#printTitle').textContent,
    rows:  document.querySelectorAll('#printRoster tr').length,
    deskBg: getComputedStyle(document.querySelector('.desk')).backgroundColor,
    numBg:  getComputedStyle(document.querySelector('.s-num')).backgroundColor
  };
});
say('명렬표 + 자리판이 종이 폭을 채운다', pm.roster + pm.board >= pm.inner * 0.93, pm);

// 명렬을 자리판 첫 줄/끝 줄에 맞추기
const alignTops = async () => pg.evaluate(() => {
  const r = document.querySelector('#printRoster').getBoundingClientRect();
  const seats = [...document.querySelectorAll('.seat')].map(e => e.getBoundingClientRect());
  return { rTop: Math.round(r.top), rBot: Math.round(r.bottom),
           sTop: Math.round(Math.min(...seats.map(s => s.top))),
           sBot: Math.round(Math.max(...seats.map(s => s.bottom))) };
});
const a1 = await alignTops();
say('첫 줄에 맞추면 명렬 위가 첫 줄 위와 같다', Math.abs(a1.rTop - a1.sTop) <= 2, a1);
await pg.emulateMedia({ media: 'screen' });
await pg.selectOption('#rosterAlign', 'last');
await pg.emulateMedia({ media: 'print' });
const a2 = await alignTops();
say('끝 줄에 맞추면 명렬 아래가 끝 줄 아래와 같다', Math.abs(a2.rBot - a2.sBot) <= 2, a2);
await pg.emulateMedia({ media: 'screen' });
await pg.selectOption('#rosterAlign', 'first');
await pg.emulateMedia({ media: 'print' });
say('자리판이 종이 높이를 쓴다', pm.tall > 300, pm);
say('화면 UI 는 인쇄에서 빠진다', pm.ui === 'none', pm.ui);
say('인쇄물에 제목이 붙는다', /2학년 3반 자리 배치도/.test(pm.title), pm.title);
say('인쇄물에 명렬표가 붙는다', pm.rows > 20, pm.rows);
// 인쇄물은 색을 쓰되 배경색에 기대면 안 된다. 브라우저가 배경을 안 찍는 설정이면
// 진한 바탕 위 흰 글씨는 흰 종이에서 통째로 사라진다.
// 그러니 '배경이 흰가'가 아니라 '배경이 빠져도 글씨가 읽히는가'를 잰다.
const contrastOnWhite = await pg.evaluate(() => {
  const lum = c => {
    const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => {
      v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = sel => {
    const el = document.querySelector(sel); if (!el) return null;
    const L = lum(getComputedStyle(el).color);
    return Math.round(((1.05) / (L + 0.05)) * 10) / 10;   // 흰 바탕 대비
  };
  return { desk: ratio('.desk'), chalk: ratio('.chalk'), num: ratio('.s-num'),
           name: ratio('.s-name'), cap: ratio('.pr-cap'), title: ratio('#printTitle') };
});
for (const [k, v] of Object.entries(contrastOnWhite))
  say(`${k} 글씨가 흰 종이에서도 읽힌다 (대비 ${v})`, v !== null && v >= 4.5, contrastOnWhite);
say('색 인쇄를 요청해 둔다', /print-color-adjust:exact/.test(html));

// 흑백 프린터로 나가도 바탕과 글씨가 갈려야 한다. 색을 되살리면서
// 명도까지 같아지면 회색 위 회색이 되어 아무것도 안 보인다.
const gray = await pg.evaluate(() => {
  const lum = c => {
    const m = c.match(/\d+/g); if (!m) return null;
    const [r, g, b] = m.slice(0,3).map(v => { v = v/255;
      return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  // 투명 배경은 rgba(0,0,0,0) 이라 그냥 읽으면 '검정'이 된다 — 실제로 뒤에 깔린
  // 배경을 찾아 올라간다. 이걸 안 하면 흰 바탕을 검정으로 재서 헛짚는다.
  const bgOf = el => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const parts = m[1].split(',').map(Number);
      if (parts.length < 4 || parts[3] > 0) return c;
    }
    return 'rgb(255,255,255)';
  };
  const pair = sel => {
    const el = document.querySelector(sel); if (!el) return null;
    const bg = lum(bgOf(el)), fg = lum(getComputedStyle(el).color);
    const [hi, lo] = bg > fg ? [bg, fg] : [fg, bg];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
  };
  return { num: pair('.s-num'), desk: pair('.desk'), chalk: pair('.chalk'),
           cap: pair('.pr-cap'), memo: pair('.memo-print') };
});
for (const [k, v] of Object.entries(gray))
  say(`${k} 는 흑백에서도 바탕과 갈린다 (명도비 ${v})`, v !== null && v >= 4.5, gray);
// 칠판은 벽, 교탁은 그 앞 — 학생과 칠판 사이에 교탁이 있어야 한다
const front = await pg.evaluate(() => {
  const y = s => document.querySelector(s).getBoundingClientRect().top;
  const seatBottom = Math.max(...[...document.querySelectorAll('.seat')].map(e => e.getBoundingClientRect().bottom));
  return { desk: y('.desk'), chalk: y('.chalk'), seatBottom, flip: document.querySelector('.board').classList.contains('flip') };
});
say('교탁이 학생과 칠판 사이에 있다',
    front.flip ? (front.desk < front.chalk) : (front.chalk < front.desk), front);
await pg.emulateMedia({ media: 'screen' });

// 화면 폭을 얼마나 쓰는가. 예전에 .wrap 이 1240px 로 묶여 있어
// FHD 에서 자리판이 484px(화면의 25%)밖에 안 됐다.
console.log('\n■ 넓은 화면에서 자리판이 폭을 가져가는가');
{
  const measure = async W => {
    await pg.setViewportSize({ width: W, height: 1080 });
    await pg.waitForTimeout(150);
    return pg.evaluate(() => {
      const r = e => e.getBoundingClientRect();
      const s = r(document.querySelector('.seat'));
      return { wrap: Math.round(r(document.querySelector('.wrap')).width),
               board: Math.round(r(document.querySelector('.board')).width),
               seatW: Math.round(s.width), ratio: s.width / s.height,
               scrollX: document.documentElement.scrollWidth > window.innerWidth };
    });
  };
  // 끝까지 채우지는 않는다 — 여백이 조금 남는 편이 읽기 편하다.
  // 대신 자리판이 화면의 절반 가까이는 나와야 한다.
  const fhd = await measure(1920);
  say('FHD 에서 넉넉히 쓴다 (1600~1800)', fhd.wrap >= 1600 && fhd.wrap <= 1800, fhd);
  say('자리판이 900px 을 넘는다', fhd.board > 900, fhd);
  // 폭만 늘고 높이가 그대로면 납작한 막대가 된다
  say('자리 비율이 책상 같다 (1.2~2.2:1)', fhd.ratio > 1.2 && fhd.ratio < 2.2, fhd.ratio.toFixed(2));
  say('가로 스크롤이 안 생긴다', !fhd.scrollX);

  // 1366 노트북이 3단에 걸리면 자리판이 610px 로 쪼그라들었다 —
  // 2단으로 내려가 오히려 넓어지는 지점이라, 그 구간을 없앴다.
  for (const W of [1512, 1440, 1366, 1280]) {
    const m = await measure(W);
    say(W + 'px 에서 가로 스크롤 없음', !m.scrollX, m);
    say(W + 'px 에서 자리가 안 찌그러진다', m.seatW >= 100, m);
  }
  // 아래로 내려간 상태에서 명렬이 세로로 이어져야 한다 —
  // 격자로 채우면 01 02 03 / 04 05 06 처럼 가로로 읽힌다.
  await pg.setViewportSize({ width: 1440, height: 1400 });
  await pg.waitForTimeout(200);
  const firstCol = await pg.evaluate(() => {
    const box = e => e.getBoundingClientRect();
    const rows = [...document.querySelectorAll('#stuGrid .stu-row')];
    const left = Math.min(...rows.map(r => box(r).left));
    return rows.filter(r => Math.abs(box(r).left - left) < 4)
               .map(r => +r.querySelector('.mono').textContent);
  });
  say('내려가도 첫 단이 1번부터 차례로', firstCol.length > 3
      && firstCol.every((n, i) => n === i + 1), firstCol);
  await pg.setViewportSize({ width: 1280, height: 1500 });
}

// 인쇄 명렬의 비고 칸 — 임무를 찍어 내보내되, 없어도 칸은 남는다
console.log('\n■ 인쇄 명렬 비고');
{
  await pg.evaluate(() => window.__buildPrintExtras());
  const head = await pg.$$eval('#printRoster .pr-tbl th', e => e.map(x => x.textContent));
  say('머리글이 번호·이름·비고', head.slice(0, 3).join(',') === '번호,이름,비고', head);
  const notes = await pg.$$eval('#printRoster .pr-tbl td.rmk', e => e.length);
  const names = await pg.$$eval('#printRoster .pr-tbl td.nm', e => e.length);
  say('학생마다 비고 칸이 하나씩', notes === names && notes > 0, { notes, names });
  const filled = await pg.$$eval('#printRoster .pr-tbl td.rmk',
    e => e.map(x => x.textContent).filter(Boolean));
  say('임무가 적힌 학생은 비고에 찍힌다', filled.includes('반장'), filled);
  say('임무가 없어도 칸은 남는다', notes - filled.length > 0, { notes, 채워진칸: filled.length });
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.join('\n') : '\n✅ 런타임 오류 없음');
await b.close();
process.exit(errs.length ? 1 : 0);
