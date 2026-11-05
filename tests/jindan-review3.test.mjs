// 적정 대학 진단 — ver8.57 외부 검토 신고 재현.
//
//  1. 50%컷 숫자가 화면마다 다르다(403곳). 동아대 교육학과(교과성적우수자): '24 는 70%컷(2.75)만, '25·'26 은 둘 다.
//     막대는 50%컷 두 해 평균 3.42 · 70%컷 세 해 평균 3.39 → 50%컷이 더 나빠 보인다(안 뒤집혔는데 역전처럼).
//     진단 문구는 판정용 '50%컷 3.10 ~ 70%컷 3.39' — 3.10 은 화면 어디에도 없다. 막대 안내 '50%컷이 70%컷보다 큰 곳도
//     있습니다 — 오류가 아닙니다' 가 늘 붙어 있다. → 막대·진단이 같은 값(같은 해끼리 맞춘 50%컷), 상세 창에 그 근거.
//  2. 예전 요강 자료로 띄우는 초록 '최저 없음' 952곳 모두 '2027 전형분석 자료집도 이와 다르지 않습니다' — 그중 540곳은
//     자료집에 그 대학 표가 없어 대조하지 못한 곳(광운대·명지대 등). → 대조한 결과대로 문구를 나눈다.
//  4. 이번에 새로 생긴 계열 오분류: '종학'(대순종학과)이 '조종학과' 에 걸려 헬리콥터조종학과가 인문,
//     '철도' 가 '경영' 보다 먼저 걸려 철도경영학과·철도경영·물류학과·철도운전경영학과가 공학.
//  5. '확인 필요' 57곳 중 학과 이름이 적힌 단서가 다른 학과 이야기인 곳 — 건양대 '(의학과 제외)' 가 의학과 아닌 학과에,
//     연세대(미래) '의예과에만 적용' 이 의예과 아닌 학과에. 막대 보기에서 대학명이 길면 '적정 · 경계' 가 두 줄로 쪼개진다.
//
// 고치기 전 코드로 돌려 보기:  JINDAN_FILE=옛파일.html node tests/jindan-review3.test.mjs
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
await pg.waitForFunction(() => Object.keys(susiMincut).length > 100 && window.jaryoMin && window.adigaMin, null, { timeout: 60000 }).catch(() => {});

console.log('\n■ 1. 50%컷 — 막대·진단 문구·상세 창이 같은 값');
const dong = await pg.evaluate(() => {
  const r = allRecords.find(x => x.university === '동아대학교' && x.department === '교육학과' && x.admissionName.includes('교과성적우수자'));
  if (!r) return null;
  const keep = { cf: currentFiltered, vm: viewMode };
  currentFiltered = [r];
  const out = document.createElement('div'); out.innerHTML = barsHtml(3.2);
  const bar = { c50: out.querySelector('.bar-cuts .c50').textContent, c70: out.querySelector('.bar-cuts .c70').textContent,
                note: out.querySelector('.bar-note').textContent, few: (out.querySelector('.few') || {}).textContent || '' };
  const d = classify(3.2, r);
  const why = diagReason(3.2, d);
  openDetail(0);
  const grid = document.getElementById('dm-grid').innerText;
  closeDetail(); currentFiltered = keep.cf;
  return { bar, label: d.label, why, a50: d.a50, grid: grid.slice(-420) };
});
check('동아대 교육학과(교과성적우수자)가 있다', !!dong, dong);
check('막대의 50%컷 = 3.10 (같은 해끼리 맞춘 값, 고치기 전 3.42)', dong && dong.bar.c50 === '3.10', dong && dong.bar);
check('막대에서 50%컷이 70%컷(3.39)보다 작다 — 뒤집혀 보이지 않는다', dong && dong.bar.c70 === '3.39' && +dong.bar.c50 < +dong.bar.c70, dong && dong.bar);
check('진단 문구도 같은 3.10', dong && /50%컷 3\.10 ~ 70%컷 3\.39/.test(dong.why), dong && dong.why);
check("상세 창에 3.10 이 어떻게 나왔는지 적는다(3.39 − 0.29, 같이 있는 해 '25·'26)", dong && /3\.10/.test(dong.grid) && /3\.39 − 0\.29/.test(dong.grid) && /'25·'26/.test(dong.grid), dong && dong.grid);
check("안 뒤집힌 곳에 '오류가 아닙니다' 안내를 붙이지 않는다", dong && !/오류가 아닙니다/.test(dong.bar.note) && !/역전/.test(dong.bar.few), dong && dong.bar);

const all = await pg.evaluate(() => {
  let fakeLook = 0, differ = 0, n = 0, ex = null;
  for (const r of allRecords) {
    if (r.avg50 == null) continue; n++;
    const d = classify(3, r);
    const looksInv = r.avg50 > r.averageGrade + 1e-9;
    if (looksInv && !d.inverted) { fakeLook++; ex = ex || [r.university, r.department, r.admissionName, r.avg50, r.averageGrade]; }
    if (!d.inverted && Math.abs(r.avg50 - d.a50) > 1e-9) differ++;
  }
  return { n, fakeLook, differ, ex };
});
check('막대에서 역전처럼 보이는데 실제로는 안 뒤집힌 곳 0 (고치기 전 407)', all.fakeLook === 0, all);
check('막대 50%컷과 판정 50%컷이 다른 곳 0', all.differ === 0, all);

const inv = await pg.evaluate(() => {
  const r = allRecords.find(x => x.gap50 != null && x.gap50 > 0.05 && x.yearCount === 3);
  if (!r) return null;
  const keep = currentFiltered; currentFiltered = [r];
  const out = document.createElement('div'); out.innerHTML = barsHtml(r.averageGrade);
  currentFiltered = keep;
  const g = r.averageGrade - 0.6, d = classify(g, r);
  return { who: [r.university, r.department, r.admissionName], note: out.querySelector('.bar-note').textContent, few: (out.querySelector('.few') || {}).textContent || '',
           label: d.label, why: diagReason(g, d), a70: r.averageGrade.toFixed(2) };
});
check('실제로 뒤집힌 곳은 막대 줄에 "50/70 역전" 을 적는다', inv && /50\/70 역전/.test(inv.few), inv);
check('실제로 뒤집힌 곳이 목록에 있을 때만 "오류가 아닙니다" 안내', inv && /오류가 아닙니다/.test(inv.note), inv && inv.note.slice(-120));
check('뒤집힌 곳의 안정 문구가 70%컷 값을 "50%컷" 이라 부르지 않는다', inv && inv.label === '안정' && !new RegExp('50%컷 ' + inv.a70.replace('.', '\\.')).test(inv.why), inv);

const lone = await pg.evaluate(() => {
  const r = allRecords.find(x => x.gap50 == null && SURVEY_YEARS.some(y => x.years[y] && x.years[y].grade50 != null && !isNaN(parseFloat(x.years[y].grade50))));
  if (!r) return null;
  const g = r.averageGrade - 0.05, d = classify(g, r);
  return { who: [r.university, r.department], label: d.label, why: diagReason(g, d) };
});
check("50%컷이 70%컷 없는 해에만 있는 곳은 '50%컷 미제출' 이라 하지 않는다", lone && !/미제출/.test(lone.why) && /같은 해/.test(lone.why), lone);

console.log("\n■ 2. 예전 자료의 초록 '최저 없음' — 자료집과 대조한 대로 적는다");
const green = await pg.evaluate(() => {
  const c = { n: 0, absent: 0, absentOk: 0, notlisted: 0, notlistedOk: 0, saysSame: 0, ex: null };
  for (const r of allRecords) {
    if (adigaFind(r) || !(susiMincut[r.uniCode] || []).length) continue;
    const picked = pickMincut(r);
    if (!picked.length || picked.some(p => p['최저있음'] === 'Y')) continue;
    renderSusi(r);
    const t = document.getElementById('dm-susi').innerText.split('이 대학 전체 최저')[0];
    if (!/수능최저를 적용하지 않습니다/.test(t)) continue;
    c.n++;
    const st = jaryoCheck(r).state;
    if (/이와 다르지 않습니다/.test(t)) c.saysSame++;
    if (st === 'absent') { c.absent++; if (/이 대학 최저 표가 없어 대조하지 못했습니다/.test(t)) c.absentOk++; else c.ex = c.ex || [r.university, r.department, t.slice(0, 200)]; }
    if (st === 'notlisted') { c.notlisted++; if (/최저 표에도 이 학과·전형은 없습니다/.test(t)) c.notlistedOk++; }
  }
  return c;
});
console.log('      ', JSON.stringify(green));
check("'자료집도 이와 다르지 않습니다' 문구는 없앤다(대조하지 않은 곳에도 붙었다)", green.n > 0 && green.saysSame === 0, green);
check('자료집에 그 대학 표가 없는 곳 → "대조하지 못했습니다"', green.absent > 0 && green.absentOk === green.absent, green);
check('표는 있는데 이 학과·전형이 없는 곳 → "최저 표에도 이 학과·전형은 없습니다"', green.notlisted > 0 && green.notlistedOk === green.notlisted, green);

console.log('\n■ 4. 계열 — 이번에 새로 생긴 오분류');
const cat = await pg.evaluate(() => Object.fromEntries(['헬리콥터조종학과', '항공운항학과', '대순종학과', '원불교학과', '철도경영학과', '철도경영·물류학과', '철도운전경영학과',
  '철도차량시스템공학과', '철도운전제어학과', '철도관제학과', '산업경영공학과', '안전공학과'].map(x => [x, categorizeDepartment(x)])));
for (const [k, v] of Object.entries({ '헬리콥터조종학과': '기타', '항공운항학과': '기타', '대순종학과': '인문', '원불교학과': '인문', '철도경영학과': '사회', '철도경영·물류학과': '사회', '철도운전경영학과': '사회',
  '철도차량시스템공학과': '공학', '철도운전제어학과': '공학', '철도관제학과': '공학', '산업경영공학과': '공학', '안전공학과': '공학' }))
  check(`${k} → ${v}`, cat[k] === v, cat[k]);

console.log("\n■ 5. '확인 필요' 중 단서가 다른 학과 이야기인 곳 · 막대 라벨");
const vg = await pg.evaluate(() => {
  const one = (u, d, a) => {
    const r = allRecords.find(x => x.university === u && x.department === d && x.admissionName.includes(a));
    if (!r) return null;
    renderSusi(r);
    const t = document.getElementById('dm-susi').innerText.split('이 대학 전체 최저')[0];
    return { adm: r.admissionName, green: /수능최저를 적용하지 않습니다/.test(t), check: /확인 필요/.test(t), t: t.slice(0, 260) };
  };
  return {
    kn: one('건양대학교', '사회복지학과', '지역인재'),
    ys: one('연세대학교(미래)', '데이터사이언스학부', '학교생활우수자'),
    ki: one('경일대학교', '디자인융합학부', '일반'),
    gs: one('경상국립대학교', '에너지공학과', '일반'),
    jb: one('전북대학교', '사회과교육학부', '농어촌'),
  };
});
check("건양대 사회복지학과 — '(의학과 제외)' 는 다른 학과 이야기 → 최저 없음", vg.kn && vg.kn.green && !vg.kn.check, vg.kn);
check("연세대(미래) 데이터사이언스학부 — '의예과에만 적용' → 최저 없음", vg.ys && vg.ys.green && !vg.ys.check, vg.ys);
check("경일대 디자인융합학부 — '(간호학과 : 적용)' → 최저 없음", vg.ki && vg.ki.green && !vg.ki.check, vg.ki);
check("경상국립대 '일부학과 적용' 은 그대로 확인 필요", vg.gs && vg.gs.check && !vg.gs.green, vg.gs);
check("전북대 '최저 없음(교과만 적용)' 은 그대로 확인 필요", vg.jb && vg.jb.check && !vg.jb.green, vg.jb);
const named = await pg.evaluate(() => typeof otherDeptOnly === 'function' ? [
  otherDeptOnly('건양대 본교: 해당 전형 수능최저 미적용(의학과 제외)', '의학과'),
  otherDeptOnly('해당 전형은 의예과에만 적용(간호·일반 미적용)', '의예과'),
  otherDeptOnly('※ 수의예과, 의예과, 약학과 적용', '약학과'),
  otherDeptOnly('수능최저학력 기준 없음 (간호학과 : 적용)', '간호학과'),
  otherDeptOnly('일부학과 적용', '컴퓨터공학부'),
  otherDeptOnly('최저 없음(교과만 적용)', '사회과교육학부'),
  otherDeptOnly('p.77 상위2개합6 최저 미적용', '물리학과'),
  otherDeptOnly('해당 전형은 의예과에만 적용(간호·일반 미적용)', '간호학과'),
] : null);
check('단서에 적힌 바로 그 학과(의학과·의예과·약학과·간호학과)는 확인 필요로 남긴다', named && named.slice(0, 4).every(v => v === false), named);
check("학과 이름이 없는 단서('일부학과'·'교과만'·'상위2개합6')는 확인 필요로 남긴다", named && named.slice(4, 7).every(v => v === false), named);
check("'의예과에만 적용(간호·일반 미적용)' 은 간호학과에는 최저 없음", named && named[7] === true, named);

const lab = await pg.evaluate(() => {
  // 경계가 붙는 줄(1년 자료) — 라벨에 띄어쓰기가 있어야 쪼개질 수 있다. 대학명 길이를 바꿔 가며 줄 끝에 걸리게 한다
  const r = allRecords.find(x => x.kind === '교과' && x.yearCount === 1);
  const keep = { cf: currentFiltered, k: admissionKind };
  admissionKind = '교과';
  const box = document.createElement('div'); box.style.width = '1200px'; document.body.appendChild(box);
  let split = 0, tried = 0, text = '';
  for (let n = 3; n <= 30; n++) {
    currentFiltered = [{ ...r, university: '가'.repeat(n) + '대학교' }];
    box.innerHTML = barsHtml(r.averageGrade + 0.05);
    const el = box.querySelector('.bar-name .lab');
    if (!el) continue;
    tried++; text = el.textContent;
    if (el.getClientRects().length > 1) split++;
  }
  box.remove(); currentFiltered = keep.cf; admissionKind = keep.k;
  return { tried, split, text };
});
check("막대 보기 — 대학명이 길어도 '적정 · 경계' 같은 라벨이 두 줄로 쪼개지지 않는다", lab && lab.tried > 20 && /경계/.test(lab.text) && lab.split === 0, lab);

check('페이지 오류 없음', errs.length === 0, errs);
await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
