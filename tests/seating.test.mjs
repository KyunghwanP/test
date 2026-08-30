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
const SRC = ['seatRC','seatParse','seatDist','seatCells','seatShuffle','apartMembers','seatFits',
             'seatViolations','seatDiagnose','seatAssign'].map(grab).join('\n');
const TRIES = /const SEAT_TRIES\s*=\s*\d+;/.exec(html)[0];
const { seatAssign, seatCells, seatDist, seatParse, seatDiagnose } =
  await import('data:text/javascript,' + encodeURIComponent(
    TRIES + '\n' + SRC + '\nexport { seatRC, seatParse, seatDist, seatCells, apartMembers, seatFits, seatViolations, seatDiagnose, seatAssign };'));

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

console.log('\n■ 분리 묶음 — 여러 명을 한꺼번에 떼어놓기');
{
  // 5명을 떼어놓으려고 짝 10개를 만들게 하면 안 된다. 묶음 하나로 끝나야 한다.
  const five = ['2-3-1','2-3-2','2-3-3','2-3-4','2-3-5'];
  let ok = 0, fails = [];
  for (let s = 0; s < 30; s++) {
    const r = seatAssign({ grid: grid(6, 6), roster: roster(30), mode: 'random',
      cons: { apart: [{ ks: five, d: 2 }] }, rand: mulberry(s) });
    if (r.error) { fails.push(r.error); continue; }
    const at = k => seatOf(r.seats, k);
    let good = true;
    for (let i = 0; i < five.length; i++) for (let j = i + 1; j < five.length; j++)
      if (seatDist(at(five[i]), at(five[j])) < 2) good = false;
    if (good) ok++;
  }
  check('5명 묶음 30판 모두 서로 안 붙는다', ok === 30, { ok, fails: fails.slice(0,1) });

  const far = seatAssign({ grid: grid(6, 6), roster: roster(30), mode: 'random',
    cons: { apart: [{ ks: ['2-3-1','2-3-2','2-3-3'], d: 3 }] }, rand: mulberry(5) });
  check('거리 3 묶음도 지켜진다', !far.error &&
    [['2-3-1','2-3-2'],['2-3-1','2-3-3'],['2-3-2','2-3-3']]
      .every(([a,b]) => seatDist(seatOf(far.seats,a), seatOf(far.seats,b)) >= 3), far.error);

  check('묶음 두 개도 각각 지켜진다', (() => {
    const r = seatAssign({ grid: grid(6, 6), roster: roster(30), mode: 'random',
      cons: { apart: [{ ks:['2-3-1','2-3-2','2-3-3'], d:2 }, { ks:['2-3-4','2-3-5'], d:3 }] },
      rand: mulberry(8) });
    if (r.error) return false;
    return seatDist(seatOf(r.seats,'2-3-1'), seatOf(r.seats,'2-3-2')) >= 2 &&
           seatDist(seatOf(r.seats,'2-3-4'), seatOf(r.seats,'2-3-5')) >= 3;
  })());

  // 같은 묶음에 속하지 않은 학생끼리는 붙어도 된다
  check('묶음 밖 학생은 제약을 안 받는다', (() => {
    const r = seatAssign({ grid: grid(3, 2), roster: roster(6), mode: 'random',
      cons: { apart: [{ ks:['2-3-1','2-3-2'], d:2 }] }, rand: mulberry(2) });
    return !r.error && Object.keys(r.seats).length === 6;
  })());

  check('예전 짝 형태({a,b})도 그대로 읽는다', (() => {
    const r = seatAssign({ grid: grid(6, 6), roster: roster(30), mode: 'random',
      cons: { apart: [{ a:'2-3-1', b:'2-3-2', d:3 }] }, rand: mulberry(4) });
    return !r.error && seatDist(seatOf(r.seats,'2-3-1'), seatOf(r.seats,'2-3-2')) >= 3;
  })());

  check('한 묶음이 자리보다 크면 이유를 말한다', (() => {
    const r = seatAssign({ grid: grid(2, 2), roster: roster(4), mode: 'random',
      cons: { apart: [{ ks: roster(4), d: 2 }] }, rand: mulberry(1) });
    return /못 찾았습니다/.test(r.error || '');
  })());

  // 실제 교실 크기에서 어디까지 되는가 — 기본값을 '이웃 금지'로 정한 근거다.
  // 5분단 6줄 30자리, 27명 기준으로 200판씩 돌려 봤다.
  const rate = (g, d) => {
    let ok = 0;
    for (let s = 0; s < 60; s++) {
      const r = seatAssign({ grid: grid(5, 6), roster: roster(27), mode: 'random',
        cons: { apart: [{ ks: roster(g), d }] }, rand: mulberry(s) });
      if (!r.error) ok++;
    }
    return ok / 60;
  };
  check('이웃 금지는 5명도 늘 된다', rate(5, 2) === 1, rate(5, 2));
  check('이웃 금지는 8명도 늘 된다', rate(8, 2) === 1, rate(8, 2));
  check("'멀리'는 5명부터 안 된다", rate(5, 3) === 0, rate(5, 3));
  check("'멀리'도 4명까지는 된다", rate(4, 3) === 1, rate(4, 3));
  check("못 찾으면 '멀리'가 원인일 수 있다고 짚는다", (() => {
    const r = seatAssign({ grid: grid(5, 6), roster: roster(27), mode: 'random',
      cons: { apart: [{ ks: roster(6), d: 3 }] }, rand: mulberry(1) });
    return /'멀리'로 묶은 6명/.test(r.error || '');
  })());

  check('번호순은 못 지킨 묶음을 알려준다', (() => {
    const r = seatAssign({ grid: grid(6, 6), roster: roster(30), mode: 'order',
      cons: { apart: [{ ks: five, d: 3 }] } });
    return Array.isArray(r.warn) && r.warn.length > 0;
  })());
  check('그 알림에 같은 짝이 두 번 안 나온다', (() => {
    const r = seatAssign({ grid: grid(6, 6), roster: roster(30), mode: 'order',
      cons: { apart: [{ ks: five, d: 3 }] } });
    return new Set(r.warn).size === r.warn.length;
  })());
}

console.log('\n■ 앞에서부터 채운다 (남는 자리는 뒤로)');
{
  // 자리 30, 학생 24 → 앞 24칸이 차고 뒤 6칸이 비어야 한다.
  // 랜덤이 전체에 흩뿌리면 가운데가 군데군데 뚫린 얼룩이 된다.
  const cells = seatCells(grid(5, 6));
  const front24 = new Set(cells.slice(0, 24));
  let allPacked = true, holes = [];
  for (let s = 0; s < 40; s++) {
    const r = seatAssign({ grid: grid(5, 6), roster: roster(24), mode: 'random', rand: mulberry(s) });
    const taken = Object.keys(r.seats);
    if (taken.length !== 24 || !taken.every(c => front24.has(c))) {
      allPacked = false; holes = taken.filter(c => !front24.has(c)); break;
    }
  }
  check('랜덤 40판 모두 앞 24칸에만 앉는다', allPacked, holes);
  const last = seatAssign({ grid: grid(5, 6), roster: roster(24), mode: 'random', rand: mulberry(3) });
  check('마지막 줄이 비어 있다', !cells.slice(24).some(c => last.seats[c]));

  const ord = seatAssign({ grid: grid(5, 6), roster: roster(24), mode: 'order' });
  check('번호순도 앞 24칸', Object.keys(ord.seats).every(c => front24.has(c)));

  // 뒤쪽 고정석은 예외 — 그 자리는 비우면 안 된다
  const backFix = seatAssign({ grid: grid(5, 6), roster: roster(24), mode: 'random',
                               cons: { fixed: { '2-3-1': '5,4' } }, rand: mulberry(9) });
  check('뒤쪽 고정석은 그대로 지킨다', backFix.seats['5,4'] === '2-3-1', backFix.error || backFix.seats['5,4']);
  check('고정석 때문에 앞 한 칸이 대신 빈다',
        Object.keys(backFix.seats).length === 24 &&
        cells.slice(0, 24).filter(c => !backFix.seats[c]).length === 1);

  // 빈칸(off)은 애초에 자리가 아니므로 앞에서부터 채우기와 함께 동작해야 한다
  const withOff = seatAssign({ grid: grid(5, 6, ['0,0','0,1']), roster: roster(20), mode: 'random', rand: mulberry(4) });
  check('빈칸을 건너뛰고 앞에서부터', !withOff.error &&
        Object.keys(withOff.seats).every(c => seatCells(grid(5,6,['0,0','0,1'])).slice(0,20).includes(c)),
        withOff.error);
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

console.log('\n■ 번호 매기는 순서');
{
  const g = grid(4, 3);
  const first = o => seatCells(g, o)[0];
  const last  = o => seatCells(g, o).at(-1);
  check('기본은 앞왼쪽에서 가로로', seatCells(g).slice(0,5).join(' ') === '0,0 0,1 0,2 0,3 1,0');
  check('앞오른쪽 시작', first({ start:'FR' }) === '0,3', first({ start:'FR' }));
  check('뒤왼쪽 시작',   first({ start:'BL' }) === '2,0', first({ start:'BL' }));
  check('뒤오른쪽 시작', first({ start:'BR' }) === '2,3', first({ start:'BR' }));
  check('세로 진행이면 한 분단을 먼저 훑는다',
        seatCells(g, { dir:'col' }).slice(0,4).join(' ') === '0,0 1,0 2,0 0,1',
        seatCells(g, { dir:'col' }).slice(0,4));
  check('뒤오른쪽 + 세로', seatCells(g, { start:'BR', dir:'col' }).slice(0,4).join(' ') === '2,3 1,3 0,3 2,2');
  check('어느 순서든 자리 수는 같다',
        ['FL','FR','BL','BR'].every(st => ['row','col'].every(d => seatCells(g,{start:st,dir:d}).length === 12)));
  check('빈칸은 어느 순서에서도 빠진다',
        seatCells(grid(4,3,['0,0','2,3']), { start:'BR', dir:'col' }).length === 10);

  // 번호순이 실제로 그 순서를 따르는가
  const r = seatAssign({ grid: grid(4,3), roster: roster(12), mode:'order', ord:{ start:'BR', dir:'col' } });
  check('번호순 1번이 시작 모서리에', r.seats['2,3'] === '2-3-1', r.seats['2,3']);
  check('번호순 2번이 그 앞자리에', r.seats['1,3'] === '2-3-2', r.seats['1,3']);

  // 앞에서부터 채우기도 같은 순서를 따른다
  const p = seatAssign({ grid: grid(4,3), roster: roster(10), mode:'random',
                         ord:{ start:'BR', dir:'col' }, rand: mulberry(1) });
  const tail = seatCells(grid(4,3), { start:'BR', dir:'col' }).slice(10);
  check('남는 자리는 그 순서의 끝에 몰린다', tail.every(c => !p.seats[c]), tail.filter(c => p.seats[c]));
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
  check('인쇄에서 선택·고름·hover 표시를 지운다',
        /@media print[\s\S]*\.seat\.sel,\.seat\.pick,\.seat:hover\{border:1\.2px solid #7593BA;box-shadow:none/.test(html));
  check('자리판 기본은 5분단 6줄',
        /id="nCols"[^>]*value="5"/.test(html) && /id="nRows"[^>]*value="6"/.test(html) &&
        /cols:5, rows:6/.test(html) && /cols: d\.cols \|\| 5, rows: d\.rows \|\| 6/.test(html));
  // 짝 → 묶음으로 바꿀 때 자리판의 배지 검사를 빠뜨려, 분리를 걸어도 자리에 표시가 안 났다
  // 묶음이 여럿이면 '분리'만으로는 누가 누구와 묶였는지 모른다. A·B… 이름표를 붙인다.
  check('묶음에 이름표를 붙인다', /const apartTag = i =>/.test(html)
        && /function apartTagsOf\(list, k\)/.test(html));
  check('자리판 배지에 묶음 이름표가 뜬다',
        /const ap = apartTagsOf\(ST\.apart, k\);/.test(html)
        && /분리 \$\{ap\.join\('·'\)\}/.test(html));
  check('목록 배지에도 이름표가 뜬다', /apartTagsOf\(ST\.apart, s\.key\)/.test(html));
  check('묶음 목록이 이름표와 거리를 같이 보여준다',
        /분리 \$\{apartTag\(i\)\}/.test(html)
        && /\(p\.d\|\|2\) >= 3 \? '멀리' : '이웃 금지'/.test(html));
  check('표의 분리 버튼도 어느 묶음인지 보여준다',
        /const apLabel = tags\.length \? `분리 \$\{tags\.join\('·'\)\}` : '분리';/.test(html));
  check('옛 짝 형태를 보는 곳이 남아 있지 않다',
        !/apart\.some\(p => p\.a ===/.test(html) && !/apart\.filter\(p => p\.a !==/.test(html));
  check('학생을 빼면 묶음에서도 빠진다', /apartMembers\(p\)\.filter\(k => k !== key\)/.test(html));
  check('혼자 남은 묶음은 지운다', /filter\(p => p\.ks\.length >= 2\)/.test(html));
  check('명렬 맞춤이 저장된다', /rosterAlign: ST\.rosterAlign/.test(html));
  // 정렬이 실제로 맞는지는 seating-page 에서 좌표를 재서 본다. 여기서는 장치가 있는지만.
  check('첫 줄 맞춤은 교탁·칠판 높이만큼 비켜 준다',
        /#printRoster\{--front-h:\d+pt;align-self:start;\}/.test(html) &&
        /\.pcol:not\(\.pflip\) #printRoster\{margin-top:var\(--front-h\)/.test(html));
  check('끝 줄 맞춤은 명렬을 자리판 줄에만 건다',
        /\.pcol\.rlast #printRoster\{[^}]*align-self:end[^}]*grid-row:board-start \/ board-end/.test(html));
  check('인쇄 .board 는 화면 여백을 물려받지 않는다',
        /@media print[\s\S]*\.board\{grid-area:board;[^}]*padding:0/.test(html));
  check('지난 기록을 지울 수 있다', /data-histdel/.test(html) && /function saveHistoryOnly/.test(html));
  check('기록만 지울 때 새로 쌓지 않는다',
        /setDoc\(doc\(db, 'seating', CLASSKEY\), \{ history: ST\.history \}, \{ merge: true \}\)/.test(html));
  check('분단 묶음이 저장된다', /group: ST\.group/.test(html) && /group: d\.group \|\| 1/.test(html));
  check('분단마다 격자를 따로 만든다', /class="aisle"/.test(html));
  check('번호순 순서가 저장된다', /ordStart: ST\.ordStart, ordDir: ST\.ordDir/.test(html));
  check('끌어놓기가 배선돼 있다', /addEventListener\('dragstart'/.test(html) && /function dropOnSeat/.test(html));
  check('목록으로 끌면 자리에서 뺀다', /function bindUnseatDrop/.test(html));
  check('클릭으로 바꾸는 길도 남겨 뒀다', /s\.addEventListener\('click', \(\) => onSeat/.test(html));
  check('교탁 아래 버전이 있다', /\.board\.flip\{flex-direction:column-reverse;\}/.test(html) && /function rowOrder\(\)/.test(html));
  check('표 복사도 교탁 방향을 따른다', /if \(!ST\.flip\) t \+= desk;/.test(html) && /if \(ST\.flip\) t \+= desk;/.test(html));
  check('교탁 방향은 문서에 저장된다', /flip: !!ST\.flip/.test(html));
  // 자리표를 만드는 사람은 교탁에 서서 본다. 저장된 방향을 따르면 매번 한 번씩 뒤집게 된다.
  check('기본이 교사 입장(교탁 아래)', /^\s*flip:true,\s*$/m.test(html));
  check('열 때는 저장값과 무관하게 교사 입장', /flip: true,\s*\n\s*group: d\.group \|\| 1,/.test(html));
  // 그리기만 바꾸는 값이다 — 번호순 배정(seatCells)이 이걸 보면 물리적 배치가 달라진다
  check('번호순 배정은 교탁 방향과 무관',
        !grab('seatCells').includes('flip') && !grab('seatCells').includes('rowOrder'));
  // 제약·임무는 모드를 바꾼 뒤 자리를 누르는 것도, 드롭다운에서 학생을 찾는 것도 아니다.
  // 반 전체가 한 줄씩 뜨는 「학생별 설정」 표에서 그 자리에서 켠다.
  check('고정석·앞자리·분리·임무 모드는 없앴다',
        !/id="mFix"/.test(html) && !/id="mFront"/.test(html)
        && !/id="mDuty"/.test(html) && !/id="mApart"/.test(html));
  check('남은 모드는 자리판을 눌러야 하는 것뿐',
        /const modes = \{ mMove:'move', mOff:'off' \};/.test(html));
  check('학생을 찾는 드롭다운은 없앴다', !/id="cWho"/.test(html) && !/id="cKind"/.test(html));
  check('표가 있다', /id="stuGrid"/.test(html) && /function renderStuGrid\(\)/.test(html));
  check('한 줄이 명렬 한 명', /g\.innerHTML = ROSTER\.map\(s => \{/.test(html));
  check('줄마다 고정·앞·분리·임무가 다 있다',
        /data-tog="fix"/.test(html) && /data-tog="front"/.test(html)
        && /data-tog="apart"/.test(html) && /data-duty=/.test(html));
  check('임무는 이름 옆 칸에 바로 적는다',
        /<input class="duty" data-duty="\$\{esc\(k\)\}" value="\$\{esc\(ST\.duty\[k\] \|\| ''\)\}"/.test(html));
  // 다시 그릴 때마다 반영하면 한 글자 칠 때마다 표가 새로 그려져 커서가 튄다
  check('임무는 다 치고 나갈 때 반영한다',
        /\[data-duty\]'\)\.forEach\(inp => inp\.addEventListener\('change'/.test(html));
  check('임무를 지우면 필드째 뺀다', /if \(v\) ST\.duty\[k\] = v; else delete ST\.duty\[k\];/.test(html));
  check('앞자리 줄 수는 표 머리에 있다', /id="stuCard"[\s\S]{0,700}id="nFront"/.test(html));
  // 고정석은 '어느 칸에' 가 필요하다. 안 앉은 학생에게 걸면 조용히 무시되면 안 된다.
  check('안 앉은 학생은 고정 버튼이 잠긴다', /\$\{seated \? '' : 'disabled'\}/.test(html));
  check('눌러도 이유를 알려준다',
        /const cell = seatOf\(k\);[\s\S]{0,120}안 앉았습니다[\s\S]{0,40}return;/.test(html));
  check('분리는 표에서 고르고 「묶기」로 확정',
        /data-tog="apart"/.test(html)
        && /if \(APART_SEL\.has\(k\)\) APART_SEL\.delete\(k\); else APART_SEL\.add\(k\);/.test(html)
        && /ST\.apart\.push\(\{ ks: \[\.\.\.APART_SEL\], d: APART_D \}\)/.test(html));
  check('묶기는 둘 이상이라야 열린다', /btn\.disabled = !CANEDIT \|\| n < 2;/.test(html));
  check('묶은 것은 목록에 남고 지울 수 있다',
        /ST\.apart\.map\(\(p, i\) =>/.test(html) && /ST\.apart\.splice\(Number\(b\.dataset\.drop\), 1\)/.test(html));
  check('브라우저 prompt 는 안 쓴다', !/\bprompt\(/.test(html));
  // 아래로 내려가 여러 단이 될 때, 격자로 채우면 번호가 가로로 읽힌다.
  // 명렬은 세로로 이어져야 눈으로 따라간다 — multi-column 을 쓴다.
  check('내려가면 명렬이 세로로 이어진다',
        /\.stucol \.stu-grid\{display:block;columns:310px/.test(html)
        && /\.stucol \.stu-row\{break-inside:avoid/.test(html));
  // 인쇄 명렬에 비고 칸 — 임무를 찍어 내보내되, 없어도 손으로 적을 칸은 남긴다
  check('인쇄 명렬에 비고 칸이 있다', /<th>번호<\/th><th>이름<\/th><th>비고<\/th>/.test(html));
  check('비고에 임무가 들어간다', /class="note">\$\{esc\(ST\.duty\[s\.key\] \|\| .{2}\)\}/.test(html));

  // 「앞 왼쪽부터」는 화면에 보이는 대로여야 한다. 교사 입장은 좌우가 뒤집혀 보인다.
  check('번호순 시작점을 보는 방향으로 옮긴다', /function ordForView\(\)/.test(html)
        && /return s\[0\] \+ \(s\[1\] === 'L' \? 'R' : 'L'\);/.test(html));
  check('배정에 그 값을 넘긴다', /ord: \{ start: ordForView\(\), dir: ST\.ordDir \}/.test(html));
  check('앞뒤는 두 화면에서 같다 — 좌우만 바꾼다',
        /if \(!ST\.flip\) return s;/.test(html) && !/s\[0\] === 'F'/.test(grab('ordForView')));
  check('인쇄에서 화면 UI 를 뺀다', /@media print[\s\S]*\.noprint\{display:none !important;\}/.test(html));
  check('인쇄는 A4 가로', /@page\{ size:A4 landscape;/.test(html));
  check('저장은 seating 문서에만', (html.match(/setDoc\(doc\(db, '([a-zA-Z]+)'/g) || [])
        .every(m => m.includes("'seating'")));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
