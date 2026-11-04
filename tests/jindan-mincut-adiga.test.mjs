// 적정 대학 진단 — 수능최저를 어디가 2027 전형정보로 판정.
//
// 요청(2026-11): 최저 '자료 없음' 이 31%(6,057곳). 어디가 2027 전형정보(선생님이 받아 준 스크랩)를 먼저 쓰고,
//   어디가 '포털 필터 미포함' 은 전형분석 자료집(2026-08)과 대조, 어디가에서 못 찾으면 예전 자료 → 자료집 순.
// 판정: 학생의 수학 선택과목·탐구 과목을 보고, 모르면 가장 유리/불리하게 두 번 계산해서
//   둘 다 통과 → 충족, 둘 다 탈락 → 미충족, 갈리면 확인 필요(수학 미적분·기하 지정, 과탐 지정, 가산·감점, 한국사 등급 없음).
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-mincut-adiga.test.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.env.JINDAN_FILE || 'jindan.html';
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 500) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.hostname !== 't.local') return r.abort();
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname === '/jindan.html') f = path.resolve(ROOT, FILE);
  if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
  const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : 'text/plain';
  return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': type + '; charset=utf-8' } });
});
await pg.goto('http://t.local/jindan.html');
await pg.waitForFunction(() => document.getElementById('main-ui').classList.contains('show'), null, { timeout: 60000 });
await pg.waitForFunction(() => Object.keys(susiMincut).length > 100, null, { timeout: 60000 });

console.log('\n■ 자료');
const meta = await pg.evaluate(() => typeof adigaMin === 'undefined' || !adigaMin ? null :
  { m: adigaMin.meta, crit: adigaMin.crit.length, j: jaryoMin && jaryoMin.meta });
check('어디가 2027 최저 자료가 읽힌다(수시 최저 적용 6,186)', meta && meta.m['최저적용'] === 6186 && meta.m['수시전형'] === 35262, meta && meta.m);
check('기준 종류 500개 이상', meta && meta.crit >= 500, meta && meta.crit);
check('자료집 최저 표가 읽힌다(115개 대학)', meta && meta.j && meta.j['대학'] === 115, meta && meta.j);

// 학생을 고른 상태로 상세 창 열기
const open = (uni, dept, adm, cs) => pg.evaluate(([uni, dept, adm, cs]) => {
  const r = allRecords.find(x => x.university === uni && x.department === dept && x.admissionName.includes(adm));
  if (!r) return null;
  window.studentCsat = cs; window.studentExams = []; currentFiltered = [r]; openDetail(0);
  const s = document.getElementById('dm-susi');
  const own = [...s.querySelectorAll('.mc-badge')].filter(e => !e.closest('details')).map(e => e.textContent);
  const link = s.querySelector('.ad-src a');
  return { text: s.innerText.split('이 대학 전체 최저')[0], badges: own, href: link && link.href, uniTable: !!s.querySelector('details summary') && s.querySelector('details summary').textContent };
}, [uni, dept, adm, cs]);
const CS = (o) => Object.assign({ '국': null, '수': null, '영': null, '한': null, '탐': [], tamPairs: [], mathSub: '', examDate: '가상' }, o);

console.log('\n■ 어디가에 최저가 있는 학과');
let d = await open('대구대학교', '간호학과', '학생부교과(일반전형)', CS({ '국': 3, '수': 4, '영': 3, tamPairs: [{ g: 5, sub: '생활과 윤리' }], '탐': [5] }));
check('대구대 간호학과(일반): 2개 합 8', d && /2개 합 8/.test(d.text), d && d.text.slice(0, 300));
check('국3·영3 → 충족', d && d.badges[0] === '충족', d && d.badges);
check('출처와 어디가 주소가 붙는다', d && /어디가 2027학년도 전형정보/.test(d.text) && /^https:\/\/www\.adiga\.kr\/ucp\/prc\/uni\/admssUnivDetail\.do\?unvCd=0000084&/.test(d.href || ''), d && d.href);
check("'이 대학 전체 최저 보기 — 어디가' 가 있다", d && /어디가/.test(d.uniTable || ''), d && d.uniTable);
d = await open('경북대학교', '전기공학과', '교과우수자', CS({ '국': 3, '수': 2, '영': 2, tamPairs: [{ g: 3, sub: '물리학Ⅰ' }], '탐': [3] }));
check('경북대 전기공학과(교과우수자): 수학 포함 2개 합 5', d && /2개 합 5/.test(d.text) && /수 포함/.test(d.text), d && d.text.slice(0, 300));
check('수2 + 영2 = 4 → 충족', d && d.badges[0] === '충족', d && d.badges);
d = await open('경북대학교', '전기공학과', '교과우수자', CS({ '국': 1, '수': 4, '영': 2, tamPairs: [{ g: 1, sub: '물리학Ⅰ' }], '탐': [1] }));
check('수학이 꼭 들어간다: 수4 + 1 = 5 → 충족, 수5 면 미충족', d && d.badges[0] === '충족', d && d.badges);
d = await open('경북대학교', '전기공학과', '교과우수자', CS({ '국': 1, '수': 5, '영': 1, tamPairs: [{ g: 1, sub: '물리학Ⅰ' }], '탐': [1] }));
check('  (수5 + 1 = 6 → 미충족)', d && d.badges[0] === '미충족', d && d.badges);

console.log('\n■ 최저가 없는 학과');
d = await open('대구대학교', '경찰학부(경찰행정학전공)', '학생부교과(일반전형)', null);
// 2026-11 외부 검토: 어디가 '미포함' 은 확정값이 아니다 → 자료집이 '미적용' 이라 할 때만 '없습니다'(tests/jindan-mincut-safe.test.mjs)
check("대구대 경찰행정학전공(일반): '어디가에 최저 표시 없음 — 요강 확인 필요'", d && /어디가에 최저 표시 없음/.test(d.text) && /자료집/.test(d.text), d && d.text.slice(0, 300));
d = await open('경북대학교', '스마트플랜트공학과', '교과우수자', null);
check('경북대 스마트플랜트공학과(상주, 교과우수자): 수능최저가 없습니다', d && /수능최저가 없습니다/.test(d.text), d && d.text.slice(0, 300));
check('  다른 학과 최저가 붙지 않는다', d && !/건축학부|농업토목공학과|전기공학과/.test(d.text), d && d.text.slice(0, 300));
d = await open('가톨릭관동대학교', '건축공학전공', '학생부교과(일반전형)', null);
check("가톨릭관동대 건축공학전공(일반): 다른 학과 규칙을 빌리지 않고 '요강 확인 필요'(자료집 대조 문구와 함께)", d && /요강 확인 필요/.test(d.text) && /자료집/.test(d.text) && !/의학과|간호학과/.test(d.text), d && d.text.slice(0, 300));

console.log('\n■ 자료끼리 다를 때');
d = await open('경성대학교', '간호학과', '저소득층', null);
check('경성대 간호학과(저소득층): 어디가엔 없고 자료집엔 있음 → 확인 필요 + 자료집 쪽', d && /확인 필요/.test(d.text) && /자료집 \d+쪽/.test(d.text), d && d.text.slice(0, 400));

console.log('\n■ 어디가에서 못 찾으면 예전 자료');
const fb = await pg.evaluate(() => {
  const r = allRecords.find(x => !adigaFind(x) && pickMincut(x).length);
  window.studentCsat = null; currentFiltered = [r]; openDetail(0);
  return document.getElementById('dm-susi').innerText;
});
check("'예전 최저 자료로 보여 드려요' 안내와 함께 예전 규칙", /예전 최저 자료로/.test(fb), fb.slice(0, 200));

console.log('\n■ 판정기(가짜 기준·가짜 학생)');
const ev = (c, cs) => pg.evaluate(([c, cs]) => { const e = evalAdiga(c, cs); return e && e.label; }, [c, CS(cs)]);
const M = { h: 's', n: 2, v: 4, a: '국수영탐', ms: ['미적분', '기하'], ts: 'SK' };
const m0 = { '국': 5, '수': 1, '영': 5, tamPairs: [{ g: 3, sub: '물리학Ⅰ' }], '탐': [3] };
check('수학 미적분·기하 지정 — 미적분이면 수1+탐3 = 4 충족', await ev(M, { ...m0, mathSub: '미적분' }) === '충족');
check('  확률과 통계면 수학 빠짐 → 탐3+국5 = 8 미충족', await ev(M, { ...m0, mathSub: '확률과 통계' }) === '미충족');
check('  과목을 모르면 확인 필요', await ev(M, { ...m0, mathSub: '' }) === '확인 필요');
const K = { h: 's', n: 2, v: 4, a: '국수영탐', ts: 'K' };
const k0 = { '국': 5, '수': 5, '영': 1, '탐': [3] };
check('과탐만 — 사탐이면 탐구 빠짐 → 영1+국5 = 6 미충족', await ev(K, { ...k0, tamPairs: [{ g: 3, sub: '생활과 윤리' }] }) === '미충족');
check('  과탐이면 영1+탐3 = 4 충족', await ev(K, { ...k0, tamPairs: [{ g: 3, sub: '지구과학Ⅰ' }] }) === '충족');
check('  과목을 모르면 확인 필요', await ev(K, { ...k0, tamPairs: [{ g: 3, sub: '' }] }) === '확인 필요');
const U = { h: 's', n: 2, v: 4, a: '국수영탐', mu: 1, mus: ['미적분', '기하'], ts: 'SK' };
const u0 = { '국': 5, '수': 3, '영': 2, tamPairs: [{ g: 6, sub: '화학Ⅰ' }], '탐': [6] };
check('미적분·기하 1등급 가산 — 미적분이면 수3→2, 2+2 = 4 충족', await ev(U, { ...u0, mathSub: '미적분' }) === '충족');
check('  확률과 통계면 3+2 = 5 미충족', await ev(U, { ...u0, mathSub: '확률과 통계' }) === '미충족');
check('  모르면 확인 필요', await ev(U, { ...u0, mathSub: '' }) === '확인 필요');
const D = { h: 's', n: 2, v: 5, a: '국수영탐', r: '수', md: 1, ts: 'SK' };
const d0 = { '국': 3, '수': 2, '영': 4, tamPairs: [{ g: 6, sub: '화학Ⅰ' }], '탐': [6] };
check('확률과 통계 1등급 감점 — 확통이면 수2→3, 3+3 = 6 미충족', await ev(D, { ...d0, mathSub: '확률과 통계' }) === '미충족');
check('  미적분이면 2+3 = 5 충족', await ev(D, { ...d0, mathSub: '미적분' }) === '충족');
const H = { h: 's', n: 2, v: 6, k: 4, a: '국수영탐', ts: 'SK' };
check('한국사 4등급 이내 — 한5 미충족', await ev(H, { '국': 2, '수': 2, '한': 5 }) === '미충족');
check('  한3 충족', await ev(H, { '국': 2, '수': 2, '한': 3 }) === '충족');
check('  한국사 등급이 없으면 확인 필요', await ev(H, { '국': 2, '수': 2 }) === '확인 필요');
check('영어 1·2등급 통합 — 각 1등급인데 영2 도 1로', await ev({ h: 'e', n: 2, v: 1, a: '국수영탐', em: 1 }, { '국': 1, '영': 2 }) === '충족');
const A = { h: 's', n: 2, v: 4, a: '국수영탐', avg: 1, ts: 'SK' };
const a0 = { '국': 2, tamPairs: [{ g: 2, sub: '화학Ⅰ' }, { g: 3, sub: '생명과학Ⅰ' }], '탐': [2, 3] };
check('탐구 2과목 평균 — 평균 2.5 그대로면 2+2.5 = 4.5 미충족', await ev(A, a0) === '미충족');
check('  버림이면 2+2 = 4 충족', await ev({ ...A, fl: 1 }, a0) === '충족');
const S = { h: 's', n: 2, v: 6, a: '국수영탐', sci: 1, ts: 'SK' };
check('과탐 1과목 이상 응시 — 사탐 둘이면 미충족', await ev(S, { '국': 2, '수': 2, tamPairs: [{ g: 1, sub: '사회·문화' }, { g: 1, sub: '생활과 윤리' }], '탐': [1, 1] }) === '미충족');
check('  과탐이 있으면 충족', await ev(S, { '국': 2, '수': 2, tamPairs: [{ g: 1, sub: '지구과학Ⅰ' }, { g: 1, sub: '생활과 윤리' }], '탐': [1, 1] }) === '충족');
check('여러 기준이 섞인 원문은 확인 필요', await ev({ x: '계열·학과마다 기준이 다름', h: 's', n: 2, v: 5 }, { '국': 1, '수': 1 }) === '확인 필요');
check('학생 등급이 모자라면 미판정', await ev({ h: 's', n: 3, v: 9, a: '국수영탐' }, { '국': 1 }) === '미판정');

console.log('\n■ 전체 진단에서');
const tot = await pg.evaluate(() => {
  const c = { n: allRecords.length, 어디가기준: 0, 예전자료: 0, 최저없음: 0, 확인필요: 0, 요강확인: 0 };
  for (const r of allRecords) {
    const a = adigaFind(r), jc = jaryoCheck(r);
    if (a && a.crit) c.어디가기준++;
    else if (a) { if (jc.state === 'none') c.최저없음++; else if (jc.state === 'listed' || oldExact(r).length) c.확인필요++; else c.요강확인++; }
    else if (pickMincut(r).length) c.예전자료++;
    else if (jc.state === 'none') c.최저없음++; else if (jc.state === 'listed') c.확인필요++; else c.요강확인++;
  }
  return c;
});
console.log('     ', JSON.stringify(tot));
check('어디가 기준으로 판정하는 학과·전형이 3,700곳 이상', tot.어디가기준 >= 3700, tot);
check("'최저 없음'(초록)은 자료집이 미적용이라 한 곳만 — 1% 아래", tot.최저없음 / tot.n < 0.01, tot);
check('모든 학과·전형이 한 갈래에 든다', tot.어디가기준 + tot.예전자료 + tot.최저없음 + tot.확인필요 + tot.요강확인 === tot.n, tot);

check('페이지 오류 없음', errs.length === 0, errs);
await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
