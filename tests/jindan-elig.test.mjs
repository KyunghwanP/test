// 적정 대학 진단 — 지원 자격 단추(특별전형 빼기·더하기).
//
// 신고(2026-11): 일반 학생을 진단하면 농어촌·기회균형·특성화고 같은 특별전형이 섞여 나와
// 목록이 부푼다. 진단이 읽는 19,759개 묶음 중 5,721개(약 29%)가 특별전형이다(2026-11 CSV).
//
// 확인하는 것
//   · 전형명 → 단추 가르기. 대표 전형명이 맞는 단추로 가는지
//     (저소득층학생전형 → 기회균형, 지역인재전형 → 일반, 정부위탁전형 → 그 밖,
//      한성인재·덕성인재처럼 '성인' 이 들어 있어도 일반)
//   · 실제 CSV 에서 '일반' 으로 간 전형명에 특별전형 낱말이 남아 있지 않은지
//   · 처음엔 일반만 켜져 있고, 여러 개를 함께 고를 수 있고, 마지막 하나는 끌 수 없다
//   · 학생을 바꾸거나(resetElig) 필터를 초기화하면 일반만으로 돌아간다
//   · 결과가 0건이면 켜지 않은 단추에 있는 건수를 알려 주고, 누르면 나온다
//   · 휴대폰 폭에서 단추가 줄바꿈되고 가로로 넘치지 않는다
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
  // 저장소 파일만 내주고 바깥(파이어베이스·글꼴 등)은 막는다 — 진단 목록은 CSV 만으로 그려진다
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

console.log('\n■ 전형명 → 단추');
const cases = {
  '학생부교과(일반전형)': '일반', '학생부교과(지역인재전형)': '일반', '학생부교과(지역균형전형)': '일반',
  '학생부교과(학교장추천전형)': '일반', '학생부교과(계약학과-채용조건형(정원외)전형)': '일반',
  '학생부종합(한성인재전형)': '일반', '학생부종합(덕성인재전형Ⅱ)': '일반', '학생부종합(교직적성인재)': '일반',
  '학생부교과(농어촌학생전형)': '농어촌', '학생부교과(정원외_농어촌학생)': '농어촌', '학생부교과(농어산촌인재특별전형)': '농어촌',
  '학생부종합(저소득층학생전형)': '기회', '학생부종합(기회균형전형)': '기회', '학생부교과(고른기회전형)': '기회',
  '학생부교과(기초생활수급자및차상위계층)': '기회', '학생부교과(정원외-교육기회균등전형)': '기회', '학생부종합(사회통합전형)': '기회',
  '학생부교과(특성화고교졸업자전형)': '특성화', '학생부교과(특성과고교졸업자전형)': '특성화',
  '학생부종합(특수교육대상자전형)': '특수', '학생부종합(장애인등대상자전형)': '특수', '학생부종합(고른기회전형[특수교육대상자])': '특수',
  '학생부교과(정부위탁전형)': '그밖', '학생부교과(서해5도학생전형)': '그밖', '학생부교과(국가보훈대상자전형)': '그밖',
  '학생부교과(성인학습자전형)': '그밖', '학생부교과(재직자전형)': '그밖', '학생부종합(다문화전형)': '그밖',
};
const got = await pg.evaluate(c => Object.fromEntries(Object.keys(c).map(k => [k, eligibilityOf(k)])), cases);
for (const [k, v] of Object.entries(cases)) check(`${k} → ${v}`, got[k] === v, got[k]);

console.log('\n■ 실제 CSV');
const r0 = await pg.evaluate(() => {
  const by = {}; allRecords.forEach(r => { by[r.elig] = (by[r.elig] || 0) + 1; });
  const WORDS = /농어촌|기회균형|고른기회|특성화|특수교육|장애|기초생활|차상위|저소득|사회배려|사회통합|서해5도|보훈|다문화|재직자|성인학습|만학/;
  const leak = [...new Set(allRecords.filter(r => r.elig === '일반' && WORDS.test(r.admissionName)).map(r => r.admissionName))];
  return { n: allRecords.length, by, leak };
});
check('모든 묶음이 단추 하나에 들어간다', Object.values(r0.by).reduce((a, b) => a + b, 0) === r0.n, r0.by);
check('일반에 특별전형 낱말이 든 전형명이 없다', r0.leak.length === 0, r0.leak);
check('특별전형이 빠진다 (일반 14,038 / 19,759 — 60~80% 사이)', r0.by['일반'] / r0.n > 0.6 && r0.by['일반'] / r0.n < 0.8, r0.by);

console.log('\n■ 단추 누르기');
const state = () => pg.evaluate(() => ({
  on: [...document.querySelectorAll('#elig-chips .elig-chip.active')].map(e => e.textContent.replace(/[\d,]+$/, '').replace('✓ ', '').trim()),
  chips: Object.fromEntries([...document.querySelectorAll('#elig-chips .elig-chip')].map(e =>
    [e.textContent.replace(/[\d,]+$/, '').replace('✓ ', '').trim(), +e.querySelector('.n').textContent.replace(/,/g, '')])),
  count: +document.getElementById('result-count').textContent.replace(/,/g, ''),
  eligs: [...new Set(currentFiltered.map(r => r.elig))].sort(),
}));
const chip = label => pg.locator('#elig-chips .elig-chip', { hasText: label }).first().click();
await pg.evaluate(() => setRange('all'));
let s = await state();
check('처음엔 일반만 켜져 있다', s.on.join() === '일반', s.on);
check('결과에 일반만 있다', s.eligs.join() === '일반', s.eligs);
check('일반 단추 숫자 = 결과 수', s.chips['일반'] === s.count, s);
const nong = s.chips['농어촌'], ilban = s.chips['일반'];
check('농어촌 단추에 건수가 보인다', nong > 0, s.chips);

await chip('농어촌'); s = await state();
check('농어촌을 누르면 일반+농어촌', s.on.join() === '일반,농어촌' && s.eligs.join() === ['농어촌', '일반'].sort().join(), s);
check('결과 수 = 일반 + 농어촌', s.count === ilban + nong, { count: s.count, ilban, nong });

await chip('일반'); s = await state();
check('일반을 끄면 농어촌만', s.on.join() === '농어촌' && s.eligs.join() === '농어촌' && s.count === nong, s);

await chip('농어촌'); s = await state();
check('마지막 하나는 꺼지지 않는다', s.on.join() === '농어촌', s.on);

await pg.evaluate(() => window.resetElig()); s = await state();
check('학생을 바꾸면(resetElig) 일반만으로', s.on.join() === '일반' && s.eligs.join() === '일반', s);

await chip('기회균형'); await chip('특성화고');
await pg.evaluate(() => resetFilters()); s = await state();
check('필터 초기화도 일반만으로', s.on.join() === '일반', s.on);

console.log('\n■ 0건 안내');
await pg.evaluate(() => setRange('all'));
await pg.fill('#search-input', '서해5도');
s = await state();
const hint = await pg.evaluate(() => { const h = document.getElementById('empty-kind-hint'); return { shown: h.style.display !== 'none', text: h.innerText }; });
check('일반만이면 서해5도 전형은 0건', s.count === 0, s.count);
check('그 밖 단추를 켜라고 건수와 함께 알려 준다', hint.shown && /그 밖 켜기 \(\d+건\)/.test(hint.text), hint);
await pg.locator('#empty-kind-hint button', { hasText: '그 밖 켜기' }).click();
s = await state();
check('누르면 서해5도 전형이 나온다', s.count > 0 && s.on.includes('그 밖'), s);
await pg.fill('#search-input', '');

check('페이지 오류 없음', errs.length === 0, errs);

console.log('\n■ 휴대폰 폭');
{
  const { pg: m } = await open({ width: 390, height: 800 });
  const r = await m.evaluate(() => {
    const row = document.querySelector('.elig-row').getBoundingClientRect();
    const chips = [...document.querySelectorAll('.elig-chip')].map(e => e.getBoundingClientRect());
    return { sw: document.documentElement.scrollWidth, w: innerWidth, right: Math.max(...chips.map(c => c.right)), rowR: row.right,
             lines: new Set(chips.map(c => Math.round(c.top))).size };
  });
  check('가로로 넘치지 않는다', r.sw <= r.w && r.right <= r.w, r);
  check('단추가 여러 줄로 감긴다', r.lines >= 2, r);
  await m.screenshot({ path: path.join(process.env.SHOT_DIR || '/tmp', 'jindan-elig-mobile.png'), fullPage: false });
}

await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
