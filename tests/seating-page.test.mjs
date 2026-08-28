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

// 교탁 위/아래 — 그리는 방향만 바뀌고 자리 데이터는 그대로여야 한다
await pg.click('#bOrder');
const topFirst = await pg.$eval('.grid .seat .s-name', e => e.textContent);
const seatsBefore = await pg.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.grid .seat')].map(s => s.dataset.cell + ':' + (s.querySelector('.s-name')?.textContent || ''))
    .sort()));
await pg.click('#bFlip');
say('교탁이 아래로 간다', await pg.$eval('.board', e => e.classList.contains('flip')));
say('버튼 글자가 바뀐다', (await pg.$eval('#bFlip', e => e.textContent)).includes('교사 입장'));
const bottomFirst = await pg.$eval('.grid .seat .s-name', e => e.textContent);
say('처음 그려지는 학생이 달라진다(뒷줄부터)', topFirst !== bottomFirst, { topFirst, bottomFirst });
const seatsAfter = await pg.evaluate(() => JSON.stringify(
  [...document.querySelectorAll('.grid .seat')].map(s => s.dataset.cell + ':' + (s.querySelector('.s-name')?.textContent || ''))
    .sort()));
say('자리 데이터는 그대로다', seatsBefore === seatsAfter);
// 보는 사람이 바뀌면 180도 회전이어야 한다 — 거울이 아니라.
// 상하만 뒤집으면 왼쪽·오른쪽이 반대가 되어 한쪽 화면이 거짓말을 한다.
const order = () => pg.$$eval('.grid .seat', e => e.map(s => s.dataset.cell));
const flipped = await order();
const dims = await pg.evaluate(() => ({
  rows: +document.getElementById('nRows').value, cols: +document.getElementById('nCols').value }));
const lastCell = `${dims.rows - 1},${dims.cols - 1}`;
say('맨 나중에 그려지는 칸이 앞줄 맨 왼쪽(0,0)', flipped.at(-1) === '0,0', flipped.slice(-3));
say('맨 처음 그려지는 칸이 뒷줄 맨 오른쪽', flipped[0] === lastCell, { 처음: flipped[0], 기대: lastCell });
await pg.click('#bFlip');
const normal = await order();
say('되돌리면 원래 순서', normal[0] === '0,0' && normal.at(-1) === lastCell, [normal[0], normal.at(-1)]);
say('두 순서는 정확히 뒤집힌 관계 (회전이지 거울이 아니다)',
    JSON.stringify(normal.slice().reverse()) === JSON.stringify(flipped));
await pg.click('#bFlip');   // 다시 교사 입장으로 (아래 검사가 이어짐)
say('버튼 이름이 보는 사람으로 표시된다',
    (await pg.$eval('#bFlip', e => e.textContent)).includes('교사 입장'));
await pg.click('#bFlip');
say('다시 누르면 학생 입장으로', !(await pg.$eval('.board', e => e.classList.contains('flip'))));

// 학생 추가
await pg.fill('#addNum', '31'); await pg.fill('#addName', '전입생');
await pg.click('#bAdd');
say('전입생이 명렬에 들어간다',
    (await pg.$eval('#rosterEdit', e => e.textContent)).includes('전입생'));

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
  const r = document.querySelector('#printRoster'), b = document.querySelector('.board');
  return {
    page: w(document.querySelector('.wrap')), roster: w(r), board: w(b),
    tall: Math.round(document.querySelector('.grid').getBoundingClientRect().height),
    ui:   getComputedStyle(document.querySelector('#barMain')).display,
    title: document.querySelector('#printTitle').textContent,
    rows:  document.querySelectorAll('#printRoster tr').length,
    deskBg: getComputedStyle(document.querySelector('.desk')).backgroundColor,
    numBg:  getComputedStyle(document.querySelector('.s-num')).backgroundColor
  };
});
say('명렬표 + 자리판이 종이 폭을 채운다', pm.roster + pm.board >= pm.page * 0.93, pm);
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
// 칠판은 벽, 교탁은 그 앞 — 학생과 칠판 사이에 교탁이 있어야 한다
const front = await pg.evaluate(() => {
  const y = s => document.querySelector(s).getBoundingClientRect().top;
  const seatBottom = Math.max(...[...document.querySelectorAll('.seat')].map(e => e.getBoundingClientRect().bottom));
  return { desk: y('.desk'), chalk: y('.chalk'), seatBottom, flip: document.querySelector('.board').classList.contains('flip') };
});
say('교탁이 학생과 칠판 사이에 있다',
    front.flip ? (front.desk < front.chalk) : (front.chalk < front.desk), front);
await pg.emulateMedia({ media: 'screen' });

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.join('\n') : '\n✅ 런타임 오류 없음');
await b.close();
process.exit(errs.length ? 1 : 0);
