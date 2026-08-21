// 운영표(요일 대체·창체 이동·시험·휴일) 해석 검증.
// index.html 에서 실제 함수를 떼어내 돌린다 — 여기 로직을 옮겨 적으면 원본이 바뀌어도 통과한다.
import fs from 'node:fs';

const html = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');
function grab(name) {
  const re = new RegExp(`^function ${name}\\(`, 'm');
  const m = re.exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  // 중괄호를 세어 끝을 찾는다(한 줄짜리 함수를 뒤 코드까지 삼키지 않게)
  let i = html.indexOf('{', m.index), d = 0, j = i;
  for (; j < html.length; j++) {
    if (html[j] === '{') d++;
    else if (html[j] === '}' && --d === 0) return html.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
}
const pick = re => { const m = re.exec(html); if (!m) throw new Error('못 찾음: ' + re); return m[0]; };

const src = [
  pick(/^const TT_ACT = .*$/m),
  pick(/^const TT_NOCLASS = .*$/m),
  pick(/^const TT_EXAM = .*$/m),
  pick(/^function ttGradeOf\(.*$/m),
  grab('ttDayCross'), grab('ttDayIsExam'), grab('ttResolveCellOp'),
  grab('ttTeacherDay'), grab('ttMaskTeacherSlot'),
  // 교사별 '주간' 맵 — 시간표 화면(renderTeacher)이 실제로 쓰는 것.
  // ttTeacherDay(하루치, 현황판·협의시간용)와 다른 함수다. 예전에 하루치만 고쳐서
  // 화면은 그대로였다 → 둘 다 본다.
  pick(/^const DAYS = .*$/m),
  pick(/^let OPERATING = .*$/m),
  pick(/^let ttWeekMon = .*$/m),
  grab('ttMondayOf'), grab('ttISO'), grab('ttEnsureWeek'), grab('ttDateOf'),
  grab('ttOpFor'), grab('ttResolveClass'), grab('ttTeacherOp'),
  'return { ttResolveCellOp, ttTeacherDay, ttMaskTeacherSlot, ttDayCross, ttTeacherOp,'
  + ' setWeek: (ops, mon) => { OPERATING = ops; ttWeekMon = mon; } };'
].join('\n\n');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// ── 학교 자료를 흉내낸다 ──────────────────────────────────────────────
// 1-1 : 6교시 수학(김수학), 7교시 동아리활동(박동아)
// 1-2 : 6교시 비어 있음,   7교시 동아리활동(박동아)
const classSchedule = {
  '1-1': { '수': [ {period:6, subject:'수학', class:'1-1', teacher:'김수학'},
                   {period:7, subject:'동아', class:'1-1', teacher:'박동아'} ],
           '월': [ {period:3, subject:'국어', class:'1-1', teacher:'이국어'} ] },
  '1-2': { '수': [ {period:7, subject:'동아', class:'1-2', teacher:'박동아'} ] }
};
const classList = ['1-1', '1-2'];
const mk = () => new Function('classSchedule','classList', src)(classSchedule, classList);
const TT = mk();

console.log('\n■ 동아리를 7교시 → 6교시로 옮긴 날 (같은 날 안에서의 이동)');
{
  // 운영표: 6교시 칸에 '동아리활동', 7교시 칸은 비움. 요일 대체(월3 같은 표기)는 없다.
  const op = { day:'수', cells: { 6: ['동아리활동'], 7: ['ㆍ'] } };

  const c6 = TT.ttResolveCellOp(op, classSchedule['1-1'], 1, '수', 6);
  const c7 = TT.ttResolveCellOp(op, classSchedule['1-1'], 1, '수', 7);
  check('학급 6교시가 동아리로 바뀐다', c6 && c6.activity && /동아/.test(c6.subject), c6);
  check('학급 7교시는 비워진다', c7 === null, c7);
  check('옮겨온 것으로 표시된다', c6 && c6._sub === true, c6);
  check('동아리 담당 교사를 찾아 붙인다', c6 && c6.teacher === '박동아', c6);

  // 여기가 이번에 고친 부분 — 교사별 배정 맵
  const byTeacher = TT.ttTeacherDay(op, '수');
  check('교사별 배정이 비어 있지 않다', Object.keys(byTeacher).length > 0, byTeacher);
  check('동아리 담당이 6교시를 받는다',
        byTeacher['박동아'] && byTeacher['박동아'][6] && /동아/.test(byTeacher['박동아'][6].subject),
        byTeacher['박동아']);

  // 박동아 선생님의 실제 화면 — 6교시 기초는 비어 있다(동아리는 원래 7교시)
  const base6 = null;
  const base7 = classSchedule['1-1']['수'].find(x => x.period === 7);
  const pull  = byTeacher['박동아'] || null;
  const s6 = TT.ttMaskTeacherSlot(op, base6, pull && pull[6], '수', 6);
  const s7 = TT.ttMaskTeacherSlot(op, base7, pull && pull[7], '수', 7);
  check('교사 6교시에 동아리가 뜬다', s6 && /동아/.test(s6.subject), s6);
  check('교사 7교시는 비워진다', s7 === null, s7);
}

console.log('\n■ 교사별 시간표 화면(renderTeacher) 이 쓰는 주간 맵');
{
  // 화면은 ttTeacherDay(하루치)가 아니라 ttTeacherOp(주간)을 쓴다.
  // 2026-08-26(수) 동아리 7→6교시. 요일 대체 표기는 없다.
  const T2 = mk();
  T2.setWeek({ dates: { '2026-08-26': { day:'수', cells: { 6: ['동아리활동'], 7: ['ㆍ'] } } } },
             new Date(2026, 7, 24));            // 그 주 월요일
  const wk = T2.ttTeacherOp();

  check('그 날이 통째로 빠지지 않는다', Object.keys(wk).length > 0, wk);
  check('동아리 담당이 수요일 6교시를 받는다',
        !!(wk['박동아'] && wk['박동아']['수'] && wk['박동아']['수'][6]), wk['박동아']);
  check('옮겨온 것으로 표시된다',
        !!(wk['박동아'] && wk['박동아']['수'] && wk['박동아']['수'][6] && wk['박동아']['수'][6]._sub),
        wk['박동아'] && wk['박동아']['수']);

  // 박동아 선생님 화면의 실제 칸 — renderTeacher.getPeriod 와 같은 순서
  const op    = { day:'수', cells: { 6: ['동아리활동'], 7: ['ㆍ'] } };
  const pull6 = wk['박동아'] && wk['박동아']['수'] && wk['박동아']['수'][6];
  const pull7 = wk['박동아'] && wk['박동아']['수'] && wk['박동아']['수'][7];
  const s6 = T2.ttMaskTeacherSlot(op, null, pull6, '수', 6);
  const s7 = T2.ttMaskTeacherSlot(op, classSchedule['1-1']['수'].find(x => x.period === 7), pull7, '수', 7);
  check('화면 6교시에 동아리가 뜬다', !!(s6 && /동아/.test(s6.subject)), s6);
  check('화면 7교시는 비워진다', s7 === null, s7);
}

console.log('\n■ 6교시에 원래 수업이 있던 교사');
{
  const op = { day:'수', cells: { 6: ['동아리활동'], 7: ['ㆍ'] } };
  const byTeacher = TT.ttTeacherDay(op, '수');
  const base6 = classSchedule['1-1']['수'].find(x => x.period === 6);   // 김수학 6교시 수학
  const s6 = TT.ttMaskTeacherSlot(op, base6, byTeacher['김수학'] && byTeacher['김수학'][6], '수', 6);
  check('원래 수업은 동아리로 덮인다', s6 && /동아/.test(s6.subject), s6);
}

console.log('\n■ 요일 대체 (다른 요일에서 당겨오는 경우) — 원래 되던 것');
{
  const op = { day:'수', cells: { 3: ['월3'] } };
  const byTeacher = TT.ttTeacherDay(op, '수');
  check('당겨온 교사가 잡힌다', !!(byTeacher['이국어'] && byTeacher['이국어'][3]), byTeacher);
  check('치환 표시가 붙는다', byTeacher['이국어'][3]._sub === true, byTeacher['이국어'][3]);
  check('출처 요일이 남는다', byTeacher['이국어'][3]._src === '월', byTeacher['이국어'][3]);
}

console.log('\n■ 손대지 않은 날은 그대로 (운영표에 칸이 없으면 기초)');
{
  const op = { day:'수', cells: { 6: ['동아리활동'] } };
  const c = TT.ttResolveCellOp(op, classSchedule['1-1'], 1, '수', 7);
  check('칸이 없는 교시는 기초 그대로', c && c.subject === '동아' && !c.activity, c);

  const byTeacher = TT.ttTeacherDay(op, '수');
  const t = byTeacher['박동아'] && byTeacher['박동아'][7];
  check('그런 교시는 옮겨온 것으로 표시하지 않는다', !t || t._sub !== true, t);
}

console.log('\n■ 시험일·휴일');
{
  const exam = { day:'수', cells: { 1: ['지필'], 6: ['동아리활동'] } };
  check('시험일은 전 교시 빈칸',
        TT.ttResolveCellOp(exam, classSchedule['1-1'], 1, '수', 6) === null);
  const holi = { day:'수', cells: { 6: ['추석'] } };
  check('휴일 칸은 빈칸',
        TT.ttResolveCellOp(holi, classSchedule['1-1'], 1, '수', 6) === null);
}

console.log('\n■ 같은 함정이 또 남아 있지 않은지');
{
  // 교사별 배정 맵을 만드는 함수가 ttDayCross 로 '날 자체'를 걸러 버리면 이 버그가 다시 난다.
  // ttDayCross 는 다른 요일에서 당겨온 칸만 참이라, 같은 날 안에서 옮긴 창체를 못 본다.
  // (배지·안내 문구에서 쓰는 것은 정상이다 — 여기서 보는 건 맵을 만드는 두 함수뿐이다.)
  for (const f of ['ttTeacherDay', 'ttTeacherOp'])
    check(f + ' 이 ttDayCross 로 날을 거르지 않는다', !/ttDayCross/.test(grab(f)));
}

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
