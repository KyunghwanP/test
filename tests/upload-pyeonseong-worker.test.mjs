// 편성표 업로드가 Cloudflare 워커를 깨뜨리지 않는지.
//
// 워커 두 개가 명렬에 얹혀 있다.
//   consult-api  — 학부모가 학년·반·이름·생년월일로 인증하고, 학년-반 으로 예약을 찾는다
//   teacher-api  — 사진을 photos/{학년학년}-{반반}/{번호}.jpg 로 찾는다 (이름은 안 본다)
// 업로드는 되돌릴 수 없으므로 '저장될 값'으로 두 워커를 미리 돌려 본다.
// 워커 쪽 판정식은 소스에서 그대로 떼어 온다 — 베끼면 언젠가 갈라진다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here   = import.meta.dirname;
const html   = fs.readFileSync(path.join(here, '..', 'upload.html'), 'utf8');
const worker = fs.readFileSync(path.join(here, '..', 'workers', 'consult-api.js'), 'utf8');
const tworker= fs.readFileSync(path.join(here, '..', 'workers', 'teacher-api.js'), 'utf8');
const parent = fs.readFileSync(path.join(here, '..', 'parent.html'), 'utf8');

const XLSXFILE = process.env.PS_FILE
  || '/tmp/claude-0/-home-user-ynhs/6d75d3ff-7eaa-5fb8-9dbb-3fcab9344eea/scratchpad/pyeonseong.xlsx';

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0,400) : ''));

if (!fs.existsSync(XLSXFILE)) {
  console.log('⚠ 편성표 파일이 없어 건너뜁니다:', XLSXFILE);
  process.exit(0);
}

const brace = (src, from) => {
  let i = src.indexOf('{', from), d = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return j + 1;
  }
  throw new Error('닫는 괄호 못 찾음');
};
const grab = (src, name) => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(src);
  if (!m) throw new Error('못 찾음: ' + name);
  return src.slice(m.index, brace(src, m.index));
};
const constOf = (src, n) =>
  new RegExp(`^const ${n}\\s*=\\s*[^\\n]*;[^\\n]*$`, 'm').exec(src)?.[0]
  ?? new RegExp(`^const ${n}\\s*=\\s*\\{[\\s\\S]*?\\n\\};`, 'm').exec(src)[0];

// ── upload.html 쪽: 편성표 → 저장될 두 문서 ──
const XLSX = createRequire(path.join(here, '..', 'package.json'))('xlsx');
globalThis.XLSX = XLSX;
const up = await import('data:text/javascript,' + encodeURIComponent([
  constOf(html,'PS_SHEETS'), constOf(html,'PS_COLS'),
  grab(html,'psBirth'), grab(html,'psPhone'), grab(html,'psFindCols'),
  grab(html,'psParseSheet'), grab(html,'psParseBook'),
  constOf(html,'PS_FIELDS'), constOf(html,'PS_KEEP_IF_BLANK'), constOf(html,'psKey'),
  grab(html,'psMerge'), grab(html,'splitRoster'),
  constOf(html,'STU_CONTACT_FIELDS'), constOf(html,'KEEP_CONTACT_IN_ROSTER'),
  'export { psParseBook, psMerge, psKey, splitRoster, STU_CONTACT_FIELDS };',
].join('\n')));

// ── consult-api 쪽: 진짜 normBirth + handleVerify 의 판정식 그대로 ──
const verifySrc = (() => {
  const h = grab(worker, 'handleVerify');
  const a = h.indexOf('const rowKey = s =>');
  const b = h.indexOf('if (!hit)');
  if (a < 0 || b < 0) throw new Error('handleVerify 모양이 바뀌었습니다 — 이 테스트를 손봐야 합니다');
  return h.slice(a, b);
})();
const cw = await import('data:text/javascript,' + encodeURIComponent(`
  ${grab(worker, 'normBirth')}
  export function verify(roster, contact, { grade, room, name, birth }) {
    ${verifySrc}
    return hit || null;
  }
  export { normBirth };
`));

const { rows } = up.psParseBook(XLSX.read(fs.readFileSync(XLSXFILE), { type: 'buffer' }));

// 기존 DB 를 흉내낸다: 전원 동아리 있음, 연락처는 분리 저장, 한 명은 반이 바뀐다
const prevRows = rows.map((r, i) => ({ ...r, club: '과학탐구부' }));
prevRows[0] = { ...prevRows[0], room: '11', num: '99' };
const prevFull = prevRows.map(r => { const o = { ...r }; delete o._birthRaw; delete o._phoneRaw; return o; });

const merged = up.psMerge(rows, prevFull);
const { roster, contact } = up.splitRoster(merged, up.STU_CONTACT_FIELDS, ['grade', 'room', 'num']);

console.log('\n■ consult-api — 학부모 인증');
{
  const bad = rows.filter(r => !cw.verify(roster, contact, r));
  check(`${rows.length}명 전원이 인증된다`, bad.length === 0,
        bad.slice(0, 3).map(r => ({ name: r.name, key: `${r.grade}-${r.room}-${r.num}`, birth: r.birth })));

  // 학부모 화면은 <input type="date"> 라 언제나 YYYY-MM-DD 로 온다.
  // 워커의 normBirth 는 끝점이 붙은 '2010.08.30.' 을 표준화하지 못하므로,
  // 그 형태가 DB 에 들어가지 않게 막는 것이 이쪽 안전장치다(psBirth + psBlockers).
  const s = rows[0];
  check('학부모 입력은 date 위젯이라 형식이 하나뿐',
        /id="inBirth"[^>]*type="date"/.test(parent), /<input id="inBirth"[^>]*>/.exec(parent)?.[0]);
  for (const [label, b] of [['하이픈', s.birth],
                            ['점',     s.birth.replace(/-/g, '.')],
                            ['슬래시', s.birth.replace(/-/g, '/')]])
    check(`생년월일을 '${label}' 로 쳐도 통과`, !!cw.verify(roster, contact, { ...s, birth: b }), b);
  check('끝점이 붙은 형태는 워커가 표준화하지 못한다 — 그래서 저장 전에 막는다',
        cw.normBirth('2010.08.30.') !== '2010-08-30');

  check('학년·반이 다르면 안 된다', !cw.verify(roster, contact, { ...s, room: String(+s.room + 1) }));
  check('생년월일이 다르면 안 된다', !cw.verify(roster, contact, { ...s, birth: '1900-01-01' }));
  check('이름이 다르면 안 된다',   !cw.verify(roster, contact, { ...s, name: s.name + '가' }));

  // 예약 문서는 학년-반 하나로 잡힌다. 반이 그대로면 예약도 그대로다.
  const classKey = x => `${parseInt(x.grade)}-${parseInt(x.room)}`;
  const moved = rows.filter((r, i) => classKey(r) !== classKey(prevFull[i]));
  check('반이 그대로인 학생은 예약 학급도 그대로', moved.length === 1, moved.map(m => m.name));
  const hit = cw.verify(roster, contact, rows[0]);
  check('반이 바뀐 학생은 새 학급으로 붙는다', hit && classKey(hit) === classKey(rows[0]),
        { was: classKey(prevFull[0]), now: hit && classKey(hit) });
}

console.log('\n■ teacher-api — 사진');
{
  const pk = await import('data:text/javascript,' + encodeURIComponent(
    grab(tworker, 'photoKey') + '\nexport { photoKey };'));
  // photoKey 는 정수로 다시 조립한다(0 을 안 채운다). 앞자리 0 을 기대하면 안 된다.
  const KEY = /^photos\/\d-\d{1,2}\/\d{1,2}\.jpg$/;
  const keys = roster.map(s => pk.photoKey(s.grade, s.room, s.num));
  check('전원 사진 키가 만들어진다', keys.every(k => k && KEY.test(k)),
        keys.filter(k => !k || !KEY.test(k)).slice(0, 3));
  check('사진 키가 겹치지 않는다', new Set(keys).size === keys.length);

  // 사진은 이름을 안 본다. 자리가 그대로면 그대로 뜨고, 바뀐 자리만 다시 올리면 된다.
  const before = new Map(prevFull.map(s => [pk.photoKey(s.grade, s.room, s.num), s.name]));
  const wrongFace = roster.filter(s => {
    const k = pk.photoKey(s.grade, s.room, s.num);
    return before.has(k) && before.get(k) !== s.name;
  });
  check('남의 얼굴이 붙는 자리는 없다', wrongFace.length === 0,
        wrongFace.slice(0, 3).map(s => ({ key: pk.photoKey(s.grade, s.room, s.num), now: s.name })));
  const noPhoto = roster.filter(s => !before.has(pk.photoKey(s.grade, s.room, s.num)));
  check('사진이 빠지는 건 자리가 바뀐 학생뿐', noPhoto.length === 1, noPhoto.map(s => s.name));
}

console.log('\n■ 워커가 읽는 필드가 저장된 문서에 실제로 있다');
{
  check('명렬에 grade·room·num·name 이 있다',
        roster.every(s => s.grade && s.room && s.num && s.name), roster.filter(s => !s.name).slice(0,2));
  check('연락처 문서에 grade·room·num 이 있다',
        contact.every(c => c.grade && c.room && c.num), contact.filter(c => !c.grade).slice(0,2));
  check('연락처 문서에 birth 가 있다', contact.every(c => c.birth), contact.filter(c => !c.birth).slice(0,2));
  check('birth 가 워커의 normBirth 를 그대로 통과한다',
        contact.every(c => cw.normBirth(c.birth) === c.birth),
        contact.filter(c => cw.normBirth(c.birth) !== c.birth).slice(0,3));
  // 워커는 두 배열을 학년-반-번호로 맞춘다. 한쪽에만 있는 자리가 있으면 못 찾는다.
  const rk = x => `${parseInt(x.grade)}-${parseInt(x.room)}-${parseInt(x.num)}`;
  const ck = new Set(contact.map(rk));
  check('명렬의 모든 자리가 연락처 문서에도 있다',
        roster.every(s => ck.has(rk(s))), roster.filter(s => !ck.has(rk(s))).slice(0,3));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
