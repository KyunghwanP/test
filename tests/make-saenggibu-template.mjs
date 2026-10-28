// 생기부 보조자료 표준 양식(엑셀) 만들기.
//
// 부서·교과가 이 양식에 써서 내면 앱(saenggibu.html)이 그대로 읽는다. 모양은 원래 쓰던 통합 엑셀을 따른다:
// 왼쪽 위 부서 이름(HY헤드라인M), '⊙ 활  동  명:' 같은 안내 칸 네 줄, 파란 머리줄(흰 굵은 돋움 10),
// 숨긴 A열(학번), 넓은 자기 평가서·기재 내용 칸, 가로 인쇄. 예시 이름은 지어낸 것이다.
//
//   node tests/make-saenggibu-template.mjs [출력폴더]        (기본: 현재 폴더)
//
// 검사(saenggibu.test.mjs 「표준 양식」)가 이 파일로 양식을 만들어 실제 파서로 읽어 본다 —
// 파서가 바뀌어 양식과 어긋나면 거기서 잡힌다.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEMPLATE_NAME = '생기부 보조자료 표준 양식.xlsx';

const BLUE = 'FF0066FF';                         // 원래 양식의 머리줄 파랑
const FONT = '돋움';
const thin = { style: 'thin' };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const BLANK_ROWS = 40;                           // 예시 아래 빈 줄(테두리·학번 수식까지)

// 활동 시트 두 가지 — 기본형(자기 평가서 + 기재 내용), 칸을 더한 형(주제 + 기재 내용)
const SHEETS = [
  {
    name: '<자>부서(활동명)',
    dept: '예) 과학중점부',
    info: [
      ['⊙ 활  동  명:', '예) 진로탐색 로봇공학 캠프'],
      ['⊙ 입력 영역:', '예) 자율·자치활동 특기사항'],
      ['⊙ 입력 경로:', '예) [학생생활]-[창의적체험활동]-[자율·자치활동]'],
      ['⊙ 유의 사항:', '예) 담임 교사가 내용을 확인한 뒤 입력합니다.'],
    ],
    cols: [['순번', 7], ['학년', 7], ['반', 7], ['번호', 7], ['성명', 10], ['자기 평가서', 50], ['기재 내용', 81]],
    rows: [
      [1, 1, 1, 1, '김가람', '로봇에 관심이 생겨 참여했고, 센서 제어가 어려웠지만 끝까지 해냄.',
        '진로탐색 로봇공학 캠프에 참여하여 초음파 센서로 장애물을 피하는 로봇을 설계하고, 제어 코드를 여러 번 고쳐 주행 정확도를 높임.'],
      [2, 1, 1, 2, '박나래', '',
        '캠프에서 모둠의 기록을 맡아 시험 주행 결과를 표로 정리하고, 실패 원인을 함께 찾아 다음 설계에 반영함.'],
      [3, 1, 2, 5, '최다온', '친구들과 역할을 나누어 협력하는 법을 배움.',
        '로봇 팔의 관절 각도를 계산하여 물건을 옮기는 동작을 구현하고, 그 과정을 발표 자료로 만들어 학급에 소개함.'],
    ],
  },
  {
    name: '<개>교과(활동명)',
    dept: '예) 국어과',
    info: [
      ['⊙ 활  동  명:', '예) 주제 탐구 독서 토론'],
      ['⊙ 입력 영역:', '예) 개인별 세부능력 및 특기사항'],
      ['⊙ 입력 경로:', '예) [성적]-[개인별 세부능력 및 특기사항]'],
      ['⊙ 유의 사항:', '예) 과목 담당 교사가 입력합니다.'],
    ],
    cols: [['순번', 7], ['학년', 7], ['반', 7], ['번호', 7], ['성명', 10], ['주제', 24], ['기재 내용', 81]],
    rows: [
      [1, 2, 3, 4, '이보람', '독서와 진로',
        '진로와 관련된 책을 읽고 저자의 주장을 근거와 함께 정리하여 토론에서 반론에 차분히 답함.'],
      [2, 2, 3, 7, '김가람', '과학 기술과 윤리',
        '인공지능 판단의 책임 소재를 주제로 자료를 찾아 정리하고, 서로 다른 입장을 비교하여 자신의 견해를 밝힘.'],
    ],
  },
];

// 작성 안내 — 꼬리표(<…>)가 없어 앱은 이 시트를 읽지 않는다(올릴 때 '건너뛴 시트' 에 뜬다)
const GUIDE = [
  ['학교생활기록부 기재 보조자료 — 작성 안내', 'title'],
  [''],
  ['1. 시트 하나에 활동 하나를 씁니다.', 'h'],
  ['   활동이 여럿이면 시트를 복사해서 씁니다(시트 탭 오른쪽 클릭 → 이동/복사 → 복사본 만들기).'],
  [''],
  ['2. 시트 이름은 입력 영역 꼬리표로 시작합니다.', 'h'],
  ['   <자> 자율·자치활동 특기사항     <진> 진로활동 특기사항     <개> 개인별 세부능력 및 특기사항'],
  ['   <누> 누가기록     <자or진> 자율·진로 가운데 담임이 골라 입력'],
  ['   예) <자>생활(학급 임원)     <개>국어(주제 탐구 독서 토론)'],
  ['   ※ 꼬리표가 없는 시트는 앱이 읽지 않습니다(이 「작성 안내」 시트처럼).'],
  [''],
  ['3. 위쪽 ⊙ 칸 네 개를 채웁니다 — 활동명 · 입력 영역 · 입력 경로 · 유의 사항.', 'h'],
  ['   맨 왼쪽 위 칸에는 부서(교과) 이름을 씁니다. 「예)」 로 시작하는 글은 지우고 씁니다.'],
  ['   안내 줄은 더 넣어도 됩니다(파란 머리줄 위로 마흔 줄까지).'],
  [''],
  ['4. 파란 머리줄의 칸 이름은 그대로 둡니다.', 'h'],
  ['   앱은 칸을 자리가 아니라 이름으로 찾습니다 — 학년 · 반 · 번호 · 성명 · 자기 평가서 · 기재 내용.'],
  ['   칸을 더 넣어도 되고(직책 · 주제 · 장소 등), 칸 차례를 바꿔도 됩니다. 자기 평가서가 없으면 칸을 지워도 됩니다.'],
  [''],
  ['5. 학년 · 반 · 번호는 숫자만 씁니다(「1학년」 이 아니라 「1」). 성명은 학적과 똑같이 씁니다.', 'h'],
  [''],
  ['6. 기재 내용 = 나이스에 그대로 옮길 문안 · 자기 평가서 = 학생이 낸 글', 'h'],
  ['   학생마다 한 줄씩 씁니다. 같은 학생이 여러 번이면 여러 줄로 씁니다.'],
  [''],
  ['7. 예시 줄(김가람 · 박나래 · 최다온 · 이보람)은 지우고 씁니다.', 'h'],
  [''],
  ['8. 시트 이름에 차수(-1차 · -2차)를 붙이지 않습니다.', 'h'],
  ['   고쳐서 다시 올릴 때도 같은 이름으로 올리면, 앱이 같은 활동으로 알아보고 이 파일 것으로 바꿉니다.'],
  ['   새로 들어온 것 · 바뀐 것은 앱이 「추가」 「수정」 꼬리표로 알려 줍니다.'],
  ['   활동의 회차는 괄호 안에 씁니다 — 예) <자>수학과(강연(1차)) · <자>수학과(강연(2차))'],
  [''],
  ['9. 다 쓰면 앱에서 바로 올립니다.', 'h'],
  ['   통합앱 → 📑 생기부 보조자료 → 📤 엑셀 올리기 → 미리보기에서 확인 → 올리기'],
  ['   올리면 바로 모든 선생님 화면에 보입니다. 이 파일에 없는 다른 부서의 시트는 그대로 둡니다.'],
  ['   미리보기에 「⚠ 확인할 시트」 가 뜨면 엑셀을 고쳐서 다시 올립니다(칸 이름 · 「예)」 글이 남았는지).'],
  ['   다른 선생님이 올린 활동을 고쳐 올리면 바꿀지 한 번 묻습니다.'],
  [''],
  ['※ 잘못 올렸으면 담당자(관리자)에게 알려 주세요 — 활동째 지우거나 부서 · 활동명을 앱에서 바로 고칩니다.', 'note'],
];

const colLetter = n => String.fromCharCode(64 + n);

function activitySheet(wb, spec) {
  const ws = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 5 }] });
  // A열 = 숨긴 학번(원래 양식처럼). B부터 머리 칸.
  const last = spec.cols.length + 1;              // 마지막 열 번호
  const L = colLetter(last);
  ws.getColumn(1).width = 8;
  ws.getColumn(1).hidden = true;
  spec.cols.forEach(([, w], k) => { ws.getColumn(k + 2).width = w; });

  // 위쪽 — 부서 이름(B1:D1), 안내 칸 이름(E:F), 값(G:마지막 열)
  const dept = ws.getCell('B1');
  dept.value = spec.dept;
  dept.font = { name: 'HY헤드라인M', size: 16 };
  dept.alignment = { vertical: 'middle', shrinkToFit: true };   // 부서 이름이 길면 칸에 맞춰 글자를 줄인다(병합 칸은 넘쳐 보이지 않는다)
  ws.mergeCells('B1:D1');
  spec.info.forEach(([label, value], i) => {
    const r = i + 1;
    const lc = ws.getCell(`E${r}`);
    lc.value = label;
    lc.font = { name: FONT, size: 10, bold: true };
    lc.alignment = { vertical: 'middle' };
    ws.mergeCells(`E${r}:F${r}`);
    const vc = ws.getCell(`G${r}`);
    vc.value = value;
    vc.font = { name: FONT, size: 10 };
    vc.alignment = { vertical: 'middle', wrapText: true };
    ws.mergeCells(`G${r}:${L}${r}`);
    ws.getRow(r).height = 18;
  });

  // 머리줄(5행) — 파랑 바탕, 흰 굵은 돋움 10, 가는 테두리
  const H = 5;
  spec.cols.forEach(([name], k) => {
    const c = ws.getRow(H).getCell(k + 2);
    c.value = name;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = box;
  });
  ws.getRow(H).height = 20;

  // 자료 줄 — 예시 + 빈 줄. 학번(A열)은 학년·반·번호로 만드는 수식(원래 양식의 조회용 열)
  const total = spec.rows.length + BLANK_ROWS;
  const gi = spec.cols.findIndex(([n]) => n === '학년') + 2;
  const ci = gi + 1, ni = gi + 2;
  for (let k = 0; k < total; k++) {
    const r = H + 1 + k;
    const vals = spec.rows[k] || [];
    const row = ws.getRow(r);
    const [G, C, N] = [colLetter(gi), colLetter(ci), colLetter(ni)];
    const g = vals[gi - 2], c = vals[ci - 2], n = vals[ni - 2];
    row.getCell(1).value = {
      formula: `IF(${G}${r}="","",${G}${r}&TEXT(${C}${r},"00")&TEXT(${N}${r},"00"))`,
      result: g ? `${g}${String(c).padStart(2, '0')}${String(n).padStart(2, '0')}` : '',
    };
    spec.cols.forEach(([name], j) => {
      const cell = row.getCell(j + 2);
      const v = vals[j];
      if (v !== undefined && v !== '') cell.value = v;
      const wide = j >= 5;                            // 성명 다음 칸부터는 글 칸
      cell.font = { name: FONT, size: 10 };
      cell.border = box;
      cell.alignment = wide ? { vertical: 'top', wrapText: true } : { horizontal: 'center', vertical: 'top' };
    });
    if (vals.length) row.height = 48;                 // 예시 줄은 글이 보이게(빈 줄은 쓰면 엑셀이 맞춘다)
  }

  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printTitlesRow: `${H}:${H}`, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
  return ws;
}

function guideSheet(wb) {
  const ws = wb.addWorksheet('작성 안내');
  ws.getColumn(1).width = 120;
  GUIDE.forEach(([text, kind], i) => {
    const c = ws.getCell(`A${i + 1}`);
    c.value = text;
    c.alignment = { vertical: 'middle', wrapText: true };
    if (kind === 'title') { c.font = { name: 'HY헤드라인M', size: 16 }; ws.getRow(i + 1).height = 28; }
    else if (kind === 'h') c.font = { name: FONT, size: 11, bold: true };
    else if (kind === 'note') c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFC05A00' } };
    else c.font = { name: FONT, size: 10.5 };
  });
  ws.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return ws;
}

export async function makeTemplate(ExcelJS, outDir = '.') {
  const wb = new ExcelJS.Workbook();
  wb.creator = '영남고 통합앱';
  guideSheet(wb);
  for (const spec of SHEETS) activitySheet(wb, spec);
  const file = path.join(outDir, TEMPLATE_NAME);
  await wb.xlsx.writeFile(file);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { default: ExcelJS } = await import('exceljs');
  const file = await makeTemplate(ExcelJS, process.argv[2] || '.');
  console.log(file);
}
