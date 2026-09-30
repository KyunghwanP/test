// 진단(jindan.html)이 읽는 어디가 입결 CSV.
//
// 2024·2025학년도(조회 2025·2026) 경쟁률과 대학별 지역은 원래 이 파일에 없었다.
// 다른 곳에서 받은 어디가 자료(2023~2026)에서 옮겨 채웠다(2026-09). 지역은 그 자료가
// 비워 두거나 틀린 23곳(분교·경산 소재 대학 등)을 검색으로 확인해 고쳤다. 옮길 때의 원칙:
//   · 원래 값은 한 칸도 안 바꾼다. 비어 있던 경쟁률 칸과 맨 끝 '지역' 칸만 더했다
//   · 짝(전형명 표기가 서로 다르다)이 확실할 때만 채운다. 정답을 아는 2026학년도로
//     같은 방법을 돌려 21,332건 중 오답 0건을 확인했다. 애매하면 비워 둔다
//
// 어디가에서 CSV 를 새로 받아 통째로 덮으면 이 두 가지가 조용히 사라진다.
// 이 검사가 그때 알려 준다 — 덮기 전에 다시 채울지 정할 것.
import { chromium } from 'playwright';
import fs from 'node:fs';

const H = fs.readFileSync(import.meta.dirname + '/../jindan.html', 'utf8');
const CSV = fs.readFileSync(import.meta.dirname + '/../2026_adiga_univ_results.csv', 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));
const grab = name => { const m = new RegExp(`^\\s*function ${name}\\(`, 'm').exec(H); let i = H.indexOf('{', m.index), d = 0;
  for (let j = i; ; j++) { if (H[j] === '{') d++; else if (H[j] === '}' && --d === 0) return H.slice(m.index, j + 1); } };

console.log('\n■ 파일 모양');
const head = CSV.slice(0, CSV.indexOf('\n'));
check('맨 끝 칸이 지역이다 (진단이 쓰는 앞 15칸은 그대로)',
      head === '조회연도,대학명,대학코드,전형명,구분,모집단위,모집인원_최초,모집인원_이월,모집인원_총,경쟁률,충원인원,환산점수_50,환산점수_70,환산등급_50,환산등급_70,지역', head);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
await pg.setContent('<body>');
const SY = /const SURVEY_YEARS = \[[^\]]+\];/.exec(H)[0];
await pg.addScriptTag({ content: SY + grab('categorizeDepartment') + grab('parseCSVLine') + grab('parseCSV') });
const r = await pg.evaluate(csv => {
  const recs = parseCSV(csv);
  const has = (x, y) => x.years[y] && parseFloat(x.years[y].competition) > 0;
  const find = (u, d, a) => recs.find(x => x.university === u && x.department === d && x.admissionName.includes(a));
  const g = find('가천대학교', '물리치료학과', '지역균형');
  return { n: recs.length, y24: recs.filter(x => has(x, '2025')).length, y25: recs.filter(x => has(x, '2026')).length,
           y26: recs.filter(x => has(x, '2027')).length, g: g && Object.fromEntries(Object.entries(g.years).map(([y, v]) => [y, v.competition])) };
}, CSV);
await b.close();

console.log('\n■ 진단 페이지가 읽는 결과');
check('학과 묶음 수는 그대로 (채우기 전 19,759)', r.n === 19759, r.n);
check('2026학년도 경쟁률은 원래 것 그대로', r.y26 === 18383, r.y26);
check('2024학년도 경쟁률이 있다 (채운 것 8,581)', r.y24 >= 8500, r.y24);
check('2025학년도 경쟁률이 있다 (채운 것 11,226)', r.y25 >= 11000, r.y25);
// 어디가 공개값과 대조한 한 건: 2024 12.8 · 2025 38.5 · 2026 21
check('한 건 대조 — 가천대 물리치료(지역균형)', r.g && r.g['2025'] === '12.8' && r.g['2026'] === '38.5' && r.g['2027'] === '21', r.g);

console.log('\n■ 지역');
{
  // 칸 안에 줄바꿈이 든 행('미제출 사유 : …' 메모)이 있어 줄 단위로 자르면 안 된다 — 따옴표를 따라 읽는다.
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < CSV.length; i++) {
    const c = CSV[i];
    if (q) { if (c === '"') { if (CSV[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  const body = rows.slice(1);
  check('모든 행이 16칸이다', body.every(r => r.length === 16), body.find(r => r.length !== 16));
  const ga = body.filter(r => r[0] === '2027' && r[1] === '가천대학교[본교]');
  check('대학마다 지역이 붙어 있다 (가천대 → 경기)', ga.length > 0 && ga.every(r => r[15] === '경기'), ga[0]);
  const regions = new Set(body.map(r => r[15]).filter(Boolean));
  check('지역 값은 17개 시·도 안에서만', [...regions].every(x => /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)$/.test(x)), [...regions]);
  check('지역이 빈 대학이 없다', body.every(r => r[15]), [...new Set(body.filter(r => !r[15]).map(r => r[1]))]);
  // 받은 자료는 분교·경산 소재 대학을 틀리게 적은 곳이 있어 검색으로 확인해 바로잡았다.
  // 새 자료로 덮다가 다시 틀어지지 않게 몇 곳을 붙잡아 둔다.
  const regOf = u => (body.find(r => r[1] === u) || [])[15];
  for (const [u, want] of [['가톨릭대학교[본교]', '경기'], ['가톨릭대학교[제2캠퍼스]', '서울'], ['명지대학교[본교]', '경기'],
                           ['명지대학교[제2캠퍼스]', '서울'], ['경기대학교[제2캠퍼스]', '서울'], ['안양대학교[제2캠퍼스]', '인천'],
                           ['경동대학교[제4캠퍼스]', '경기'], ['영남대학교[본교]', '경북'], ['홍익대학교[제2캠퍼스]', '세종']])
    check(`${u} → ${want}`, regOf(u) === want, regOf(u));
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
