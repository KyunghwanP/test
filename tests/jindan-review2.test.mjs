// 적정 대학 진단 — ver8.56 외부 검토 신고 재현.
//
//  1. 기본 화면(3.29 · 교과 · 일반 · ±0.1 · 소신 포함) 1,297건 중 위험 573(44%), 경계 962(74%), 깔끔한 적정 3건.
//     소신을 켜면 범위가 0.5 더 올라가 위험권이 들어오고, 70%컷 ±0.1 안이면 다 경계라 ±0.1 범위가 거의 전부 경계.
//     → 소신 확장은 그 학과의 완충(0.15~0.4) 안(= 소신)까지만, '경계' 는 안정 선 0.1 안·1년 자료·변동 0.8↑·역전일 때
//       (70%컷 선·위험 선 옆은 넣지 않는다 — 적정/소신 라벨과 ▲▼ 차이가 이미 보여 준다).
//  2. 50%·70% 평균을 서로 다른 해 묶음으로 내서 안 뒤집힌 곳이 '50%컷 역전'(397곳). 동아대 교육학과(교과성적우수자):
//     '25 3.75 < 4.08, '26 3.08 < 3.33 인데 역전으로 판정. → 두 컷이 다 있는 해끼리.
//  3. 예전 요강 자료의 '최저 없음' 만 보고 초록: 경상국립대 교과 일반 7개 학과(비고 '일부학과 적용', 2027 자료집엔
//     소프트웨어공학과 '2개 영역 합 10'), 전북대 사회과교육학부 농어촌(교과) '최저 없음(교과만 적용)',
//     경북대 물리학과 농어촌(종합) '상위2개합6 최저 미적용' → 자료집과 대조, 애매한 비고면 확인 필요.
//  4. 전형 이름만 바뀌어도 앞 해 기록이 끊김: 강원대 간호학과 '농어촌전형'→'농어촌학생전형',
//     고신대 의예과 '지역인재특별전형'→'지역인재전형'.
//  5. '전공' 을 다 지워 안전공학과가 기타. 공과대학·경상학부·기독교학과·상담학과·물류학과도 기타.
//  6. 막대 보기에만 '경계' 표시가 없음.   7. 필터 초기화가 ±0.3 (처음은 ±0.1).
//  8. 목사추천전형이 일반, 조기취업형 계약학과가 일반.   9. 추합률이 1년치인데 '평균 추합률'.
// 10. 휴대폰: '리포트 보는 법' 이 성적 입력과 결과 사이에 길게 끼어 있음, '필터 초기화' 가 제목처럼 보임.
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-review2.test.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = process.env.JINDAN_FILE || 'jindan.html';
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 500) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const open = async (viewport) => {
  const pg = await b.newPage({ viewport });
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
  return { pg, errs };
};
const { pg, errs } = await open({ width: 1200, height: 900 });

console.log('\n■ 1. 기본 화면');
const def = await pg.evaluate(() => {
  const t = getTargetGrade();
  const c = { n: currentFiltered.length, target: +t.toFixed(2), 위험: 0, 경계: 0, 깔끔적정: 0, 소신: 0, 적정: 0, range: searchRange, amb: showAmbitious };
  for (const r of currentFiltered) { const d = classify(t, r); c[d.label]++; if (d.uncertain) c.경계++; if (d.label === '적정' && !d.uncertain) c.깔끔적정++; }
  return c;
});
console.log('     ', JSON.stringify(def));
check('처음 화면은 ±0.1 · 소신 포함', def.range === 0.1 && def.amb === true, def);
check('소신을 켜도 위험권은 들어오지 않는다(완충 안까지만)', def.위험 === 0, def);
check("'경계' 는 절반 아래", def.경계 / def.n < 0.5, def);
check("경계 없는 '적정' 이 100건 넘게", def.깔끔적정 > 100, def);
const amb = await pg.evaluate(() => {   // 소신으로 더해진 학과는 모두 '소신'
  const t = getTargetGrade();
  return currentFiltered.filter(r => r.averageGrade < t - searchRange - 1e-9).map(r => classify(t, r).label).reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
});
check('소신 확장으로 들어온 학과는 모두 소신', Object.keys(amb).every(k => k === '소신') && (amb['소신'] || 0) > 0, amb);

console.log('\n■ 2. 50%·70% 같은 해끼리');
const dong = await pg.evaluate(() => {
  const r = allRecords.find(x => x.university === '동아대학교' && x.department === '교육학과' && x.admissionName.includes('교과성적우수자'));
  if (!r) return null;
  const ys = Object.fromEntries(SURVEY_YEARS.filter(y => r.years[y]).map(y => [y, [r.years[y].grade50, r.years[y].grade70]]));
  return { inv: classify(3.5, r).inverted, ys };
});
check('동아대 교육학과(교과성적우수자)는 역전이 아니다', dong && dong.inv === false, dong);
const inv = await pg.evaluate(() => {
  let fake = 0, n = 0;
  for (const r of allRecords) {
    if (!classify(3, r).inverted) continue; n++;
    // 두 컷이 다 있는 해에서 50%컷이 70%컷보다 나쁜 해가 하나도 없으면 가짜 역전
    const pairs = SURVEY_YEARS.map(y => r.years[y]).filter(v => v && v.grade70 != null && v.grade50 != null);
    if (pairs.length && pairs.every(v => parseFloat(v.grade50) <= v.grade70)) fake++;
  }
  return { n, fake };
});
check('역전으로 보는 곳 중 해마다 보면 안 뒤집힌 곳이 없다', inv.fake === 0, inv);

console.log('\n■ 3. 예전 요강 자료의 \'최저 없음\' 을 그대로 초록으로 띄우지 않기');
const susi = (u, d, a) => pg.evaluate(([u, d, a]) => {
  const r = allRecords.find(x => x.university === u && x.department === d && x.admissionName.includes(a));
  if (!r) return null;
  window.studentCsat = null; currentFiltered = [r]; openDetail(0);
  const s = document.getElementById('dm-susi');
  return { adm: r.admissionName, text: s.innerText.split('이 대학 전체 최저')[0], green: !!s.querySelector('.ad-none') || /적용하지 않습니다/.test(s.innerText.split('이 대학 전체 최저')[0]) };
}, [u, d, a]);
for (const [u, d, a] of [['경상국립대학교', '소프트웨어공학과', '교과'], ['경상국립대학교', 'AI정보공학과', '교과'], ['전북대학교', '사회과교육학부', '농어촌'], ['경북대학교', '물리학과', '농어촌']]) {
  const x = await susi(u, d, a);
  check(`${u} ${d}(${x ? x.adm : a}): 초록 '최저 없음' 이 아니다`, x && !x.green, x && x.text.slice(0, 260));
}

console.log('\n■ 4. 전형 이름이 바뀌어도 앞 해 기록을 잇는다');
const cont = await pg.evaluate(() => {
  const f = (u, d, rx) => allRecords.filter(x => x.university === u && x.department === d && rx.test(x.admissionName)).map(x => ({ adm: x.admissionName, yc: x.yearCount, ys: Object.keys(x.years) }));
  return { kw: f('강원대학교', '간호학과', /농어촌/), ks: f('고신대학교', '의예과', /지역인재/) };
});
check('강원대 간호학과 농어촌: 2년 이상 자료', cont.kw.length && cont.kw.some(x => x.yc >= 2), cont.kw);
check('고신대 의예과 지역인재: 2년 이상 자료', cont.ks.length && cont.ks.some(x => x.yc >= 2), cont.ks);
// 이어 붙인 해가 왜 붙었는지 상세 화면에서 보이게 — 바뀌기 전 이름을 그 해와 함께 적는다
const alt = await pg.evaluate(() => {
  const r = allRecords.find(x => x.university === '강원대학교' && x.department === '간호학과' && /농어촌/.test(x.admissionName) && x.yearCount >= 2);
  if (!r) return null;
  const keep = currentFiltered; currentFiltered = [r]; openDetail(0);
  const txt = document.getElementById('dm-grid').innerText;
  currentFiltered = keep; closeDetail();
  return { adm: r.admissionName, byYear: r.nameByYear, tail: txt.slice(-200) };
});
check("상세 화면에 바뀌기 전 이름을 그 해와 함께 적는다('24 …농어촌전형)", alt && /이름이 바뀐 해/.test(alt.tail) && /'\d\d [^·]*농어촌전형/.test(alt.tail), alt);

console.log('\n■ 5. 계열');
const cat = await pg.evaluate(() => Object.fromEntries(['안전공학과', '재난안전공학과', '공과대학', 'IT 공과대학', '경상학부', '기독교학과', '상담학과', '유통물류학과', '스마트모빌리티학과', '자율전공학부', '국어국문학과', '안전보건학과'].map(x => [x, categorizeDepartment(x)])));
for (const [k, v] of Object.entries({ '안전공학과': '공학', '재난안전공학과': '공학', '공과대학': '공학', 'IT 공과대학': '공학', '경상학부': '사회', '기독교학과': '인문', '상담학과': '사회', '유통물류학과': '사회', '스마트모빌리티학과': '공학', '자율전공학부': '기타', '국어국문학과': '인문' }))
  check(`${k} → ${v}`, cat[k] === v, cat[k]);

console.log('\n■ 6. 막대 보기의 경계');
const bar = await pg.evaluate(() => {
  setViewMode('bar'); const t = getTargetGrade();
  const labs = [...document.querySelectorAll('.bar-row .lab')].map(e => e.textContent);
  const unc = currentFiltered.slice(0, labs.length).map(r => classify(t, r).uncertain);
  setViewMode('card');
  return { withEdge: labs.filter((l, i) => unc[i] && /경계/.test(l)).length, unc: unc.filter(Boolean).length };
});
check('막대 보기에도 경계가 보인다', bar.unc > 0 && bar.withEdge === bar.unc, bar);

console.log('\n■ 7. 필터 초기화');
const rs = await pg.evaluate(() => { setRange(0.5); resetFilters(); return searchRange; });
check('필터 초기화 → 처음과 같은 ±0.1', rs === 0.1, rs);

console.log('\n■ 8. 지원 자격');
const el = await pg.evaluate(() => ({ a: eligibilityOf('학생부종합(목사추천전형)'), b: eligibilityOf('학생부교과(조기취업형계약학과전형)'), c: eligibilityOf('학생부교과(계약학과-채용조건형(정원외)전형)') }));
check('목사추천전형 → 그 밖', el.a === '그밖', el);
check('조기취업형 계약학과 → 특성화고', el.b === '특성화', el);
check('채용조건형 계약학과는 그대로 일반', el.c === '일반', el);

console.log('\n■ 9. 추합률 해 수');
const ch = await pg.evaluate(() => {
  const r = allRecords.find(x => x.chungRate != null && x.chungN === 1) || allRecords.find(x => x.chungRate != null);
  currentFiltered = [r]; openDetail(0);
  return { n: r.chungN, tip: document.getElementById('dm-tip').innerText };
});
check("1년치 추합률을 '평균' 이라 하지 않는다", ch.n === 1 && !/평균 추합률/.test(ch.tip) && /학년도 추합률/.test(ch.tip), ch);
await pg.evaluate(() => closeDetail());

check('페이지 오류 없음', errs.length === 0, errs);

console.log('\n■ 10. 휴대폰');
{
  const { pg: m, errs: e2 } = await open({ width: 390, height: 800 });
  const r = await m.evaluate(() => {
    const lg = document.querySelector('.legend-panel .lg-group');
    const btn = document.querySelector('.reset-btn'), cs = getComputedStyle(btn);
    return { legendHidden: !lg || lg.getBoundingClientRect().height === 0, btnBorder: cs.borderStyle, btnBg: cs.backgroundColor };
  });
  check("'리포트 보는 법' 은 접혀 있다(눌러서 펼침)", r.legendHidden, r);
  check("'필터 초기화' 는 단추 모양(테두리)", r.btnBorder !== 'none' && r.btnBorder !== '', r);
  check('휴대폰 페이지 오류 없음', e2.length === 0, e2);
}

await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
