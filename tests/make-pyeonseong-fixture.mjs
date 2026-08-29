// 편성표 검사용 대체 파일 만들기.
//
// 진짜 편성표는 학생 개인정보라 저장소에 못 둔다. 그렇다고 파일이 없으면 검사가
// 통째로 건너뛰어져 아무도 안 돌리게 된다. 그래서 검사들이 확인하는 '지문'
// (1020명 / 전출·자퇴 55 / 학년별 343·322·355 / 엑셀이 삼킨 앞 0 3건 / 번호 구멍 13반)
// 을 그대로 재현한 가짜 파일을 만든다. 이름·번호·생일은 전부 지어낸 값이다.
//
//   node tests/make-pyeonseong-fixture.mjs [출력폴더]        (기본: /tmp)
//   PS_FILE=<폴더>/pyeonseong.xlsx node tests/upload-pyeonseong.test.mjs
//
// 화면 검사는 기존 DB 를 흉내낸 prev-students.json · prev-contact.json 도 쓴다.
// 여기서 같이 만든다 — 한 명은 반이 바뀐 학생이고, 편성표에 연락처가 빈 학생은
// DB 에만 번호가 있다. 둘 다 '조용히 사라지면 안 되는' 경우다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = import.meta.dirname;
const OUT  = process.argv[2] || '/tmp';
const XLSX = createRequire(path.join(here, '..', 'package.json'))('xlsx');

// 신원 열 — 여기까지가 명렬. 마지막 '주소' 가 '여기부터 과목' 을 알리는 칸막이다.
const HEAD   = ['연번','신반','신번호','성명','생년월일','연락처(본인)','연락처(부)','연락처(모)','주소'];
const GRADES = [[1,343],[2,322],[3,355]];
const DROP   = [18, 18, 19];        // 합 55 — 신반·신번호가 빈 줄(실제 파일에선 빨간 음영)
const ROOMS  = 11;

// 주소 뒤의 과목 열. '단위수' 로 이번학년 블록이 끝나고, 빈 열 하나 뒤가 직전학년이다.
// 1학년은 직전학년이 없다 — 그래도 형태는 같다.
const SUBJ = {
  1: { now: ['통합과학','통합사회','정보','한문Ⅰ'],              prev: [] },
  2: { now: ['물리학Ⅰ','화학Ⅰ','생명과학Ⅰ','지구과학Ⅰ'],        prev: ['통합과학','통합사회','정보'] },
  3: { now: ['물리학Ⅱ','화학Ⅱ','생명과학Ⅱ'],                    prev: ['물리학Ⅰ','화학Ⅰ','생명과학Ⅰ','지구과학Ⅰ'] },
};

let seq = 0, gapRooms = 0, zeroFix = 0, sciN = 0;
const pad = n => String(n).padStart(4, '0');
const wb  = XLSX.utils.book_new();

for (const [gi, [grade, total]] of GRADES.entries()) {
  const per = Array(ROOMS).fill(Math.floor(total / ROOMS));
  for (let i = 0; i < total % ROOMS; i++) per[i]++;
  const s = SUBJ[grade];
  // 주소 ‖ 이번학년 과목… | 단위수 | (빈 열) | 직전학년 과목… | 비고
  const head = [...HEAD, ...s.now, '단위수', '', ...s.prev, '비고'];
  const aoa  = [['2026학년도 편성표'], [], head];

  for (let room = 1; room <= ROOMS; room++) {
    // 번호를 재사용하지 않는 반 — 마지막 번호가 인원보다 크다
    const gap = gapRooms < 13 ? (gapRooms++, true) : false;
    let num = 0;
    for (let i = 0; i < per[room - 1]; i++) {
      num += (gap && i === 1) ? 2 : 1;
      seq++;
      const y = 2026 - grade - 15;
      // 진짜 파일처럼 끝점이 붙은 형태 — 이대로 저장되면 학부모 인증이 깨진다
      const birth = `${y}.${String((seq % 12) + 1).padStart(2,'0')}.${String((seq % 28) + 1).padStart(2,'0')}.`;
      let phone = '010' + pad(seq).padEnd(8, '0');
      if (zeroFix < 3 && seq % 137 === 0) { zeroFix++; phone = Number(phone.slice(1)); }  // 엑셀이 앞 0 을 삼킴
      if (seq % 53 === 0) phone = '';                                                     // 편성표에 본인 번호가 빔
      const father = seq % 40 === 0 ? '없음' : '010' + pad(seq + 1000).padEnd(8, '0');
      const mother = seq % 61 === 0 ? '-'    : '010' + pad(seq + 2000).padEnd(8, '0');
      // 주소는 파서가 값을 읽지 않는다(칸막이로만 쓴다). 그래도 실제처럼 채워 둔다.
      const addr = `대구광역시 ○○구 ○○로 ${100 + (seq % 400)}`;
      const mark = (list, off) => list.map((_, k) => ((seq + k + off) % 3 === 0) ? 'O' : '');
      const sci  = seq % 44 === 0; if (sci) sciN++;
      aoa.push([seq, room, num, `학생${pad(seq)}`, birth, phone, father, mother, addr,
                ...mark(s.now, 0), '', '', ...mark(s.prev, 1), sci ? '과학중점' : '']);
    }
  }
  for (let i = 0; i < DROP[gi]; i++) aoa.push(['', '', '', `전출${grade}_${i}`]);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `${grade}학년`);
}
const xlsxPath = path.join(OUT, 'pyeonseong.xlsx');
XLSX.writeFile(wb, xlsxPath);

// ── 기존 DB 흉내 (화면 검사용) ──
const html = fs.readFileSync(path.join(here, '..', 'upload.html'), 'utf8');
const brace = (src, from) => { let i = src.indexOf('{', from), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) return j + 1; } };
const grab = n => { const m = new RegExp(`^function ${n}\\(`, 'm').exec(html); return html.slice(m.index, brace(html, m.index)); };
const constOf = n => new RegExp(`^const ${n}\\s*=\\s*[^\\n]*;[^\\n]*$`, 'm').exec(html)?.[0]
  ?? new RegExp(`^const ${n}\\s*=\\s*\\{[\\s\\S]*?\\n\\};`, 'm').exec(html)[0];
globalThis.XLSX = XLSX;
const { psParseBook } = await import('data:text/javascript,' + encodeURIComponent([
  constOf('PS_SHEETS'), constOf('PS_COLS'), grab('psBirth'), grab('psPhone'),
  grab('psFindCols'), grab('psParseSheet'), grab('psParseBook'), 'export { psParseBook };',
].join('\n')));

const { rows } = psParseBook(XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' }));
const CLUBS = ['과학탐구부','밴드부','축구부','독서토론부','바둑부'];
const roster = [], contact = [];
rows.forEach((r, i) => {
  const moved = i === 0;                       // 이 학생만 반이 바뀐다
  const room = moved ? '11' : r.room, num = moved ? '99' : r.num;
  roster.push({ grade: r.grade, room, num, name: r.name, club: CLUBS[i % CLUBS.length] });
  contact.push({ grade: r.grade, room, num, name: r.name, birth: r.birth,
                 phone: r.phone === '' ? '01077770000' : r.phone,   // DB 에만 있는 번호
                 fatherPhone: r.fatherPhone, motherPhone: r.motherPhone });
});
fs.writeFileSync(path.join(OUT, 'prev-students.json'), JSON.stringify(roster));
fs.writeFileSync(path.join(OUT, 'prev-contact.json'),  JSON.stringify(contact));

console.log(`${xlsxPath}  ${seq}명 · 제외 ${DROP.reduce((a,b)=>a+b)} · 앞0보정 ${zeroFix} · 번호구멍 ${gapRooms}반 · 과학중점 ${sciN}명`);
console.log(`${OUT}/prev-students.json, prev-contact.json  (반이 바뀐 학생: ${rows[0].name} 1-11-99 → ${rows[0].grade}-${rows[0].room}-${rows[0].num})`);
