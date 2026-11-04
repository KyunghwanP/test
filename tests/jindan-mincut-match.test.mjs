// 적정 대학 진단 — 수능최저 규칙 붙이기(모집단위 매칭) · 추세 문구 · 빈 해 충원 · 기타 계열.
//
// 신고(2026-11, 외부 검토):
//  1. 경북대 스마트플랜트공학과(교과우수자) 상세 창 수능최저에 건축학부(건축공학전공)·농업토목공학과·
//     전기공학과 최저가 나온다. 최저 자료에 스마트플랜트공학과 규칙은 없다.
//     원인: unitMatch 가 규칙 모집단위에 '공학'·'사회'·'자연' 이 들어 있기만 하면 '계열 규칙' 으로 봤다.
//     → 규칙 모집단위가 계열 낱말로만 된 것(인문계열·자연계·인문·사회계 …)일 때만 계열로 본다.
//       맞는 규칙이 없으면 판정하지 않고 '자료 없음 — 요강 확인' 으로 둔다.
//  2. 2년치 자료인데 상담 포인트에 '최근 3개년 합격선이…'
//  3. 경북대 '24학년도는 등급·모집인원이 모두 0 인 빈 자료인데 충원이 '0' 으로 보인다
//  4. 일본어학과·아랍어과·식물자원학과·스마트팜학과·운동재활학과·축구학과·도예학과·의류학과가 '기타'
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-mincut-match.test.mjs
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
await pg.waitForFunction(() => Object.keys(susiMincut).length > 100, null, { timeout: 30000 });

// 이 검사는 '예전 최저 자료(susi_mincut.json)' 를 붙이는 규칙을 본다. 2026-11 부터 상세 창은 어디가 2027 전형정보를
// 먼저 쓰므로(tests/jindan-mincut-adiga.test.mjs), 여기서는 어디가·자료집을 꺼서 예전 길만 그린다.
await pg.evaluate(() => { adigaMin = null; jaryoMin = null; _adigaIdx = null; });

// 학생 하나를 고른 상태(모의 등급)로 상세 창을 연다 — 충족/미충족 판정까지 보이게
const detail = (uni, dept, adm) => pg.evaluate(([uni, dept, adm]) => {
  const r = allRecords.find(x => x.university === uni && x.department === dept && x.admissionName.includes(adm));
  if (!r) return null;
  window.studentCsat = { '국': 2, '수': 2, '영': 2, '탐': [2, 2], '한': 3, examDate: '가상' };
  currentFiltered = [r]; openDetail(0);
  const s = document.getElementById('dm-susi');
  // '이 대학 전체 최저 보기'(접힌 표)의 판정은 빼고, 이 학과에 붙은 규칙의 판정만 센다
  const badges = [...s.querySelectorAll('.mc-badge')].filter(e => !e.closest('details')).length;
  return { susi: s.innerText, badges,
           tip: document.getElementById('dm-tip').innerText,
           grid: document.getElementById('dm-grid').innerText, yearCount: r.yearCount };
}, [uni, dept, adm]);

console.log('\n■ 1. 다른 학과 최저가 붙지 않는다');
const sp = await detail('경북대학교', '스마트플랜트공학과', '교과우수자');
check('경북대 스마트플랜트공학과(교과우수자) 묶음이 있다', !!sp);
const top = sp ? sp.susi.split('이 대학 전체 최저')[0] : '';
check('건축공학전공·농업토목공학과·전기공학과 최저가 붙지 않는다',
  sp && !/건축학부\(건축공학전공\)|농업토목공학과|전기공학과/.test(top), top.slice(0, 400));
check('충족/미충족 판정을 하지 않는다', sp && sp.badges === 0, sp && sp.badges);
check('최저 자료가 없으니 요강을 확인하라고 한다', sp && /최저 자료가 없습니다/.test(top) && /요강/.test(top), top.slice(0, 300));

const el = await detail('경북대학교', '전기공학과', '교과우수자');
check('경북대 전기공학과는 자기 규칙(전기공학과)이 붙고 판정된다',
  el && /전기공학과/.test(el.susi.split('이 대학 전체 최저')[0]) && el.badges > 0, el && el.susi.slice(0, 300));
const gc = await detail('가천대학교', '사회복지학과', '학생부우수자');
// 2026-11 외부 검토 뒤: 예전 자료 길은 학과명이 그대로 같을 때만 잇는다(계열 규칙도 잇지 않는다 — tests/jindan-mincut-safe.test.mjs)
check('가천대 사회복지학과(학생부우수자): 인문계열 규칙을 잇지 않고 요강 확인으로',
  gc && !/인문계열/.test(gc.susi.split('이 대학 전체 최저')[0]) && /요강 확인/.test(gc.susi) && gc.badges === 0, gc && gc.susi.slice(0, 300));

const um = await pg.evaluate(() => {
  const R = (department, category) => ({ department, category });
  const U = u => ({ '모집단위': u, '전형명': '교과우수자' });
  return {
    farm:   unitMatch(U('농업토목공학과'), R('스마트플랜트공학과', '공학')),
    arch:   unitMatch(U('건축학부(건축공학전공)'), R('스마트플랜트공학과', '공학')),
    oriental: unitMatch(U('한의예과(인문)'), R('사회복지학과', '사회')),
    pharm:  unitMatch(U('제약공학과'), R('기계공학과', '공학')),
    nat:    unitMatch(U('자연계'), R('기계공학과', '공학')),
    hum:    unitMatch(U('인문계열'), R('사회복지학과', '사회')),
    humsoc: unitMatch(U('인문·사회계'), R('경영학과', '사회')),
    excl:   unitMatch(U('인문사회계열(경찰행정학과 제외)'), R('경찰행정학과', '사회')),
    exclOk: unitMatch(U('인문사회계열(경찰행정학과 제외)'), R('경영학과', '사회')),
    all:    unitMatch(U('전 모집단위(자유전공학부 제외)'), R('자유전공학부', '기타')),
    allOk:  unitMatch(U('전 모집단위(자유전공학부 제외)'), R('경영학과', '사회')),
  };
});
check('학과 이름 규칙(농업토목공학과)은 다른 공학 학과에 붙지 않는다', um.farm === 0, um);
check('학과 이름 규칙(건축학부(건축공학전공))도 붙지 않는다', um.arch === 0, um);
check('한의예과(인문)이 인문·사회 학과 전체에 붙지 않는다', um.oriental === 0, um);
check('제약공학과가 기계공학과에 붙지 않는다', um.pharm === 0, um);
check('자연계 → 공학 학과에 계열로 붙는다', um.nat === 2, um);
check('인문계열 → 사회 학과에 계열로 붙는다', um.hum === 2, um);
check('인문·사회계 → 사회 학과에 계열로 붙는다', um.humsoc === 2, um);
check('(경찰행정학과 제외) 면 경찰행정학과에는 붙지 않는다', um.excl === 0, um);
check('(경찰행정학과 제외) 라도 경영학과에는 붙는다', um.exclOk === 2, um);
check('전 모집단위(자유전공학부 제외) → 자유전공학부엔 안 붙는다', um.all === 0, um);
check('전 모집단위(자유전공학부 제외) → 경영학과엔 붙는다', um.allOk === 1, um);

const um2 = await pg.evaluate(() => {
  const R = (department, category) => ({ department, category });
  const U = u => ({ '모집단위': u, '전형명': '교과우수자' });
  return {
    safety:  unitMatch(U('산업안전학과'), R('경영학과', '사회')),          // '안전학과' 에 '전학과' 가 들어 있다
    college: unitMatch(U('공과대학 전 모집단위'), R('경영학과', '사회')),
    humAll:  unitMatch(U('인문 전체(+의류디자인(일반)·자유전공융합학부)'), R('기계공학과', '공학')),
    hotelEx: unitMatch(U('호텔관광학과 외 전 모집단위'), R('호텔관광학과', '사회')),
    hotelOk: unitMatch(U('호텔관광학과 외 전 모집단위'), R('경영학과', '사회')),
    medEx:   unitMatch(U('약학과, 의예과, 간호학과 제외 전 모집단위'), R('간호학과', '의약')),
    natEx:   unitMatch(U('자연 - 의예과 외'), R('의예과', '의약')),
    natOk:   unitMatch(U('자연 - 의예과 외'), R('기계공학과', '공학')),
  };
});
check("'산업안전학과' 규칙은 '전 학과' 가 아니다", um2.safety === 0, um2);
check("'공과대학 전 모집단위' 는 경영학과에 붙지 않는다", um2.college === 0, um2);
check("'인문 전체(…)' 는 기계공학과에 붙지 않는다", um2.humAll === 0, um2);
check("'호텔관광학과 외 전 모집단위' → 호텔관광학과엔 안, 경영학과엔 붙는다", um2.hotelEx === 0 && um2.hotelOk === 1, um2);
check("'약학과, 의예과, 간호학과 제외 전 모집단위' → 간호학과엔 안 붙는다", um2.medEx === 0, um2);
check("'자연 - 의예과 외' → 의예과엔 안, 기계공학과엔 계열로", um2.natEx === 0 && um2.natOk === 2, um2);

// 전남대 교과(일반)는 단과대학별로만 적혀 있다. 맞는 단과대학을 못 찾았다고 '전 전형' 규칙(최저 없음)을
// 빌려 와 '수능최저를 적용하지 않습니다' 라고 하면 안 된다
const jn = await detail('전남대학교', '국제학부(일본학전공)', '일반');
const jnTop = jn ? jn.susi.split('이 대학 전체 최저')[0] : '';
check("전남대 국제학부(일본학전공) 교과 일반에 '최저 미적용' 이 붙지 않는다", jn && !/적용하지 않습니다/.test(jnTop), jnTop.slice(0, 300));
const ih = await detail('인하대학교', '스마트모빌리티공학과', '지역균형');
const ihTop = ih ? ih.susi.split('이 대학 전체 최저')[0] : '';
check("인하대 스마트모빌리티공학과(지역균형): 계열 규칙('자연 - 의예과 외'·'인문 전체')을 잇지 않는다", ih && !/자연 - 의예과 외/.test(ihTop) && !/인문 전체/.test(ihTop), ihTop.slice(0, 300));

// 전체 자료에서: 계열 매칭(2점)으로 뽑힌 규칙의 모집단위가 모두 계열 낱말인지
const whole = await pg.evaluate(() => {
  let picked = 0, um2 = 0; const units = new Set();
  for (const r of allRecords) {
    const all = susiMincut[r.uniCode] || [];
    const sc = all.map(rule => ({ rule, tm: typeMatch(rule, r), ns: nameScore(rule, r), um: unitMatch(rule, r) })).filter(x => x.tm > 0 && x.ns > 0 && x.um > 0);
    if (!sc.length) continue; picked++;
    const s = x => x.tm * 1000 + x.um * 100 + x.ns * 10; const best = Math.max(...sc.map(s));
    sc.filter(x => s(x) === best && x.um === 2).forEach(x => { um2++; units.add(x.rule['모집단위']); });
  }
  return { picked, um2, units: [...units] };
});
console.log('     (규칙이 붙는 묶음', whole.picked.toLocaleString(), '/ 계열로 붙은 모집단위', whole.units.length, '가지:', whole.units.join(' · ') + ')');
const BAD = /학과|학부|전공|대학|과\(|과$/;
check('계열로 붙은 규칙의 모집단위에 학과·학부·대학 이름이 없다', whole.units.every(u => !BAD.test(u.replace(/\([^)]*제외[^)]*\)/g, ''))),
  whole.units.filter(u => BAD.test(u.replace(/\([^)]*제외[^)]*\)/g, ''))).slice(0, 20));

console.log('\n■ 2. 추세 문구의 해 수');
check('스마트플랜트공학과는 2년치', sp && sp.yearCount === 2, sp && sp.yearCount);
check("2년치면 '3개년' 이라 하지 않는다", sp && !/3개년/.test(sp.tip) && /2개년/.test(sp.tip), sp && sp.tip.slice(0, 200));
const three = await pg.evaluate(() => {
  const r = allRecords.find(x => x.yearCount === 3 && x.trendDelta != null && Math.abs(x.trendDelta) >= 0.15);
  currentFiltered = [r]; openDetail(0); return document.getElementById('dm-tip').innerText;
});
check("3년치면 '3개년'", /3개년/.test(three), three.slice(0, 200));

console.log("\n■ 3. 빈 해의 충원");
const row = (grid, label) => (grid.split('\n').find(l => l.startsWith(label)) || '');
const chung = sp ? row(sp.grid, '충원') : '';
check("경북대 '24(빈 자료) 충원은 — 로", /^충원 \(추합\)\s+—/.test(chung), chung);
const real = await pg.evaluate(() => {
  const r = allRecords.find(x => x.years['2025'] && x.years['2025'].grade70 == null && !x.years['2025'].quotaTotal && parseFloat(x.years['2025'].waitlist) > 0);
  return r ? { w: r.years['2025'].waitlist } : null;
});
check('등급·모집이 비어도 충원이 0보다 크면(실제 값) 그대로 둔다', real && parseFloat(real.w) > 0, real);

console.log("\n■ 4. '기타' 로 빠지던 학과");
const cats = await pg.evaluate(() => Object.fromEntries([
  '일본어학과', '프랑스어학과', '스페인어학과', '러시아어학과', '아랍어과', '노어과', '프랑스어학부', '비즈니스일본어학과',
  '식물자원학과', '스마트팜학과', '응용식물학과', '운동재활학과', '피트니스산업학부', '축구학과', '도예학과', '운동처방학과',
  '의류학과', '의상학과', '의류산업학과',
  // 바뀌면 안 되는 것
  '국어국문학과', '영어교육과', '식품공학부', '패션디자인학과', '스포츠의학과', '의예과', '자율전공학부',
].map(d => [d, categorizeDepartment(d)])));
const want = { '일본어학과': '인문', '프랑스어학과': '인문', '스페인어학과': '인문', '러시아어학과': '인문', '아랍어과': '인문', '노어과': '인문',
  '프랑스어학부': '인문', '비즈니스일본어학과': '인문', '식물자원학과': '자연', '스마트팜학과': '자연', '응용식물학과': '자연',
  '운동재활학과': '예체능', '피트니스산업학부': '예체능', '축구학과': '예체능', '도예학과': '예체능', '운동처방학과': '예체능',
  '의류학과': '자연', '의상학과': '자연', '의류산업학과': '자연',
  '국어국문학과': '인문', '영어교육과': '교육', '식품공학부': '공학', '패션디자인학과': '예체능', '스포츠의학과': '예체능', '의예과': '의약', '자율전공학부': '기타' };
for (const [d, c] of Object.entries(want)) check(`${d} → ${c}`, cats[d] === c, cats[d]);

check('페이지 오류 없음', errs.length === 0, errs);
await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
