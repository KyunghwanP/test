// 적정 대학 진단 — '수능최저가 없습니다' 를 확정처럼 보여 주지 않기 · 예전 자료는 학과명이 같을 때만.
//
// 신고(2026-11, 외부 검토):
//  1. 어디가 2027 '포털 필터 미포함'(12,051곳)을 초록 상자 '이 학과·전형은 수능최저가 없습니다' 로 보여 준다.
//     자료 파일 메타에도 '미포함은 최저 없음으로 확정한 값이 아니다' 라고 적혀 있다. 3,568곳은 자료집에 대학 자체가 없다.
//     예: 한림대 의학과 학종(지역인재 기초생활) — 한림대 요강·입학처는 의학과 지역인재 최저 '국·영·수·과탐 중 3개 합 5'.
//     차의과학대 간호대학, 남부대(교과 일반학생)도 같은 모양(예전 요강 자료는 같은 학과에 최저가 있음).
//     → 자료집이 '미적용' 이라고 직접 말할 때만 초록. 나머지는 노랑 '어디가에 최저 표시 없음 — 요강 확인 필요'.
//  2. 어디가에서 못 찾아 예전 자료로 보여 주는 길에 '이름 일부만 같으면 잇기' 가 남아 있다(92곳).
//     가천대 한의예과 ← 의예과, 전남대·호남대 공학계열 ← 자유전공학부, 강서대 G2빅데이터경영학과 ← 경영학과,
//     세명대 교과(일반) 디자인 학과 ← 실기전형 최저 → 학과명이 그대로 같을 때(또는 그 전형의 '전 모집단위')만.
//  3. 러시아학과·독일학과가 '기타', 언어치료학과가 '인문'.
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-mincut-safe.test.mjs
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
await pg.waitForFunction(() => Object.keys(susiMincut).length > 100 && typeof adigaMin !== 'undefined' && adigaMin, null, { timeout: 60000 });

const box = (uni, dept, adm) => pg.evaluate(([uni, dept, adm]) => {
  const r = allRecords.find(x => x.university === uni && x.department === dept && x.admissionName === adm);
  if (!r) return null;
  window.studentCsat = null; currentFiltered = [r]; openDetail(0);
  const s = document.getElementById('dm-susi');
  return { text: s.innerText.split('이 대학 전체 최저')[0], green: !!s.querySelector('.ad-none'), yellow: !!s.querySelector('.ad-warn'),
           guide: !!s.querySelector('button.ad-guide') };
}, [uni, dept, adm]);
const NONE = /수능최저가 없습니다/;

console.log('\n■ 1. 확정할 수 없는 곳에 \'최저 없음\' 을 띄우지 않는다');
let d = await box('한림대학교', '의학과', '학생부종합(지역인재전형_기초생활수급자및차상위계층)');
check('한림대 의학과 학종(지역인재 기초생활): 초록 \'없습니다\' 가 아니다', d && !d.green && !NONE.test(d.text), d && d.text.slice(0, 300));
check('  확인 필요(노랑)로 보여 준다', d && d.yellow, d && d.text.slice(0, 300));
d = await box('차의과학대학교', '간호대학', '학생부교과(CHA학생부교과전형)');
check('차의과학대 간호대학(CHA학생부교과): 초록이 아니고 확인 필요', d && !d.green && d.yellow, d && d.text.slice(0, 300));
d = await box('남부대학교', 'AI경영학과', '학생부교과(일반학생)');
check('남부대 AI경영학과(교과 일반학생): 초록이 아니고 확인 필요', d && !d.green && d.yellow, d && d.text.slice(0, 300));
check('  예전 요강 자료에 최저가 있다고 알려 준다', d && /예전/.test(d.text), d && d.text.slice(0, 300));
d = await box('대구대학교', '경찰학부(경찰행정학전공)', '학생부교과(일반전형)');
check("대구대 경찰행정학전공(일반): '어디가에 최저 표시 없음 — 요강 확인 필요'", d && !d.green && d.yellow && /어디가에 최저 표시 없음/.test(d.text) && /요강/.test(d.text), d && d.text.slice(0, 300));
check("  요강에서 '최저' 찾기 단추가 있다", d && d.guide, d);
const src = await pg.evaluate(() => { document.querySelector('#dm-susi button.ad-guide').click(); return document.getElementById('guide-frame').getAttribute('src') || ''; });
check("  누르면 그 대학 요강이 '최저학력' 검색으로 열린다", /appguide\.html\?code=84&/.test(src) && src.includes('q=' + encodeURIComponent('최저학력')), src);
await pg.evaluate(() => closeGuide());
const mj = await pg.evaluate(() => {
  const r = allRecords.find(x => x.university === '명지대학교' && adigaFind(x) && !adigaFind(x).crit);
  if (!r) return null; window.studentCsat = null; currentFiltered = [r]; openDetail(0);
  const s = document.getElementById('dm-susi'); return { text: s.innerText.split('이 대학 전체 최저')[0], green: !!s.querySelector('.ad-none') };
});
check('명지대(자료집에 대학 없음): 초록이 아니고 \'대조하지 못했습니다\'', mj && !mj.green && /대조하지 못했/.test(mj.text), mj && mj.text.slice(0, 300));

console.log('\n■ 자료집이 \'미적용\' 이라고 직접 말하면 초록');
d = await box('경북대학교', '스마트플랜트공학과', '학생부교과(교과우수자전형)');
check('경북대 스마트플랜트공학과(상주): 수능최저가 없습니다 — 자료집 \'미적용\'(생태환경대학·과학기술대학)', d && d.green && NONE.test(d.text) && /미적용/.test(d.text), d && d.text.slice(0, 300));
// 외부 검토: 경북대 축산학과·에너지화학공학과 등 9곳은 예전 요강 자료엔 최저가 있지만 2027 요강 75쪽은 미적용 → 새 자료가 맞다
d = await box('경북대학교', '축산학과', '학생부교과(교과우수자전형)');
check('경북대 축산학과(상주, 교과우수자): 예전 자료와 달라도 2027 자료집 미적용이 먼저 → 수능최저가 없습니다', d && d.green && NONE.test(d.text), d && d.text.slice(0, 300));
d = await box('경북대학교', '자율미래인재학부', '학생부교과(교과우수자전형)');
check('경북대 자율미래인재학부: 수능최저가 없습니다', d && d.green, d && d.text.slice(0, 300));
const greens = await pg.evaluate(() => {
  let g = 0, all = 0;
  for (const r of allRecords) { const ad = adigaFind(r); if (ad && !ad.crit) { all++; if (jaryoCheck(r).state === 'none') g++; } }
  return { g, all };
});
console.log('     ', JSON.stringify(greens));
check('어디가 미포함 중 초록은 자료집이 \'미적용\' 이라고 한 곳뿐(10% 아래)', greens.g > 0 && greens.g / greens.all < 0.1, greens);

console.log('\n■ 2. 예전 자료 길 — 학과명이 같을 때만');
const pk = (uni, dept, adm) => pg.evaluate(([uni, dept, adm]) => {
  const r = allRecords.find(x => x.university === uni && x.department === dept && x.admissionName === adm);
  return r ? pickMincut(r).map(x => x['모집단위']) : null;
}, [uni, dept, adm]);
let p = await pk('가천대학교', '한의예과', '학생부종합(가천의약학)');
check('가천대 한의예과 ← 의예과 최저가 붙지 않는다', p && !p.includes('의예과'), p);
p = await pk('전남대학교', '공학계열', '학생부교과(일반)');
check('전남대 공학계열 ← 자율전공학부 최저가 붙지 않는다', p && !p.some(u => /자율전공|자유전공/.test(u)), p);
p = await pk('호남대학교', '공학계열', '학생부교과(일반고전형)');
check('호남대 공학계열 ← 자유전공학부 최저가 붙지 않는다', p && !p.some(u => /자율전공|자유전공/.test(u)), p);
p = await pk('강서대학교', 'G2빅데이터경영학과', '학생부교과(일반학생)');
check('강서대 G2빅데이터경영학과 ← 경영학과 최저가 붙지 않는다', p && !p.includes('경영학과'), p);
p = await pk('세명대학교', '아트&산업디자인학과', '학생부교과(일반전형)');
check('세명대 아트&산업디자인학과(교과 일반) ← 실기전형 최저가 붙지 않는다', p && !p.some(u => /실기/.test(u)), p);
const st = await pg.evaluate(() => {
  let part = 0, n = 0;
  for (const r of allRecords) {
    if (adigaFind(r)) continue;
    // 붙은 규칙은 모두 '학과명이 그대로 같음' 이거나 '전 모집단위' 줄이어야 한다
    for (const rule of pickMincut(r)) { n++; if (!exactUnit(rule, r) && unitMatch(rule, r) !== 1) part++; }
  }
  return { part, n };
});
check('예전 자료 길에서 부분 일치·계열로 붙는 규칙이 없다', st.part === 0, st);
const ok = await pk('경북대학교', '전기공학과', '학생부교과(교과우수자전형)');
check('학과명이 같으면 그대로 붙는다(경북대 전기공학과)', ok && ok.includes('전기공학과'), ok);

console.log('\n■ 3. 계열');
const cats = await pg.evaluate(() => Object.fromEntries(['러시아학과', '독일학과', '러시아·유라시아학과', '독일유럽학과', '언어치료학과', '청각언어재활학과', '국어국문학과', '언어학과']
  .map(x => [x, categorizeDepartment(x)])));
for (const [k, v] of Object.entries({ '러시아학과': '인문', '독일학과': '인문', '러시아·유라시아학과': '인문', '독일유럽학과': '인문', '언어치료학과': '의약', '청각언어재활학과': '의약', '국어국문학과': '인문', '언어학과': '인문' }))
  check(`${k} → ${v}`, cats[k] === v, cats[k]);

check('페이지 오류 없음', errs.length === 0, errs);
await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
