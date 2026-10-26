// 리로스쿨 상벌점 표 해석 — 학교 PC 의 PowerShell(riro/riro-push.ps1) 이 브라우저와 같은 답을 내는지.
//
// 예전에는 GitHub 서버의 크로미움이 페이지를 열고 scripts/scrape-riro.js 의 page.evaluate 로
// 표를 읽었다. 리로스쿨이 해외 접속을 막은 뒤로는 학교 PC 가 받아서 PowerShell 로 읽는다.
// 브라우저 없이 HTML 을 읽으면 브라우저가 고쳐 읽는 규칙(닫는 태그 빠뜨림, <p> 안의 블록,
// 스크립트 안의 '<td>' …)에서 갈라질 수 있다. 그래서 같은 HTML 을
//   ① 크로미움 + 원래 코드(scrape-riro.js 에서 그대로 떼어 옴)
//   ② PowerShell 의 ConvertFrom-RiroHtml
// 에 넣고 결과를 통째로 맞춰 본다.
//
// 필요: playwright, PowerShell 7 (pwsh). PWSH=/경로/pwsh 로 지정할 수 있다. 없으면 건너뛴다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = import.meta.dirname + '/..';
const PS1 = path.join(ROOT, 'riro/riro-push.ps1');
const PWSH = process.env.PWSH || 'pwsh';
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : ''));

if (spawnSync(PWSH, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status !== 0) {
  console.log(`\n⚠️  PowerShell(${PWSH}) 이 없어 건너뜁니다. PWSH=/경로/pwsh 로 지정하세요.`);
  process.exit(0);
}

// 원래 코드 — page.evaluate(() => { … }) 의 함수를 그대로 떼어 온다 (옮겨 적으면 원본이 바뀌어도 통과한다)
const SCRAPER = fs.readFileSync(path.join(ROOT, 'scripts/scrape-riro.js'), 'utf8');
const ORIGINAL = (() => {
  const a = SCRAPER.indexOf('page.evaluate(() => {');
  const s = SCRAPER.indexOf('() => {', a);
  let d = 0;
  for (let j = SCRAPER.indexOf('{', s); j < SCRAPER.length; j++) {
    if (SCRAPER[j] === '{') d++;
    else if (SCRAPER[j] === '}' && --d === 0) return SCRAPER.slice(s, j + 1);
  }
  throw new Error('scrape-riro.js 에서 page.evaluate 를 못 찾음');
})();

console.log('\n■ 스크립트 파일 (학교 PC 는 Windows PowerShell 5.1)');
{
  const raw = fs.readFileSync(PS1);
  const txt = raw.toString('utf8');
  check('UTF-8 BOM 으로 시작한다 (없으면 5.1 이 한글을 깨뜨려 읽는다)', raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF);
  const odd = [...txt.slice(1)].filter(c => [0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF].includes(c.codePointAt(0))
    || (c.codePointAt(0) >= 0x2000 && c.codePointAt(0) <= 0x200A)).map(c => c.codePointAt(0).toString(16));
  check('눈에 안 보이는 특수 공백 글자가 없다 (정규식은 \\u 표기로)', odd.length === 0, odd);
  const code = txt.split('\n').filter(l => !/^\s*#/.test(l)).join('\n').replace(/'[^'\n]*'/g, "''").replace(/"[^"\n]*"/g, '""');
  check('PowerShell 7 에만 있는 문법을 안 쓴다 (&& || ?? ?. 삼항 -Parallel)', !/&&|\|\||\?\?|\?\.|\s\?\s[^:]+\s:\s|-Parallel/.test(code));
}

// ── 시험할 HTML ─────────────────────────────────────────────────────────
const doc = (body, { doctype = true, head = '' } = {}) =>
  `${doctype ? '<!DOCTYPE html>' : ''}<html><head><meta charset="utf-8"><title>리로스쿨</title>${head}</head><body>${body}</body></html>`;
const rec = (d, t) => `<span class="label label-record">[ ${d} ]</span><span class="txt">${t}</span><br>`;
const row = (hb, name, nums = [1, 2, -1, 0], recs = '', { align = 'align="center"', open = '<tr ' } = {}) =>
  `${open}${align}><td>1</td><td>${hb}</td><td>${name}</td>${nums.map(n => `<td>${n}</td>`).join('')}<td><div class="record-p">${recs}</div></td></tr>`;
const table = rows => `<table class="table mypage_record_pc"><thead><tr><th>번호</th><th>학번</th><th>이름</th></tr></thead><tbody>${rows}</tbody></table>`;
const R2 = rec('09.04', '벌점 -1 지각') + rec('10.02', '상점 +2 봉사');

const CASES = {
  '기본': doc(table(row('10101', '김가나', [3, 5, -2, 0], R2) + row('10102', '이다라', [0, 0, 0, 0]))),
  '닫는 td·tr 생략': doc(`<table class="mypage_record_pc"><tr align="center"><td>1<td>20305<td>박마바<td>-4<td>1<td>-5<td>0<td><p class="record-p">${R2}</p>
     <tr align="center"><td>2<td>20306<td>최사아<td>2<td>2<td>0<td>0<td></table>`),
  '정렬 속성 여러 모양': doc(table(
    row('10201', '가', [1, 1, 0, 0], '', { align: 'align=center' }) +
    row('10202', '나', [1, 1, 0, 0], '', { align: "ALIGN='CENTER'" }) +
    row('10203', '다', [1, 1, 0, 0], '', { align: 'align="left"' }) +
    row('10204', '라', [1, 1, 0, 0], '', { align: 'class="x"' }) +
    row('10205', '마', [1, 1, 0, 0], '', { align: 'align=" center"' }))),
  '글자 엔티티': doc(table(row('10301', '김&nbsp;가&amp;나', [1, 0, 0, 0],
    rec('09.01', '휴대폰&nbsp;사용 &lt;수업 중&gt; &#39;경고&#x27; &middot; 담임') + rec('09.02', 'A&amp;B &quot;인용&quot;')))),
  '공백 접기': doc(table(row('10401', '  홍길동\n  ', [1, 0, 0, 0],
    `<span class="label-record">\n  09.05\t</span>\n<span>  벌점\n\n -1\t\t복장   불량  </span>`))),
  'p 안의 블록은 p 를 닫는다': doc(table(row('10501', '가', [0, 0, 0, 0],
    '') .replace('<div class="record-p"></div>',
    `<p class="record-p">${rec('09.01', '첫째')}<div>${rec('09.02', '둘째 — p 밖')}</div>${rec('09.03', '셋째 — p 밖')}</p>`))),
  '스크립트·주석·스타일 안의 태그는 글자': doc(table(
    row('10601', '<script>var s = "<td>가짜</td></tr><tr align=\'center\'>";</script>진짜', [1, 0, 0, 0], R2) +
    '<!-- <tr align="center"><td>1</td><td>19999</td><td>주석</td><td>1</td><td>1</td><td>1</td><td>1</td></tr> -->' +
    row('10602', '<style>td{color:red}</style>스타일', [2, 0, 0, 0])),
    { head: '<script>document.write = 1; var t = "<table class=\\"mypage_record_pc\\"><tr align=center>";</script>' }),
  '대문자 SCRIPT 안의 태그도 글자': doc(table(
    row('10651', '<SCRIPT>var s = "</td><td>9</td><td>9";</SCRIPT>대문자', [1, 2, 3, 4], R2))),
  '이름 칸 안의 작은 표 (칸 순서가 밀린다)': doc(table(
    row('10701', '정<table><tr><td>안1</td><td>안2</td></tr></table>', [5, 6, 7, 8], R2))),
  '이름 칸 안의 작은 표 — tr 없이 td 만 (앞 칸이 닫혀야 칸이 나뉜다)': doc(table(
    row('10751', '정<table><td>7<td>8</table>', [5, 6, 7, 8], R2))),
  '떠도는 닫는 태그는 블록을 못 넘는다': doc(table(row('10761', '가', [0, 0, 0, 0], '').replace('<div class="record-p"></div>',
    '<span><div class="record-p"><span class="label-record">09.01</span></span><span>블록 안의 내용</span></div></span>'))),
  '8번째 칸 안의 작은 표': doc(table(row('10801', '가', [1, 2, 3, 4],
    `<table><tr align="center"><td>a</td><td>99999</td><td>안</td><td>1</td><td>1</td><td>1</td><td>1</td></tr></table>${R2}`))),
  '학번·숫자 읽기': doc(table(
    row('  10901  ', '가', [' -3 ', '+2', '3점', ''], '') +
    row('123', '짧은학번', [1, 1, 1, 1]) +
    row('A0901', '글자학번', [1, 1, 1, 1]) +
    row('10902', '나', ['0x1A', 'abc', '-0', '12.7'], '') +
    row('10903', '', [1, 1, 1, 1]))),
  '날짜만·내용만·다음 요소 없음': doc(table(row('11001', '가', [0, 0, 0, 0],
    '<span class="label-record">09.01</span>' +
    '<span class="label-record">09.02</span> 글자만 있고 <b>굵은 다음 요소</b>' +
    '<span class="label-record"> </span><span>날짜가 빈칸</span>' +
    '<span class="label-record">09.03</span><span>   </span>' +
    '<span class="label-record">09.04</span>'))),
  '라벨 안의 라벨': doc(table(row('11101', '가', [0, 0, 0, 0],
    '<span class="label-record">09.01<span class="label-record">09.02</span><i>안쪽 다음</i></span><em>바깥 다음</em>'))),
  'record-p 가 둘이면 첫째만': doc(table(row('11201', '가', [0, 0, 0, 0], rec('09.01', '첫째 상자')).replace('</td></tr>',
    `<div class="record-p">${rec('09.09', '둘째 상자')}</div></td></tr>`))),
  '안 닫은 span·떠도는 닫는 태그': doc(table(
    '<tr align="center"><td>1</td><td>11301</td><td><span>안닫힘</td><td>4</span></td><td>5</td></div><td>-6</td><td>0</td>' +
    `<td><div class="record-p"><span class="label-record">09.01</span><span>내용<b>굵게</td></tr>`)),
  '대문자 태그': doc(`<TABLE CLASS="mypage_record_pc"><TR ALIGN="center"><TD>1</TD><TD>11401</TD><TD>대문자</TD><TD>1</TD><TD>1</TD><TD>0</TD><TD>0</TD>` +
    `<TD><DIV CLASS="record-p"><SPAN CLASS="label-record">09.01</SPAN><SPAN>큰 글자</SPAN></DIV></TD></TR></TABLE>`),
  '줄 바로 안의 글자': doc(`<table class="mypage_record_pc"><tr align="center">떠도는 글자<td>1</td><td>11501</td><td>가</td><td>1</td><td>1</td><td>1</td><td>1</td></tr></table>`),
  '상벌점 표가 두 개 + 모바일 표': doc(table(row('11601', '가', [1, 0, 0, 0], R2)) +
    '<table class="mypage_record_mobile"><tr align="center"><td>1</td><td>11699</td><td>모바일</td><td>1</td><td>1</td><td>1</td><td>1</td></tr></table>' +
    table(row('11602', '나', [2, 0, 0, 0]))),
  'CRLF 줄바꿈': doc(table(row('11701', '가\r\n나', [1, 0, 0, 0], '<span class="label-record">09.01\r\n</span><span>줄\r\n바꿈\r내용</span>'))),
  'doctype 없음 (호환 모드)': doc(table(row('11801', '가', [1, 0, 0, 0], R2)), { doctype: false }),
  '표 밖 리스트·폼 사이': doc('<form><ul><li>메뉴' + table(row('11901', '가', [1, 0, 0, 0], R2)) + '</ul></form>'),
};

// 실제 규모 (1033명) — 크기·시간도 같이 본다
const big = (() => {
  const rows = [];
  for (let i = 0; i < 1033; i++) {
    const g = 1 + (i % 3), r = 1 + (i % 12), n = 1 + (i % 30);
    const hb = `${g}${String(r).padStart(2, '0')}${String(n).padStart(2, '0')}`;
    let rs = '';
    for (let k = 0; k < (i % 16); k++) rs += rec(`${String(3 + (k % 9)).padStart(2, '0')}.${String(1 + k).padStart(2, '0')}`, `벌점 -1 &nbsp;지각(정당한 사유 없이) &lt;담임&gt; 김교사${k}`) + '\n';
    rows.push(row(hb, `학생${i}`, [(i % 7) - 3, i % 5, -(i % 4), i % 2], rs));
  }
  return doc(table(rows.join('\n')));
})();
CASES['실제 규모 1033명'] = big;

// ── ① 크로미움 + 원래 코드 ─────────────────────────────────────────────
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const want = {};
for (const [name, html] of Object.entries(CASES)) {
  await pg.setContent(html, { waitUntil: 'domcontentloaded' });
  want[name] = JSON.parse(JSON.stringify(await pg.evaluate(`(${ORIGINAL})()`)));
}
await b.close();

// ── ② PowerShell ─────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'riro-parse-'));
const names = Object.keys(CASES);
names.forEach((n, i) => fs.writeFileSync(path.join(TMP, `${i}.html`), CASES[n]));
const runner = path.join(TMP, 'run.ps1');
fs.writeFileSync(runner, `param([string]$Script, [string]$Dir, [int]$Count)
. $Script -LoadOnly
for ($i = 0; $i -lt $Count; $i++) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $st = ConvertFrom-RiroHtml ([IO.File]::ReadAllText((Join-Path $Dir "$i.html")))
  [IO.File]::WriteAllText((Join-Path $Dir "$i.json"), (ConvertTo-PlainJson $st))
  [IO.File]::WriteAllText((Join-Path $Dir "$i.ms"), [string][Math]::Round($sw.Elapsed.TotalMilliseconds))
}
`);
const t0 = Date.now();
execFileSync(PWSH, ['-NoLogo', '-NoProfile', '-File', runner, '-Script', PS1, '-Dir', TMP, '-Count', String(names.length)], { stdio: 'inherit' });
const got = {};
names.forEach((n, i) => { got[n] = JSON.parse(fs.readFileSync(path.join(TMP, `${i}.json`), 'utf8')); });

console.log('\n■ 같은 HTML → 크로미움(원래 코드) 과 PowerShell 이 같은 결과');
for (const n of names) {
  const a = JSON.stringify(want[n]), g = JSON.stringify(got[n]);
  let diff = '';
  if (a !== g) {
    for (let k = 0; k < Math.max(want[n].length, got[n].length); k++) {
      if (JSON.stringify(want[n][k]) !== JSON.stringify(got[n][k])) { diff = `#${k}\n         크로미움 ${JSON.stringify(want[n][k])}\n         PowerShell ${JSON.stringify(got[n][k])}`; break; }
    }
  }
  check(`${n} (${want[n].length}명 · 상세 ${want[n].reduce((s, x) => s + x.records.length, 0)}건)`, a === g, diff || undefined);
}

console.log('\n■ 시험 자료가 실제로 갈래를 건드리는지 (빈 결과끼리 맞는 건 의미가 없다)');
check('기본: 2명, 첫 학생 상세 2건', want['기본'].length === 2 && want['기본'][0].records.length === 2);
check('닫는 태그 생략도 브라우저는 2명을 읽는다', want['닫는 td·tr 생략'].length === 2 && want['닫는 td·tr 생략'][0].records.length === 2);
check('정렬: center 둘만 (left·없음·공백 낀 값 제외)', want['정렬 속성 여러 모양'].map(s => s.name).join() === '가,나', want['정렬 속성 여러 모양'].map(s => s.name));
check('p 안 블록: 첫째만 상자 안', want['p 안의 블록은 p 를 닫는다'][0].records.map(r => r.detail).join() === '첫째', want['p 안의 블록은 p 를 닫는다'][0].records);
check('스크립트 속 가짜 줄·주석 속 줄은 학생이 아니다', want['스크립트·주석·스타일 안의 태그는 글자'].length === 2);
check('이름 칸 안의 작은 표 때문에 숫자 칸이 밀린다 (브라우저도 그렇게 읽는다)', want['이름 칸 안의 작은 표 (칸 순서가 밀린다)'][0].total !== 5);
check('학번: 짧은 것·이름 빈 것은 빠지고 글자 학번은 학년이 비어 있다',
      want['학번·숫자 읽기'].map(s => s.hakbun).join() === '10901,A0901,10902' && want['학번·숫자 읽기'][1].grade === null);
check('숫자: " -3 " → -3, "3점" → 3, "" → 0, "0x1A" → 26', (() => { const [a, , c] = want['학번·숫자 읽기']; return a.total === -3 && a.merit === 2 && a.demerit === 3 && a.deducted === 0 && c.total === 26; })());
{ const s = want['이름 칸 안의 작은 표 — tr 없이 td 만 (앞 칸이 닫혀야 칸이 나뉜다)'][0];
  check('tr 없는 작은 표: 브라우저는 7·8 을 다른 칸으로 본다 (합계 7, 상점 8 — 합쳐지면 78)', s.total === 7 && s.merit === 8, s); }
check('떠도는 </span> 이 상자를 닫지 않아 상세 1건', want['떠도는 닫는 태그는 블록을 못 넘는다'][0].records.length === 1);
check('대문자 태그도 읽는다', want['대문자 태그'].length === 1 && want['대문자 태그'][0].records.length === 1);
check('표가 둘이면 둘 다, 모바일 표는 빼고', want['상벌점 표가 두 개 + 모바일 표'].map(s => s.hakbun).join() === '11601,11602');
check('1033명 · 상세 7,000건 이상', want['실제 규모 1033명'].length === 1033 && want['실제 규모 1033명'].reduce((s, x) => s + x.records.length, 0) > 7000);
const bigMs = Number(fs.readFileSync(path.join(TMP, `${names.indexOf('실제 규모 1033명')}.ms`), 'utf8'));
console.log(`     (PowerShell 1033명 해석 ${(bigMs / 1000).toFixed(1)}초 · 전체 ${((Date.now() - t0) / 1000).toFixed(1)}초)`);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
