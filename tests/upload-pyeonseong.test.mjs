// 편성표 업로드 파서 — 실제 편성표 파일로 검증한다.
//
// 이 업로드는 students/main 을 통째로 갈아치우고 되돌릴 수단이 없다(PITR 없음).
// 그래서 '돌아간다'가 아니라 '무엇이 저장되는지'를 값으로 확인한다.
import fs from 'node:fs';

const HTML = import.meta.dirname + '/../upload.html';
const XLSXFILE = process.env.PS_FILE
  || '/tmp/claude-0/-home-user-ynhs/6d75d3ff-7eaa-5fb8-9dbb-3fcab9344eea/scratchpad/pyeonseong.xlsx';
const html = fs.readFileSync(HTML, 'utf8');
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
// 한 줄 선언을 먼저 본다 — 여러 줄 패턴을 먼저 대면 다음 상수까지 삼킨다
const constOf = n =>
  new RegExp(`^const ${n} = [^\\n]*;[^\\n]*$`, 'm').exec(html)?.[0]
  ?? new RegExp(`^const ${n} = \\{[\\s\\S]*?\\n\\};`, 'm').exec(html)[0];

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

if (!fs.existsSync(XLSXFILE)) {
  console.log('⚠ 편성표 파일이 없어 건너뜁니다:', XLSXFILE);
  process.exit(0);
}

// SheetJS 는 upload.html 이 쓰는 그 버전(0.18.5)을 npm 에서 그대로 쓴다.
// cdnjs 는 이 환경에서 막혀 있어 브라우저로는 못 띄운다 — 파서는 DOM 을 안 쓰므로
// Node 에서 도는 게 더 빠르고 정확하다.
const XLSX = (await import('xlsx')).default;
const src = `
  ${constOf('PS_SHEETS')}
  ${constOf('PS_COLS')}
  ${grab('psBirth')}
  ${grab('psPhone')}
  ${grab('psFindCols')}
  ${grab('psParseSheet')}
  ${grab('psParseBook')}
  ${constOf('PS_FIELDS')}
  ${constOf('psKey')}
  ${grab('psMerge')}
  ${grab('psDiff')}
  ${constOf('PS_MIN_TOTAL')}
  ${grab('psBlockers')}
  export { psParseBook, psBirth, psPhone, psMerge, psDiff, psBlockers, psKey, PS_FIELDS };
`;
// data: 모듈은 'xlsx' 같은 이름을 못 찾는다 — 전역으로 주입한다(브라우저에서도 전역이다)
globalThis.XLSX = XLSX;
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const { psParseBook, psBirth, psPhone, psMerge, psDiff, psBlockers, psKey, PS_FIELDS } = mod;

const buf = fs.readFileSync(XLSXFILE);
const out = psParseBook(XLSX.read(buf, { type: 'buffer' }));

console.log('\n■ 파싱 결과');
check('시트 오류 없음', out.errors.length === 0, out.errors);
check('세 학년을 다 읽었다', out.sheets.length === 3, out.sheets);
check('1020명', out.rows.length === 1020, out.rows.length);
check('전출·자퇴 55명 제외', out.dropped.length === 55, out.dropped.length);
check('학년별 인원 343/322/355',
      JSON.stringify(out.sheets.map(s => s.count)) === '[343,322,355]', out.sheets.map(s => s.count));

console.log('\n■ 학부모 인증 — 여기가 틀리면 전교생이 못 들어온다');
{
  // 워커의 진짜 normBirth 를 그대로 가져와 돌린다
  const wsrc = fs.readFileSync(import.meta.dirname + '/../workers/consult-api.js', 'utf8');
  const nb = /function normBirth\(v\) \{[\s\S]*?\n\}/.exec(wsrc)[0];
  const { normBirth } = await import('data:text/javascript,' + encodeURIComponent(nb + '\nexport { normBirth };'));
  const bad = out.rows.filter(r => !r.birth || normBirth(r.birth) !== r.birth);
  check('1020명 전원 생년월일이 표준형', bad.length === 0, bad.slice(0,3));
  check('원본 끝점이 사라졌다', out.rows.every(r => !r.birth.includes('.')), 
        out.rows.filter(r => r.birth.includes('.')).slice(0,2));
  const sample = out.rows[0];
  check('형식이 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(sample.birth), sample.birth);
  // 수정 전이었다면 실패해야 한다 — 원본 그대로면 normBirth 가 표준화를 포기한다
  check('원본 그대로 넣었다면 인증이 깨졌을 것', normBirth('2010.08.30.') !== '2010-08-30');
}

console.log('\n■ 연락처 정리');
{
  const ok = v => v === '' || /^01\d{8,9}$/.test(v);
  check('모든 연락처가 형식에 맞거나 빈칸',
        out.rows.every(r => ok(r.phone) && ok(r.fatherPhone) && ok(r.motherPhone)),
        out.rows.filter(r => !(ok(r.phone) && ok(r.fatherPhone) && ok(r.motherPhone))).slice(0,3));
  const fixed = out.rows.filter(r => String(r._phoneRaw[0]).length === 10 && r.phone.length === 11);
  check('엑셀이 삼킨 앞 0 을 되살렸다 (3건)', fixed.length === 3, fixed.map(r => [r.name, r._phoneRaw[0], r.phone]));
  const blanked = out.rows.filter(r => ['없음','-'].includes(String(r._phoneRaw[1]).trim()) || ['없음','-'].includes(String(r._phoneRaw[2]).trim()));
  check("'없음'·'-' 은 빈칸이 됐다",
        blanked.every(r => (String(r._phoneRaw[1]).trim() === '없음' ? r.fatherPhone === '' : true)), blanked.slice(0,2));
  const two = out.rows.filter(r => String(r._phoneRaw[2]).includes('\n'));
  check('한 칸에 두 개면 앞의 것만', two.length === 0 || two.every(r => /^01\d{8,9}$/.test(r.motherPhone)),
        two.map(r => [r.name, r._phoneRaw[2], r.motherPhone]));
}

console.log('\n■ 키 (사진·상벌점·상담예약이 여기에 붙는다)');
{
  const keys = out.rows.map(r => `${r.grade}-${r.room}-${r.num}`);
  check('학년-반-번호 중복 없음', new Set(keys).size === keys.length,
        keys.filter((k,i) => keys.indexOf(k) !== i).slice(0,3));
  check('모두 숫자 문자열', out.rows.every(r => /^\d+$/.test(r.grade) && /^\d+$/.test(r.room) && /^\d+$/.test(r.num)));
  check('이름에 앞뒤 공백 없음', out.rows.every(r => r.name === r.name.trim()));
  check('번호를 재사용하지 않아 빈 번호가 있다', (() => {
    let gaps = 0;
    for (const g of ['1','2','3']) for (const rm of new Set(out.rows.filter(r=>r.grade===g).map(r=>r.room))) {
      const ns = out.rows.filter(r=>r.grade===g&&r.room===rm).map(r=>+r.num);
      if (Math.max(...ns) > ns.length) gaps++;
    }
    return gaps === 13;
  })());
}

console.log('\n■ 편성표에 없는 것은 건드리지 않는다');
check('동아리를 파싱하지 않는다', out.rows.every(r => !('club' in r)));
check('파서 본문에 club 이 없다',
      !grab('psParseSheet').includes('club') && !grab('psParseBook').includes('club'));
check('편성표 열 목록에 동아리가 없다', !constOf('PS_COLS').includes('동아리'));

console.log('\n■ 필드 단위 덮어쓰기 — 동아리가 살아남아야 한다');
{
  // 기존 명렬을 흉내낸다: 전원에게 동아리가 있고, 나중에 늘어날 필드도 하나 넣어 둔다
  const prev = out.rows.map(r => ({ ...r, club: '과학탐구부', someFutureField: 'x' }));
  const merged = psMerge(out.rows, prev);
  check('인원은 편성표 기준', merged.length === out.rows.length);
  check('동아리가 전원 보존됐다', merged.every(m => m.club === '과학탐구부'),
        merged.filter(m => m.club !== '과학탐구부').slice(0,2));
  check('편성표에 없는 미래 필드도 보존됐다', merged.every(m => m.someFutureField === 'x'));
  check('생년월일은 편성표 값으로 갈렸다', merged.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.birth)));

  // 새로 들어온 학생은 기존 값이 없다 — 동아리가 undefined 여도 터지면 안 된다
  const one = psMerge([out.rows[0]], []);
  check('기존 값이 없어도 동작한다', one.length === 1 && one[0].name === out.rows[0].name);
  check('없던 동아리를 만들어내지 않는다', !('club' in one[0]));
  // psMerge 는 화이트리스트다. 파서가 들고 다니는 내부 필드(_birthRaw 등)가
  // 여기서 걸러진다. 누가 {...r} 로 '정리'하면 그대로 DB 에 실려 간다.
  check('파서의 내부 필드는 저장 대상에서 빠진다',
        merged.every(m => !('_birthRaw' in m) && !('_phoneRaw' in m)),
        Object.keys(merged[0]));
  check('저장 필드는 PS_FIELDS + 기존 필드뿐',
        Object.keys(merged[0]).every(k => PS_FIELDS.includes(k) || k in prev[0]),
        Object.keys(merged[0]));
}

console.log('\n■ 대조 — 자리 주인이 바뀐 곳을 잡아내나');
{
  const prev = out.rows.map(r => ({ ...r }));
  check('똑같으면 전원 그대로', psDiff(out.rows, prev).same.length === out.rows.length);

  // 전출 자리에 다른 학생이 들어온 경우 (학년 초 재편성에서 실제로 생긴다)
  const swapped = prev.map(r => psKey(r) === psKey(out.rows[0]) ? { ...r, name: '다른학생' } : r);
  const d1 = psDiff(out.rows, swapped);
  check('자리 주인이 바뀌면 잡는다', d1.tookOver.length === 1, d1.tookOver);
  check('그 자리가 정확히 지목된다', d1.tookOver[0]?.to === out.rows[0].name, d1.tookOver[0]);

  // 반변경 — 사람은 같은데 자리가 옮겨짐
  const moved = prev.map(r => psKey(r) === psKey(out.rows[5]) ? { ...r, room: '99' } : r);
  const d2 = psDiff(out.rows, moved);
  check('반변경을 새 학생으로 오해하지 않는다',
        d2.reseated.length === 1 && d2.added.length === 0, { reseated: d2.reseated, added: d2.added.length });

  // 전입·전출
  const d3 = psDiff(out.rows, prev.slice(0, -2));
  check('새로 들어온 2명을 잡는다', d3.added.length === 2, d3.added.length);
  const d4 = psDiff(out.rows.slice(0, -3), prev);
  check('빠진 3명을 잡는다', d4.removed.length === 3, d4.removed.length);
}

console.log('\n■ 막는 조건 — 되돌릴 수 없으니 애매하면 막는다');
{
  const none = psBlockers({ errors: [], sheets: out.sheets }, out.rows);
  check('정상 파일은 안 막는다', none.length === 0, none);

  const few = psBlockers({ errors: [], sheets: out.sheets }, out.rows.slice(0, 500));
  check('인원이 확 줄면 막는다', few.some(m => m.includes('500명뿐')), few);

  const oneSheet = psBlockers({ errors: [], sheets: [out.sheets[0]] }, out.rows);
  check('학년 시트가 빠지면 막는다', oneSheet.some(m => m.includes('빠진 학년')), oneSheet);

  const dup = psBlockers({ errors: [], sheets: out.sheets }, [...out.rows, out.rows[0]]);
  check('학년-반-번호가 겹치면 막는다', dup.some(m => m.includes('겹칩니다')), dup);

  const badBirth = psBlockers({ errors: [], sheets: out.sheets },
    out.rows.map((r, i) => i === 3 ? { ...r, birth: '2010.08.30.' } : r));
  check('생년월일을 못 읽으면 막는다', badBirth.some(m => m.includes('학부모 인증')), badBirth);

  const err = psBlockers({ errors: ["'2학년' 시트가 없습니다"], sheets: out.sheets }, out.rows);
  check('파싱 오류를 그대로 올린다', err.some(m => m.includes('2학년')), err);
}

console.log('\n■ 화면 배선');
{
  const ids = [...html.matchAll(/getElementById\('(ps[A-Za-z]+)'\)/g)].map(m => m[1]);
  const inMarkup = new Set([...html.matchAll(/\sid="([A-Za-z0-9_]+)"/g)].map(m => m[1]));
  const missing = [...new Set(ids)].filter(i => !inMarkup.has(i));
  check(`편성표 화면이 부르는 id ${new Set(ids).size}개가 다 있다`, missing.length === 0, missing);
  check('탭 버튼과 탭 본문이 짝을 이룬다',
        /data-tab="pyeonseong"/.test(html) && /id="tab-pyeonseong"/.test(html));

  // 저장 경로가 학생연락망과 같은 함수를 쓰는가 — 연락처 분리 규칙이 갈리면 안 된다
  check('저장은 saveSplit 을 통한다',
        /psSaveBtn[\s\S]{0,1500}saveSplit\('students', 'students', 'studentsContact'/.test(html));
  check('저장 직전에 psMerge 를 거친다',
        /psSaveBtn[\s\S]{0,1200}psMerge\(psRows, psPrev\)/.test(html));
  check('막는 조건을 저장 직전에 다시 본다',
        /psSaveBtn[\s\S]{0,400}psBlockers\(psParsed, psRows\)/.test(html));
  check('백업 전에는 저장 못 한다',
        /btn\.disabled = !\(ok && psBackedUp\)/.test(html));
  check('취소하면 상태가 비워진다', /psClearBtn[\s\S]{0,300}psRows = psParsed = null/.test(html));
  check('화면에 넣는 값은 이스케이프한다', /const psEsc = /.test(html)
        && !/psDiffBox'\)\.innerHTML[\s\S]{0,600}\$\{x\.name\}/.test(html));
}

console.log('\n■ 기존 탭을 건드리지 않았다');
{
  check('학생연락망 업로드는 그대로 동아리(I열)를 읽는다',
        /club:\s*String\(r\[8\]\|\|''\)\.trim\(\)/.test(html));
  check('학생연락망 탭이 남아 있다', /data-tab="students"/.test(html));
  check('동아리 탭이 남아 있다', /data-tab="clubs"/.test(html));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
