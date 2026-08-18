// upload.html 이 나눠 저장한 문서를 teacher-api 가 그대로 찾아낼 수 있는지.
// 두 파일은 서로 다른 곳에 있어서 필드 이름이 어긋나도 조용히 통과하기 쉽다.
// 여기서 '업로드가 만든 결과 → 워커 조회'를 이어 붙여 확인한다.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'upload.html'), 'utf8');

// upload.html 에서 분리 로직만 떼어낸다(중복 정의하면 원본이 바뀌어도 통과해버린다).
function grab(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(html);
  if (!m) throw new Error('못 찾음: ' + name);
  const end = html.indexOf('\n}\n', m.index) + 3;
  return html.slice(m.index, end);
}
const KEEP = /const KEEP_CONTACT_IN_ROSTER = (true|false);/.exec(html)[1] === 'true';
const STU   = JSON.parse(/const STU_CONTACT_FIELDS   = (\[[^\]]*\]);/.exec(html)[1].replace(/'/g, '"'));
const STAFF = JSON.parse(/const STAFF_CONTACT_FIELDS = (\[[^\]]*\]);/.exec(html)[1].replace(/'/g, '"'));
// 함수 안에서 KEEP_CONTACT_IN_ROSTER 를 참조하므로 같이 넣어준다.
const mkSplit = keep => new Function('KEEP_CONTACT_IN_ROSTER',
                                     'return ' + grab('splitRoster'))(keep);
const splitRoster = mkSplit(KEEP);
// 전환이 끝난 뒤(플래그 false) 상태도 지금 확인해 둔다. 그때 가서 깨지면 늦다.
const splitFinal = mkSplit(false);

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x) : ''));

// teacher-api 의 조회 규칙을 그대로 옮긴 것 (worker 쪽과 같아야 한다)
const sameNum = (a, b) => String(a ?? '').trim() !== '' && parseInt(a, 10) === parseInt(b, 10);
const findStudent = (list, g, r, n) =>
  list.find(x => x && sameNum(x.grade, g) && sameNum(x.room, r) && sameNum(x.num, n));
function findStaff(list, i, name) {
  let c = Number.isInteger(i) && list[i];
  if (!c || (name && String(c.name || '').trim() !== name)) {
    const hits = list.filter(x => x && String(x.name || '').trim() === name);
    c = hits.length === 1 ? hits[0] : null;
  }
  return c || null;
}

const STUDENTS = [
  { grade:1, room:3, num:7,  name:'김학생', club:'과학탐구부', birth:'2009-04-01',
    phone:'010-1111-1111', fatherPhone:'010-2222-2222', motherPhone:'010-3333-3333' },
  { grade:1, room:3, num:8,  name:'이학생', club:'', birth:'2009-05-02', phone:'', fatherPhone:'', motherPhone:'010-5555-5555' },
  { grade:2, room:1, num:12, name:'박학생' }                                  // 연락처 없음
];
const STAFF_LIST = [
  { name:'김교사', dept:'교무기획부', subject:'수학', role:'부장', ext:'1201', phone:'010-8888-8888' },
  { name:'최교사', dept:'2학년부', ext:'1302', phone:'010-1010-1010' },
  { name:'최교사', dept:'3학년부', ext:'1303', phone:'010-2020-2020' },       // 동명이인
  { name:'행정실', dept:'행정실', ext:'1401' }                                 // 번호 없음
];

console.log('\n■ 학생 — 명렬과 연락처가 제대로 갈라지는가');
const st = splitRoster(STUDENTS, STU, ['grade','room','num']);
{
  check('인원수가 같다', st.roster.length === 3 && st.contact.length === 3);
  const rosterJson = JSON.stringify(st.roster);
  console.log(`     (KEEP_CONTACT_IN_ROSTER=${KEEP})`);
  if (KEEP) check('전환 중에는 명렬에도 번호가 남는다(운영이 아직 옛 코드)',
                  rosterJson.includes('010-1111-1111'));
  check('명렬에 이름·학반은 남는다', st.roster[0].name === '김학생' && st.roster[0].grade === 1);
  check('명렬에 동아리도 남는다', st.roster[0].club === '과학탐구부');
  check('연락처에 이름은 안 들어간다', !JSON.stringify(st.contact).includes('김학생'), st.contact[0]);
  check('연락처에 학년·반·번호는 들어간다',
        st.contact[0].grade === 1 && st.contact[0].room === 3 && st.contact[0].num === 7, st.contact[0]);
  check('빈 값은 안 담는다', !('phone' in st.contact[1]) && st.contact[1].motherPhone === '010-5555-5555', st.contact[1]);
  check('연락처가 아예 없는 학생도 자리는 있다', st.contact[2].grade === 2 && st.contact[2].num === 12, st.contact[2]);
}

console.log('\n■ 학생 — 워커가 그 문서에서 찾아내는가');
{
  const a = findStudent(st.contact, 1, 3, 7);
  check('1-3-7 을 찾는다', a && a.phone === '010-1111-1111', a);
  check('부·모 번호도 함께', a.fatherPhone === '010-2222-2222' && a.motherPhone === '010-3333-3333');
  check('생년월일도 함께', a.birth === '2009-04-01');
  const b = findStudent(st.contact, 1, 3, 8);
  check('1-3-8 을 찾는다(번호 일부만 있어도)', b && b.motherPhone === '010-5555-5555' && !b.phone, b);
  check('없는 학생은 못 찾는다', !findStudent(st.contact, 9, 9, 9));
  check('다른 반의 같은 번호와 헷갈리지 않는다', findStudent(st.contact, 2, 1, 12).num === 12);
}

console.log('\n■ 교원 — 명렬과 연락처가 제대로 갈라지는가');
const sf = splitRoster(STAFF_LIST, STAFF, ['name','dept']);
{
  check('내선은 명렬에 남는다(개인 번호가 아님)', sf.roster[0].ext === '1201');
  check('부서·과목·직위 남는다', sf.roster[0].dept === '교무기획부' && sf.roster[0].role === '부장');
  check('번호 있는 사람은 hasPhone true', sf.roster[0].hasPhone === true);
  check('번호 없는 사람은 hasPhone false', sf.roster[3].hasPhone === false, sf.roster[3]);
  check('연락처는 명렬과 길이·순서가 같다',
        sf.contact.length === sf.roster.length &&
        sf.contact.every((c, i) => c.name === sf.roster[i].name), sf.contact);
}

console.log('\n■ 교원 — 워커가 그 문서에서 찾아내는가');
{
  check('인덱스+이름으로 찾는다', findStaff(sf.contact, 0, '김교사').phone === '010-8888-8888');
  check('동명이인도 인덱스가 맞으면 정확히', findStaff(sf.contact, 2, '최교사').phone === '010-2020-2020');
  check('인덱스가 밀려도 이름이 유일하면 복구', findStaff(sf.contact, 3, '김교사').phone === '010-8888-8888');
  check('동명이인 + 인덱스 어긋남은 거부', findStaff(sf.contact, 99, '최교사') === null);
  check('번호 없는 사람은 phone 이 없다', !findStaff(sf.contact, 3, '행정실').phone);
}

console.log('\n■ 전환 완료 후(플래그 false) — 명렬에서 연락처가 사라지는가');
{
  const s2 = splitFinal(STUDENTS, STU, ['grade','room','num']);
  const j2 = JSON.stringify(s2.roster);
  check('학생 명렬에 전화번호가 없다', !/010-\d{4}-\d{4}/.test(j2), j2);
  check('학생 명렬에 생년월일이 없다', !j2.includes('2009-04-01'), j2);
  check('그래도 이름·학반·동아리는 남는다',
        s2.roster[0].name === '김학생' && s2.roster[0].club === '과학탐구부');
  const f2 = splitFinal(STAFF_LIST, STAFF, ['name','dept']);
  const k2 = JSON.stringify(f2.roster);
  check('교원 명렬에 휴대폰이 없다', !/010-\d{4}-\d{4}/.test(k2), k2);
  check('내선·부서는 남는다', f2.roster[0].ext === '1201' && f2.roster[0].dept === '교무기획부');
  check('hasPhone 표시는 그대로', f2.roster[0].hasPhone === true && f2.roster[3].hasPhone === false);
  check('연락처 문서는 플래그와 무관하게 같다',
        JSON.stringify(s2.contact) === JSON.stringify(st.contact));
}

console.log(`\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
