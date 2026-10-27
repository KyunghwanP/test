// 생기부 보조자료(saenggibu.html) — 엑셀 해석, 저장 문서 모양, 실제 화면(올리기·학생별·활동별·창체 일정).
//
// 엑셀은 검사가 직접 만든다(지어낸 이름). 실제 통합 엑셀의 모양을 따랐다:
//  - 시트 이름 앞 꼬리표 <자>·<진>·<개>·<누>, '<자or진>' 처럼 둘 중 고름
//  - 머리 줄 위 '⊙ 활  동  명:' 안내 칸, 수학과처럼 A열에 '00⊙ …' 가 한 번 더 있는 시트
//  - 활동명 칸이 다른 시트에서 복사돼 온 시트(학급 임원 시트에 '학생회 임원'), 부서 칸에 활동명이 들어간 시트
//  - 숨김 시트(Base), 꼬리표 없는 조회 시트, 창체 일정(월·일·교시) 시트
// Firebase 는 모듈 주소를 가로채 메모리 대역으로 바꾼다.
//
// 설치: npm i -D xlsx@0.18.5 playwright
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx';

const ROOT = import.meta.dirname + '/..';
const HTML = fs.readFileSync(ROOT + '/saenggibu.html', 'utf8');
const XLSXJS = fs.readFileSync(ROOT + '/node_modules/xlsx/dist/xlsx.full.min.js', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

// ── 엑셀 만들기 ──
const XSS = '<img src=x onerror=window.__xss=1>';
function sheets({ dropOfficers = false, robotText = '로봇 코딩 캠프에 참여하여 센서 제어를 익힘.' } = {}) {
  const list = [
    ['<누>창의(1학년 창체)', [
      ['창의교육부', null, null, '⊙ 활  동  명:', null, '1학년 창의적 체험활동 상황'],
      [null, null, null, '⊙ 입력 영역:', null, '창의적 체험활동 누가기록'],
      ['월', '일', '요일', '교시', '이수시간', '자율', '동아리', '봉사', '진로', '활동 영역', '활동 내용'],
      [3, 9, '월', 1, 1, 1, null, null, null, '자율·자치활동', '도서관 활용교육'],
      [],
      [3, 11, '수', 7, 1, null, 1, null, null, '동아리활동', '동아리 편성'],
    ]],
    ['<누>창의(봉사)', [
      ['창의교육부', null, null, '⊙ 활  동  명:', null, '교과학습도우미'],
      [null, null, null, '⊙ 입력 영역:', null, '봉사활동 누가기록'],
      ['연번', '학년', '반', '번호', '성명', '시작일자', '시간', '봉사활동내용'],
      [1, 1, 1, 1, '김가람', '2026.04.10.', 4, '헌혈'],
      [2, 3, 2, 5, '박나래', '2026.03.09.', 12, '교과학습도우미'],
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
function book(opts) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets(opts)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  wb.Workbook = { Sheets: wb.SheetNames.map(n => ({ Hidden: n === 'Base' ? 2 : 0 })) };
  return wb;
}
function xlsxFile(name, opts) {
  const f = path.join(TMP, name);
  XLSX.writeFile(book(opts), f, { bookType: 'xlsx' });
  return f;
}
// 파일 이름은 영문으로 — Playwright 가 괄호·한글이 섞인 이름은 조용히 못 넘긴다(파일 0개)
const FILE1 = xlsxFile('sgb-4.xlsx');
const FILE2 = xlsxFile('sgb-5.xlsx', { dropOfficers: true, robotText: '로봇 코딩 캠프에서 센서 제어를 익히고 발표함.' });

// ── 1. 해석 (페이지의 순수 함수 블록을 그대로) ──
console.log('\n[해석]');
const code = HTML.match(/<script id="sgbParser">([\s\S]*?)<\/script>/)[1];
const P = new Function(code + ';return { sgbParseBook, sgbBuildDocs, sgbBookToSheets, sgbSheetInfo, sgbCompare, sgbMerge };')();
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
check('봉사 — 기재 칸이 없으면 나머지 칸을 정보로', vol.body === '' && vol.extra.join() === '시작일자,시간,봉사활동내용', vol);
const sch = parsed.schedules[0];
check('창체 일정 — 1학년, 11칸, 빈 줄 빼고 2줄', sch.grade === 1 && sch.cols.length === 11 && sch.rows.length === 2
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
check('명단(roster) — 반별 번호·이름', JSON.stringify(built.meta.roster['1-1']) === JSON.stringify([{ n: 1, nm: '김가람' }, { n: 2, nm: XSS }]),
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

// ── 3. 화면 ──
console.log('\n[화면]');
const ORIGIN = 'https://kyunghwanp.github.io';
const STUB = {
  'firebase-app.js': 'export function initializeApp(){ return {}; }',
  'firebase-auth.js': `
    const u = window.__TEST_EMAIL__ ? { email: window.__TEST_EMAIL__ } : null;
    const auth = { currentUser: u };
    export function getAuth(){ return auth; }
    export function onAuthStateChanged(a, cb){ setTimeout(() => cb(a.currentUser), 0); return () => {}; }
    export function setPersistence(){ return Promise.resolve(); }
    export class GoogleAuthProvider {}
    export function signInWithPopup(){ return Promise.reject(new Error('no')); }
    export const indexedDBLocalPersistence = {}, browserLocalPersistence = {};`,
  'firebase-firestore.js': `
    const fs = () => (window.__FS__ = window.__FS__ || {});
    const ops = () => (window.__OPS__ = window.__OPS__ || { get: 0, set: 0, del: 0 });
    const clone = v => JSON.parse(JSON.stringify(v));
    export function getFirestore(){ return {}; }
    export function doc(db, c, id){ return c + '/' + id; }
    export async function getDoc(ref){ ops().get++; const d = fs()[ref]; return { exists: () => !!d, data: () => d && clone(d) }; }
    export async function setDoc(ref, data){ ops().set++; fs()[ref] = clone(data); }
    export function writeBatch(){
      const q = [];
      return { set(ref, d){ q.push(['s', ref, clone(d)]); }, delete(ref){ q.push(['d', ref]); },
        async commit(){ for (const [k, ref, d] of q){ if (k === 's'){ ops().set++; fs()[ref] = d; } else { ops().del++; delete fs()[ref]; } } } };
    }`,
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let STORE = {};   // 문맥이 바뀌어도(다른 사람으로 열어도) 같은 Firestore 를 보게
async function openAs(email, { width = 1100 } = {}) {
  const ctx = await b.newContext({ viewport: { width, height: 900 } });
  await ctx.route(ORIGIN + '/test/saenggibu.html*', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await ctx.route(ORIGIN + '/test/favicon-32.png', r => r.fulfill({ status: 404, body: '' }));
  await ctx.route('https://www.gstatic.com/firebasejs/**', r =>
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUB[r.request().url().split('/').pop()] || '' }));
  await ctx.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: XLSXJS }));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.addInitScript(([e, store]) => {
    window.__TEST_EMAIL__ = e; window.__FS__ = store;
    navigator.clipboard.writeText = async t => { window.__copied = t; };
  }, [email, STORE]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(ORIGIN + '/test/saenggibu.html?in=1');
  page.errors = errors;
  return page;
}
const keep = async page => { STORE = await page.evaluate(() => window.__FS__); };
const ADMIN = 'pkh910518@yeungnam.hs.kr', KIM = 'kim@yeungnam.hs.kr';

// 3-1 처음 — 아무것도 없을 때
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
  check('처음 올릴 때 — 전부 「새로 추가」, 물어볼 것 없음', panel.includes('새로 추가 7') && !(await p.$('#upMissing')), panel.slice(0, 300));
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  const fsKeys = await p.evaluate(() => Object.keys(window.__FS__));
  check('목록·지문·학생·활동 문서가 저장된다', fsKeys.includes('saenggibu/meta') && fsKeys.includes('saenggibu/manifest')
    && fsKeys.includes('saenggibuStu/1-1-1') && fsKeys.some(k => k.startsWith('saenggibuAct/')), fsKeys);
  const meta = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  check('목록에 파일 이름·올린 사람·시각', meta.file === path.basename(FILE1) && meta.by === ADMIN && !!meta.at);
  check('활동마다 어느 파일에서 왔는지', meta.activities.every(a => a.file === path.basename(FILE1)));

  // 학생별
  await p.waitForSelector('#stus .stu');
  check('학생별 — 1학년 1반이 먼저, 이름 단추', (await p.$$eval('#stus .stu', bs => bs.map(x => x.textContent))).join('|') === `1김가람|2${XSS}`);
  check('이름에 섞인 태그는 글자로만 — 실행되지 않는다', await p.evaluate(() => window.__xss === undefined));
  await p.click('#stus .stu[data-n="1"]');
  await p.waitForSelector('#stuOut .card');
  check('학생 1-1-1 — 카드 3장', (await p.$$('#stuOut .card')).length === 3);
  const grps = await p.$$eval('#stuOut .grp', gs => gs.map(g => g.textContent.replace(/\s+/g, ' ').trim()));
  check('입력 영역별 묶음 — 자율·진로가 앞, 누가기록이 뒤', grps.length === 2 && grps[0].includes('자율') && grps[0].includes('진로')
    && grps[1].includes('누가기록'), grps);
  await p.click('#stuOut .card [data-copy]');
  check('복사 — 기재 문안이 그대로', await p.evaluate(() => window.__copied) === '로봇 코딩 캠프에 참여하여 센서 제어를 익힘.');
  check('학생 글(자기 평가서)은 접어 둔다', (await p.$$('#stuOut details')).length >= 1 && !(await p.isVisible('#stuOut details .txt')));
  const vcard = await p.$$eval('#stuOut .card', cs => cs.map(c => c.textContent).find(t => t.includes('헌혈')) || '');
  check('봉사처럼 기재 칸이 없으면 칸 이름과 값으로', vcard.includes('시작일자') && vcard.includes('2026.04.10.'), vcard);

  // 학번으로
  await p.fill('#hakbun', '30205');
  await p.press('#hakbun', 'Enter');
  await p.waitForFunction(() => document.querySelectorAll('#stuOut .card').length === 3);
  const t3 = await p.textContent('#stuOut');
  check('학번 30205 → 3학년 2반 5번', t3.includes('3-2-5') && t3.includes('박나래'));
  check('활동명이 겹치면 시트 이름으로 가른다 [학급 임원]', t3.includes('학생회 임원') && t3.includes('[학급 임원]'));
  check('겹치지 않으면 시트 이름을 안 붙인다', !t3.includes('[수업량유연화]'));
  check('직책 같은 덧붙은 정보', t3.includes('직책') && t3.includes('반장'));

  // 활동별
  await p.click('#views button[data-view="act"]');
  await p.waitForSelector('#acts .act');
  check('활동별 — 활동 6개', (await p.$$('#acts .act')).length === 6);
  await p.click(`#acts .act[data-id="${robot.id}"]`);
  await p.waitForSelector('#actRows .card');
  check('로봇 캠프 — 참여 학생 2명, 반별 수', (await p.$$('#actRows .card')).length === 2 && (await p.textContent('#actOut .counts')).includes('1반 2'));
  check('로봇 캠프 — 유의 사항은 접어서', (await p.textContent('#actOut')).includes('유의 사항'));
  check('로봇 캠프 — 시트·파일 이름', (await p.textContent('#actOut')).includes('파일: sgb-4.xlsx'));
  const rowTxt = await p.textContent('#actRows');
  check('태그 섞인 문안도 글자 그대로', rowTxt.includes('<b>태그</b>') && await p.evaluate(() => !document.querySelector('#actRows b')));
  await p.fill('#actQ', '없는활동');
  await p.waitForFunction(() => document.querySelector('#acts').textContent.includes('맞는 활동이 없습니다'));
  check('활동 찾기 — 없으면 안내', true);
  await p.fill('#actQ', '');

  // 창체 일정
  await p.click('#views button[data-view="sch"]');
  await p.waitForSelector('table tbody tr');
  check('창체 일정 — 표 2줄', (await p.$$('table tbody tr')).length === 2 && (await p.textContent('table')).includes('도서관 활용교육'));
  check('오류 없음', p.errors.length === 0, p.errors);
  await keep(p);
  await p.context().close();
}

// 3-2 다시 올리기(로봇 문안이 바뀌고 학급 임원 시트가 빠진 파일) — 빠진 것은 묻고, 기본은 남기기
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0 }; });
  await p.setInputFiles('#upFile', FILE2);
  await p.waitForSelector('#upGo');
  const panel = await p.textContent('#upPanel');
  check('미리보기 — 바뀐 시트와 건수(2건 → 2건)', panel.includes('내용이 바뀜 1') && (await p.textContent('#upChanged')).includes('2건 → 2건'), panel.slice(0, 400));
  check('미리보기 — 그대로 5', panel.includes('그대로 5'));
  const miss = await p.textContent('#upMissing');
  check('미리보기 — 이 파일에 없는 기존 시트를 묻는다(학급 임원)', miss.includes('기존 자료 1') && miss.includes('학급 임원'), miss);
  check('물어보는 칸의 기본값은 「남기기」', await p.$eval('#upMissing select', s => s.value) === 'keep');
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  const ops = await p.evaluate(() => window.__OPS__);
  const keys = await p.evaluate(() => Object.keys(window.__FS__));
  const msg = await p.textContent('#upPanel');
  check('남기면 — 바뀐 문서만 쓴다(로봇 활동 · 학생 1-1-1 · 목록 둘)', ops.set === 4 && ops.del === 0, ops);
  check('남긴 시트의 활동 문서가 그대로 있다', keys.some(k => k.startsWith(`saenggibuAct/${officer.id}`)));
  check('결과 안내 — 추가·바뀜·남김·지움', msg.includes('추가 0 · 바뀜 1 · 남김 1 · 지움 0'), msg);
  const s325 = await p.evaluate(() => window.__FS__['saenggibuStu/3-2-5']);
  check('남긴 시트의 문안이 학생 문서에 그대로(3-2-5 세 건)', s325.items.length === 3, s325);
  const meta = await p.evaluate(() => window.__FS__['saenggibu/meta']);
  check('남긴 활동은 처음 파일 이름, 바뀐 활동은 새 파일 이름', meta.activities.find(a => a.id === officer.id).file === 'sgb-4.xlsx'
    && meta.activities.find(a => a.id === robot.id).file === 'sgb-5.xlsx');
  check('바뀐 문안이 화면에 — 로봇', (await p.evaluate(() => window.__FS__['saenggibuStu/1-1-1'].items.map(i => i.b || '').join('|'))).includes('발표함'));
  await keep(p);
  await p.context().close();
}

// 3-2a 남길 자료 일부를 못 읽으면 — 조용히 비우지 않고 멈춘다(아무것도 안 쓴다)
{
  const saved = STORE;
  STORE = Object.fromEntries(Object.entries(saved).filter(([k]) => !k.startsWith(`saenggibuAct/${officer.id}`)));
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0 }; });
  await p.setInputFiles('#upFile', FILE2);
  await p.waitForSelector('#upGo');
  await p.click('#upGo');
  await p.waitForFunction(() => /실패|올렸습니다/.test(document.getElementById('upPanel').textContent));
  const ops = await p.evaluate(() => window.__OPS__);
  check('남길 자료를 못 읽으면 실패로 멈추고 아무것도 안 쓴다', ops.set === 0 && ops.del === 0
    && (await p.textContent('#upPanel')).includes('못 읽었습니다'), ops);
  check('실패하면 다시 누를 수 있다', !!(await p.$('#upGo')) && await p.isEnabled('#upGo'));
  await p.context().close();
  STORE = saved;
}

// 3-2b 같은 파일을 한 번 더 — 이번엔 「모두 지우기」(합본으로 바꾸기)
{
  const p = await openAs(ADMIN);
  await p.waitForSelector('#upBtn');
  await p.evaluate(() => { window.__OPS__ = { get: 0, set: 0, del: 0 }; });
  await p.setInputFiles('#upFile', FILE2);
  await p.waitForSelector('#missDelAll');
  check('같은 파일이면 바뀐 것 없음 — 남겨 둔 시트만 다시 묻는다', !(await p.$('#upChanged')) && (await p.textContent('#upPanel')).includes('그대로 6'));
  await p.click('#missDelAll');
  check('「모두 지우기」 를 누르면 칸이 전부 「지우기」', await p.$$eval('#upMissing select', ss => ss.every(s => s.value === 'del')));
  await p.click('#upGo');
  await p.waitForFunction(() => document.getElementById('upPanel').textContent.includes('올렸습니다'));
  const ops = await p.evaluate(() => window.__OPS__);
  const keys = await p.evaluate(() => Object.keys(window.__FS__));
  check('지우면 — 그 활동 문서를 지우고 3-2-5 · 목록 둘만 쓴다', ops.del === 1 && ops.set === 3
    && !keys.some(k => k.startsWith(`saenggibuAct/${officer.id}`)), ops);
  check('결과 안내 — 지움 1', (await p.textContent('#upPanel')).includes('남김 0 · 지움 1'));
  const s325 = await p.evaluate(() => window.__FS__['saenggibuStu/3-2-5']);
  check('3-2-5 학생 문서에서도 그 활동이 빠졌다', s325.items.length === 2, s325);
  check('오류 없음(다시 올리기)', p.errors.length === 0, p.errors);
  await keep(p);
  await p.context().close();
}

// 3-3 다른 선생님 — 보기만
{
  const p = await openAs(KIM, { width: 390 });
  await p.waitForSelector('#stus .stu');
  check('다른 교사 — 자료는 보이고 올리기 단추는 없다', !(await p.isVisible('#upBtn')));
  check('폰 폭에서 가로로 넘치지 않는다', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check('오류 없음(다른 교사)', p.errors.length === 0, p.errors);
  await p.context().close();
}
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
await b.close();

// ── 4. 앱에 붙인 곳 ──
console.log('\n[앱 연결]');
const IDX = fs.readFileSync(ROOT + '/index.html', 'utf8');
const USG = fs.readFileSync(ROOT + '/usage.html', 'utf8');
const RULES = fs.readFileSync(ROOT + '/firestore.rules', 'utf8');
check('탭·메뉴는 처음엔 숨김', /id="tabSaenggibu" style="display:none;"/.test(IDX) && /id="navSaenggibu" style="display:none;"/.test(IDX));
const reveal = IDX.match(/if \(_IS_ADMIN\(\)\) \{\s*\[([^\]]*)\]\.forEach/);
check('관리자일 때만 드러낸다', reveal && reveal[1].includes("'navSaenggibu'") && reveal[1].includes("'tabSaenggibu'"));
check('탭 전환 목록에 들어 있다', /'duty','saenggibu','usage'/.test(IDX) && IDX.includes("if(page === 'saenggibu') openSaenggibuFrame();"));
check('프레임 주소에 버전', IDX.includes('saenggibu.html?in=1&v=${encodeURIComponent(APP_VER)}'));
check('사용 현황에 이름이 있다', USG.includes("saenggibu:'📑 생기부 보조자료'"));
check('앱·사용 현황 버전이 같다', IDX.match(/const APP_VER = '([^']+)'/)[1] === USG.match(/const APP_VER = '([^']+)'/)[1]);
for (const c of ['saenggibu', 'saenggibuStu', 'saenggibuAct']) {
  const m = RULES.match(new RegExp(`match /${c}/\\{docId\\} \\{([^}]*)\\}`));
  check(`규칙 ${c} — 읽기 교사 전체, 쓰기 관리자`, m && /allow read:\s*if isYnhsTeacher\(\);/.test(m[1]) && /allow write: if isAppAdmin\(\);/.test(m[1]), m && m[1]);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
