// 적정 대학 진단 — 대학코드 하나에 시·도가 다른 캠퍼스가 섞인 대학의 캠퍼스·지역.
//
// 신고(2026-11): 경북대 상주캠퍼스 학과(스마트플랜트공학과 등)가 '본교 · 대구' 로 나온다.
//   CSV(어디가)는 경북대를 대학코드 5 하나로만 주고 '지역' 도 대구 하나라, 지역 단추에서 '경북' 을 켜면
//   상주 학과가 빠지고 '대구' 만 켜면 섞여 나온다.
//   같은 모양: 경희대 국제캠퍼스(용인)·한국외대 글로벌캠퍼스(용인)가 '서울', 한국교통대 의왕캠퍼스가 '충북',
//   성균관대 자연과학캠퍼스(수원)가 '서울', 가천대 메디컬캠퍼스(인천)가 '경기', 동양대 동두천캠퍼스가 '경북' …
// 고친 것: jindan.html 의 CAMPUS_FIX(웹 검색으로 확인한 학과만)로 읽을 때 캠퍼스·지역을 바꾼다. 원본 CSV 는 그대로.
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-campus.test.mjs
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
await pg.waitForFunction(() => document.getElementById('main-ui').classList.contains('show'), null, { timeout: 30000 });

const where = (uni, dept) => pg.evaluate(([uni, dept]) => {
  const rs = allRecords.filter(r => r.university === uni && r.department.replace(/[・·]/g, '·') === dept.replace(/[・·]/g, '·'));
  return rs.length ? [...new Set(rs.map(r => r.campus + ' · ' + r.region))].join(' / ') : null;
}, [uni, dept]);
const want = async (uni, dept, exp) => { const g = await where(uni, dept); check(`${uni} ${dept} → ${exp}`, g === exp, g); };

console.log('\n■ 신고: 경북대 상주캠퍼스');
await want('경북대학교', '스마트플랜트공학과', '상주캠퍼스 · 경북');
await want('경북대학교', '정밀기계공학과', '상주캠퍼스 · 경북');
await want('경북대학교', '말/특수동물학과', '상주캠퍼스 · 경북');
await want('경북대학교', '체육학부 체육학전공', '상주캠퍼스 · 경북');
await want('경북대학교', '자율미래인재학부', '상주캠퍼스 · 경북');
await want('경북대학교', '전기공학과', '본교 · 대구');
await want('경북대학교', '식물의학과', '본교 · 대구');                 // 농업생명과학대학(대구)
await want('경북대학교', '첨단기술융합대학 자율학부1', '본교 · 대구');   // 첨단기술융합대학(대구)

console.log('\n■ 같은 모양의 다른 대학');
await want('경희대학교', '기계공학부', '국제캠퍼스 · 경기');
await want('경희대학교', '전자공학부 반도체공학과', '국제캠퍼스 · 경기');
await want('경희대학교', '자유전공학부', '국제캠퍼스 · 경기');
await want('경희대학교', '자율전공학부', '본교 · 서울');
await want('경희대학교', '미래정보디스플레이학부', '본교 · 서울');
await want('경희대학교', '응용영어통번역학과', '본교 · 서울');
await want('한국외국어대학교', '컴퓨터공학부', '글로벌캠퍼스 · 경기');
await want('한국외국어대학교', 'AI데이터융합학부', '글로벌캠퍼스 · 경기');
await want('한국외국어대학교', 'Language & AI융합학부', '본교 · 서울');
await want('한국외국어대학교', '영어통번역학과', '본교 · 서울');
await want('한국외국어대학교', '융합일본지역학부', '본교 · 서울');
await want('국립한국교통대학교', '철도운전시스템공학과', '의왕캠퍼스 · 경기');
await want('국립한국교통대학교', '간호학과', '본교 · 충북');
await want('성균관대학교', '의예과', '자연과학캠퍼스 · 경기');
await want('성균관대학교', '소프트웨어학과', '자연과학캠퍼스 · 경기');
await want('성균관대학교', '경영학과', '본교 · 서울');
await want('가천대학교', '의예과', '메디컬캠퍼스 · 인천');
await want('가천대학교', '의공학과', '본교 · 경기');                    // 2022 글로벌 IT융합대학으로
await want('동양대학교', '철도시스템공학과', '동두천캠퍼스 · 경기');
await want('동양대학교', '철도운전제어학과', '본교 · 경북');
await want('세한대학교', '항공운항학과', '당진캠퍼스 · 충남');
await want('청운대학교', '컴퓨터공학과', '인천캠퍼스 · 인천');
await want('유원대학교', '작업치료학과', '아산캠퍼스 · 충남');
await want('우석대학교', '휴먼테크 자율전공학부(진천)', '진천캠퍼스 · 충북');
await want('우석대학교', '휴먼테크 자율전공학부(전주)', '본교 · 전북');

console.log('\n■ 목록에 적은 학과명이 CSV 에 실제로 있다(오타로 조용히 빠지지 않게)');
const csv = fs.readFileSync(path.join(ROOT, '2026_adiga_univ_results.csv'), 'utf8').split('\n').slice(1);
const byCode = {};
for (const line of csv) {
  const c = line.split(',');   // 학과명에 쉼표가 든 행은 없다(대상 대학 기준) — 앞 6칸만 쓴다
  if (c.length < 6 || c[4] !== '수시') continue;
  (byCode[c[2]] = byCode[c[2]] || new Set()).add(c[5].replace(/[・·?]/g, '·').replace(/\s+/g, ''));
}
const fix = await pg.evaluate(() => typeof CAMPUS_FIX === 'undefined' ? null : CAMPUS_FIX);
check('CAMPUS_FIX 가 있다', !!fix);
if (fix) {
  const missing = [];
  for (const [code, v] of Object.entries(fix))
    for (const d of v.depts) if (!(byCode[code] || new Set()).has(d.replace(/[・·?]/g, '·').replace(/\s+/g, ''))) missing.push(code + ':' + d);
  check('모든 학과명이 그 대학 CSV 에 있다', missing.length === 0, missing);
  check('지역 값이 지역 단추 17개 안에 든다', Object.values(fix).every(v => /^(서울|경기|인천|강원|대전|세종|충북|충남|대구|경북|부산|울산|경남|광주|전북|전남|제주)$/.test(v.region)));
}

console.log('\n■ 지역 단추');
await pg.evaluate(() => setRange('all'));
const pick = async labels => {
  await pg.evaluate(() => clearRegion());
  for (const l of labels) await pg.evaluate(l => toggleRegion(l), l);
  return pg.evaluate(() => currentFiltered.filter(r => r.university === '경북대학교').map(r => r.department + '|' + r.region));
};
let rs = await pick(['대구']);
check("'대구' 만 켜면 경북대 상주 학과가 없다", rs.length > 0 && !rs.some(x => x.startsWith('스마트플랜트공학과') || x.endsWith('|경북')), rs.filter(x => x.endsWith('|경북')).slice(0, 5));
rs = await pick(['경북']);
check("'경북' 만 켜면 경북대 상주 학과가 나온다", rs.some(x => x.startsWith('스마트플랜트공학과|')) && rs.every(x => x.endsWith('|경북')), rs.slice(0, 5));
await pg.evaluate(() => clearRegion());

console.log('\n■ 화면');
const card = await pg.evaluate(() => {
  const i = allRecords.findIndex(r => r.university === '경북대학교' && r.department === '스마트플랜트공학과');
  currentFiltered = [allRecords[i]]; openDetail(0);
  return document.getElementById('dm-campus').textContent;
});
check("상세 창에 '상주캠퍼스 · 경북'", card === '상주캠퍼스 · 경북', card);
check('페이지 오류 없음', errs.length === 0, errs);

await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
