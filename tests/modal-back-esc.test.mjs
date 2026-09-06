// 열린 모달은 뒤로가기와 ESC 로 닫혀야 한다.
//
// 이 앱은 popstate 핸들러와 keydown(Escape) 핸들러에 열린 모달을 하나씩 나열해 두고
// 위에서부터 닫는 방식이다. 새 모달을 만들면서 그 목록에 넣는 걸 잊으면 — 모달은
// 그대로 있고 뒷페이지가 뒤로 가 버린다. 화면상 '먹통'이라 알아채기 어렵고, 실제로
// 상벌점 모달이 이랬다.
//
// 그래서 목록을 손으로 적어 두고 대조만 하지 않는다. 원본에서 모달을 직접 찾아내
// 표에 없는 게 나오면 그것도 실패로 만든다 — 다음에 모달을 추가하는 사람이 여기서
// 걸리게 된다.
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

// ── 두 핸들러 본문을 떼어 온다 ──
const popAt = HTML.indexOf("window.addEventListener('popstate'");
const POP = HTML.slice(popAt, HTML.indexOf('\n});', popAt));
const escAt = HTML.indexOf('// ESC 키로 열린 모달 닫기');
const ESC = HTML.slice(escAt, HTML.indexOf('\n});', escAt));

check('popstate 핸들러를 찾았다', popAt > 0 && POP.length > 200);
check('ESC 핸들러를 찾았다', escAt > 0 && ESC.length > 200);

// ── 원본에서 모달을 찾아낸다 ──
// id 가 있고 class 에 modal/overlay 가 들어간 요소 중, 실제로 open/show 를 붙였다 뗐다
// 하는 것만. (제목·본문 같은 속 요소는 그 조작을 받지 않으므로 자연히 걸러진다)
function discoverModals() {
  const ids = new Set();
  const pats = [
    /<div[^>]*\bid="([A-Za-z0-9_]+)"[^>]*\bclass="([^"]*)"/g,
    /<div[^>]*\bclass="([^"]*)"[^>]*\bid="([A-Za-z0-9_]+)"/g,
  ];
  for (const [i, re] of pats.entries()) {
    for (const m of HTML.matchAll(re)) {
      const id = i === 0 ? m[1] : m[2];
      const cls = i === 0 ? m[2] : m[1];
      if (/modal|overlay/i.test(cls)) ids.add(id);
    }
  }
  return [...ids].filter(id =>
    new RegExp(`${id}'\\)[^\\n]{0,40}?\\.add\\('(?:open|show)'\\)`).test(HTML));
}

// ── 알고 있는 모달과 닫는 함수 ──
// 여기 있는 것은 '뒤로가기·ESC 로 닫혀야 한다'가 확인된 것들이다.
const MODALS = {
  mytaskModal:       'closeMytaskModal',
  mytaskDayModal:    'closeMytaskDayModal',
  ptsDetailModal:    'closePtsDetailBtn',
  ptsNewModal:       'closePtsNewModalBtn',
  consultPeekModal:  'closeConsultPeek',
  consultAutoModal:  'closeConsultAutoModal',
  roomModalOverlay:  'closeRoomModal',
  ttMeetModal:       'ttMeetClose',
  jindanModal:       'closeJindanModal',
  seatModal:         'closeSeatModal',
  classOrgModal:     'closeClassOrgModal',
  passDetailOverlay: 'passCloseDetail',
  passModalOverlay:  'passCloseForm',
  swapModal:         'closeSwapModal',
};

// 뒤로가기는 modalDepth 로 따로 처리한다(교체/보강). ESC 에는 직접 걸려 있다.
const POP_BY_DEPTH = new Set(['swapModal']);

console.log('\n■ 원본에 있는 모달이 표에 다 있는가');
{
  const found = discoverModals();
  const missing = found.filter(id => !(id in MODALS));
  check(`모달 ${found.length}개를 찾았고 표에 다 있다`, missing.length === 0,
        missing.length ? { 표에없음: missing } : undefined);
  if (missing.length) {
    console.log('\n  새로 생긴 모달로 보인다. 두 핸들러에 등록하고 위 표에도 넣어야 한다:');
    for (const m of missing) console.log(`    · ${m}`);
  }
}

console.log('\n■ 뒤로가기로 닫히는가');
for (const [id, fn] of Object.entries(MODALS)) {
  if (POP_BY_DEPTH.has(id)) {
    check(`${id} (modalDepth 로 처리)`, /modalDepth/.test(POP));
    continue;
  }
  check(id, POP.includes(id) && POP.includes(fn + '()'),
        POP.includes(id) ? undefined : '핸들러에 없음');
}

console.log('\n■ ESC 로 닫히는가');
for (const [id, fn] of Object.entries(MODALS)) {
  check(id, ESC.includes(id) && ESC.includes(fn + '()'),
        ESC.includes(id) ? undefined : '핸들러에 없음');
}

console.log('\n■ 닫고 나면 가드를 다시 쌓는가 (뒤로가기 전용)');
// armExitGuard() 를 빼먹으면 히스토리 스택이 한 칸씩 줄어, 몇 번 열고 닫으면
// 뒤로가기가 앱을 통째로 빠져나간다.
{
  const lines = POP.split('\n').filter(l => /getElementById\('\w+Modal|getElementById\('\w+Overlay/.test(l));
  const noGuard = lines.filter(l => !l.includes('armExitGuard()'));
  check(`모달을 닫는 ${lines.length}줄이 전부 가드를 다시 쌓는다`, noGuard.length === 0, noGuard);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
