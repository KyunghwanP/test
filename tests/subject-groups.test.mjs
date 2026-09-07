// 시간표의 교과 묶음(SUBJECT_GROUPS)을 교원 연락망의 '담당과목'에서 만든다.
//
// 예전에는 과목마다 교사 이름을 코드에 나열해 두었다. 인사이동 때마다 배포를 해야
// 했고, 명렬에 없는 새 선생님은 교과에 안 묶여 목록 끝에 낱개로 남았다.
// 연락망 업로드(upload.html)가 이미 A:이름 B:담당부서 C:담당과목 을 받아
// contacts/main 에 {name, dept, subject, …} 로 넣고 있으므로 그것을 쓴다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

// 원본에서 그대로 떼어 온다 — 베껴 적으면 원본이 바뀌어도 통과해 버린다
const grab = (name) => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};
const grabSeed = () => {
  const a = HTML.indexOf('const SUBJECT_GROUPS_SEED = [');
  return HTML.slice(a, HTML.indexOf('\n];', a) + 3);
};

console.log('\n■ 배선 (정적)');
check('밑그림은 SEED 로 두고 실제 묶음은 바꿀 수 있다',
      /const SUBJECT_GROUPS_SEED = \[/.test(HTML) && /let SUBJECT_GROUPS = SUBJECT_GROUPS_SEED;/.test(HTML));
check('시작할 때 연락망을 같이 받아 온다',
      /getDoc\(doc\(fbDb, 'contacts', 'main'\)\)[\s\S]{0,300}applySubjectGroups/.test(HTML));
check('시간표를 보고 있으면 그 자리에서 다시 그린다',
      /applySubjectGroups\(s\.data\(\)\.staff\)\) return;[\s\S]{0,260}reRenderTimetable/.test(HTML));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));

await pg.setContent(`<!doctype html><meta charset="utf-8"><script>
  ${grabSeed()}
  let SUBJECT_GROUPS = SUBJECT_GROUPS_SEED;
  const GROUPED_NAME_SET = new Set(SUBJECT_GROUPS.flatMap(g=>g.teachers));
  const TEACHER_TO_SUBJECT = {};
  SUBJECT_GROUPS.forEach(g=> g.teachers.forEach(n => { TEACHER_TO_SUBJECT[n] = g.subject; }));
  let TEACHERS = [];
  const UNGROUPED_NAMES = [];
  const ORDERED_TEACHER_NAMES = [];
  ${grab('subjectGroupsFromStaff')}
  ${grab('applySubjectGroups')}
  window.setTeachers = names => { TEACHERS = names.map(n => ({ name: n })); };
  window.apply = staff => applySubjectGroups(staff);
  window.groups = () => SUBJECT_GROUPS;
  window.subjectOf = n => TEACHER_TO_SUBJECT[n];
  window.ordered = () => ORDERED_TEACHER_NAMES.slice();
  window.ungrouped = () => UNGROUPED_NAMES.slice();
  window.seed = () => SUBJECT_GROUPS_SEED;
</script>`);

console.log('\n■ 연락망에서 묶음을 만든다');
{
  // 실제 연락망 규모를 흉내낸다 — 너무 적으면 '부실한 파일'로 보고 갈아 끼우지 않는다
  const staff = [
    { name: '이윤정', dept: '교무기획부', subject: '국어' },   // 새로 온 분
    { name: '전진송', dept: '1학년부',   subject: '영어' },   // 새로 온 분
    { name: '최영수', dept: '교무기획부', subject: '국어' },
    { name: '이인태', dept: '2학년부',   subject: '국어' },
    { name: '정승호', dept: '연구부',     subject: '수학' },
    { name: '김종욱', dept: '3학년부',   subject: '수학' },
    { name: '정훈철', dept: '1학년부',   subject: '영어' },
    { name: '김희재', dept: '교무기획부', subject: '음악' },
    { name: '양영주', dept: '교무기획부', subject: '미술' },
    { name: '김영순', dept: '체육부',     subject: '체육' },
    { name: '이소영', dept: '교무기획부', subject: '한문' },
    { name: '한동석', dept: '행정실',     subject: '' },       // 담당과목 없음
    { name: '오세림', dept: '교무기획부', subject: '스페인어' }, // 밑그림에 없는 과목
  ];
  await pg.evaluate(s => { window.setTeachers(s.map(x => x.name)); }, staff);
  const ok = await pg.evaluate(s => window.apply(s), staff);
  check('자료가 충분하면 갈아 끼운다', ok === true);

  const groups = await pg.evaluate(() => window.groups());
  check('새로 온 이윤정이 국어에 들어간다',
        groups.find(g => g.subject === '국어')?.teachers.includes('이윤정'), groups[0]);
  check('전진송이 영어에 들어간다',
        groups.find(g => g.subject === '영어')?.teachers.includes('전진송'));
  check('교사 → 과목도 같이 바뀐다', (await pg.evaluate(() => window.subjectOf('전진송'))) === '영어');

  // 과목 나열 순서는 밑그림을 따른다 — 업로드 순서대로 두면 화면이 매번 달라진다
  const names = groups.map(g => g.subject);
  check('과목 순서는 밑그림을 따른다(국어 → 수학 → 영어 → 음악)',
        names.slice(0, 4).join() === '국어,수학,영어,음악', names);
  check('밑그림에 없는 과목은 뒤에 붙는다', names[names.length - 1] === '스페인어', names);

  check('담당과목이 빈 사람은 묶이지 않는다', !names.includes(''), names);
  check('그 사람도 전체 목록에는 남는다',
        (await pg.evaluate(() => window.ungrouped())).includes('한동석'),
        await pg.evaluate(() => window.ungrouped()));
  check('전체 목록은 묶인 사람 다음에 안 묶인 사람',
        (await pg.evaluate(() => window.ordered())).at(-1) === '한동석',
        await pg.evaluate(() => window.ordered()));
}

console.log('\n■ 잘못 올린 파일 하나로 무너지지 않는다');
{
  const before = await pg.evaluate(() => window.groups().length);
  for (const [label, staff] of [
    ['빈 배열',            []],
    ['null',               null],
    ['이름만 있고 과목 없음', [{ name: '김하나' }, { name: '이두리' }]],
    ['과목이 두엇뿐',        [{ name: '김하나', subject: '국어' }, { name: '이두리', subject: '수학' }]],
  ]) {
    const ok = await pg.evaluate(s => window.apply(s), staff);
    check(`${label} → 갈아 끼우지 않는다`, ok === false);
  }
  check('그동안 쓰던 묶음이 그대로다', (await pg.evaluate(() => window.groups().length)) === before);
}

console.log('\n■ 밑그림은 그대로 남는다 (연락망이 없을 때 쓸 것)');
check('SEED 는 안 바뀐다', (await pg.evaluate(() => window.seed().length)) > 10);

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
