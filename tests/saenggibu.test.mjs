// 생기부 보조자료(saenggibu.html) — 엑셀 해석, 저장 문서 모양, 실제 화면(올리기·학생별·활동별·창체 일정).
//
// 엑셀은 검사가 직접 만든다(지어낸 이름). 실제 통합 엑셀의 모양을 따랐다:
//  - 시트 이름 앞 꼬리표 <자>·<진>·<개>·<누>, '<자or진>' 처럼 둘 중 고름
//  - 머리 줄 위 '⊙ 활  동  명:' 안내 칸, 수학과처럼 A열에 '00⊙ …' 가 한 번 더 있는 시트
//  - 활동명 칸이 다른 시트에서 복사돼 온 시트(학급 임원 시트에 '학생회 임원'), 부서 칸에 활동명이 들어간 시트
//  - 숨김 시트(Base), 꼬리표 없는 조회 시트, 창체 일정(월·일·교시) 시트
//  - 서식: 로봇 시트에 원본처럼 HY헤드라인M 머리, 병합, 파란 머리줄, 숨긴 A열, 가로 인쇄 — 그리고
//    여러 사람 손을 탄 듯 본문 글꼴을 나눔고딕 14 로 섞어 둔다(내려받으면 돋움 10 으로 맞춰져야 한다)
// Firebase 는 모듈 주소를 가로채 메모리 대역으로 바꾼다.
//
// 설치: npm i -D xlsx@0.18.5 exceljs@4.4.0 playwright
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';

const ROOT = import.meta.dirname + '/..';
const HTML = fs.readFileSync(ROOT + '/saenggibu.html', 'utf8');
const XLSXJS = fs.readFileSync(ROOT + '/node_modules/xlsx/dist/xlsx.full.min.js', 'utf8');
const EXCELJS = fs.readFileSync(ROOT + '/node_modules/exceljs/dist/exceljs.min.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

// ── 엑셀 만들기 ──
const XSS = '<img src=x onerror=window.__xss=1>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function sheets({ dropOfficers = false, robotText = '로봇 코딩 캠프에 참여하여 센서 제어를 익힘.' } = {}) {
  const list = [
    ['<누>창의(1학년 창체)', [
      ['창의교육부', null, null, '⊙ 활  동  명:', null, '1학년 창의적 체험활동 상황'],
      [null, null, null, '⊙ 입력 영역:', null, '창의적 체험활동 누가기록'],
      ['월', '일', '요일', '교시', '이수시간', '자율', '동아리', '봉사', '진로', '활동 영역', '활동 내용'],
      [3, 9, '월', 1, 1, 1, null, null, null, '자율·자치활동', '도서관 활용교육'],
      [],
      [3, 11, '수', 7, 1, null, 1, null, null, '동아리활동', '동아리 편성'],
      [3, 13, '금', 5, 1, null, null, null, 1, null, '진로 롤모델 조사'],   // 활동 영역 칸이 비어도 진로 시간 칸으로
      ['3월 소계', null, null, null, 3, 1, 1, 0, 1, null, null],            // 활동 내용 없음 — 화면에선 없는 줄
      ['1학기 진로 소계', null, null, null, 16, 0, 0, 0, 16, null, '이수시간은 학급별로 상이'],   // 내용 칸에 메모가 있어도 소계는 없는 줄
      [3, 20, '금', 6, 1, 1, null, null, null, '자율·자치활동', null],       // 활동 내용 없음
    ]],
    ['<누>창의(봉사)', [
      ['창의교육부', null, null, '⊙ 활  동  명:', null, '교과학습도우미'],
      [null, null, null, '⊙ 입력 영역:', null, '봉사활동 누가기록'],
      [null, null, null, '⊙ 유의 사항:', null, '학교교육계획에 의해 실시한 봉사활동과 학교장이 승인한 개인 봉사활동만 입력합니다.\n반별 일괄등록 시 결시 학생이 자동으로 빠지지 않으므로 출결을 확인한 뒤 등록합니다.\n개인 봉사활동의 영역은 입력되지 않습니다.'],
      // 원본 프로젝트 봉사처럼: 머리 이름 없는 요일 칸, 한 칸에 회차가 줄바꿈으로 여러 개
      ['연번', '학년', '반', '번호', '성명', '시작일자', null, '시간', '봉사활동내용'],
      [1, 3, 2, 5, '박나래', '2026.03.09.\n2026.03.16.', '월\n월', '6\n6', '교과학습도우미'],   // 원본처럼 3학년이 먼저 — 내려받아도 이 차례
      [2, 1, 1, 1, '김가람', '2026.04.10.', '금', 4, '헌혈'],
    ]],
    ['<자or진>과중(로봇공학)-2차', [
      [null, '과학중점부', null, null, '⊙ 활  동  명:', null, '진로탐색 로봇공학 캠프'],
      [null, null, null, null, '⊙ 입력 영역:', null, '자율활동 특기사항 or 진로활동 특기사항'],
      [null, null, null, null, '⊙ 입력 경로:', null, '[학생생활]-[창의적체험활동]'],
      [null, null, null, null, '⊙ 유의 사항:', null, '담임 교사가 최종 수정'],
      [null, '순번', '학년', '반', '번호', '성명', '자기 평가서', '기재 내용'],
      ['10101', 1, 1, 1, 1, '김가람', '로봇에 관심이 있어 참여함.', robotText],
      ['10102', 2, 1, 1, 2, XSS, '평가 <script>', '문안에 <b>태그</b> 가 섞임.'],
      [null, '합계', null, null, null, null, null, null],
      ['10103', 3, 1, 1, 3, '최다온', '', ''],
    ]],
    ['<자or진>수학과(수학대중화강연 1,2차)-1차', [
      ['00⊙ 활  동  명:', '수학과', null, null, '⊙ 활  동  명:', null, '수학 대중화 강연 1차, 2차'],
      ['00⊙ 입력 영역:', null, null, null, '⊙ 입력 영역:', null, '자율·자치활동 특기사항 or 진로활동 특기사항'],
      ['학년반번호', '순번', '학년', '반', '번호', '성명', '기재 내용', 'b=k+n'],
      ['10101', 1, 1, 1, 1, '김가람', '수학 대중화 강연을 청취함.', 'x'],
    ]],
    ['<자>생활(학급 임원)-2차', [
      [null, '생활교육부', null, null, '⊙ 활  동  명:', null, '학생회 임원'],
      [null, '순번', '학년', '반', '번호', '성명', '직책', '기재 내용'],
      ['30205', 1, 3, 2, 5, '박나래', '반장', '학급 반장으로 활동함.'],
    ]],
    ['<자>생활(학생회 임원)-2차', [
      [null, '생활교육부', null, null, '⊙ 활  동  명:', null, '학생회 임원'],
      [null, '순번', '학년', '반', '번호', '성명', '직책', '기재 내용'],
      ['20101', 1, 2, 1, 1, '이보람', '회장', '학생회장으로 활동함.'],
    ]],
    ['<개>연구부(수업량유연화)-2차-3차(수정)', [
      [null, '수업량 유연화', null, null, '⊙ 활  동  명:', null, '수업량 유연화'],
      [null, '순번', '학년', '반', '번호', '성명', '주제', '기재 내용'],
      ['30205', 1, 3, 2, 5, '박나래', '정보 비대칭', '정보 비대칭을 탐구함.'],
    ]],
    ['Base', [[null], ['학년', '반', '번호', '성명'], [1, 1, 1, '김가람']]],
    ['학생 개인별 조회', [['학년', '반', '번호', '성명', '기재 내용'], [1, 1, 1, '김가람', '중복']]],
    ['<자>메모', [['그냥 메모']]],
  ];
  return dropOfficers ? list.filter(([n]) => !n.includes('학급 임원')) : list;
}
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-'));
const BLUE = 'FF0066FF';
const thin = { style: 'thin' }, box = { top: thin, left: thin, bottom: thin, right: thin };
async function xlsxFile(name, opts) {
  const wb = new ExcelJS.Workbook();
  for (const [sname, aoa] of sheets(opts)) {
    const ws = wb.addWorksheet(sname);
    aoa.forEach((row, i) => row.forEach((v, j) => { if (v != null) ws.getRow(i + 1).getCell(j + 1).value = v; }));
    if (sname === 'Base') ws.state = 'veryHidden';
    if (sname.includes('로봇')) {
      ws.getColumn(1).hidden = true;                   // 원본처럼 학번 열을 숨겨 둔다
      ws.getColumn(7).width = 50; ws.getColumn(8).width = 81;
      ws.mergeCells('B1:D1'); ws.mergeCells('E1:F1');
      ws.getCell('B1').font = { name: 'HY헤드라인M', size: 16 };
      for (let c = 2; c <= 8; c++) Object.assign(ws.getRow(5).getCell(c), {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } },
        font: { name: '돋움', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }, border: box });
      for (let r = 6; r <= 9; r++) for (let c = 2; c <= 8; c++) Object.assign(ws.getRow(r).getCell(c), {
        font: { name: '나눔고딕', size: 14 }, border: box, alignment: { vertical: 'top', wrapText: c >= 7 } });
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      ws.properties.tabColor = { argb: 'FFFFFF00' };   // 아래 시트 탭 색
      ws.getRow(6).height = 120;                        // 원본 줄 높이(사람이 맞춰 둔 것)
    }
  }
  const f = path.join(TMP, name);
  await wb.xlsx.writeFile(f);
  return f;
}
// 칸 이름이 맞지 않는 시트 — 올리기 미리보기에서 경고해야 한다(그대로 올리면 문안 복사가 안 된다)
const FILE_ODD = path.join(TMP, 'sgb-odd.xlsx');
{
  const wb = new ExcelJS.Workbook();
  const put = (ws, aoa) => aoa.forEach((row, i) => row.forEach((v, j) => { if (v != null) ws.getRow(i + 1).getCell(j + 1).value = v; }));
  put(wb.addWorksheet('<개>국어(이름 다른 칸)'), [[null, '⊙ 활  동  명:', null, '이름 다른 칸'],
    ['학년', '반', '번호', '성명', '작성할 글'], [1, 1, 1, '김가람', '문안인데 칸 이름이 낯설다.']]);
  put(wb.addWorksheet('<자>교무(정상)'), [[null, '⊙ 활  동  명:', null, '정상'],
    ['학년', '반', '번호', '성명', '자기 평가서', '기재 내용'], [1, 1, 2, '박나래', '평가', '문안.']]);
  await wb.xlsx.writeFile(FILE_ODD);
}
// 부서가 시트를 하나씩 바로 올린다 — 김 선생님이 처음 올리고, 이 선생님이 고쳐 올리고, 이름을 바꿔 다시 낸다
async function oneSheet(fname, sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, aoa] of sheets) aoa.forEach((row, i) => row.forEach((v, j) => {
    if (v != null) (wb.getWorksheet(name) || wb.addWorksheet(name)).getRow(i + 1).getCell(j + 1).value = v; }));
  const f = path.join(TMP, fname); await wb.xlsx.writeFile(f); return f;
}
const readHead = (title, dept = '교무부') => [[dept, null, '⊙ 활  동  명:', null, title], ['학년', '반', '번호', '성명', '기재 내용']];
const FILE_K1 = await oneSheet('dept-k1.xlsx', [['<자>교무(독서 토론)', [...readHead('독서 토론'), [1, 1, 1, '김가람', '독서 토론에 참여함.'], [1, 1, 2, '박나래', '토론 사회를 봄.']]]]);
const FILE_K2 = await oneSheet('dept-k2.xlsx', [['<자>교무(독서 토론)', [...readHead('독서 토론'), [1, 1, 1, '김가람', '다른 선생님이 고친 문안.']]]]);
const FILE_K3 = await oneSheet('dept-k3.xlsx', [['<자>교무(독서토론 활동)', [...readHead('독서 토론'), [1, 1, 1, '김가람', '이름을 바꿔 낸 새 판.']]]]);
const FILE_K4 = await oneSheet('dept-k4.xlsx', [['<자>생활(학생회 임원)', [[null, '생활교육부', null, null, '⊙ 활  동  명:', null, '학생회 임원'],
  [null, '순번', '학년', '반', '번호', '성명', '직책', '기재 내용'], ['20101', 1, 2, 1, 1, '이보람', '회장', '학생회장으로 행사를 이끎.']]]]);
const FILE_CL = await oneSheet('dept-cl.xlsx', [
  ['<자>교무(강연)-1차', [...readHead('강연 1'), [1, 1, 1, '김가람', '첫 강연.']]],
  ['<자>교무(강연)-2차', [...readHead('강연 2'), [1, 1, 1, '김가람', '둘째 강연.']]]]);
// 파일 이름은 영문으로 — Playwright 가 괄호·한글이 섞인 이름은 조용히 못 넘긴다(파일 0개)
const FILE1 = await xlsxFile('sgb-4.xlsx');
const FILE2 = await xlsxFile('sgb-5.xlsx', { dropOfficers: true, robotText: '로봇 코딩 캠프에서 센서 제어를 익히고 발표함.' });

// ── 1. 해석 (페이지의 순수 함수 블록을 그대로) ──
console.log('\n[해석]');
const code = HTML.match(/<script id="sgbParser">([\s\S]*?)<\/script>/)[1];
const P = new Function(code + ';return { sgbParseBook, sgbBuildDocs, sgbBookToSheets, sgbSheetInfo, sgbCompare, sgbMerge, sgbFormOf, sgbExportPlan, sgbRowHeight, sgbVolunteerRows, sgbMismatches, sgbOddSheets, sgbActKey, sgbStamp, sgbLookalikes, sgbApplyFix, sgbFresh };')();
const wb1 = XLSX.read(fs.readFileSync(FILE1), { type: 'buffer' });
const parsed = P.sgbParseBook(P.sgbBookToSheets(XLSX, wb1));
const act = t => parsed.activities.find(a => a.sheet.includes(t));

check('활동 6 · 창체 일정 1', parsed.activities.length === 6 && parsed.schedules.length === 1,
  [parsed.activities.map(a => a.sheet), parsed.schedules.length]);
check('숨김 시트·꼬리표 없는 시트·머리 줄 없는 시트는 건너뛰고 까닭을 남긴다',
  parsed.skipped.length === 3 && parsed.skipped.some(s => s.name === 'Base' && s.why.includes('숨긴'))
  && parsed.skipped.some(s => s.name === '학생 개인별 조회') && parsed.skipped.some(s => s.name === '<자>메모'), parsed.skipped);
const robot = act('로봇');
check('로봇 — 꼬리표 자·진, 부서, 활동명, 입력 영역·경로·유의 사항',
  robot.tags.join() === '자,진' && robot.dept === '과학중점부' && robot.title === '진로탐색 로봇공학 캠프'
  && robot.area.startsWith('자율활동') && robot.path.includes('창의적체험활동') && robot.note.includes('최종 수정'), robot);
check('로봇 — 기재 칸·학생 글 칸을 알아본다', robot.body === '기재 내용' && robot.self === '자기 평가서' && robot.extra.length === 0, robot);
check('로봇 — 합계 줄·빈 줄은 빼고 2건, 반별 수', robot.count === 2 && robot.byClass['1-1'] === 2, robot);
check('로봇 — 차수 2', robot.rounds.join() === '2');
const math = act('수학');
check('수학 — A열의 00⊙ 를 두고도 부서·활동명을 찾는다', math.dept === '수학과' && math.title === '수학 대중화 강연 1차, 2차', math);
check('수학 — 괄호 속 「1,2차」 는 차수가 아니다(차수 1)', math.rounds.join() === '1', math.rounds);
check('수학 — 학년반번호·b=k+n 같은 보조 칸은 버린다', math.extra.length === 0, math.extra);
const officer = act('학급 임원');
check('학급 임원 — 엑셀의 활동명(학생회 임원)을 쓰되 시트 이름도 남긴다', officer.title === '학생회 임원' && officer.short === '학급 임원', officer);
check('학급 임원 — 직책은 덧붙은 정보로', officer.extra.join() === '직책');
const flex = act('수업량');
check('수업량 유연화 — 부서 칸이 활동명과 같으면 시트 이름의 부서(연구부)', flex.dept === '연구부', flex.dept);
check('수업량 유연화 — 차수 2·3', flex.rounds.join() === '2,3', flex.rounds);
const vol = act('봉사');
check('봉사 — 기재 칸이 없으면 나머지 칸을 정보로', vol.body === '' && vol.extra.join() === '시작일자,요일,시간,봉사활동내용', vol);
check('머리 이름이 빈 칸이라도 요일 글자뿐이면 「요일」 로 읽는다', vol.extra[1] === '요일');
const sch = parsed.schedules[0];
check('창체 일정 — 1학년, 11칸, 중간 빈 줄은 자리 그대로(내려받을 때 원본 줄 자리)', sch.grade === 1 && sch.cols.length === 11 && sch.rows.length === 7
  && !sch.rows[1].v.some(Boolean)
  && sch.rows[0]?.v?.[10] === '도서관 활용교육', sch);
const s111 = parsed.students.find(s => s.g === 1 && s.c === 1 && s.n === 1);
check('학생 1-1-1 — 봉사·로봇·수학 3건', s111 && s111.items.length === 3 && s111.nm === '김가람', s111);
check('기재 문안이 빈 학생(1-1-3)은 학생 목록에 없다', !parsed.students.some(s => s.g === 1 && s.c === 1 && s.n === 3));

// ── 2. 저장 문서 ──
console.log('\n[저장 문서]');
const nested = o => Array.isArray(o) ? o.some(v => Array.isArray(v) || nested(v))
  : (o && typeof o === 'object') ? Object.values(o).some(nested) : false;
const built = P.sgbBuildDocs(parsed);
check('Firestore 가 못 담는 「배열 안 배열」이 어디에도 없다',
  ![...built.docs.values()].some(nested) && !nested(built.meta));
check('학생 문서 = 학생 수', [...built.docs.keys()].filter(k => k.startsWith('saenggibuStu/')).length === parsed.students.length);
check('명단(roster) — 반별 번호·이름·자료 건수', JSON.stringify(built.meta.roster['1-1']) === JSON.stringify([{ n: 1, nm: '김가람', k: 3 }, { n: 2, nm: XSS, k: 1 }]),
  built.meta.roster['1-1']);
const tiny = P.sgbBuildDocs(parsed, 50);
const rp = tiny.meta.activities.find(a => a.id === robot.id).parts;
const rows = [...tiny.docs].filter(([k]) => k.startsWith(`saenggibuAct/${robot.id}-1-`)).flatMap(([, v]) => v.rows);
check('활동 문서가 크면 조각낸다 — 조각 수가 목록에 남고, 합치면 원래 줄', rp['1'] === 2 && rows.length === 2, rp);
check('조각 크기 한도는 1MiB 보다 넉넉히 작다', /SGB_PART_BYTES = 600000/.test(code));

// ── 2-1. 다시 올릴 때 맞대 보기 · 합치기 ──
console.log('\n[맞대 보기 · 합치기]');
const parsed2 = P.sgbParseBook(P.sgbBookToSheets(XLSX, XLSX.read(fs.readFileSync(FILE2), { type: 'buffer' })));
const meta1 = P.sgbBuildDocs(parsed).meta;
const cmp = P.sgbCompare(meta1, parsed2);
check('같은 시트 이름 = 같은 활동 — 바뀐 것 1(로봇)', cmp.changed.length === 1 && cmp.changed[0].cur.id === robot.id, cmp.changed.map(x => x.cur.sheet));
check('그대로 5 (활동 4 + 창체 일정 1)', cmp.same.length === 5, cmp.same.map(x => x.cur.sheet));
check('이 파일에 없는 기존 시트 1(학급 임원), 추가 0', cmp.missing.length === 1 && cmp.missing[0].old.id === officer.id && cmp.added.length === 0);
check('처음 올릴 때는 전부 추가', P.sgbCompare(null, parsed).added.length === 7);
const noHash = { ...meta1, activities: meta1.activities.map(({ hash, ...a }) => a) };
check('지문 없는 옛 기록은 「바뀜」 으로 (같다고 넘기지 않는다)', P.sgbCompare(noHash, parsed2).same.length === 1);
const oldOfficer = meta1.activities.find(a => a.id === officer.id);
const merged = P.sgbMerge(parsed2, [{ a: oldOfficer, rows: parsed.actRows.get(officer.id) }], []);
const m325 = merged.students.find(x => x.g === 3 && x.c === 2 && x.n === 5);
check('남기면 — 활동 목록에 돌아오고 학생 문서에도 다시 들어간다', merged.activities.some(a => a.id === officer.id) && m325.items.length === 3, m325);
check('남긴 활동에 옛 조각 수(parts)는 안 따라온다 — 다시 센다', !('parts' in merged.activities.find(a => a.id === officer.id)));
const ordered = P.sgbMerge(parsed2, [{ a: oldOfficer, rows: parsed.actRows.get(officer.id) }], [], meta1.activities.map(a => a.id));
check('순서는 처음 올라간 차례대로 — 남긴 시트가 맨 뒤로 밀리지 않는다',
  ordered.activities.map(a => a.id).join() === meta1.activities.map(a => a.id).join(), ordered.activities.map(a => a.sheet));
const plusNew = P.sgbMerge(parsed, [], [], meta1.activities.filter(a => a.id !== robot.id).map(a => a.id));
check('목록에 없던 시트(새 시트)는 뒤에', plusNew.activities.at(-1).id === robot.id);

// ── 2-1b. 봉사활동 누가기록 한 표 ──
console.log('\n[봉사 누가기록]');
const VA = { id: 'v1', tags: ['누'], area: '봉사활동 누가기록', title: '교과학습도우미',
  extra: ['시작일자', '종료일자', '시간', '봉사활동영역', '학교/개인', '장소/주관기관명', '봉사활동내용'] };
const VP = { id: 'v2', tags: ['누'], area: '봉사활동 누가기록', title: '프로젝트 봉사활동 실적',
  extra: ['정규 동아리명', '교시', '시작일자', '요일', '활동내용', '시간', '봉사활동영역', '학교/개인', '장소/기관명'] };
const VX = { id: 'v3', tags: ['자'], area: '자율활동 특기사항', title: '다른 활동', extra: ['시작일자'] };
const vrows = P.sgbVolunteerRows([
  { a: 'v1', x: ['2026.04.10.', '2026.04.10.', '4', '캠페인활동', '학교', '영남고등학교', '헌혈'] },
  { a: 'v2', x: ['창공', '6\n6', '2026.03.11.\n2026.05.20.', '수\n수', '주제 선정\n결과 정리', '1\n1', '캠페인활동', '학교', '영남고등학교'] },
  { a: 'v3', x: ['2026.01.01.'] },
], id => ({ v1: VA, v2: VP, v3: VX })[id]);
check('봉사 시트 + 프로젝트 봉사(회차 둘) → 세 줄, 날짜 순', vrows.map(r => r.start).join() === '2026.03.11.,2026.04.10.,2026.05.20.', vrows.map(r => r.start));
check('칸 맞추기 — 내용·영역·학교/개인·장소·시간(프로젝트는 회차마다 같은 값을 되풀이)',
  vrows[0].content === '주제 선정' && vrows[2].content === '결과 정리' && vrows[0].area === '캠페인활동' && vrows[2].place === '영남고등학교'
  && vrows[1].end === '2026.04.10.' && vrows[0].end === '', vrows);
check('시간 누계 1 → 5 → 6', vrows.map(r => r.total).join() === '1,5,6');
check('봉사가 아닌 활동은 안 들어간다', !vrows.some(r => r.srcId === 'v3'));

// ── 2-1c. 반·번호·이름 맞추기 ──
console.log('\n[반·번호·이름]');
// 지어낸 명렬 — 1-1-2 는 다른 이름(엑셀엔 XSS 이름), 2-1-1 은 명렬에 없고 그 이름은 2-1-2 에 있다
const ROSTER = [{ grade: '1', room: '01', num: '01', name: '김가람' }, { grade: 1, room: 1, num: 2, name: '최다온' },
  { grade: 3, room: 2, num: 5, name: '박 나래' }, { grade: 2, room: 1, num: 2, name: '이보람' }];
const mis = P.sgbMismatches(parsed.activities, parsed.actRows, ROSTER);
check('명렬과 맞대 보기 — 이름 다름 1(1-1-2), 명렬에 없는 학번 1(2-1-1)', mis.length === 2
  && mis.some(m => m.g === 1 && m.c === 1 && m.n === 2 && m.why === '이름이 명렬과 다름' && m.expect === '최다온')
  && mis.some(m => m.g === 2 && m.n === 1 && m.why === '명렬에 없는 학번'), mis);
check('그 이름이 명렬에서 실제로 어디 있는지 알려 준다(이보람 → 2-1-2)', mis.find(m => m.g === 2).hint === '2-1-2');
check('띄어쓰기·앞에 0 붙은 반·번호는 같은 것으로(박 나래, 01)', !mis.some(m => m.g === 3 || (m.g === 1 && m.n === 1)));
const selfOnly = P.sgbMismatches([{ id: 'q', sheet: 'S' }], new Map([['q', [{ g: 1, c: 1, n: 1, nm: '가' }, { g: 1, c: 1, n: 1, nm: '가' }, { g: 1, c: 1, n: 1, nm: '나' }]]]), []);
const ROSTER2 = ROSTER.filter(x => x.name !== '이보람');                    // 이보람이 떠났다
const GONE = [{ grade: '2', name: '이보람', kind: '전출', date: '2026.05.10.' }];
const mv = P.sgbMismatches(parsed.activities, parsed.actRows, ROSTER2, GONE);
check('학적 변동 — 명렬에 없는 학번인데 떠난 학생 목록에 있으면 오류가 아니라 「학적 변동」(구분·날짜)',
  mv.filter(m => !m.moved).length === 1 && mv.some(m => m.moved && m.nm === '이보람' && m.kind === '전출' && m.date === '2026.05.10.'), mv);
check('같은 학년에 그 이름이 아직 있으면 학적 변동으로 넘기지 않는다(동명이인일 수 있다)',
  !P.sgbMismatches(parsed.activities, parsed.actRows, ROSTER, GONE).some(m => m.moved));
const reuse = [...ROSTER2, { grade: 2, room: 1, num: 1, name: '새학생' }];      // 떠난 자리에 다른 학생이 들어옴
check('떠난 학생 번호를 다른 학생이 받았어도 학적 변동', P.sgbMismatches(parsed.activities, parsed.actRows, reuse, GONE).some(m => m.moved && m.nm === '이보람'));
const parenRows = new Map([['q2', [{ g: 2, c: 1, n: 1, nm: '(이보람)' }, { g: 2, c: 1, n: 3, nm: '(정하늘)' }, { g: 1, c: 1, n: 2, nm: '(최다온)' }]]]);
const pm = P.sgbMismatches([{ id: 'q2', sheet: 'S' }], parenRows, ROSTER2, GONE);
check('괄호 이름 — 「(이보람)」 도 떠난 학생 이보람으로 맞춘다', pm.some(m => m.moved && m.nm === '(이보람)' && m.kind === '전출'), pm);
check('괄호 이름 — 떠난 학생 목록에 없어도 괄호면 학적 변동(정하늘)', pm.some(m => m.moved && m.nm === '(정하늘)'), pm);
check('괄호 이름이라도 명렬의 같은 자리 이름과 같으면 문제없음(최다온 1-1-2)', !pm.some(m => m.nm === '(최다온)'), pm);
check('명렬이 없으면 시트끼리 — 같은 학번에 적은 쪽 이름을 짚는다', selfOnly.length === 1 && selfOnly[0].nm === '나' && selfOnly[0].why === '시트마다 이름이 다름', selfOnly);

// ── 2-2. 원본 양식 뜨기 ──
console.log('\n[원본 양식]');
const ewb = new ExcelJS.Workbook();
await ewb.xlsx.readFile(FILE1);
const rform = P.sgbFormOf(ewb.getWorksheet(robot.sheet), robot, 'act');
check('머리 줄(5행)을 찾고 칸마다 쓰임을 안다 — 이름 없는 A열은 학번(값을 보고), 순번·학년·반·번호·성명·자기 평가서·기재 내용',
  rform.h === 5 && rform.roles.join() === ',key,seq,g,c,n,nm,s,b', rform.roles);
check('위쪽 병합(B1:D1, E1:F1)을 떠 둔다', rform.merges.includes('B1:D1') && rform.merges.includes('E1:F1'), rform.merges);
check('숨긴 A열은 숨긴 채로', rform.cols[1].hidden === true, rform.cols[1]);
check('열 너비', rform.cols[8].w === 81 && rform.cols[7].w === 50);
const hdrCell = rform.rows.find(r => r.r === 5).cells.find(c => c.c === 3);
check('머리줄 서식(파랑·흰 굵은 글씨) 그대로', hdrCell.s.fill.fgColor.argb === BLUE && hdrCell.s.font.bold === true, hdrCell);
check('위쪽 안내 칸 글자 — 병합된 나머지 칸에는 값을 안 옮긴다',
  rform.rows[0].cells.find(c => c.c === 2).t === '과학중점부' && !rform.rows[0].cells.some(c => (c.c === 3 || c.c === 4) && c.t));
check('본문 칸 서식에서 글꼴은 버린다(나눔고딕 14 를 안 옮긴다)', !rform.data[8].font && rform.data[8].border && rform.data[8].alignment.wrapText);
check('인쇄 방향 가로', rform.page.orientation === 'landscape');
const mform = P.sgbFormOf(ewb.getWorksheet(math.sheet), math, 'act');
check('수학 — 학년반번호 칸은 key, b=k+n 은 빈 칸', mform.roles.join() === 'key,seq,g,c,n,nm,b,'.replace(/^/, ','), mform.roles);
check('창체 일정 — 칸마다 v{j}', P.sgbFormOf(ewb.getWorksheet(sch.sheet), sch, 'sch').roles.slice(1, 4).join() === 'v0,v1,v2');
check('Firestore 에 담을 수 있다(배열 안 배열 없음)', !nested(rform) && !nested(mform));
const plan = P.sgbExportPlan(P.sgbBuildDocs(parsed).meta,
  Object.fromEntries(parsed.activities.map(a => [a.id, parsed.actRows.get(a.id)])), { [robot.id]: rform, [math.id]: mform });
check('내려받기 — 원본 시트 차례 그대로, 목차는 맨 뒤', plan.length === 8 && plan.at(-1).name === '목차'
  && plan.slice(0, 7).map(x => x.name).join('|') === sheets().map(([n]) => n).filter(n => n.startsWith('<') && n !== '<자>메모').join('|'), plan.map(x => x.name));
const rp2 = plan.find(x => x.name === robot.sheet);
check('로봇 시트 — 원본 칸 차례대로 값(순번 1, 학년반번호 칸 없음, 기재 내용 H열)',
  rp2.styled && rp2.rows[0][2] === 1 && rp2.rows[0][3] === 1 && rp2.rows[0][6] === '김가람' && rp2.rows[0][8].startsWith('로봇 코딩'), rp2.rows[0]);
check('수학 시트 — 학년반번호 칸에 10101', plan.find(x => x.name === math.sheet).rows[0][1] === '10101');
check('원본 줄 높이 — 로봇 첫 줄 120, 둘째 줄은 잴 것', rp2.heights[0] === 120 && rp2.heights[1] == null, rp2.heights);
check('탭 색을 떠 둔다', rform.tab?.argb === 'FFFFFF00', rform.tab);
check('줄 차례는 원본 시트 차례 — 봉사는 3학년 줄이 먼저', plan.find(x => x.name === vol.sheet).rows[0].includes('박나래'));
check('양식 없는 시트는 단순한 틀(파란 머리줄)', !plan.find(x => x.name === vol.sheet).styled
  && plan.find(x => x.name === vol.sheet).form.rows.at(-1).cells[0].s.fill.fgColor.argb === BLUE);
const lng = '가'.repeat(200);
check('줄 높이 — 긴 문안은 여러 줄 높이, 엑셀 한도 409 를 안 넘는다',
  P.sgbRowHeight(rform, ['', '', 1, 1, 1, 1, '김', '', lng]) > 40 && P.sgbRowHeight(rform, ['', '', 1, 1, 1, 1, '김', '', lng.repeat(20)]) === 409);
check('줄 높이 — 숨긴 열 글자는 안 센다(한 줄 높이 그대로)', P.sgbRowHeight(rform, [lng.repeat(5), '', 1]) === P.sgbRowHeight(rform, ['', '', 1]));

// ── 2-3. 양식이 조금 달라도 머리 칸을 알아본다 ──
// 부서마다 안내 줄을 더 넣거나, 칸 이름을 다르게 쓰거나, 머리를 두 줄로 병합해 낸다. 행·열 자리가 아니라
// 칸 이름으로 찾으니 자리는 상관없다. 그런데 이름이 다르면 조용히 '기타 칸' 이 되고(기재 문안 복사가 안 됨),
// 두 줄 머리는 병합된 칸 이름이 위 줄에만 있어 아래 줄에서 이름 없는 칸으로 버려졌다(문안이 통째로 사라짐).
// 엑셀은 ExcelJS 로 병합까지 만들어 앱과 똑같이 SheetJS 로 읽는다 — 병합 칸이 실제로 어떻게 읽히는지 그대로.
console.log('\n[양식 변형 — 머리 칸 자동 인식]');
const putRows = (ws, aoa) => aoa.forEach((row, i) => row.forEach((v, j) => { if (v != null) ws.getRow(i + 1).getCell(j + 1).value = v; }));
async function varBook(fname, build) {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const f = path.join(TMP, fname);
  await wb.xlsx.writeFile(f);
  const ew = new ExcelJS.Workbook();
  await ew.xlsx.readFile(f);
  return { p: P.sgbParseBook(P.sgbBookToSheets(XLSX, XLSX.read(fs.readFileSync(f), { type: 'buffer' }))), ew };
}
const itemOf = (p, g, c, n) => p.students.find(s => s.g === g && s.c === c && s.n === n)?.items?.[0];
{
  const { p, ew } = await varBook('v-long.xlsx', wb => {
    const aoa = [['교무부', null, '⊙ 활  동  명:', null, '긴 안내 활동']];
    for (let k = 0; k < 28; k++) aoa.push([null, null, null, null, `안내 ${k + 1}번째 줄`]);
    aoa.push(['학년', '반', '번호', '성명', '기재 내용']);               // 30번째 줄
    aoa.push([1, 2, 3, '김가람', '긴 안내 아래의 문안.']);
    putRows(wb.addWorksheet('<자>교무(긴 안내)'), aoa);
  });
  const a = p.activities[0];
  check('안내 줄이 늘어 머리가 30번째 줄이어도 찾는다', a?.body === '기재 내용' && a.count === 1 && !p.skipped.length, [a, p.skipped]);
  check('— 양식 뜨기도 30번째 줄을 머리로', a && P.sgbFormOf(ew.getWorksheet(a.sheet), a, 'act')?.h === 30);
}
{
  const { p } = await varBook('v-order.xlsx', wb => putRows(wb.addWorksheet('<자>교무(칸 차례)'), [
    [null, '⊙ 활  동  명:', null, '칸 차례를 바꾼 활동'],
    ['기재 내용', '성명', '번호', '반', '학년'],
    ['뒤섞인 칸의 문안.', '박나래', 5, 2, 3],
  ]));
  const it = itemOf(p, 3, 2, 5);
  check('칸 차례가 바뀌어도 이름으로 찾는다(학년·반·번호·성명·기재 내용)',
    p.activities[0]?.body === '기재 내용' && it?.b === '뒤섞인 칸의 문안.' && p.students[0]?.nm === '박나래', [p.activities[0], it]);
}
{
  const { p, ew } = await varBook('v-words.xlsx', wb => {
    putRows(wb.addWorksheet('<자>교무(다른 낱말)'), [
      [null, '⊙ 활  동  명:', null, '낱말이 다른 머리'],
      ['학년', '학급', '출석번호', '학생명', '기재 내용'],
      [2, 1, 4, '최다온', '다른 낱말 머리의 문안.'],
    ]);
    putRows(wb.addWorksheet('<자>교무(괄호 머리)'), [
      [null, '⊙ 활  동  명:', null, '괄호가 붙은 머리'],
      ['학년', '반(학급)', '번호 (출석)', '성명(한글)', '기재 내용(500자 이내)'],
      [1, 3, 7, '이보람', '괄호 붙은 머리의 문안.'],
    ]);
  });
  const [w, b] = p.activities;
  check('반 = 학급, 번호 = 출석번호, 성명 = 학생명', w?.count === 1 && !w.extra.length && itemOf(p, 2, 1, 4)?.b === '다른 낱말 머리의 문안.'
    && p.students.find(s => s.g === 2)?.nm === '최다온', [w, p.students]);
  check('머리 이름의 괄호 속은 덧붙임으로 본다(반(학급)·번호 (출석)·성명(한글)·기재 내용(500자 이내))',
    b?.count === 1 && !b.extra.length && b.body === '기재 내용(500자 이내)' && p.students.find(s => s.g === 1)?.nm === '이보람', b);
  const wf = w && P.sgbFormOf(ew.getWorksheet(w.sheet), w, 'act');
  check('— 양식 뜨기·내려받기도 같은 칸으로(학급 → 반, 학생명 → 성명)', wf?.roles.join() === ',g,c,n,nm,b', wf?.roles);
}
{
  const { p } = await varBook('v-body.xlsx', wb => {
    putRows(wb.addWorksheet('<개>국어(세부능력)'), [
      [null, '⊙ 활  동  명:', null, '세특'],
      ['학년', '반', '번호', '성명', '활동 소감문', '세부능력 및 특기사항'],
      [1, 1, 5, '김가람', '소감을 적음.', '세특 문안.'],
    ]);
    putRows(wb.addWorksheet('<자>교무(기재 문안)'), [
      [null, '⊙ 활  동  명:', null, '문안'],
      ['학년', '반', '번호', '성명', '자기평가', '기재 문안'],
      [1, 1, 6, '박나래', '스스로 평가함.', '기재 문안 칸의 글.'],
    ]);
    putRows(wb.addWorksheet('<누>봉사(내용 칸)'), [
      [null, '⊙ 활  동  명:', null, '봉사'],
      ['학년', '반', '번호', '성명', '봉사활동내용', '활동 내용'],
      [1, 1, 7, '최다온', '헌혈', '헌혈에 참여'],
    ]);
  });
  const [se, mu, bo] = p.activities;
  check("기재 문안 = '세부능력 및 특기사항', 학생 글 = '활동 소감문'", se?.body === '세부능력 및 특기사항' && se.self === '활동 소감문', se);
  check("기재 문안 = '기재 문안', 학생 글 = '자기평가'", mu?.body === '기재 문안' && mu.self === '자기평가', mu);
  check("'내용' 만으로는 기재 문안이 아니다(봉사활동내용·활동 내용은 기타 칸 그대로)", bo?.body === '' && bo.extra.join() === '봉사활동내용,활동 내용', bo);
}
{
  const { p } = await varBook('v-info.xlsx', wb => putRows(wb.addWorksheet('<진>과학(안내 낱말)'), [
    ['과학부', null, '⊙ 활동 이름:', null, '안내 낱말이 다른 활동'],
    [null, null, '⊙ 기재 영역:', null, '진로활동 특기사항'],
    [null, null, '⊙ 입력 위치:', null, '[학생생활]-[창의적체험활동]'],
    [null, null, '⊙ 주의 사항(필독):', null, '최종 확인은 담임'],
    ['학년', '반', '번호', '성명', '기재 내용'],
    [1, 1, 1, '김가람', '안내 낱말이 다른 시트.'],
  ]));
  const a = p.activities[0];
  check('⊙ 안내 칸 — 활동 이름 → 활동명, 기재 영역 → 입력 영역, 입력 위치 → 입력 경로, 주의 사항(필독) → 유의 사항',
    a?.title === '안내 낱말이 다른 활동' && a.area === '진로활동 특기사항' && a.path.includes('창의적체험활동')
    && a.note === '최종 확인은 담임' && a.dept === '과학부', a);
}
{
  // 묶음 머리: '학적' 이 학년·반·번호·성명 위에 병합, '기재 내용' 은 두 줄에 걸쳐 세로 병합(값은 위 줄에만)
  const { p, ew } = await varBook('v-group.xlsx', wb => {
    const ws = wb.addWorksheet('<자>교무(묶음 머리)');
    putRows(ws, [
      ['교무부', null, '⊙ 활  동  명:', null, '두 줄 머리'],
      ['학적', null, null, null, '기재 내용'],
      ['학년', '반', '번호', '성명', null],
      [1, 1, 2, '박나래', '세로로 병합된 기재 내용 칸의 문안.'],
    ]);
    ws.mergeCells('A2:D2'); ws.mergeCells('E2:E3');
  });
  const a = p.activities[0];
  check('두 줄 머리(위에 묶음 이름, 세로 병합) — 기재 내용 칸을 잃지 않는다',
    a?.body === '기재 내용' && itemOf(p, 1, 1, 2)?.b === '세로로 병합된 기재 내용 칸의 문안.', [a, p.students]);
  const f = a && P.sgbFormOf(ew.getWorksheet(a.sheet), a, 'act');
  check('— 양식 뜨기: 머리는 3번째 줄, 병합된 E열은 기재 문안', f?.h === 3 && f.roles[5] === 'b', f && [f.h, f.roles]);
  const pl = f && P.sgbExportPlan(P.sgbBuildDocs(p).meta, { [a.id]: p.actRows.get(a.id) }, { [a.id]: f }).find(x => x.name === a.sheet);
  check('— 내려받기: 문안이 원래 칸(E열)에', pl?.rows?.[0]?.[5] === '세로로 병합된 기재 내용 칸의 문안.', pl?.rows?.[0]);
}
{
  // 갈래 머리: '활동 정보' 가 두 칸에 병합되고 그 아래 줄에 '장소'·'시간'(학년·반·번호는 세로 병합)
  const { p, ew } = await varBook('v-sub.xlsx', wb => {
    const ws = wb.addWorksheet('<누>봉사(갈래 머리)');
    putRows(ws, [
      ['봉사부', null, '⊙ 활  동  명:', null, '갈래 머리'],
      ['학년', '반', '번호', '성명', '기재 내용', '활동 정보', null],
      [null, null, null, null, null, '장소', '시간'],
      [2, 3, 4, '이보람', '갈래 머리 아래 문안.', '시민회관', 3],
    ]);
    for (const c of 'ABCDE') ws.mergeCells(`${c}2:${c}3`);
    ws.mergeCells('F2:G2');
  });
  const a = p.activities[0];
  check("두 줄 머리(아래에 갈래 이름) — '장소'·'시간' 칸을 잃지 않는다",
    a?.extra.join() === '장소,시간' && itemOf(p, 2, 3, 4)?.x?.join() === '시민회관,3', [a, itemOf(p, 2, 3, 4)]);
  const f = a && P.sgbFormOf(ew.getWorksheet(a.sheet), a, 'act');
  check('— 양식 뜨기: 머리는 갈래 줄(3번째), 장소·시간은 기타 칸', f?.h === 3 && f.roles[6] === 'x0' && f.roles[7] === 'x1', f && [f.h, f.roles]);
}
{
  // 기재 문안 낱말이 넓어진 만큼, 여러 칸이 맞으면 센 이름을 고른다(왼쪽부터 고르면 메모 칸을 문안으로 집는다)
  const { p } = await varBook('v-rank.xlsx', wb => putRows(wb.addWorksheet('<진>진로(두 후보)'), [
    [null, '⊙ 활  동  명:', null, '후보가 둘'],
    ['학년', '반', '번호', '성명', '진로 특기사항 메모', '기재 내용'],
    [1, 2, 1, '박나래', '메모일 뿐', '진짜 문안.'],
  ]));
  const a = p.activities[0];
  check("기재 문안 후보가 둘이면 센 이름(기재 내용) — '진로 특기사항 메모' 는 기타 칸",
    a?.body === '기재 내용' && a.extra.join() === '진로 특기사항 메모' && itemOf(p, 1, 2, 1)?.b === '진짜 문안.', a);
}
{
  // 잘못 알아보지 않는가 — 머리 바로 위·아래의 메모·예시 줄은 칸 이름이 아니다
  const { p } = await varBook('v-memo.xlsx', wb => {
    putRows(wb.addWorksheet('<자>교무(위 메모)'), [
      ['교무부', null, '⊙ 활  동  명:', null, '메모 위 머리'],
      [null, null, null, null, null, '※ 500자 이내'],          // 이름 없는 칸 위에만 메모 한 칸
      ['학년', '반', '번호', '성명', '기재 내용', null],
      [1, 1, 3, '최다온', '메모가 있어도 칸 이름은 그대로.', null],
    ]);
    putRows(wb.addWorksheet('<자>교무(예시 줄)'), [
      ['교무부', null, '⊙ 활  동  명:', null, '예시 줄'],
      ['학년', '반', '번호', '성명', '직책', '기재 내용'],
      ['예시', null, null, '홍길동', '반장', '이렇게 씁니다.'],    // 머리 아래 예시 줄 — 갈래 이름 줄이 아니다
      [1, 1, 4, '김가람', '부반장', '예시 아래의 진짜 문안.'],
    ]);
  });
  const [m, e] = p.activities;
  check('머리 바로 위 메모 한 칸을 칸 이름으로 착각하지 않는다', m?.body === '기재 내용' && !m.extra.length, m);
  check("머리 바로 아래 예시 줄을 갈래 이름으로 착각하지 않는다('직책' 이 예시의 '반장' 으로 안 바뀜, 예시 줄은 학생이 아니라 빠짐)",
    e?.body === '기재 내용' && e.extra.join() === '직책' && e.count === 1 && itemOf(p, 1, 1, 4)?.b === '예시 아래의 진짜 문안.', e);
}

// ── 2-3b. 다시 올릴 때 짝짓기 — 차수 없이 ──
// 부서가 시트를 하나씩 바로 올린다. 예전 합본은 시트 이름 끝에 배포 차수(-2차-3차(수정))를 붙였고 앞으로는
// 안 붙인다 — 붙든 안 붙든, 꼬리표를 고쳐 냈든 같은 활동이어야 겹치지 않는다. 괄호 안 차수는 활동 회차라 다르다.
console.log('\n[짝짓기 — 차수 없이]');
{
  const K = P.sgbActKey;
  const pairs = [
    ['<자>생활(학급 임원)-2차', '생활(학급임원)'],
    ['<자or진>생활(학급 임원)-2차-3차(수정)', '생활(학급임원)'],
    ['<자>생활(학급 임원)', '생활(학급임원)'],
    ['<자>생활(학급 임원)_3차', '생활(학급임원)'],
    ['<자>수학과(강연(1차))-3차', '수학과(강연(1차))'],
    ['<자>수학과(강연(2차))-3차', '수학과(강연(2차))'],
    ['<자or진>수학과(수학대중화강연 1,2차)-1차', '수학과(수학대중화강연1,2차)'],
    ['<개>연구부(수업량유연화)-2차-3차(수정)', '연구부(수업량유연화)'],
  ];
  const bad = pairs.filter(([n, k]) => K(n) !== k).map(([n, k]) => [n, K(n), k]);
  check('활동 열쇠 — 꼬리표·끝의 배포 차수·(수정)은 떼고, 괄호 안 회차는 남긴다', !bad.length, bad);

  const A = (sheet, title, hash, extra = {}) => ({ id: 'a' + sheet, sheet, title, hash, ...extra });
  const meta = { activities: [
    A('<자>생활(학급 임원)-2차', '학급 임원', 'h1', { by: 'old@x', since: 'S0', upd: 'U0' }),
    A('<자>수학과(강연(1차))-2차', '강연 1차', 'h2'),
    A('<자>수학과(강연(2차))-2차', '강연 2차', 'h3', { by: 'b@x', since: 'S3', upd: 'U3' }),
  ], schedules: [] };
  const cur = { activities: [
    A('<자or진>생활(학급 임원)', '학급 임원', 'h1b'),       // 차수 없이 + 꼬리표 고쳐 냄 + 내용 바뀜
    A('<자>수학과(강연(1차))', '강연 1차', 'h2b'),
    A('<자>수학과(강연(2차))-3차', '강연 2차', 'h3'),          // 내용 그대로, 이름만 차수 바뀜
  ], schedules: [] };
  const c = P.sgbCompare(meta, cur);
  check('차수 없이 내도·꼬리표를 고쳐 내도 같은 활동 — 「바뀜」 으로 짝(새로 추가·빠짐 없음)',
    c.changed.length === 2 && c.same.length === 1 && !c.added.length && !c.missing.length
    && c.changed.find(x => x.cur.sheet.includes('학급 임원'))?.old.sheet === '<자>생활(학급 임원)-2차', c);
  check('괄호 안 회차가 다르면 다른 활동 — 강연(1차)·강연(2차) 각자 짝',
    c.changed.find(x => x.cur.sheet.includes('강연(1차)'))?.old.title === '강연 1차' && c.same[0]?.old.title === '강연 2차');

  const now = '2026-10-28T09:00:00.000Z';
  P.sgbStamp(c, 'me@x', now);
  const off = c.changed.find(x => x.cur.sheet.includes('학급 임원')).cur;
  const lec = c.changed.find(x => x.cur.sheet.includes('강연(1차)')).cur;
  check('올린 사람·날짜 — 바뀐 것은 처음 날짜를 두고 바뀐 날짜·올린 사람만 새로', off.since === 'S0' && off.upd === now && off.by === 'me@x', off);
  check('— 예전 기록에 날짜가 없으면 칸을 아예 안 만든다(Firestore 는 undefined 를 못 담는다)', !('since' in lec) && lec.upd === now, lec);
  check('— 그대로인 것은 옛 기록 그대로', c.same[0].cur.by === 'b@x' && c.same[0].cur.since === 'S3' && c.same[0].cur.upd === 'U3', c.same[0].cur);
  const c2 = P.sgbCompare({ activities: [], schedules: [] }, { activities: [A('<자>새 활동', '새 활동', 'n')], schedules: [] });
  P.sgbStamp(c2, 'me@x', now);
  check('— 새로 들어온 것은 처음 날짜 = 바뀐 날짜 = 지금(「추가」)', c2.added[0].cur.since === now && c2.added[0].cur.upd === now);

  const c3 = P.sgbCompare({ activities: [A('<자>교무(강연)-1차', '강연', 'k1')], schedules: [] },
    { activities: [A('<자>교무(강연)-1차', '강연', 'k1'), A('<자>교무(강연)-2차', '강연', 'k2')], schedules: [] });
  check('이 파일 안에서 차수를 떼면 같아지는 시트 — 하나로 묶지 않고 알린다(clash)',
    c3.clash.length === 1 && c3.clash[0].sheets.length === 2, c3.clash);
  check('— 시트 이름이 같은 예전 것과는 짝, 다른 하나는 새로 추가', c3.same.length === 1 && c3.same[0].cur.sheet === '<자>교무(강연)-1차'
    && c3.added.length === 1 && c3.added[0].cur.sheet === '<자>교무(강연)-2차' && !c3.missing.length, c3);

  const c4 = P.sgbCompare({ activities: [A('<자>생활(학급 임원)-2차', '학급 임원', 'h1'), A('<자>교무(독서)', '독서', 'r')], schedules: [] },
    { activities: [A('<자>생활(반 임원)', '학급 임원', 'x'), A('<자>교무(토론)', '토론', 'y')], schedules: [] });
  const look = P.sgbLookalikes(c4);
  check('이름을 바꿔 낸 새 판 짐작 — ⊙ 활동명이 짝 없는 기존 활동과 같으면(학급 임원), 아니면 짐작 안 함(토론)',
    look.length === 1 && look[0].cur.sheet === '<자>생활(반 임원)' && look[0].old.sheet === '<자>생활(학급 임원)-2차', look);
}

// ── 2-3c. 관리자가 앱에서 고친 값 ── 원본은 그대로 두고 fix 에. 다시 올려도 남고, 받기에도 들어간다.
console.log('\n[관리자가 고친 값]');
{
  const meta0 = P.sgbBuildDocs(parsed).meta;
  const rb0 = meta0.activities.find(a => a.id === robot.id);
  rb0.fix = { title: '고친 활동명', dept: '진로진학부', tags: ['진'] };
  const eff = P.sgbApplyFix(meta0);
  const rb = eff.activities.find(a => a.id === robot.id);
  check('읽을 때 고친 값으로 덮어 보이고, 원래 값은 orig 에', rb.title === '고친 활동명' && rb.dept === '진로진학부' && rb.tags.join() === '진'
    && rb.orig.title === '진로탐색 로봇공학 캠프' && rb.orig.dept === '과학중점부' && rb.orig.tags.join() === '자,진', rb);
  check('— 원본 칸은 그대로(다시 올릴 때 원본끼리 맞대 본다)', rb0.title === '진로탐색 로봇공학 캠프' && rb0.dept === '과학중점부');
  check('— 고친 게 없는 활동은 그대로(orig 없음)', !eff.activities.find(a => a.id === math.id).orig);
  const plan = P.sgbExportPlan(eff, { [robot.id]: parsed.actRows.get(robot.id) }, { [robot.id]: rform });
  const rp = plan.find(x => x.name.includes('과중(로봇공학)'));
  const top = rp.form.rows.filter(r => r.r <= rp.form.h).flatMap(r => r.cells.map(c => c.t));
  check('엑셀로 받기 — 원본 양식의 위쪽 안내 칸이 고친 값(부서·활동명)', top.includes('고친 활동명') && top.includes('진로진학부') && !top.includes('과학중점부'), top);
  check('— 고친 꼬리표는 시트 이름에', rp.name === '<진>과중(로봇공학)-2차', rp.name);
  check('— 목차에도 고친 활동명·부서', plan.at(-1).rows.some(r => r.includes('고친 활동명') && r.includes('진로진학부')));
  check('— 저장된 양식 자체는 안 건드린다(받을 때 복사본만)', rform.rows[0].cells.find(c => c.c === 2).t === '과학중점부');
  const c = P.sgbCompare(meta0, parsed);
  P.sgbStamp(c, 'kim@x', 'now');
  const again = [...c.same, ...c.changed].find(x => x.cur.id === robot.id)?.cur;
  check('부서가 틀린 이름 그대로 같은 파일을 다시 올려도 고친 값이 남는다', again?.fix?.title === '고친 활동명' && again.title === '진로탐색 로봇공학 캠프', again);
}

// ── 2-3d. 추가·수정 꼬리표 ── 7일은 모두에게, 그 뒤에는 안 본 선생님에게 볼 때까지
console.log('\n[추가·수정 꼬리표]');
{
  const F = P.sgbFresh, now = Date.parse('2026-10-28T09:00:00Z'), d = n => new Date(now - n * 864e5).toISOString();
  check('올린 지 7일 안 — 추가(처음 날짜 = 바뀐 날짜) · 수정', F({ id: 'a', since: d(1), upd: d(1) }, {}, now) === 'new' && F({ id: 'a', since: d(30), upd: d(2) }, {}, now) === 'mod');
  check('— 7일 안이면 이미 봤어도 보인다', F({ id: 'a', since: d(2), upd: d(2) }, { a: d(2) }, now) === 'new');
  check('7일이 지나도 안 본 선생님에게는 보인다', F({ id: 'a', since: d(10), upd: d(10) }, {}, now) === 'new');
  check('— 7일이 지나고 이미 봤으면 안 보인다', F({ id: 'a', since: d(10), upd: d(10) }, { a: d(10) }, now) === '');
  check('— 본 뒤에 다시 바뀌었으면 다시 보인다(수정)', F({ id: 'a', since: d(30), upd: d(9) }, { a: d(20) }, now) === 'mod');
  check('날짜가 없는 옛 기록은 꼬리표 없음', F({ id: 'a' }, {}, now) === '');
}

// ── 2-4. 표준 양식 ── 부서에 나눠 줄 빈 양식(tests/make-saenggibu-template.mjs). 앱이 그대로 읽어야 하고,
// 모양은 원래 쓰던 통합 엑셀을 따른다. 파서가 바뀌어 양식과 어긋나면 여기서 잡힌다.
console.log('\n[표준 양식]');
{
  const { makeTemplate, TEMPLATE_NAME } = await import('./make-saenggibu-template.mjs');
  const tf = await makeTemplate(ExcelJS, TMP);
  const tp = P.sgbParseBook(P.sgbBookToSheets(XLSX, XLSX.read(fs.readFileSync(tf), { type: 'buffer' })));
  const [ta, tb] = tp.activities;
  check('활동 시트 2개를 읽고, 건너뛰는 건 「작성 안내」 하나(꼬리표 없음)', path.basename(tf) === TEMPLATE_NAME
    && tp.activities.length === 2 && tp.skipped.length === 1 && tp.skipped[0].name === '작성 안내', [tp.activities.map(a => a.sheet), tp.skipped]);
  check('기본형 — 꼬리표 자, 부서·활동명·입력 영역·입력 경로·유의 사항을 다 읽는다',
    ta?.tags.join() === '자' && ta.dept && ta.title && ta.area && ta.path && ta.note, ta);
  check('기본형 — 기재 문안 「기재 내용」, 학생 글 「자기 평가서」, 기타 칸 없음, 예시 3줄',
    ta?.body === '기재 내용' && ta.self === '자기 평가서' && !ta.extra.length && ta.count === 3, ta);
  check('칸을 더한 형 — 꼬리표 개, 주제는 기타 칸, 학생 글 없음, 예시 2줄',
    tb?.tags.join() === '개' && tb.body === '기재 내용' && !tb.self && tb.extra.join() === '주제' && tb.count === 2, tb);
  const odd0 = P.sgbOddSheets(tp.activities);
  check('양식을 그대로 올리면 「예)」 예시 글이 남았다고 알린다(칸은 맞다)', odd0.length === 2
    && odd0.every(x => x.why.includes('예)')), odd0.map(x => x.why));
  const filled = tp.activities.map(a => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? v.replace(/^예\) /, '') : v])));
  check('— 예시 글을 지우고 채우면 경고 없음', !P.sgbOddSheets(filled).length, P.sgbOddSheets(filled).map(x => x.why));
  check('예시 이름은 지어낸 것만', tp.students.every(x => ['김가람', '박나래', '최다온', '이보람'].includes(x.nm)), tp.students.map(x => x.nm));
  const tw = new ExcelJS.Workbook();
  await tw.xlsx.readFile(tf);
  const tws = tw.getWorksheet(ta.sheet);
  const tfm = P.sgbFormOf(tws, ta, 'act');
  check('양식 뜨기 — 머리 5행, 숨긴 A열은 학번(수식 값으로), 순번·학년·반·번호·성명·자기 평가서·기재 내용',
    tfm?.h === 5 && tfm.roles.join() === ',key,seq,g,c,n,nm,s,b', tfm?.roles);
  const hc = tws.getCell('C5');
  check('원래 양식 모양 — 파란 머리줄에 흰 굵은 돋움 10', hc.fill?.fgColor?.argb === BLUE && hc.font?.bold === true
    && hc.font?.name === '돋움' && hc.font?.size === 10 && hc.font?.color?.argb === 'FFFFFFFF', hc.style);
  check('원래 양식 모양 — 부서 이름 HY헤드라인M(B1:D1 병합), 안내 칸 이름 E:F 병합',
    tws.getCell('B1').font?.name === 'HY헤드라인M' && tfm.merges.includes('B1:D1') && tfm.merges.includes('E1:F1'), tfm.merges);
  check('원래 양식 모양 — A열 숨김, 자기 평가서 50 · 기재 내용 81, 가로 인쇄',
    tws.getColumn(1).hidden === true && tws.getColumn(7).width === 50 && tws.getColumn(8).width === 81 && tws.pageSetup.orientation === 'landscape');
  const bc = tws.getCell('H6');
  check('본문 글꼴 돋움 10, 글 칸은 줄바꿈', bc.font?.name === '돋움' && bc.font?.size === 10 && bc.alignment?.wrapText === true, bc.style);
  const guide = [];
  tw.getWorksheet('작성 안내').eachRow(r => guide.push(String(r.getCell(1).value || '')));
  const g = guide.join('\n');
  check('작성 안내 — 차수를 붙이지 않음 · 회차는 괄호 안 · 앱에서 바로 올리는 법', g.includes('차수(-1차 · -2차)를 붙이지 않습니다')
    && g.includes('강연(1차)') && g.includes('📤 엑셀 올리기') && g.includes('확인할 시트'), g.slice(0, 200));
}

// ── 3. 화면 ──
console.log('\n[화면]');
const ORIGIN = 'https://kyunghwanp.github.io';
const STUB = {
  'firebase-app.js': 'export function initializeApp(){ return {}; }',
  'firebase-auth.js': `
    const u = window.__TEST_EMAIL__ ? { email: window.__TEST_EMAIL__, getIdToken: async () => 'tok' } : null;
    const auth = { currentUser: u };
    export function getAuth(){ return auth; }
    export function onAuthStateChanged(a, cb){ setTimeout(() => cb(a.currentUser), 0); return () => {}; }
    export function setPersistence(){ return Promise.resolve(); }
    export class GoogleAuthProvider {}
    export function signInWithPopup(){ return Promise.reject(new Error('no')); }
    export const indexedDBLocalPersistence = {}, browserLocalPersistence = {};`,
  'firebase-firestore.js': `
    const fs = () => (window.__FS__ = window.__FS__ || {});
    const ops = () => (window.__OPS__ = window.__OPS__ || { get: 0, set: 0, del: 0, w: [] });
    const rec = (k, ref) => { const o = ops(); if (k === 's') o.set++; else o.del++; (o.w = o.w || []).push([k, ref]); };
    const clone = v => JSON.parse(JSON.stringify(v));
    export function getFirestore(){ return {}; }
    export function doc(db, c, id){ return c + '/' + id; }
    export async function getDoc(ref){ ops().get++; const d = fs()[ref]; return { exists: () => !!d, data: () => d && clone(d) }; }
    export async function setDoc(ref, data){ rec('s', ref); fs()[ref] = clone(data); }
    export async function deleteDoc(ref){ rec('d', ref); delete fs()[ref]; }
    // 트랜잭션 — 한 탭 안에서는 차례로 도니 읽고 쓰기만 흉내 낸다
    export async function runTransaction(db, fn){
      return fn({ get: async ref => getDoc(ref), set(ref, d){ rec('s', ref); fs()[ref] = clone(d); }, delete(ref){ rec('d', ref); delete fs()[ref]; } });
    }
    export function writeBatch(){
      const q = [];
      return { set(ref, d){ q.push(['s', ref, clone(d)]); }, delete(ref){ q.push(['d', ref]); },
        async commit(){ for (const [k, ref, d] of q){ rec(k, ref); if (k === 's') fs()[ref] = d; else delete fs()[ref]; } } };
    }`,
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let STORE = {};   // 문맥이 바뀌어도(다른 사람으로 열어도) 같은 Firestore 를 보게
async function openAs(email, { width = 1100, blockExcel = false } = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  await ctx.route(ORIGIN + '/test/saenggibu.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await ctx.route(ORIGIN + '/test/favicon-32.png', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB[r.request().url().split('/').pop()] || '' }));
  // 서식 도구(ExcelJS)는 jsDelivr 가 먼저, cdnjs 가 예비. blockExcel 이면 둘 다 막는다(못 받았을 때)
  const ej = r => blockExcel ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'text/javascript', body: EXCELJS });
  await ctx.route('https://cdn.jsdelivr.net/**', ej);
  await ctx.route('https://cdnjs.cloudflare.com/**', r => r.request().url().includes('exceljs') ? ej(r)
    : r.fulfill({ status: 200, contentType: 'text/javascript', body: XLSXJS }));
  // 고화질 사진 — 1-1-1 만 있다(나머지는 404 → 작은 사진 그대로)
  await ctx.route('https://teacher-api.pkh910518.workers.dev/**', r => /g=1&r=1&n=1\b/.test(r.request().url())
    ? r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.split(',')[1], 'base64') })
    : r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(([e, store]) => {
    window.__TEST_EMAIL__ = e; window.__FS__ = store;
    navigator.clipboard.writeText = async t => { window.__copied = t; };
    // 내려받을 때 붙인 파일 이름 — Playwright 의 Chromium 은 한글 이름을 'download' 로 바꿔 버려서 여기서 본다
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dlName = this.download; return click.call(this); };
  }, [email, STORE]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(ORIGIN + '/test/saenggibu.html?in=1');
  page.errors = errors;
  return page;
}
const keep = async page => { STORE = await page.evaluate(() => window.__FS__); };
// 자료 문서 쓰기만 — 잠금(saenggibu/lock)·올린 기록(saenggibu/log)은 빼고 센다
const dataOps = o => { const w = (o.w || []).filter(([, r]) => !/^saenggibu\/(lock|log)$/.test(r));
  return { set: w.filter(([k]) => k === 's').length, del: w.filter(([k]) => k === 'd').length }; };
// 요소가 없으면 빈 글자(흐름이 틀어져도 멈추지 말고 ❌ 로)
const txt = async (p, sel) => (await p.$(sel)) ? p.textContent(sel) : '';
// 눈 확인용 캡처 — SGB_SHOTS=<폴더> 를 주면 그때만 찍는다(검사 결과에는 영향 없음)
const shot = async (p, sel, name) => { if (!process.env.SGB_SHOTS) return;
  const el = await p.$(sel); if (el) await el.screenshot({ path: path.join(process.env.SGB_SHOTS, name + '.png') }); };
const ADMIN = 'pkh910518@yeungnam.hs.kr', KIM = 'kim@yeungnam.hs.kr', LEE = 'lee@yeungnam.hs.kr';
const ADMIN_E = ADMIN;

// 3-0 칸 이름이 안 맞는 시트 — 올리기 전에 알린다(쓰지 않고 닫는다)
STORE = { 'students/main': { students: ROSTER } };
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#body .empty');
  await p.setInputFiles('#upFile', FILE_ODD);
  await p.waitForSelector('#upGo');
  const odd = (await p.$('#upOdd')) ? await p.textContent('#upOdd') : '';
  check('미리보기 — 기재 문안 칸을 못 찾은 시트를 알리고, 어떤 칸으로 읽었는지까지',
    odd.includes('확인할 시트 1개') && odd.includes('국어(이름 다른 칸)') && odd.includes('기재 문안 칸 없음') && odd.includes('작성할 글'), odd);
  check('— 칸이 맞는 시트는 경고에 안 든다', odd && !odd.includes('교무(정상)'), odd);
  await p.close();
}

// 3-1 처음 — 아무것도 없을 때(학교 명렬은 있다)
STORE = { 'students/main': { students: ROSTER }, 'studentPhotos/1-1': { photos: { 1: PNG }, updatedAt: 'v1' } };
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#body .empty');
  check('자료가 없으면 관리자에게 올리라고 안내', (await p.textContent('#body')).includes('엑셀 올리기'));
  check('관리자에게만 올리기 단추', await p.isVisible('#upBtn'));

  await p.setInputFiles('#upFile', FILE1);
  await p.waitForSelector('#upGo');
  const panel = await p.textContent('#upPanel');
  check('올리기 전 미리보기 — 활동 6 · 창체 일정 1 · 학생 수', /활동 시트 6개/.test(panel) && /창체 일정 1개/.test(panel)
    && panel.includes(`학생 ${parsed.students.length}명`), panel.slice(0, 200));
  check('미리보기에 건너뛴 시트와 까닭', panel.includes('학생 개인별 조회') && panel.includes('숨긴 시트'));
  check('미리보기 — 반·번호·이름 확인 2건', (await p.textContent('#upMis')).includes('확인 2건') && (await p.textContent('#upMis')).includes('2-1-2'));
  check('처음 올릴 때 — 전부 「새로 추가」, 물어볼 것 없음', panel.includes('새로 추가 7') && !(await p.$('#upMissing')), panel.slice(0, 300));
  check('원본 양식도 함께 — 7/7 시트', panel.includes('원본 양식 7/7'), panel.slice(0, 300));
  check('칸이 다 맞으면 「확인할 시트」 경고 없음(봉사 누가기록은 문안 칸이 원래 없어 뺀다)', !(await p.$('#upOdd')));
  check('미리보기 — 새 시트마다 어느 칸을 무엇으로 읽었는지', (await p.textContent('#upAdded')).includes('기재 문안 「기재 내용」 / 학생 글 「자기 평가서」'),
    (await p.textContent('#upAdded')).slice(0, 300));
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  const fsKeys = await p.evaluate(() => Object.keys(window.__FS__));
  check('목록·지문·학생·활동 문서가 저장된다', fsKeys.includes('saenggibu/meta') && fsKeys.includes('saenggibu/manifest')
    && fsKeys.includes('saenggibuStu/1-1-1') && fsKeys.some(k => k.startsWith('saenggibuAct/')), fsKeys);
  const meta = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  check('목록에 파일 이름·올린 사람·시각', meta.file === path.basename(FILE1) && meta.by === ADMIN && !!meta.at);
  check('활동마다 어느 파일에서 왔는지', meta.activities.every(a => a.file === path.basename(FILE1)));
  check('양식 문서 7개(saenggibu/fmt-…)', fsKeys.filter(k => k.startsWith('saenggibu/fmt-')).length === 7);
  check('관리자에게 「엑셀로 받기」', await p.isVisible('#dlBtn'));
  check('목록에 어긋난 줄 2건이 남는다', (meta.mismatch || []).length === 2);
  check('「⚠ 확인 필요 2」 탭이 생긴다', await p.isVisible('#chkTab') && (await p.textContent('#chkTab')).includes('2'));
  await p.click('#chkTab');
  await p.waitForSelector('table.chk');
  const chk = await p.textContent('#body');
  check('확인 필요 — 시트별로, 학번·엑셀 이름·명렬 이름·내용', chk.includes(robot.sheet) && chk.includes('최다온') && chk.includes('명렬에 없는 학번')
    && (await p.$$('table.chk tbody tr')).length === 2);
  check('확인 필요 표의 이름도 글자로만', await p.evaluate(() => window.__xss === undefined));
  await p.click('#views button[data-view="stu"]');

  // 엑셀로 받기 — 내려받은 파일을 열어 본다
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dlBtn')]);
  const dlName = await p.evaluate(() => window.__dlName);
  check('파일 이름 — 생기부 보조자료_날짜.xlsx', /^생기부 보조자료_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dlName), dlName);
  const out = new ExcelJS.Workbook();
  await out.xlsx.readFile(await dl.path());
  const names = out.worksheets.map(w => w.name);
  check('시트 — 원래 이름·원래 차례, 목차는 맨 뒤', names.length === 8 && names.at(-1) === '목차' && names[0] === sch.sheet && names[2] === robot.sheet, names);
  check('시트 탭 색 그대로(노랑)', out.getWorksheet(robot.sheet).properties.tabColor?.argb === 'FFFFFF00', out.getWorksheet(robot.sheet).properties.tabColor);
  check('원본 줄 높이 그대로(120)', out.getWorksheet(robot.sheet).getRow(6).height === 120);
  const toc = out.getWorksheet('목차');
  const tocTxt = []; toc.eachRow(r => tocTxt.push(r.values.join('|')));
  check('목차 — 활동마다 건수와 시트 이름', tocTxt.some(t => t.includes('진로탐색 로봇공학 캠프') && t.includes('|2|') && t.includes(robot.sheet)), tocTxt.slice(0, 5));
  const rw = out.getWorksheet(robot.sheet);
  check('원본 틀 — 머리 글꼴 HY헤드라인M 16, 병합 B1:D1', rw.getCell('B1').font?.name === 'HY헤드라인M' && rw.getCell('B1').font?.size === 16
    && (rw.model.merges || []).includes('B1:D1'), [rw.getCell('B1').font, rw.model.merges]);
  check('원본 틀 — 파란 머리줄, 숨긴 A열, 열 너비, 가로 인쇄', rw.getCell('C5').fill?.fgColor?.argb === BLUE && rw.getColumn(1).hidden
    && rw.getColumn(8).width === 81 && rw.pageSetup.orientation === 'landscape');
  check('자료 — 반·번호 순, 원본 칸 자리(B 순번 · F 성명 · H 기재 내용)', rw.getCell('B6').value === 1 && rw.getCell('F6').value === '김가람'
    && String(rw.getCell('H6').value).startsWith('로봇 코딩') && rw.getCell('F7').value === XSS, [rw.getCell('B6').value, rw.getCell('F6').value]);
  check('본문 글꼴은 돋움 10 으로 통일(원본 나눔고딕 14 → 돋움 10)', ['B6', 'F6', 'H6', 'H7'].every(a => rw.getCell(a).font?.name === '돋움' && rw.getCell(a).font?.size === 10),
    rw.getCell('H6').font);
  check('본문 테두리·줄바꿈은 원본대로', rw.getCell('H6').border?.left?.style === 'thin' && rw.getCell('H6').alignment?.wrapText === true);
  check('수학 — 학년반번호 칸에 10101', out.getWorksheet(math.sheet).getCell('A4').value === '10101');
  check('이름 없는 숨긴 학번 칸도 채운다(로봇 A6 = 10101)', rw.getCell('A6').value === '10101');
  check('창체 일정 시트 — 표 그대로', out.getWorksheet(sch.sheet).getCell('K4').value === '도서관 활용교육');
  check('창체 일정 엑셀은 원본 그대로(소계 줄도)', out.getWorksheet(sch.sheet).getCell('A8').value === '3월 소계');

  // 학생별
  await p.waitForSelector('#stus .stu');
  check('학생별 — 1학년 1반이 먼저, 번호·이름·자료 건수', (await p.$$eval('#stus .stu', bs => bs.map(x => [...x.children].filter(c => c.tagName !== 'IMG').map(c => c.textContent).join('/')))).join('|') === `1/김가람/3|2/${XSS}/1`,
    await p.$$eval('#stus .stu', bs => bs.map(x => x.textContent)));
  check('반 목록 — 처음엔 보고 있는 학년(1)만 펼침', await p.isVisible('.cls-pc .cl-list[data-g="1"]') && !(await p.isVisible('.cls-pc .cl-list[data-g="3"]')));
  await p.click('.cls-pc .cl-grade[data-g="3"]');
  check('학년 머리를 누르면 펼친다', await p.isVisible('.cls-pc .cl-list[data-g="3"]') && (await p.textContent('.cls-pc .cl-grade[data-g="3"]')).includes('▾'));
  await p.click('.cls-pc .cl-grade[data-g="1"]');
  check('다시 누르면 접는다(보던 반이 있는 학년도)', !(await p.isVisible('.cls-pc .cl-list[data-g="1"]')) && (await p.textContent('.cls-pc .cl-grade[data-g="1"]')).includes('▸'));
  await p.click('.cls-pc .cl-grade[data-g="1"]');
  check('반 목록 — 학년 머리와 반별 학생 수', (await p.textContent('#clsPane')).includes('1학년') && (await p.textContent('#clsPane .cl-item.on')).replace(/\s+/g, '') === '1반2');
  check('이름에 섞인 태그는 글자로만 — 실행되지 않는다', await p.evaluate(() => window.__xss === undefined));
  await p.click('#stus .stu[data-n="1"]');
  await p.waitForSelector('#stuOut .card');
  const shownCards = () => p.evaluate(() => [...document.querySelectorAll('#stuOut .card')].filter(c => !c.closest('.vol-split')).length);
  check('학생 1-1-1 — 카드 3장(로봇·수학·봉사활동 누가기록 표)', await shownCards() === 3);
  check('명단에 작은 사진(사진 있는 학생만)', await p.$eval('#stus .stu[data-n="1"] .ph', i => i.classList.contains('on') && i.src.startsWith('data:image'))
    && !(await p.$eval('#stus .stu[data-n="2"] .ph', i => i.classList.contains('on'))));
  await p.waitForFunction(() => document.getElementById('sPhoto')?.src.startsWith('blob:'));
  check('상세 사진 — 작은 사진 뒤 고화질(워커)로 바꿔 끼운다', await p.isVisible('#sPhoto'));
  await p.click('#sPhoto');
  check('사진을 누르면 크게, 이름·학년반번호', await p.isVisible('#zoom') && (await p.textContent('#zoomCap')).includes('김가람 · 1학년 1반 1번'));
  await p.click('#zoom');
  check('다시 누르면 닫힌다', !(await p.isVisible('#zoom')));
  check('학생별 카드에도 유의 사항(로봇)', await p.$$eval('#stuOut .card', cs => cs.some(c => c.textContent.includes('진로탐색 로봇공학 캠프') && c.querySelector('.note')?.textContent.includes('담임 교사가 최종 수정'))));
  const grps = await p.$$eval('#stuOut .grp', gs => gs.map(g => g.textContent.replace(/\s+/g, ' ').trim()));
  check('입력 영역별 묶음 — 자율·진로가 앞, 누가기록이 뒤', grps.length === 2 && grps[0].includes('자율') && grps[0].includes('진로')
    && grps[1].includes('누가기록'), grps);
  await p.click('#stuOut .card [data-copy]');
  check('복사 — 기재 문안이 그대로', await p.evaluate(() => window.__copied) === '로봇 코딩 캠프에 참여하여 센서 제어를 익힘.');
  await p.evaluate(() => { window.__copied = ''; });
  await p.click('#stuOut .card .body');
  check('문안 상자를 눌러도 복사된다', await p.evaluate(() => window.__copied) === '로봇 코딩 캠프에 참여하여 센서 제어를 익힘.');
  check('학생 글(자기 평가서)은 접어 둔다', (await p.$$('#stuOut details')).length >= 1 && !(await p.isVisible('#stuOut details .txt')));
  const vcard = await p.$$eval('#stuOut .card', cs => cs.map(c => c.textContent).find(t => t.includes('헌혈')) || '');
  check('봉사처럼 기재 칸이 없으면 칸 이름과 값으로', vcard.includes('시작일자') && vcard.includes('2026.04.10.'), vcard);

  // 참여한 활동 목록 — 활동명 + 입력 영역(어디에 적을 수 있는지). 누르면 그 카드로(선생님 요청 2026-10-28)
  const actList = await p.evaluate(() => {
    const ids = [...new Set([...document.querySelectorAll('#stuOut .card[data-a]')].map(c => c.dataset.a))];
    const lis = [...document.querySelectorAll('#stuOut .s-acts li')];
    return { ids, got: lis.map(li => li.querySelector('[data-go]')?.dataset.go), tagged: lis.every(li => li.querySelector('.tag')),
      txt: lis.map(li => li.textContent.replace(/\s+/g, ' ').trim()) };
  });
  check('참여한 활동 — 카드의 활동이 하나씩 빠짐없이(봉사도)', actList.ids.length >= 3 && actList.got.length === actList.ids.length
    && actList.ids.every(id => actList.got.includes(id)), actList);
  check('참여한 활동 — 줄마다 입력 영역 칩', actList.tagged, actList.txt);
  check('참여한 활동 — 머리에 몇 개인지', (await p.textContent('#stuOut .s-acts-h')).includes(String(actList.ids.length)));
  const ph = await p.evaluate(() => { const r = document.getElementById('sPhoto').getBoundingClientRect(); return [r.width, r.height]; });
  check('상세 사진 — 조금 크게(120×160)', ph[0] === 120 && ph[1] === 160, ph);
  const narrow = await p.evaluate(() => { const s = document.querySelector('#stuOut .sheet').getBoundingClientRect(), l = document.querySelector('#stuOut .s-acts').getBoundingClientRect(),
    ph = document.getElementById('sPhoto').getBoundingClientRect(); return { inSheet: l.right <= s.right + 1 && l.left >= ph.right, top: l.top < ph.bottom + 200 }; });
  check('좁은 화면 — 목록은 이름 아래, 사진 옆 빈자리', narrow.inSheet && narrow.top, narrow);
  const goTo = async sel => {
    await p.evaluate(() => { document.getElementById('stuOut').scrollTop = 0; });
    await p.click(sel);
    await p.waitForTimeout(700);
  };
  // 맨 끝 일반 카드(봉사 표 아래) — 내려가야 보이는 것
  const mathId = await p.$$eval('#stuOut .card[data-a]', cs => cs.filter(c => !c.closest('.vol-split')).at(-1)?.dataset.a);
  await goTo(`#stuOut .s-acts [data-go="${mathId}"]`);
  check('목록에서 누르면 그 카드가 위로', await p.evaluate(id => { const c = document.querySelector(`#stuOut .card[data-a="${id}"]`).getBoundingClientRect(),
    o = document.getElementById('stuOut').getBoundingClientRect(); return document.getElementById('stuOut').scrollTop > 0 && c.top >= o.top - 2 && c.top < o.top + 120; }, mathId));
  const volId = await p.$eval('#stuOut .vol-split .card[data-a]', c => c.dataset.a);
  await goTo(`#stuOut .s-acts [data-go="${volId}"]`);
  // 표가 맨 아래라 끝까지 내려가도 위에 닿지 않을 수 있다 — 끝까지 내려갔거나 위에 닿았으면 된다
  check('봉사 활동을 누르면 누가기록 표로(접힌 카드 말고)', await p.evaluate(() => { const e = document.getElementById('stuOut'), c = document.querySelector('#stuOut .card.vol').getBoundingClientRect(),
    o = e.getBoundingClientRect(); return e.scrollTop > 0 && c.top >= o.top - 2 && (c.top < o.top + 120 || e.scrollTop >= e.scrollHeight - e.clientHeight - 1); }));
  // FHD — 오른쪽 빈자리에 목록, 내려도 따라온다
  await p.setViewportSize({ width: 1920, height: 1000 });
  await p.evaluate(() => { document.getElementById('stuOut').scrollTop = 0; });
  const wide = await p.evaluate(() => { const s = document.querySelector('#stuOut .sheet').getBoundingClientRect(), l = document.querySelector('#stuOut .s-acts-in').getBoundingClientRect(),
    o = document.getElementById('stuOut').getBoundingClientRect(); return { right: l.left >= s.right, fits: l.right <= o.right, top: Math.abs(l.top - s.top) < 4 }; });
  check('FHD — 목록은 카드 오른쪽 빈자리, 화면 안에', wide.right && wide.fits && wide.top, wide);
  if (process.env.SGB_SHOTS) await shot(p, '#stuOut', '7-stu-acts-fhd');
  await p.evaluate(() => { const o = document.getElementById('stuOut'); o.scrollTop = o.scrollHeight; });
  check('FHD — 끝까지 내려도 목록이 보인다', await p.evaluate(() => { const l = document.querySelector('#stuOut .s-acts-in').getBoundingClientRect(),
    o = document.getElementById('stuOut').getBoundingClientRect(); return l.top >= o.top - 1 && l.top < o.top + 40; }));
  await p.setViewportSize({ width: 1100, height: 900 });
  if (process.env.SGB_SHOTS){ await p.evaluate(() => { document.getElementById('stuOut').scrollTop = 0; }); await shot(p, '#stuOut', '7-stu-acts-narrow'); }

  // 학번으로
  await p.fill('#hakbun', '30205');
  await p.press('#hakbun', 'Enter');
  await p.waitForFunction(() => document.querySelector('#stuOut .s-id')?.textContent.includes('30205'));
  const t3 = await p.textContent('#stuOut');
  check('사진이 없는 학생은 사진 칸 없이', !(await p.isVisible('#sPhoto')));
  check('학번 30205 → 3학년 2반 5번', t3.includes('3학년 2반 5번') && t3.includes('30205') && t3.includes('박나래'));
  check('반 목록도 그 반으로 옮겨 간다', (await p.textContent('#clsPane .cl-item.on')).includes('2반') && (await p.textContent('.roster-head')).includes('3학년 2반'));
  check('활동명이 겹치면 시트 이름으로 가른다 [학급 임원]', t3.includes('학생회 임원') && t3.includes('[학급 임원]'));
  check('겹치지 않으면 시트 이름을 안 붙인다', !t3.includes('[수업량유연화]'));
  check('직책 같은 덧붙은 정보', t3.includes('직책') && t3.includes('반장'));
  const sessHead = await p.$$eval('#stuOut .sess th', ts => ts.map(t => t.textContent));
  check('회차 표 — 한 칸에 줄바꿈으로 든 회차를 풀어 보인다(회차·시작일자·요일·시간)', sessHead.join() === '회차,시작일자,요일,시간'
    && (await p.$$('#stuOut .sess tbody tr')).length === 2, sessHead);
  // 봉사활동 누가기록 — 나이스 입력창 모양, 회차를 풀어 날짜 순, 시간 누계
  const neis = await p.$$eval('#stuOut .neis tbody tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent.trim())));
  check('봉사 — 나이스와 같은 칸 차례(시작일자…시간 누계), 입력칸 모양이 아닌 표', (await p.$$eval('#stuOut .neis th', ts => ts.map(t => t.textContent))).join() ===
    '시작일자,종료일자,영역구분,봉사활동내용,학교/개인 구분,장소 또는 주관 기관명,시간,시간 누계' && !(await p.$('#stuOut .neis .f')));
  check('봉사 — 한 칸의 회차 둘을 두 줄로, 날짜 순, 시간 누계 6 → 12', neis.length === 2 && neis[0][0] === '2026.03.09.' && neis[1][0] === '2026.03.16.'
    && neis[0][3] === '교과학습도우미' && neis[0][7] === '6' && neis[1][7] === '12', neis);
  await p.click('#stuOut .neis tbody tr:first-child td.c-content');
  check('봉사 — 칸을 누르면 그 내용이 복사된다', await p.evaluate(() => window.__copied) === '교과학습도우미');
  check('활동별 카드는 처음엔 접혀 있다', !(await p.isVisible('#volSplit')));
  const ln = await p.$eval('#stuOut .card.vol .note .nt', n => [n.clientHeight, n.scrollHeight]);
  check('긴 유의 사항은 줄여 보이고(더보기)', ln[1] > ln[0] + 4 && await p.isVisible('#stuOut .card.vol .note-more'), ln);
  await p.click('#stuOut .card.vol .note-more');
  const ln2 = await p.$eval('#stuOut .card.vol .note .nt', n => [n.clientHeight, n.scrollHeight]);
  check('「더보기」 를 누르면 다 펼쳐지고 「접기」 로 바뀐다', ln2[1] <= ln2[0] + 1 && (await p.textContent('#stuOut .card.vol .note-more')).includes('접기'), ln2);
  await p.click('#volSplitBtn');
  check('「활동별로 나눠 보기」 — 원래 활동 카드(회차 표)가 펼쳐진다', await p.isVisible('#volSplit .sess'));
  check('회차 표에 든 칸은 아래 이름·값 목록에 다시 안 나온다', !(await p.$$eval('#stuOut .ex dt', ds => ds.map(d => d.textContent))).includes('요일'));

  // 이름으로 찾기 — 목록(meta)만 쓰므로 읽기가 늘지 않는다
  await p.fill('#hakbun', '가람');
  await p.waitForFunction(() => document.querySelector('.roster-head').textContent.includes('찾은 학생'));
  const found = await p.$$eval('#stus .stu', bs => bs.map(b => b.querySelector('.num').textContent + ' ' + b.querySelector('.nm').textContent));
  check('이름 찾기 — 반이 달라도 찾고, 반-번호를 같이 보인다', found.join() === '1-1-1 김가람', found);
  await p.click('#stus .stu');
  await p.waitForFunction(() => document.querySelector('#stuOut .s-name')?.textContent === '김가람');
  await p.click('#copyAll');
  const all = await p.evaluate(() => window.__copied);
  check('기재 문안 전체 복사 — 입력 영역·활동명을 머리에 붙여서, 문안 있는 것만', all.includes('[자율 · 진로] 진로탐색 로봇공학 캠프\n로봇 코딩')
    && all.includes('수학 대중화 강연') && !all.includes('헌혈'), all);
  await p.fill('#hakbun', '');
  await p.waitForFunction(() => !document.querySelector('.roster-head').textContent.includes('찾은 학생'));

  const inkUnder = () => p.evaluate(() => { const i = document.querySelector('#views > .ink'), on = document.querySelector('#views > button.on');
    return !!i && Math.abs(parseFloat(i.style.left) - on.offsetLeft) < 1 && Math.abs(parseFloat(i.style.width) - on.offsetWidth) < 1; });
  check('밑줄 탭 — 파란 줄이 고른 탭(학생별) 아래', await inkUnder());
  await p.hover('#views button[data-view="act"]');
  check('탭에 회색 음영 없음(마우스를 올려도 바탕은 투명)', await p.$eval('#views button[data-view="act"]', b => getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)'));
  // 활동별
  await p.click('#views button[data-view="act"]');
  await p.waitForTimeout(80);
  check('탭을 옮기면 파란 줄도 옮겨 간다(활동별)', await inkUnder());
  await p.waitForSelector('#acts .act');
  check('활동별 — 활동 6개', (await p.$$('#acts .act')).length === 6);
  await p.click(`#acts .act[data-id="${robot.id}"]`);
  await p.waitForSelector('#actRows .card');
  check('활동별 — 어긋난 학생 카드에 ⚠ 표시(1-1-2)', await p.$$eval('#actRows .card', cs => cs.filter(c => c.querySelector('.mis')).map(c => c.querySelector('.num').textContent)).then(x => x.join() === '1-1-2'));
  check('로봇 캠프 — 참여 학생 2명, 반별 수', (await p.$$('#actRows .card')).length === 2 && (await p.textContent('#actOut .counts')).includes('1반 2'));
  check('로봇 캠프 — 유의 사항은 상자 없이 굵은 글씨로, 짧으면 다 보인다', await p.isVisible('#actOut .note') && (await p.textContent('#actOut .note')).includes('담임 교사가 최종 수정')
    && +(await p.$eval('#actOut .note', n => getComputedStyle(n).fontWeight)) >= 700 && await p.$eval('#actOut .note', n => getComputedStyle(n).borderLeftWidth === '0px' && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)')
    && !(await p.$('#actOut .note .note-more')));
  check('로봇 캠프 — 시트·파일 이름', (await p.textContent('#actOut')).includes('파일: sgb-4.xlsx'));
  const rowTxt = await p.textContent('#actRows');
  check('태그 섞인 문안도 글자 그대로', rowTxt.includes('<b>태그</b>') && await p.evaluate(() => !document.querySelector('#actRows b')));
  // 봉사 — 활동별에서도 학생별처럼 나이스 칸 차례 표, 맨 앞에 학번·이름(선생님 요청 2026-10-28)
  await p.click(`#acts .act[data-id="${vol.id}"]`);
  await p.waitForSelector('#actRows table.neis');
  const vHeads = await p.$$eval('#actRows table.neis thead th', ths => ths.map(t => t.textContent.trim()));
  check('봉사 활동별 — 카드 대신 나이스 칸 차례 표, 맨 앞에 학번·이름', vHeads.slice(0, 4).join() === '학번,이름,시작일자,종료일자'
    && vHeads.at(-1) === '시간 누계' && !(await p.$('#actRows .card')), vHeads);
  const vRow = async () => p.$$eval('#actRows table.neis tbody tr', trs => trs.map(tr => [...tr.cells].map(td => td.textContent.trim())));
  const v1 = await vRow();
  check('— 1학년: 10101 김가람 · 2026.04.10. · 헌혈 · 4시간 · 누계 4', v1.length === 1 && v1[0][0] === '10101' && v1[0][1] === '김가람'
    && v1[0][2] === '2026.04.10.' && v1[0].includes('헌혈') && v1[0].at(-2) === '4' && v1[0].at(-1) === '4', v1);
  await p.click('#selAG button[data-g="3"]');
  await p.waitForFunction(() => document.querySelectorAll('#actRows table.neis tbody tr').length === 2);
  const v3 = await vRow();
  check('— 한 칸에 든 회차는 한 줄씩, 학번·이름은 그 학생 첫 줄에만(두 줄에 걸침), 누계는 학생마다(6 → 12)',
    v3[0][0] === '30205' && v3[0][1].includes('박나래') && v3[1][0] === '2026.03.16.' && v3[0].at(-1) === '6' && v3[1].at(-1) === '12'
    && (await p.$eval('#actRows td.c-nm', td => td.rowSpan)) === 2, v3);
  check('— PC: 학번·이름이 한 줄(꺾이지 않음)', await p.evaluate(() => ['.c-hak', '.c-nm'].every(sel => {
    const td = document.querySelector('#actRows ' + sel), lh = parseFloat(getComputedStyle(td).lineHeight) || 24;
    const r = document.createRange(); r.selectNodeContents(td); return r.getClientRects().length === 1 || r.getBoundingClientRect().height < lh * 1.5; })));
  if (process.env.SGB_SHOTS){ await p.setViewportSize({ width: 1440, height: 900 }); await shot(p, '#actOut', '6-vol-act-pc'); await p.setViewportSize({ width: 1100, height: 900 }); }
  await p.click('#actRows td.c-nm');
  check('— 칸을 누르면 복사(이름)', (await p.evaluate(() => window.__copied)) === '박나래');
  // 「전체」 — 업무 담당자가 모든 학년을 한 번에(선생님 요청 2026-10-28)
  check('학년 탭 맨 앞에 「전체」', (await p.$$eval('#selAG button', bs => bs.map(b => b.textContent.trim()))).join() === '전체,1학년,3학년');
  await p.click('#selAG button[data-g="all"]');
  await p.waitForFunction(() => document.querySelectorAll('#actRows table.neis tbody tr').length === 3);
  const vAll = await vRow();
  check('「전체」 — 모든 학년을 학년·반·번호 순으로(10101 → 30205), 칩은 「전체 학년 2」 하나',
    vAll[0][0] === '10101' && vAll[1][0] === '30205' && (await p.textContent('#actChips')).replace(/\s+/g, ' ').trim() === '전체 학년 2'
    && (await p.$$('#actChips .chip')).length === 1, [vAll.map(r => r[0]), await p.textContent('#actChips')]);
  check('— 고른 탭을 기억한다(다시 열어도 전체)', await p.evaluate(() => JSON.parse(localStorage.getItem('ynhs-sgb') || '{}').ag) === 'all');
  await p.click(`#acts .act[data-id="${robot.id}"]`);
  await p.waitForSelector('#actRows .card');
  check('— 봉사가 아닌 활동은 그대로 카드', !(await p.$('#actRows table.neis')));
  await p.fill('#actQ', '없는활동');
  await p.waitForFunction(() => document.querySelector('#acts').textContent.includes('맞는 활동이 없습니다'));
  check('활동 찾기 — 없으면 안내', true);
  await p.fill('#actQ', '');

  // 창체 일정
  await p.click('#views button[data-view="sch"]');
  await p.waitForSelector('table tbody tr');
  check('창체 일정 — 활동 내용이 있는 줄만(소계·내용 없는 줄은 없는 줄로) 3줄', (await p.$$('table tbody tr')).length === 3
    && (await p.textContent('table')).includes('도서관 활용교육') && !(await p.textContent('table')).includes('소계'));
  check('창체 일정 — 거르기 칩: 전체 · 자율·자치 1 · 진로 1 · 동아리 1', (await p.$$eval('#schKinds .chip', cs => cs.map(c => c.textContent.replace(/\s+/g, '')))).join() === '전체,자율·자치1,진로1,동아리1');
  await p.click('#schKinds .chip[data-k="jin"]');
  await p.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 1);
  check('진로만 — 활동 영역이 비어도 진로 시간 칸으로 가른다, 건수·이수시간', (await p.textContent('table tbody')).includes('진로 롤모델 조사')
    && (await p.textContent('.sch-sum')).includes('1건') && (await p.textContent('.sch-sum')).includes('이수 1시간'));
  await p.click('#schKinds .chip[data-k="club"]');
  await p.waitForFunction(() => document.querySelector('table tbody').textContent.includes('동아리 편성'));
  check('동아리만', (await p.$$('table tbody tr')).length === 1);
  check('활동 내용·활동 영역 칸은 짧아도 왼쪽 정렬, 숫자 칸은 가운데', await p.$eval('table tbody tr td:nth-child(11)', td => getComputedStyle(td).textAlign) === 'left'
    && await p.$eval('table tbody tr td:nth-child(10)', td => getComputedStyle(td).textAlign) === 'left'
    && await p.$eval('table tbody tr td:nth-child(4)', td => getComputedStyle(td).textAlign) === 'center');
  await p.click('#schKinds .chip[data-k=""]');
  check('오류 없음', p.errors.length === 0, p.errors);
  await keep(p);
  await p.context().close();
}

// 3-2 다시 올리기(로봇 문안이 바뀌고 학급 임원 시트가 빠진 파일) — 관리자도 기본은 「추가·수정」: 빠진 것은 그대로
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0, w: [] }; });
  await p.setInputFiles('#upFile', FILE2);
  await p.waitForSelector('#upGo');
  const panel = await p.textContent('#upPanel');
  check('미리보기 — 바뀐 시트와 건수(2건 → 2건)', panel.includes('내용이 바뀜 1') && (await p.textContent('#upChanged')).includes('2건 → 2건'), panel.slice(0, 400));
  check('미리보기 — 그대로 5', panel.includes('그대로 5'));
  const miss = await p.textContent('#upMissing');
  check('미리보기 — 이 파일에 없는 기존 시트는 「그대로 둡니다」(기본 추가·수정, 묻지 않음)',
    miss.includes('기존 자료 1개') && miss.includes('그대로 둡니다') && !(await p.isVisible('#upMissing select')), miss);
  check('관리자에게만 「올리는 방식」 — 추가·수정이 기본', await p.isVisible('#upMode')
    && await p.$eval('input[name="upMode"]:checked', r => r.value) === 'add');
  check('「내용이 바뀜」 에 기존 것을 누가 언제 올렸는지(관리자)', (await p.textContent('#upChanged')).includes('기존: 관리자'),
    await p.textContent('#upChanged'));
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  const ops = await p.evaluate(() => window.__OPS__);
  const keys = await p.evaluate(() => Object.keys(window.__FS__));
  const msg = await p.textContent('#upPanel');
  check('남기면 — 바뀐 문서만 쓴다(로봇 활동 · 학생 1-1-1 · 목록 둘)', dataOps(ops).set === 4 && dataOps(ops).del === 0, dataOps(ops));
  check('쓰는 동안 잠그고, 다 쓰면 푼다', ops.w[0]?.[1] === 'saenggibu/lock' && ops.w.at(-1)?.[0] === 'd' && ops.w.at(-1)?.[1] === 'saenggibu/lock'
    && !keys.includes('saenggibu/lock'), ops.w.map(x => x.join(':')));
  const lg = await p.evaluate(() => window.__FS__['saenggibu/log']);
  check('올린 기록 — 누가 · 어느 파일 · 바뀐 활동', lg?.items?.[0]?.by === ADMIN_E && lg.items[0].file === 'sgb-5.xlsx'
    && lg.items[0].changed.length === 1, lg?.items?.[0]);
  check('남긴 시트의 활동 문서·양식 문서가 그대로 있다', keys.some(k => k.startsWith(`saenggibuAct/${officer.id}`)) && keys.includes(`saenggibu/fmt-${officer.id}`));
  check('결과 안내 — 추가·바뀜·남김·지움', msg.includes('추가 0 · 바뀜 1 · 남김 1 · 지움 0'), msg);
  const s325 = await p.evaluate(() => window.__FS__['saenggibuStu/3-2-5']);
  check('남긴 시트의 문안이 학생 문서에 그대로(3-2-5 세 건)', s325.items.length === 3, s325);
  const meta = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  check('남긴 활동은 처음 파일 이름, 바뀐 활동은 새 파일 이름', meta.activities.find(a => a.id === officer.id).file === 'sgb-4.xlsx'
    && meta.activities.find(a => a.id === robot.id).file === 'sgb-5.xlsx');
  check('바뀐 문안이 화면에 — 로봇', (await p.evaluate(() => window.__FS__['saenggibuStu/1-1-1'].items.map(i => i.b || '').join('|'))).includes('발표함'));
  const rb = meta.activities.find(a => a.id === robot.id);
  check('바뀐 활동에 올린 사람·바뀐 날짜(처음 날짜는 첫 올리기 것)', rb.by === ADMIN_E && rb.upd && rb.since && rb.since < rb.upd, rb);
  await keep(p);
  await p.context().close();
}

// 3-2a 남길 자료 일부를 못 읽으면 — 조용히 비우지 않고 멈춘다(아무것도 안 쓴다)
{
  const saved = STORE;
  STORE = Object.fromEntries(Object.entries(saved).filter(([k]) => !k.startsWith(`saenggibuAct/${officer.id}`)));
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0, w: [] }; });
  await p.setInputFiles('#upFile', FILE2);
  await p.waitForSelector('#upGo');
  await p.click('#upGo');
  await p.waitForFunction(() => /실패|올렸습니다/.test(document.getElementById('upPanel').textContent));
  const ops = await p.evaluate(() => window.__OPS__);
  check('남길 자료를 못 읽으면 실패로 멈추고 아무것도 안 쓴다(잠금도 푼다)', dataOps(ops).set === 0 && dataOps(ops).del === 0
    && !(await p.evaluate(() => 'saenggibu/lock' in window.__FS__))
    && (await p.textContent('#upPanel')).includes('못 읽었습니다'), ops);
  check('실패하면 다시 누를 수 있다', !!(await p.$('#upGo')) && await p.isEnabled('#upGo'));
  await p.context().close();
  STORE = saved;
}

// 3-2b 같은 파일을 한 번 더 — 이번엔 관리자가 「전체 바꾸기」(합본): 빠진 시트는 기본 지우기, 확인 창
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0, w: [] }; });
  await p.setInputFiles('#upFile', FILE2);
  await p.waitForSelector('#upMode');
  check('같은 파일이면 바뀐 것 없음 — 남겨 둔 시트만 「그대로 둡니다」', !(await p.$('#upChanged')) && (await p.textContent('#upPanel')).includes('그대로 6'));
  await p.check('input[name="upMode"][value="replace"]');
  check('「전체 바꾸기」 를 고르면 빠진 시트 목록이 열리고 기본은 「지우기」', await p.isVisible('#upMissing select')
    && await p.$$eval('#upMissing select', ss => ss.every(s => s.value === 'del')) && (await p.textContent('#upMissHow')).includes('지웁니다'));
  await shot(p, '#upPanel', '3-preview-replace');
  let asked = '';
  p.once('dialog', d => { asked = d.message(); d.accept(); });
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  const ops = await p.evaluate(() => window.__OPS__);
  const keys = await p.evaluate(() => Object.keys(window.__FS__));
  check('지우기 전에 확인 창 — 몇 개 · 무엇', asked.includes('1개를 지웁니다') && asked.includes('학생회 임원'), asked);
  check('지우면 — 그 활동 문서·양식 문서를 지우고 3-2-5 · 목록 둘만 쓴다', dataOps(ops).del === 2 && dataOps(ops).set === 3
    && !keys.some(k => k.startsWith(`saenggibuAct/${officer.id}`)) && !keys.includes(`saenggibu/fmt-${officer.id}`), ops);
  check('결과 안내 — 지움 1', (await p.textContent('#upPanel')).includes('남김 0 · 지움 1'));
  const s325 = await p.evaluate(() => window.__FS__['saenggibuStu/3-2-5']);
  check('3-2-5 학생 문서에서도 그 활동이 빠졌다', s325.items.length === 2, s325);
  check('오류 없음(다시 올리기)', p.errors.length === 0, p.errors);
  await keep(p);
  await p.context().close();
}

// 3-3 다른 선생님 — 보고, 올릴 수도 있다(받기·관리는 관리자만)
{
  const p = await openAs(KIM, { width: 390 });
  await p.waitForSelector('#stus .stu');
  check('다른 교사 — 자료가 보이고 올리기 단추도 있다(부서가 바로 올린다), 엑셀로 받기는 없다',
    await p.isVisible('#upBtn') && !(await p.isVisible('#dlBtn')));
  check('폰 폭에서 가로로 넘치지 않는다', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // 폰 — 학년 탭 → 반 격자 → 학생 큰 단추 → 상세만, ◀ ▶ 로 넘기고 ← 로 돌아오기
  check('폰: 명단은 한 줄에 한 명(번호 차례대로 위에서 아래로)', await p.evaluate(() => { const b = [...document.querySelectorAll('#stus .stu')];
    return b.length > 1 && b.every((x, i) => i === 0 || x.getBoundingClientRect().top > b[i - 1].getBoundingClientRect().top); }));
  check('폰: 반은 학년 탭 + 격자(PC 목록은 숨김)', await p.isVisible('.cls-m .g-tab') && !(await p.isVisible('.cls-pc')) && !(await p.isVisible('#stuOut')));
  await p.click('.cls-m .g-tab[data-g="3"]');
  await p.waitForFunction(() => document.querySelector('.roster-head').textContent.includes('3학년 2반'));
  check('폰: 학년 탭을 누르면 그 학년 첫 반 명단', (await p.$$eval('.cls-grid .cl-item', bs => bs.map(b => b.textContent.trim()))).join() === '2반');
  await p.click('.cls-m .g-tab[data-g="1"]');
  await p.waitForFunction(() => document.querySelector('.roster-head').textContent.includes('1학년 1반'));
  await p.click('#stus .stu[data-n="1"]');
  await p.waitForSelector('#stuOut .s-name');
  check('폰: 학생을 고르면 상세만 화면 가득(반·명단 숨김)', await p.isVisible('#stuOut') && !(await p.isVisible('#stus')) && !(await p.isVisible('.cls-m')));
  check('폰: 위쪽 줄 — ← 1학년 1반 · 다음 학생(2번)', (await p.textContent('#mBack')).includes('1학년 1반') && (await p.$$('#mNav .m-step')).length === 1
    && (await p.textContent('#mNav .m-step')).includes('2'));
  await p.click('#mNav .m-step');
  await p.waitForFunction(() => document.querySelector('#stuOut .s-id')?.textContent.includes('2번'));
  check('폰: 다음 학생으로 넘어가고, 이제는 이전(◀ 1)만', (await p.textContent('#mNav .m-step')).includes('◀') && (await p.$$('#mNav .m-step')).length === 1);
  await p.click('#mBack');
  check('폰: ← 를 누르면 명단으로, 고른 학생에 표시', await p.isVisible('#stus') && !(await p.isVisible('#stuOut'))
    && (await p.$eval('#stus .stu.on', b => b.dataset.n)) === '2');
  check('폰: 단계마다 가로로 넘치지 않는다', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // 폰 — 활동별에서 활동을 누르면 상세가 보여야 한다. 학생별 단계식 규칙(.pane3:not(.has-detail) .p-detail 숨김)이
  // 활동별 칸에도 걸려 폰에서는 활동 상세가 아예 안 보였다(2026-10-28 봉사 표를 보다 찾음)
  await p.click('#views button[data-view="act"]');
  await p.waitForSelector('#acts .act');
  await p.click(`#acts .act[data-id="${vol.id}"]`);
  await p.waitForSelector('#actRows table.neis', { state: 'attached' });
  check('폰: 활동별에서 활동을 누르면 상세가 보인다', await p.isVisible('#actOut') && await p.isVisible('#actRows table.neis'));
  await p.click('#selAG button[data-g="3"]').catch(() => {});
  await p.waitForTimeout(200);
  check('폰: 봉사 표 — 학번·이름이 덩어리 머리에, 가로로 넘치지 않는다', (await txt(p, '#actRows tr.who-first')).includes('30205')
    && await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('폰: 날짜·시간·누계가 화면 안에(학번·이름 아래 줄)', await p.evaluate(() => {
    const tr = document.querySelector('#actRows tr.who-first'), box = document.getElementById('actRows').getBoundingClientRect();
    const nm = tr.querySelector('.c-nm').getBoundingClientRect();
    return ['.c-start', '.c-hours', '.c-total'].every(sel => { const r = tr.querySelector(sel).getBoundingClientRect();
      return r.width > 0 && r.right <= box.right + 1 && r.top >= nm.bottom - 1; }); }));
  await shot(p, '#actRows', '7-vol-act-phone');
  await p.click('#views button[data-view="stu"]');
  await p.waitForSelector('.cls-m .g-tab');
  check('오류 없음(다른 교사)', p.errors.length === 0, p.errors);
  await p.context().close();
}
// 3-3a 부서가 바로 올리기 — 김 선생님이 시트 하나를 올린다(나머지는 그대로), 교사에겐 「전체 바꾸기」 가 없다
const STORE_B = JSON.parse(JSON.stringify(STORE));          // 뒤 검사를 위해 이 묶음이 끝나면 되돌린다
const upload = async (p, file) => { await p.setInputFiles('#upFile', file); await p.waitForSelector('#upGo'); };
const done = p => p.waitForFunction(() => /올렸습니다|실패/.test(document.getElementById('upPanel').textContent));
// 관리 화면 — 결과(admMsg)가 뜨거나 실패(admEdMsg·admMsg)가 뜰 때까지
const adminDone = (p, word) => p.waitForFunction(w => { const a = document.getElementById('admMsg')?.textContent || '', e = document.getElementById('admEdMsg')?.textContent || '';
  return a.includes(w) || /실패/.test(a + e); }, word, { timeout: 15000 }).catch(() => {});
{
  const p = await openAs(KIM);
  await p.waitForSelector('#upBtn');
  await upload(p, FILE_K1);
  check('교사 미리보기 — 「올리는 방식」 이 없다(전체 바꾸기는 관리자만), 빠진 시트는 그대로',
    !(await p.$('#upMode')) && (await p.textContent('#upMissing')).includes('그대로 둡니다') && !(await p.$('#upMissing select')));
  const n0 = STORE['saenggibu/meta'].activities.length;
  await p.click('#upGo'); await done(p);
  const meta = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const rd = meta.activities.find(a => a.sheet === '<자>교무(독서 토론)');
  check(`김 선생님 시트가 더해지고 나머지는 그대로(${n0} → ${n0 + 1})`, rd && meta.activities.length === n0 + 1
    && (await p.textContent('#upPanel')).includes('추가 1'), meta.activities.map(a => a.sheet));
  check('올린 사람·날짜 — 새로 들어온 활동(처음 날짜 = 바뀐 날짜)', rd?.by === KIM && rd.since && rd.since === rd.upd, rd);
  await keep(p);
  await p.context().close();
}
// 3-3b 다른 선생님이 남의 활동을 고쳐 올리면 — 묻고, 기본은 건너뛰기
{
  const p = await openAs(LEE);
  await p.waitForSelector('#upBtn');
  await upload(p, FILE_K2);
  await shot(p, '#upPanel', '1-preview-foreign');
  const chg = await p.textContent('#upChanged');
  check('남이 올린 활동 — ⚠ 누가 올렸는지, 기본은 「건너뛰기」', chg.includes('kim 선생님이 올린 활동') && await p.$eval('#upChanged select', s => s.value) === 'skip', chg);
  await p.click('#upGo'); await done(p);
  let s111 = await p.evaluate(() => window.__FS__['saenggibuStu/1-1-1']);
  check('건너뛰면 김 선생님 문안 그대로, 결과에 「건너뜀 1」', s111.items.some(i => i.b === '독서 토론에 참여함.') && !s111.items.some(i => i.b === '다른 선생님이 고친 문안.')
    && (await p.textContent('#upPanel')).includes('건너뜀 1'), await p.textContent('#upPanel'));
  await keep(p);
  await upload(p, FILE_K2);
  await p.selectOption('#upChanged select', 'put');
  await p.click('#upGo'); await done(p);
  s111 = await p.evaluate(() => window.__FS__['saenggibuStu/1-1-1']);
  const rd = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).activities.find(a => a.sheet === '<자>교무(독서 토론)');
  check('「바꾸기」 를 고르면 바뀌고, 올린 사람이 이 선생님으로(처음 날짜는 그대로)', s111.items.some(i => i.b === '다른 선생님이 고친 문안.')
    && rd.by === LEE && rd.since < rd.upd
    && !((await p.evaluate(() => window.__FS__['saenggibuStu/1-1-2']))?.items || []).some(i => i.b === '토론 사회를 봄.'), rd);
  await keep(p);
  await p.context().close();
}
// 3-3c 이름을 바꿔 낸 새 판 — ⊙ 활동명이 같으면 묻는다(기본 따로 추가), 바꾸면 옛것이 빠지고 자리를 잇는다
{
  const p = await openAs(LEE);
  await p.waitForSelector('#upBtn');
  await upload(p, FILE_K3);
  await shot(p, '#upPanel', '2-preview-lookalike');
  const add = await p.textContent('#upAdded');
  check('새 판 짐작 — 「기존 「독서 토론」… 의 새 판인가요?」, 기본은 따로 추가', add.includes('의 새 판인가요?') && add.includes('교무(독서 토론)')
    && await p.$eval('#upAdded select', s => s.value) === 'new', add);
  const before = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).order;
  const nBefore = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).activities.length;
  const oldId = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).activities.find(a => a.sheet === '<자>교무(독서 토론)').id;
  await p.selectOption('#upAdded select', 'swap');
  await p.click('#upGo'); await done(p);
  const meta = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const nw = meta.activities.find(a => a.sheet === '<자>교무(독서토론 활동)');
  check('바꾸면 — 옛 시트는 빠지고 새 시트가 옛 자리에(활동 수 그대로)', nw && !meta.activities.some(a => a.id === oldId) && meta.activities.length === nBefore
    && meta.order.indexOf(nw.id) === before.indexOf(oldId), [meta.order, before]);
  check('— 처음 날짜는 옛것에서(「수정」 으로 보이게)', nw.since && nw.since < nw.upd, nw);
  await keep(p);
  await p.context().close();
}
// 3-3c2 예전 합본의 시트(차수 붙음)를 부서가 차수 없이 다시 낸다 — 같은 활동으로 바뀌고 목록 자리도 그대로
{
  const p = await openAs(LEE);
  await p.waitForSelector('#upBtn');
  const m0 = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const old = m0.activities.find(a => a.sheet === '<자>생활(학생회 임원)-2차');
  const at0 = m0.order.indexOf(old.id);
  await upload(p, FILE_K4);
  check('차수를 뗀 이름으로 짝 — 「내용이 바뀜」(새로 추가 아님)', (await txt(p, '#upChanged')).includes('학생회 임원') && !(await p.$('#upAdded')));
  await p.click('#upGo'); await done(p);
  const m1 = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const nw = m1.activities.find(a => a.sheet === '<자>생활(학생회 임원)');
  check('— 옛 시트는 빠지고, 목록 가운데 자리 그대로(끝으로 밀리지 않음)', nw && !m1.activities.some(a => a.id === old.id)
    && m1.order.indexOf(nw.id) === at0 && at0 < m1.order.length - 1, [at0, nw && m1.order.indexOf(nw.id), m1.order.length]);
  await keep(p);
  await p.context().close();
}
// 3-3d 같이 올리는 때 — 다른 사람이 올리는 중이면 막고, 미리보기 뒤에 누가 먼저 올렸으면 다시 미리보기
{
  STORE['saenggibu/lock'] = { by: KIM, at: new Date().toISOString() };
  const p = await openAs(LEE);
  await p.waitForSelector('#upBtn');
  await upload(p, FILE_K1);
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0, w: [] }; });
  await p.click('#upGo'); await done(p);
  const ops = await p.evaluate(() => window.__OPS__);
  check('다른 선생님이 올리는 중이면 — 막고 아무것도 안 쓴다(그 잠금은 그대로)', (await txt(p, '#upMsg')).includes('kim 선생님이 올리는 중')
    && dataOps(ops).set === 0 && dataOps(ops).del === 0 && (await p.evaluate(() => window.__FS__['saenggibu/lock']?.by)) === KIM, await txt(p, '#upPanel'));
  await p.evaluate(k => { window.__FS__['saenggibu/lock'] = { by: k, at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }; }, KIM);
  if (!(await p.$('#upGo'))) await upload(p, FILE_K1);
  await p.click('#upGo'); await done(p);
  check('잠금이 5분 넘게 묵었으면(창을 닫았거나 끊김) — 버려진 것으로 보고 올린다', (await p.textContent('#upPanel')).includes('올렸습니다')
    && !(await p.evaluate(() => 'saenggibu/lock' in window.__FS__)));
  await upload(p, FILE_K2);
  await p.evaluate(() => { window.__FS__['saenggibu/meta'].at = 'someone-else'; });     // 미리보기 뒤에 누가 먼저 올림
  await p.click('#upGo'); await done(p);
  check('미리보기 뒤에 누가 먼저 올렸으면 — 쓰지 않고 「다시 미리보기」', (await txt(p, '#upMsg')).includes('다시 미리보기') && !!(await p.$('#upRetry')));
  if (await p.$('#upRetry')) await p.click('#upRetry'); else await upload(p, FILE_K2);
  await p.waitForSelector('#upGo');
  await p.click('#upGo'); await done(p);
  check('— 다시 미리보기 하면 올라간다', (await p.textContent('#upPanel')).includes('올렸습니다'));
  check('오류 없음(부서 올리기)', p.errors.length === 0, p.errors);
  await p.context().close();
  delete STORE['saenggibu/lock'];                // 이 묶음에서 심어 둔 잠금 — 뒤 검사로 넘기지 않는다
}
// 3-3e 차수를 떼면 이름이 같은 시트 둘 — 알려 주고 따로 올린다
{
  const p = await openAs(LEE);
  await p.waitForSelector('#upBtn');
  await upload(p, FILE_CL);
  const cl = (await p.$('#upClash')) ? await p.textContent('#upClash') : '';
  check('「차수를 떼면 이름이 같은 시트」 경고 — 두 시트 이름과 괄호 안에 쓰라는 안내', cl.includes('교무(강연)-1차') && cl.includes('교무(강연)-2차') && cl.includes('괄호 안에'), cl);
  check('— 하나로 묶지 않고 둘 다 「새로 추가」', (await p.textContent('#upAdded')).includes('새로 추가 2'));
  await p.context().close();
}
// 3-3f 관리(선생님만) — 바로 고치기 · 원래대로 · 통째로 지우기 · 기록
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#admBtn');
  check('관리자에게만 「⚙ 관리」', await p.isVisible('#admBtn'));
  await p.click('#admBtn');
  await p.waitForSelector('.adm-tb');
  const tb = await p.textContent('.adm-tb');
  check('관리 목록 — 활동·창체 일정과 올린 사람(lee · 관리자)', tb.includes('독서 토론') && tb.includes('창체 일정') && tb.includes('lee') && tb.includes('관리자'), tb.slice(0, 300));
  check('최근 올린 기록 — 누가 · 어느 파일', (await txt(p, '#admLog')).includes('dept-k'), (await txt(p, '#admLog')).slice(0, 200));
  const meta0 = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const target = meta0.activities.find(a => a.sheet === '<자>생활(학생회 임원)');
  await p.click(`.adm-ed[data-id="${target.id}"]`);
  await p.fill('.adm-edit [data-f="title"]', '학생자치회 임원');
  await p.fill('.adm-edit [data-f="dept"]', '학생자치부');
  await shot(p, '#admPanel', '4-admin-edit');
  await p.click('#admSave');
  await adminDone(p, '고쳤습니다');
  let raw = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).activities.find(a => a.id === target.id);
  check('고치기 — 원본 칸은 그대로, 고친 칸만 따로(활동명·부서)', raw.title === '학생회 임원' && raw.fix?.title === '학생자치회 임원'
    && raw.fix?.dept === '학생자치부' && Object.keys(raw.fix).length === 2, [raw, await txt(p, '#admEdMsg'), await txt(p, '#admMsg'), p.errors]);
  check('— 관리 목록에 고친 값과 ✏ 표시', (await p.textContent(`tr[data-id="${target.id}"]`)).includes('학생자치회 임원') && !!(await p.$(`tr[data-id="${target.id}"] .fixed`)));
  await p.click('#views [data-view="act"]');
  await p.waitForFunction(() => document.getElementById('body').textContent.includes('학생자치회 임원'), null, { timeout: 5000 }).catch(() => {});
  check('— 화면(활동별)에 고친 활동명', (await p.textContent('#body')).includes('학생자치회 임원'));
  await p.click(`.adm-ed[data-id="${target.id}"]`);
  check('다시 열면 「원래: 학생회 임원」', (await p.textContent('.adm-edit')).includes('원래: 학생회 임원'));
  await p.click('#admReset');
  await adminDone(p, '원래대로');
  raw = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).activities.find(a => a.id === target.id);
  check('「원래대로」 — 고침이 지워진다', !raw.fix, raw);
  await p.click(`.adm-ed[data-id="${target.id}"]`);                // 다시 고쳐 둔다(아래 다시 올리기에서 남는지 본다)
  await p.fill('.adm-edit [data-f="title"]', '학생자치회 임원');
  await p.click('#admSave');
  await adminDone(p, '고쳤습니다');
  const m1 = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const rd = m1.activities.find(a => a.sheet === '<자>교무(독서토론 활동)');
  await p.check(`.adm-ck[data-id="${rd.id}"]`);
  let asked = '';
  p.once('dialog', d => { asked = d.message(); d.accept(); });
  await p.click('#admDel');
  await p.waitForFunction(() => /지웠습니다|실패/.test(document.getElementById('admMsg')?.textContent || ''));
  const m2 = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  const keys = await p.evaluate(() => Object.keys(window.__FS__));
  check('통째로 지우기 — 확인 창, 목록·활동 문서·양식에서 빠진다', asked.includes('1개를 지웁니다') && asked.includes('독서 토론')
    && !m2.activities.some(a => a.id === rd.id) && !keys.some(k => k.startsWith(`saenggibuAct/${rd.id}`)) && !keys.includes(`saenggibu/fmt-${rd.id}`), [asked, await txt(p, '#admMsg')]);
  check('— 학생 문서에서도 빠진다(1-1-1)', !((await p.evaluate(() => window.__FS__['saenggibuStu/1-1-1']))?.items || []).some(i => i.a === rd.id));
  check('— 나머지는 그대로(활동 하나만 줄고, 고친 값도 남는다)', m2.activities.length === m1.activities.length - 1
    && m2.activities.find(a => a.id === target.id)?.fix?.title === '학생자치회 임원');
  check('— 기록에 「지움 독서 토론」', (await txt(p, '#admLog')).includes('지움 독서 토론'), (await txt(p, '#admLog')).slice(0, 300));
  check('오류 없음(관리)', p.errors.length === 0, p.errors);
  await keep(p);
  await p.context().close();
}
// 3-3g 부서가 틀린 이름 그대로 같은 파일을 다시 올려도 — 선생님이 고친 값이 남는다
{
  const p = await openAs(LEE);
  await p.waitForSelector('#upBtn');
  check('다른 교사에게는 「⚙ 관리」 가 없다', !(await p.isVisible('#admBtn')));
  await upload(p, FILE_K4);
  await p.click('#upGo'); await done(p);
  const a = (await p.evaluate(() => window.__FS__['saenggibu/meta'])).activities.find(x => x.sheet === '<자>생활(학생회 임원)');
  check('다시 올려도 고친 활동명이 남는다(원본 칸은 파일 그대로)', a?.fix?.title === '학생자치회 임원' && a.title === '학생회 임원', a);
  await keep(p);
  await p.context().close();
}
// 3-3h 추가·수정 꼬리표 — 화면에서. 본 것은 선생님마다 브라우저에 기억한다
{
  const m = STORE['saenggibu/meta'];
  const off = m.activities.find(a => a.sheet === '<자>생활(학생회 임원)');                 // 8일 전에 바뀜 — 안 본 사람에겐 보여야
  off.since = new Date(Date.now() - 20 * 864e5).toISOString(); off.upd = new Date(Date.now() - 8 * 864e5).toISOString();
  const flex = m.activities.find(a => a.sheet.includes('수업량'));
  delete flex.since; delete flex.upd; delete flex.by;                                      // 날짜 없는 옛 기록
  const rbId = m.activities.find(a => a.sheet.includes('로봇')).id, mathId = m.activities.find(a => a.sheet.includes('수학')).id;
  const p = await openAs(KIM);
  await p.waitForSelector('.cls-pc .cl-item');
  check('반 목록 — 추가·수정된 자료가 있는 반에 점(1-1)', !!(await p.$('.cls-pc .cl-item[data-k="1-1"] .fresh-dot')));
  await p.click('#views [data-view="act"]');
  await p.waitForSelector('#acts .act');
  const tagOf = async id => txt(p, `#acts .act[data-id="${id}"] .fresh`);
  check('활동 목록 — 처음 올라온 것 「추가」, 바뀐 것 「수정」, 날짜 없는 옛 기록은 꼬리표 없음',
    (await tagOf(mathId)) === '추가' && (await tagOf(rbId)) === '수정' && (await tagOf(flex.id)) === '', [await tagOf(mathId), await tagOf(rbId), await tagOf(flex.id)]);
  check('— 8일 전에 바뀌었어도 아직 안 봤으면 「수정」', (await tagOf(off.id)) === '수정');
  await shot(p, '.p-acts', '5-fresh-tags');
  await p.click('#freshTg');
  const ids = await p.$$eval('#acts .act', bs => bs.map(b => b.dataset.id));
  check('「추가·수정만」 — 꼬리표 있는 활동만 남는다', !ids.includes(flex.id) && ids.includes(off.id) && ids.includes(mathId), ids);
  await p.click('#freshTg');
  await p.click(`#acts .act[data-id="${off.id}"]`);
  await p.waitForFunction(() => (document.querySelector('#actOut .card-h')?.textContent || '').includes('학생자치회'), null, { timeout: 8000 }).catch(() => {});
  check('활동을 열면 그때는 꼬리표가 보인다', (await txt(p, '#actOut .card-h')).includes('수정'), await txt(p, '#actOut .card-h'));
  await p.click('#views [data-view="stu"]');
  await p.click('#views [data-view="act"]');
  await p.waitForSelector('#acts .act');
  check('— 다시 그리면 8일 지난 그 활동은 꼬리표가 빠진다(본 것으로)', (await tagOf(off.id)) === '');
  check('— 7일 안의 것은 봤어도 그대로', (await tagOf(rbId)) === '수정');
  await p.click('#views [data-view="stu"]');
  await p.click('.cls-pc .cl-item[data-k="1-1"]');
  await p.click('#stus .stu[data-n="1"]');
  await p.waitForSelector('#stuOut .card');
  check('학생 카드에도 꼬리표(1-1-1)', (await p.$$('#stuOut .card .fresh')).length > 0);
  check('오류 없음(꼬리표)', p.errors.length === 0, p.errors);
  await p.context().close();
}
STORE = STORE_B;

// 3-4 학생 계정·로그인 전
{
  const p = await openAs('1030101@yeungnam.hs.kr');
  await p.waitForSelector('#gate', { state: 'visible' });
  check('학생 계정은 막고 까닭을 말한다', (await p.textContent('#gateErr')).includes('교사 계정이 아닙니다'));
  await p.context().close();
  const q = await openAs('');
  await q.waitForSelector('#gate', { state: 'visible' });
  check('로그인 전에는 로그인 화면', await q.isVisible('#loginBtn'));
  await q.context().close();
}
// 3-4a 한 학생만 보기 — 종합검색 「생기부 보조자료」 탭이 띄우는 모양
{
  const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.route(ORIGIN + '/test/saenggibu.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB[r.request().url().split('/').pop()] || '' }));
  await ctx.route('https://teacher-api.pkh910518.workers.dev/**', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(([e, store]) => {
    window.__TEST_EMAIL__ = e; window.__FS__ = store; window.__h = [];
    window.addEventListener('message', ev => { if (ev.data?.type === 'sgb-height') window.__h.push(ev.data.h); });
  }, [KIM, STORE]);
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(ORIGIN + '/test/saenggibu.html?in=1&embed=1&k=1-1-1');
  await p.waitForSelector('#stuOut .card');
  check('한 학생만 보기 — 위쪽 줄·이동 줄·이름·사진은 숨기고 그 학생 카드만', !(await p.isVisible('.top')) && !(await p.isVisible('.s-name'))
    && !(await p.isVisible('#mNav')) && (await p.textContent('#stuOut')).includes('진로탐색 로봇공학 캠프'));
  check('한 학생만 보기 — 높이를 앱에 알린다', await p.evaluate(() => window.__h.length > 0 && window.__h.at(-1) > 100));
  await p.goto(ORIGIN + '/test/saenggibu.html?in=1&embed=1&k=1-1-3');
  await p.waitForSelector('#stuOut .empty');
  check('한 학생만 보기 — 자료 없는 학생은 그렇다고', (await p.textContent('#stuOut')).includes('생기부 보조자료가 없습니다'));
  check('오류 없음(한 학생만 보기)', errors.length === 0, errors);
  await ctx.close();
}

// 3-4b 학적 변동 — 떠난 학생 목록(students/changed)이 있을 때
{
  const saved = STORE;
  STORE = { 'students/main': { students: ROSTER2 }, 'students/changed': { students: GONE } };
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.setInputFiles('#upFile', FILE1);
  await p.waitForSelector('#upGo');
  check('미리보기 — 확인 필요 1건, 학적 변동 기록은 따로(확인할 필요 없음)', (await p.textContent('#upMis')).includes('확인 1건')
    && (await p.textContent('#upMoved')).includes('학적 변동'));
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  check('「⚠ 확인 필요」 는 학적 변동을 빼고 1', (await p.textContent('#chkTab')).includes('1'));
  await p.click('#chkTab');
  await p.waitForSelector('table.chk');
  check('확인 필요 화면 아래에 학적 변동 학생(학번·이름·구분·날짜)을 회색으로', (await p.textContent('.moved-list')).includes('2-1-1 이보람 · 전출 2026.05.10.')
    && (await p.$$('table.chk tbody tr')).length === 1);
  await p.click('#views button[data-view="stu"]');
  await p.waitForSelector('#stus .stu');
  await p.click('.cls-pc .cl-grade[data-g="2"]').catch(() => {});
  await p.click('.cls-pc .cl-item[data-k="2-1"]');
  await p.waitForFunction(() => document.querySelector('.roster-head').textContent.includes('2학년 1반'));
  check('명단에 「전출」 꼬리표', (await p.textContent('#stus .stu.gone')).includes('전출'));
  check('오류 없음(학적 변동)', p.errors.length === 0, p.errors);
  await p.context().close();
  STORE = saved;
}

// 3-5 서식 도구를 못 받았을 때 — 올리기는 되고, 받을 때 단순한 틀
{
  STORE = {};
  const p = await openAs(ADMIN, { blockExcel: true });
  await p.waitForSelector('#upBtn');
  await p.setInputFiles('#upFile', FILE1);
  await p.waitForSelector('#upGo');
  check('서식을 못 읽으면 그렇다고 알리고', (await p.textContent('#upPanel')).includes('서식을 못 읽었습니다'));
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  check('자료는 올라간다(양식 문서만 없다)', await p.evaluate(() => Object.keys(window.__FS__).some(k => k.startsWith('saenggibuStu/'))
    && !Object.keys(window.__FS__).some(k => k.startsWith('saenggibu/fmt-'))));
  await keep(p);
  await p.context().close();
  const q = await openAs(ADMIN);
  await q.waitForSelector('#dlBtn');
  const [dl] = await Promise.all([q.waitForEvent('download'), q.click('#dlBtn')]);
  const out = new ExcelJS.Workbook();
  await out.xlsx.readFile(await dl.path());
  const rw = out.getWorksheet(robot.sheet);
  let hdr = 0; rw.eachRow((r, i) => { if (!hdr && r.getCell(1).value === '학년') hdr = i; });
  check('양식이 없으면 단순한 틀 — 안내 줄 + 파란 머리줄 + 돋움 10', hdr > 0 && rw.getRow(hdr).getCell(1).fill?.fgColor?.argb === BLUE
    && rw.getRow(hdr + 1).getCell(4).value === '김가람' && rw.getRow(hdr + 1).getCell(4).font?.name === '돋움', hdr);
  check('오류 없음(서식 없이)', q.errors.length === 0, q.errors);
  await q.context().close();
}
await b.close();

// ── 4. 앱에 붙인 곳 ──
console.log('\n[앱 연결]');
const IDX = fs.readFileSync(ROOT + '/index.html', 'utf8');
const USG = fs.readFileSync(ROOT + '/usage.html', 'utf8');
const RULES = fs.readFileSync(ROOT + '/firestore.rules', 'utf8');
check('탭·메뉴는 처음엔 숨김', /id="tabSaenggibu" style="display:none;"/.test(IDX) && /id="navSaenggibu" style="display:none;"/.test(IDX));
const reveal = IDX.match(/if \(_IS_ADMIN\(\)\) \{\s*\[([^\]]*)\]\.forEach/);
check('로그인한 교사 모두에게 드러낸다(관리자 조건 목록에서 빠짐 · 따로 연다)', reveal && !reveal[1].includes('Saenggibu')
  && /\[\s*'navSaenggibu',\s*'tabSaenggibu'\s*\]\.forEach/.test(IDX));
check('탭 전환 목록에 들어 있다', /'duty','saenggibu','usage'/.test(IDX) && IDX.includes("if(page === 'saenggibu') openSaenggibuFrame();"));
check('프레임 주소에 버전', IDX.includes('saenggibu.html?in=1&v=${encodeURIComponent(APP_VER)}'));
check('사용 현황에 이름이 있다', USG.includes("saenggibu:'📑 생기부 보조자료'"));
check('앱·사용 현황 버전이 같다', IDX.match(/const APP_VER = '([^']+)'/)[1] === USG.match(/const APP_VER = '([^']+)'/)[1]);
for (const c of ['saenggibu', 'saenggibuStu', 'saenggibuAct']) {
  const m = RULES.match(new RegExp(`match /${c}/\\{docId\\} \\{([^}]*)\\}`));
  check(`규칙 ${c} — 읽기·쓰기 교사 전체(부서가 바로 올린다)`, m && /allow read:\s*if isYnhsTeacher\(\);/.test(m[1]) && /allow write: if isYnhsTeacher\(\);/.test(m[1]), m && m[1]);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
