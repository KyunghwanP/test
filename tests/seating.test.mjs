// 교실 자리 배치 — 배정 알고리즘이 제약을 실제로 지키는지.
//
// 자리 배치는 눈으로 보면 그럴듯한데 제약 하나가 조용히 깨져 있어도 모른다.
// 그래서 seating.html 의 진짜 함수를 그대로 뽑아 여러 판 돌려보고 매번 검사한다.
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../seating.html', 'utf8');
const grab = name => {
  const m = new RegExp(`^function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = html.indexOf('{', m.index), d = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};
const SRC = ['seatRC','seatParse','seatDist','seatCells','seatShuffle','seatFits',
             'seatViolations','seatDiagnose','seatAssign'].map(grab).join('\n');
const TRIES = /const SEAT_TRIES\s*=\s*\d+;/.exec(html)[0];
const { seatAssign, seatCells, seatDist, seatParse, seatDiagnose } =
  await import('data:text/javascript,' + encodeURIComponent(
    TRIES + '\n' + SRC + '\nexport { seatRC, seatParse, seatDist, seatCells, seatFits, seatViolations, seatDiagnose, seatAssign };'));

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// 재현되는 난수 — 실패했을 때 같은 판을 다시 돌려볼 수 있어야 한다
const mulberry = seed => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const grid = (cols, rows, off = []) => ({ cols, rows, off });
const roster = n => Array.from({ length: n }, (_, i) => `2-3-${i + 1}`);
const seatOf = (seats, k) => Object.keys(seats).find(c => seats[c] === k);

console.log('\n■ 자리판');
{
  check('빈칸을 뺀 자리 수', seatCells(grid(4, 6)).length === 24);
  check('빈칸 2개 빼면 22', seatCells(grid(4, 6, ['0,0', '5,3'])).length === 22);
  check('앞줄부터 왼쪽부터', seatCells(grid(3, 2)).join(' ') === '0,0 0,1 0,2 1,0 1,1 1,2');
  check('대각선도 이웃(거리 1)', seatDist('0,0', '1,1') === 1);
  check('두 칸 건너뛰면 2', seatDist('0,0', '0,2') === 2);
}

console.log('\n■ 번호순');
{
  const r = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'order' });
  check('오류 없음', !r.error, r.error);
  check('1번이 맨 앞 왼쪽', r.seats['0,0'] === '2-3-1', r.seats['0,0']);
  check('24번이 맨 뒤 오른쪽', r.seats['5,3'] === '2-3-24', r.seats['5,3']);
  check('전원 착석', Object.keys(r.seats).length === 24);

  const f = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'order',
                         cons: { fixed: { '2-3-24': '0,0' } } });
  check('고정석은 번호순보다 세다', f.seats['0,0'] === '2-3-24', f.seats['0,0']);
  check('고정석 때문에 1번이 밀린다', f.seats['0,1'] === '2-3-1', f.seats['0,1']);

  const w = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'order',
                         cons: { apart: [{ a: '2-3-1', b: '2-3-2', d: 3 }] } });
  check('번호순은 분리를 못 지키면 알려준다', !!w.warn, w.warn);
  check('그래도 배치는 내놓는다', Object.keys(w.seats).length === 24);
}

console.log('\n■ 랜덤 — 제약을 실제로 지키나 (판마다 새로)');
{
  let okFixed = 0, okFront = 0, okApart = 0, okAll = 0, errs = 0;
  const N = 60;
  for (let s = 0; s < N; s++) {
    const cons = {
      fixed: { '2-3-5': '0,0' },
      front: { '2-3-9': 2, '2-3-10': 2 },
      apart: [{ a: '2-3-1', b: '2-3-2', d: 3 }, { a: '2-3-3', b: '2-3-4', d: 2 }]
    };
    const r = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
                           cons, rand: mulberry(s) });
    if (r.error) { errs++; continue; }
    if (seatOf(r.seats, '2-3-5') === '0,0') okFixed++;
    if (['2-3-9','2-3-10'].every(k => seatParse(seatOf(r.seats, k)).r < 2)) okFront++;
    if (seatDist(seatOf(r.seats,'2-3-1'), seatOf(r.seats,'2-3-2')) >= 3 &&
        seatDist(seatOf(r.seats,'2-3-3'), seatOf(r.seats,'2-3-4')) >= 2) okApart++;
    if (Object.keys(r.seats).length === 24) okAll++;
  }
  check(`${N}판 모두 배치를 찾았다`, errs === 0, { errs });
  check('고정석이 매번 지켜졌다', okFixed === N, { okFixed, N });
  check('앞자리 우선이 매번 지켜졌다', okFront === N, { okFront, N });
  check('분리가 매번 지켜졌다', okApart === N, { okApart, N });
  check('매번 전원 착석', okAll === N, { okAll, N });
}

console.log('\n■ 랜덤은 실제로 섞이나');
{
  const seen = new Set();
  for (let s = 0; s < 20; s++) {
    const r = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random', rand: mulberry(s) });
    seen.add(r.seats['0,0']);
  }
  check('맨 앞자리에 여러 학생이 앉는다', seen.size > 5, { 가짓수: seen.size });
}

console.log('\n■ 부분 랜덤 — 고른 학생만 움직인다');
{
  const first = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'order' }).seats;
  const move = new Set(['2-3-1', '2-3-2', '2-3-3']);
  const keep = {};
  for (const c in first) if (!move.has(first[c])) keep[first[c]] = c;
  const r = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
                         keep, rand: mulberry(7) });
  check('오류 없음', !r.error, r.error);
  const stayed = Object.keys(keep).every(k => seatOf(r.seats, k) === keep[k]);
  check('안 고른 학생은 그대로', stayed);
  check('고른 학생도 다 앉았다', [...move].every(k => !!seatOf(r.seats, k)));
}

console.log('\n■ 빈칸 자리에는 안 앉힌다');
{
  const off = ['0,0', '0,1', '2,2'];
  const r = seatAssign({ grid: grid(4, 6, off), roster: roster(21), mode: 'random', rand: mulberry(3) });
  check('오류 없음', !r.error, r.error);
  check('빈칸은 비어 있다', off.every(c => !r.seats[c]), Object.keys(r.seats).filter(c => off.includes(c)));
  const ord = seatAssign({ grid: grid(4, 6, off), roster: roster(21), mode: 'order' });
  check('번호순도 빈칸을 건너뛴다', off.every(c => !ord.seats[c]));
  check('번호순 1번은 빈칸 다음 자리', ord.seats['0,2'] === '2-3-1', ord.seats['0,2']);
}

console.log('\n■ 말이 안 되는 제약은 이유를 알려준다');
{
  const tooMany = seatAssign({ grid: grid(4, 4), roster: roster(20), mode: 'random' });
  check('자리보다 학생이 많으면', /자리가 16개인데 학생이 20명/.test(tooMany.error || ''), tooMany.error);

  const clash = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
    cons: { fixed: { '2-3-1': '0,0', '2-3-2': '0,0' } } });
  check('고정석이 겹치면', /같은 자리/.test(clash.error || ''), clash.error);

  const outside = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
    cons: { fixed: { '2-3-1': '9,9' } } });
  check('고정석이 판 밖이면', /자리판 밖/.test(outside.error || ''), outside.error);

  const front = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
    cons: { front: Object.fromEntries(roster(10).map(k => [k, 1])) } });
  check('앞자리 우선이 앞줄보다 많으면', /앞 1줄 자리는 4개인데/.test(front.error || ''), front.error);

  const fixApart = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
    cons: { fixed: { '2-3-1': '0,0', '2-3-2': '0,1' }, apart: [{ a: '2-3-1', b: '2-3-2', d: 3 }] } });
  check('고정석끼리 붙었는데 분리면', /고정석이 서로 붙어/.test(fixApart.error || ''), fixApart.error);

  check('진단은 이름으로 말한다',
        /김민준/.test(seatDiagnose(['2-3-1','2-3-2'], ['0,0','0,1'],
          { '2-3-1':'9,9' }, {}, [], k => k === '2-3-1' ? '김민준' : '이서연') || ''));
}

console.log('\n■ 경계');
{
  const empty = seatAssign({ grid: grid(4, 6), roster: [], mode: 'random' });
  check('학생이 없어도 안 터진다', !empty.error && Object.keys(empty.seats).length === 0, empty);

  const exact = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random', rand: mulberry(11) });
  check('자리와 인원이 딱 맞아도 된다', !exact.error && Object.keys(exact.seats).length === 24, exact.error);

  // 전학 간 학생의 고정석이 문서에 남아 있어도 그 자리를 비워두면 안 된다
  const gone = seatAssign({ grid: grid(4, 6), roster: roster(24), mode: 'random',
    cons: { fixed: { '2-3-99': '0,0' } }, rand: mulberry(2) });
  check('명렬에 없는 학생의 고정석은 무시', !gone.error, gone.error);
  check('그 자리에 다른 학생이 앉는다', !!gone.seats['0,0'] && gone.seats['0,0'] !== '2-3-99', gone.seats['0,0']);
  check('그래도 전원 착석', Object.keys(gone.seats).length === 24);

  const hard = seatAssign({ grid: grid(2, 2), roster: roster(4), mode: 'random',
    cons: { apart: [{ a:'2-3-1', b:'2-3-2', d:3 }] }, rand: mulberry(5) });
  check('아무리 돌려도 안 되면 그렇게 말한다', /못 찾았습니다/.test(hard.error || ''), hard.error);
}

console.log('\n■ 화면 배선 — JS 가 부르는 id 가 실제로 있나');
{
  // 알고리즘 테스트는 UI 절반을 못 본다. id 오타는 눌러봐야 알게 되는데,
  // 그 '눌러봄'이 담임 선생님이면 곤란하다.
  const ids = new Set([...html.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]));
  const inMarkup = new Set([...html.matchAll(/\sid="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
  const missing = [...ids].filter(i => !inMarkup.has(i));
  check(`JS 가 부르는 id ${ids.size}개가 전부 마크업에 있다`, missing.length === 0, missing);

  // 이벤트를 다는 버튼도 마찬가지
  const handlers = [...html.matchAll(/\$\('([A-Za-z0-9_]+)'\)\.addEventListener/g)].map(m => m[1]);
  check(`이벤트 다는 요소 ${new Set(handlers).size}개도 전부 있다`,
        handlers.every(i => inMarkup.has(i)), handlers.filter(i => !inMarkup.has(i)));

  check('클래스 키 없이 열면 안내가 있다', /학급이 지정되지 않았습니다/.test(html));
  check('저장 권한 거부를 사람 말로 옮긴다', /permission-denied[\s\S]{0,200}담임만 저장/.test(html));
  check('지난 배치는 본인 것만 (관리자는 전부)', /ME === ADMIN_EMAIL \|\| h\.by === ME/.test(html));
  check('이력은 최근 것만 남긴다', /slice\(-HIST_KEEP\)/.test(html));
  check('명렬 원본은 안 건드린다', !/setDoc\(doc\(db, 'students'/.test(html));
  check('인쇄에서 선택 표시를 지운다', /@media print[\s\S]*\.seat\.sel\{border:1px solid #000/.test(html));
  check('인쇄에서 화면 UI 를 뺀다', /@media print[\s\S]*\.noprint\{display:none !important;\}/.test(html));
  check('인쇄는 A4 가로', /@page\{ size:A4 landscape;/.test(html));
  check('저장은 seating 문서에만', (html.match(/setDoc\(doc\(db, '([a-zA-Z]+)'/g) || [])
        .every(m => m.includes("'seating'")));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
