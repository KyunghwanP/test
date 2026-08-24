// 학부모 인증(handleVerify)이 나눠 저장된 명렬에서 생년월일을 찾아내는지.
//
// 2026-08: 연락처 분리 작업으로 birth 가 students/main → studentsContact/main 으로
// 옮겨졌는데 consult-api 는 계속 students/main 의 s.birth 를 봤다. 언제나 '' 와
// 비교하게 되어 **모든 학부모가 NOT_FOUND** 였고, 학교에서 예약이 통째로 막혔다.
// upload.html 의 분리 로직과 워커의 조회를 이어 붙여 다시는 어긋나지 않게 한다.
import fs from 'node:fs';
import path from 'node:path';

const here   = import.meta.dirname;
const html   = fs.readFileSync(path.join(here, '..', 'upload.html'), 'utf8');
const worker = fs.readFileSync(path.join(here, 'consult-api.js'), 'utf8');

const grabHtml = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  return html.slice(m.index, html.indexOf('\n}\n', m.index) + 3);
};
const grabJs = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(worker);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = worker.indexOf('{', m.index), d = 0;
  for (let j = i; j < worker.length; j++) {
    if (worker[j] === '{') d++;
    else if (worker[j] === '}' && --d === 0) return worker.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};

// upload.html 쪽 — 실제 분리 로직
const KEEP = /const KEEP_CONTACT_IN_ROSTER = (true|false);/.exec(html)[1] === 'true';
const STU  = JSON.parse(/const STU_CONTACT_FIELDS   = (\[[^\]]*\]);/.exec(html)[1].replace(/'/g, '"'));
const mkSplit = keep => new Function('KEEP_CONTACT_IN_ROSTER', 'return ' + grabHtml('splitRoster'))(keep);

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// 워커 쪽 — 실제 handleVerify 를 떼어 와 바깥 의존만 스텁으로 물린다
function makeVerify(rosterDoc, contactDoc, consultDoc) {
  const src = grabJs('normBirth') + '\n' + grabJs('handleVerify') + '\nreturn handleVerify;';
  const fsGet = async (env, coll) =>
    coll === 'students'        ? { data: rosterDoc }
  : coll === 'studentsContact' ? { data: contactDoc }
  : coll === 'consultations'   ? { data: consultDoc }
  : { data: null };
  return new Function('fsGet', 'makeSession', 'mintCustomToken', 'publicSlots', 'mineView', 'findMine', src)(
    fsGet,
    async () => 'sess',
    async () => 'tok',
    () => [],
    () => null,
    () => null
  );
}

// ── 학교 자료를 흉내낸다 ─────────────────────────────────────────────
const 명렬 = [
  { grade:1, room:1, num:3,  name:'김도욱', birth:'2010-08-30', phone:'010-1111-1111' },
  { grade:1, room:1, num:4,  name:'이서연', birth:'2010-03-01' },
  { grade:2, room:5, num:12, name:'박지호', birth:'2009-12-25' },
  // 엑셀에서 점·슬래시로 들어오는 경우
  { grade:1, room:2, num:7,  name:'최민서', birth:'2010.7.5' }
];
const split = mkSplit(KEEP)(명렬, STU, ['grade', 'room', 'num']);
const consultDoc = { slots: [] };
const verify = makeVerify({ students: split.roster }, { students: split.contact }, consultDoc);
const ask = (grade, room, name, birth) => verify({}, { grade, room, name, birth });

console.log('\n■ 분리 저장이 실제로 birth 를 빼 갔는지 (전제 확인)');
{
  check('students/main 에는 birth 가 없다', split.roster.every(r => r.birth === undefined), split.roster[0]);
  check('studentsContact/main 에 birth 가 있다', split.contact[0].birth === '2010-08-30', split.contact[0]);
  check('짝을 찾을 식별자가 양쪽에 있다',
        split.contact.every(c => c.grade !== undefined && c.room !== undefined && c.num !== undefined));
}

console.log('\n■ 맞는 정보면 통과한다');
{
  const r = await ask('1', '1', '김도욱', '2010-08-30');
  check('성공', r.success === true, r);
  check('그 학생의 반으로 붙는다', r.classKey === '1-1', r);
}

console.log('\n■ 표기가 달라도 같은 날로 본다');
for (const [n, v] of [['2010.7.5', '2010-07-05'], ['한 자리 월·일', '2010-7-5']])
  check(n, (await ask('1', '2', '최민서', v)).success === true);

console.log('\n■ 틀리면 막는다');
{
  check('생년월일이 다르면',   (await ask('1','1','김도욱','2010-08-31')).error === 'NOT_FOUND');
  check('이름이 다르면',       (await ask('1','1','김도옥','2010-08-30')).error === 'NOT_FOUND');
  check('반이 다르면',         (await ask('1','2','김도욱','2010-08-30')).error === 'NOT_FOUND');
  check('학년이 다르면',       (await ask('2','1','김도욱','2010-08-30')).error === 'NOT_FOUND');
  check('빈 값이면',           (await ask('1','1','김도욱','')).error === 'MISSING_FIELDS');
  // 다른 학생의 생일로는 못 들어간다(이름만 맞고 생일이 남의 것)
  check('남의 생일로는 안 된다', (await ask('1','1','김도욱','2010-03-01')).error === 'NOT_FOUND');
}

console.log('\n■ 연락처 문서가 비어 있어도 조용히 실패한다(터지지 않는다)');
{
  const v2 = makeVerify({ students: split.roster }, null, consultDoc);
  const r  = await v2({}, { grade:'1', room:'1', name:'김도욱', birth:'2010-08-30' });
  check('NOT_FOUND 로 끝난다', r.error === 'NOT_FOUND', r);
}

console.log('\n■ 되돌림(KEEP_CONTACT_IN_ROSTER=true)에서도 통한다');
{
  const s2 = mkSplit(true)(명렬, STU, ['grade', 'room', 'num']);
  const v3 = makeVerify({ students: s2.roster }, { students: s2.contact }, consultDoc);
  check('명렬에 birth 가 남아 있는 경우',
        (await v3({}, { grade:'1', room:'1', name:'김도욱', birth:'2010-08-30' })).success === true);
}

console.log('\n■ 워커가 두 문서를 다 읽는지 (원문 확인)');
{
  check("studentsContact 를 읽는다", /fsGet\(env, 'studentsContact', 'main'\)/.test(worker));
  check('한 번에 같이 읽는다(왕복 안 늘림)', /Promise\.all\(\[\s*\n\s*fsGet\(env, 'students', 'main'\),/.test(worker));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
