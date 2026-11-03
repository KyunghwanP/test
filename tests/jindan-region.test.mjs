// 적정 대학 진단 — 지역 단추(대학이 있는 시·도로 거르기).
//
// 요청(2026-11): 대구·경북 지역인재전형 상담용으로 CSV 맨 끝 '지역' 칸으로 거르고 싶다.
// 여러 지역을 함께 고를 수 있어야 한다(대구 + 경북).
//
// 확인하는 것
//   · CSV 의 모든 묶음에 지역이 붙고, 그 값이 단추 17개 안에 든다
//   · 처음엔 '전체' — 지역으로 거르지 않는다
//   · 대구를 누르면 대구만, 경북을 더 누르면 대구 + 경북 (결과 수 = 두 단추 숫자의 합)
//   · 한 대학은 한 지역 (경북대 → 대구, 국립경국대 → 경북)
//   · 지원 자격 단추와 함께 걸린다(지역 + 일반 + 검색 '지역인재')
//   · '전체' 를 누르거나 필터 초기화하면 풀리고, 학생을 바꿔도(resetElig) 지역은 남는다
//   · 고른 지역에 없는 대학을 찾으면 '지역 전체로 보기' 안내
//   · 휴대폰 폭에서 가로로 넘치지 않는다
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const open = async (viewport) => {
  const pg = await b.newPage({ viewport });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.hostname !== 't.local') return r.abort();
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : 'text/plain';
    return r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': type + '; charset=utf-8' } });
  });
  await pg.goto('http://t.local/jindan.html');
  await pg.waitForFunction(() => document.getElementById('main-ui').classList.contains('show'), null, { timeout: 30000 });
  return { pg, errs };
};
const { pg, errs } = await open({ width: 1200, height: 900 });

console.log('\n■ 실제 CSV');
const r0 = await pg.evaluate(() => {
  const by = {}; allRecords.forEach(r => { by[r.region] = (by[r.region] || 0) + 1; });
  const uniReg = {}; allRecords.forEach(r => { const k = r.university + '|' + r.campus; (uniReg[k] = uniReg[k] || new Set()).add(r.region); });
  const multi = Object.entries(uniReg).filter(([, v]) => v.size > 1).map(([k]) => k);
  const reg = rx => [...new Set(allRecords.filter(r => rx.test(r.university)).map(r => r.region))];
  return { by, outside: Object.keys(by).filter(g => !REGIONS.includes(g)), multi,
           knu: reg(/^경북대학교$/), gk: reg(/^국립경국대학교$/), n: REGIONS.length };
});
check('지역 단추는 17개 시·도', r0.n === 17, r0.n);
check('모든 묶음의 지역이 단추 안에 든다(빈 칸 없음)', r0.outside.length === 0, r0.outside);
check('한 대학·캠퍼스는 한 지역', r0.multi.length === 0, r0.multi);
check('경북대 → 대구', r0.knu.join() === '대구', r0.knu);
check('국립경국대 → 경북', r0.gk.join() === '경북', r0.gk);

console.log('\n■ 단추 누르기');
const state = () => pg.evaluate(() => ({
  on: [...document.querySelectorAll('#region-chips .elig-chip.active')].map(e => e.textContent.replace(/[\d,]+$/, '').replace('✓ ', '').trim()),
  chips: Object.fromEntries([...document.querySelectorAll('#region-chips .elig-chip')].map(e =>
    [e.textContent.replace(/[\d,]+$/, '').replace('✓ ', '').trim(), +e.querySelector('.n').textContent.replace(/,/g, '')])),
  count: +document.getElementById('result-count').textContent.replace(/,/g, ''),
  regions: [...new Set(currentFiltered.map(r => r.region))].sort(),
  eligs: [...new Set(currentFiltered.map(r => r.elig))].sort(),
}));
const chip = label => pg.locator('#region-chips .elig-chip', { hasText: new RegExp('^(✓ )?' + label + '[\\d,]+$') }).first().click();
await pg.evaluate(() => setRange('all'));
let s = await state();
const total = s.count;
check('처음엔 전체만 켜져 있다', s.on.join() === '전체', s.on);
check('전체 단추 숫자 = 결과 수', s.chips['전체'] === s.count, s.chips);
const sum = REGIONS_SUM => Object.entries(s.chips).filter(([k]) => k !== '전체').reduce((a, [, v]) => a + v, 0);
check('지역 단추 숫자를 다 더하면 전체', sum() === s.chips['전체'], s.chips);
const daegu = s.chips['대구'], gb = s.chips['경북'];
check('대구·경북 단추에 건수가 보인다', daegu > 0 && gb > 0, s.chips);

await chip('대구'); s = await state();
check('대구를 누르면 대구만, 전체는 꺼진다', s.on.join() === '대구' && s.regions.join() === '대구' && s.count === daegu, s);
await chip('경북'); s = await state();
check('경북을 더 누르면 대구 + 경북', s.on.join() === '대구,경북' && s.regions.join() === ['경북', '대구'].sort().join(), s);
check('결과 수 = 대구 + 경북', s.count === daegu + gb, { count: s.count, daegu, gb });
check('결과에 일반 자격만(자격 단추와 함께 걸린다)', s.eligs.join() === '일반', s.eligs);

await pg.fill('#search-input', '지역인재');
s = await state();
const allJi = await pg.evaluate(() => currentFiltered.every(r => r.admissionName.includes('지역인재')));
check('대구·경북 + 검색 지역인재 → 결과가 있고 모두 지역인재전형', s.count > 0 && allJi && s.regions.every(g => g === '대구' || g === '경북'), s);
await pg.fill('#search-input', '');

await chip('대구'); s = await state();
check('대구를 다시 누르면 경북만', s.on.join() === '경북' && s.regions.join() === '경북', s);
await chip('경북'); s = await state();
check('마지막 지역을 끄면 전체로 돌아간다', s.on.join() === '전체' && s.count === total, s);

await chip('대구'); await chip('경북');
await pg.evaluate(() => window.resetElig()); s = await state();
check('학생을 바꿔도(resetElig) 지역은 그대로', s.on.join() === '대구,경북', s.on);
await chip('전체'); s = await state();
check('전체를 누르면 풀린다', s.on.join() === '전체' && s.count === total, s);
await chip('서울');
await pg.evaluate(() => resetFilters()); s = await state();
check('필터 초기화도 지역을 푼다', s.on.join() === '전체', s.on);

console.log('\n■ 화면 표시');
await pg.evaluate(() => setRange('all'));
await chip('경북');
const camp = await pg.evaluate(() => document.querySelector('.uni-card .campus-txt')?.textContent || '');
check('카드에 캠퍼스 옆 지역이 보인다', /· 경북$/.test(camp), camp);

console.log('\n■ 0건 안내');
await pg.fill('#search-input', '숭실대학교');
s = await state();
const hint = await pg.evaluate(() => { const h = document.getElementById('empty-kind-hint'); return { shown: h.style.display !== 'none', text: h.innerText }; });
check('경북만 켜고 숭실대(서울)를 찾으면 0건', s.count === 0, s.count);
check('다른 지역(서울)에 있다고 알려 준다', hint.shown && /서울 \d/.test(hint.text) && hint.text.includes('지역 전체로 보기'), hint);
await pg.locator('#empty-kind-hint button', { hasText: '지역 전체로 보기' }).click();
s = await state();
check('누르면 지역이 풀리고 나온다', s.count > 0 && s.on.join() === '전체', s);
await pg.fill('#search-input', '');

check('페이지 오류 없음', errs.length === 0, errs);

console.log('\n■ 휴대폰 폭');
{
  const { pg: m, errs: e2 } = await open({ width: 390, height: 800 });
  const r = await m.evaluate(() => {
    const chips = [...document.querySelectorAll('#region-chips .elig-chip')].map(e => e.getBoundingClientRect());
    return { sw: document.documentElement.scrollWidth, w: innerWidth, right: Math.max(...chips.map(c => c.right)),
             lines: new Set(chips.map(c => Math.round(c.top))).size };
  });
  check('가로로 넘치지 않는다', r.sw <= r.w && r.right <= r.w, r);
  check('단추가 여러 줄로 감긴다', r.lines >= 2, r);
  await m.locator('#region-chips').scrollIntoViewIfNeeded();
  await m.waitForTimeout(1200);
  await m.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'jindan-region-mobile.png'), fullPage: false });
  check('휴대폰 페이지 오류 없음', e2.length === 0, e2);
}

await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
