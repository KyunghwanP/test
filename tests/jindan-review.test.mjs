// 적정 대학 진단 — 외부 검토(2026-11)에서 나온 자료·판정·문구 문제.
//
// 신고 그대로 넣는다
//   1. 안정 판정: 50%컷이 70%컷보다 나쁜(숫자가 큰) 곳은 '50%컷 − 여유폭' 이 70%컷 아래로 내려가
//      70%컷보다 성적이 나쁜 학생에게 '안정' 이 붙었다(309곳).
//      예: 가톨릭관동대 지리교육과 — 70%컷 4.79 · 50%컷 5.17, 내 등급 4.80 → 안정
//   2. 9 를 넘는 등급: 신라대 항공정비학과 2025학년도 70%컷 24 가 3년 평균에 섞였다
//   3. 가운뎃점이 ? 로: '도시계획?조경학부', '건축 ? 토목 ? 환경공학부', 'AI?SW인재전형'
//   4. 계열: '문화학' 의 '화학' 때문에 언어문화학과가 자연, 골프산업 → 공학('산업'),
//      문헌정보 → 공학('정보'), 해양경찰 → 자연('해양'), 스포츠의학 → 의약('의학').
//      예체능·기타 단추가 없어 '전체' 로만 보였다
//   5. 모집인원 0: 2024·2025학년도는 원자료에 모집인원이 없어 0 으로 들어 있다
//      (국립부경대 건축공학과 — 모집 0, 충원 7) → '—'
//   6. 문구: '내 등급 3.29이(가)' → '3.29등급은', 1년치인데 '1년 평균 70%컷',
//      ▲▼ 가 '내 등급과의 차이' 와 '3년 추세' 두 뜻, 출처 문구 셋이 서로 다름,
//      '검색 범위 ±0.10' 인데 실제 범위는 소신 포함으로 더 넓음
//   7. 휴대폰: '교/과' '필터 초/기화' 처럼 단어 중간에서 줄이 바뀐다
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const H = fs.readFileSync(path.join(ROOT, 'jindan.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 400) : ''));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const open = async viewport => {
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
const find = (u, d) => pg.evaluate(([u, d]) => allRecords.findIndex(r => r.university === u && r.department === d), [u, d]);

console.log('\n■ 1. 안정 판정 — 70%컷보다 나쁜 성적에 안정이 붙지 않는다');
{
  const r = await pg.evaluate(() => {
    const rec = allRecords.find(r => r.university === '가톨릭관동대학교' && r.department === '지리교육과' && r.avg50 > r.averageGrade);
    const d = rec && classify(4.80, rec);
    let bad = 0, ex = null;
    for (const x of allRecords) for (let g = 1; g <= 9; g += 0.05) {
      const c = classify(g, x);
      if (c.label === '안정' && g > x.averageGrade + 1e-9) { bad++; ex = ex || [x.university, x.department, g.toFixed(2), x.averageGrade, x.avg50]; break; }
    }
    const inv = allRecords.filter(x => x.avg50 != null && x.avg50 > x.averageGrade + 1e-9);
    const invUnc = inv.filter(x => classify(x.averageGrade - 0.5, x).uncertain).length;
    return { found: !!rec, a70: rec && rec.averageGrade, a50: rec && rec.avg50, label: d && d.label, unc: d && d.uncertain, bad, ex, inv: inv.length, invUnc };
  });
  check('가톨릭관동대 지리교육과가 있다 (50%컷 > 70%컷)', r.found, r);
  check('4.80 은 안정이 아니다 (70%컷 4.79 보다 나쁨)', r.label && r.label !== '안정', r);
  check('어느 곳에서도 70%컷보다 나쁜 성적에 안정이 붙지 않는다 (고치기 전 309곳)', r.bad === 0, r);
  check('50%컷이 뒤집힌 곳은 판정을 경계로 표시한다', r.inv > 0 && r.invUnc === r.inv, { inv: r.inv, invUnc: r.invUnc });
}

console.log('\n■ 2. 9 를 넘는 등급은 그 해 자료에서 뺀다');
{
  const r = await pg.evaluate(() => {
    const rec = allRecords.find(r => r.university === '신라대학교' && r.department === '항공정비학과' && r.years['2025'] && r.years['2025'].grade70 === 4.1);
    const big = allRecords.filter(x => Object.values(x.years).some(y => (y.grade70 != null && y.grade70 > 9) || parseFloat(y.grade50) > 9)).length;
    return rec ? { y26: rec.years['2026'].grade70, avg: rec.averageGrade, n: rec.yearCount, big } : { big };
  });
  check('신라대 항공정비 2025학년도(조회 2026) 70%컷 24 → 비움', r.y26 === null, r);
  check('평균은 남은 두 해(4.1 · 2.7)로 3.40', r.avg !== undefined && Math.abs(r.avg - 3.4) < 1e-9 && r.n === 2, r);
  check('9 를 넘는 등급이 남아 있지 않다', r.big === 0, r);
}

console.log('\n■ 3. 가운뎃점 복구');
{
  const r = await pg.evaluate(() => ({
    q: allRecords.filter(x => /\?/.test(x.department) || /\?/.test(x.admissionName)).map(x => x.department + ' / ' + x.admissionName).slice(0, 5),
    a: allRecords.some(x => x.department === '도시계획·조경학부'),
    b: allRecords.some(x => x.department === '건축·토목·환경공학부'),
    c: allRecords.some(x => x.admissionName === '학생부종합(AI·SW인재전형)'),
  }));
  check('학과명·전형명에 ? 가 남아 있지 않다', r.q.length === 0, r.q);
  check('도시계획?조경학부 → 도시계획·조경학부', r.a);
  check('건축 ? 토목 ? 환경공학부 → 건축·토목·환경공학부', r.b);
  check('학생부종합(AI?SW인재전형) → AI·SW', r.c);
}

console.log('\n■ 4. 계열 분류');
{
  const cases = {
    '러시아언어문화학과': '인문', '중국언어문화학과': '인문', '프랑스어문화학과': '인문', '독일어문화학': '인문',
    '미디어문화학부': '사회', '골프산업학과': '예체능', '문헌정보학과': '사회', '해양경찰학과': '사회',
    '해양경찰학부(항해전공)': '사회', '스포츠의학과': '예체능', '골프산업학과 ': '예체능',
    // 원래 맞던 것은 그대로
    '화학과': '자연', '화학공학과': '공학', '컴퓨터공학과': '공학', '정보통신공학과': '공학', '산업공학과': '공학',
    '간호학과': '의약', '경영정보학과': '사회', '체육교육과': '교육', '해양학과': '자연', '의예과': '의약',
    '시각디자인학과': '예체능', '실용음악과': '예체능', '체육학과': '예체능', '국어국문학과': '인문',
    '고고미술사학과': '인문', '섬유패션디자인학부 섬유공학전공': '공학', '미래정보디스플레이학부': '공학', '지능정보융합학과': '공학',
    '법과대학': '사회', '상경학부': '사회', '소방방재학부': '공학', '신문방송학과': '사회', '정보통계학과': '자연', '영화학과': '예체능',
    '치기공학과': '의약', '보건복지자율전공학부': '의약', '창의예술자율전공학부': '예체능', '공과대학 자율학부': '기타',
  };
  const got = await pg.evaluate(c => Object.fromEntries(Object.keys(c).map(k => [k, categorizeDepartment(k.trim())])), cases);
  for (const [k, v] of Object.entries(cases)) check(`${k.trim()} → ${v}`, got[k] === v, got[k]);
  const chips = await pg.evaluate(() => [...document.querySelectorAll('#cat-grid .cat-chip .name')].map(e => e.textContent));
  check('계열 단추에 예체능·기타가 있다', chips.includes('예체능') && chips.includes('기타'), chips);
  const r = await pg.evaluate(() => { setRange('all'); setCategory('기타'); const n = currentFiltered.length; setCategory('예체능'); const m = currentFiltered.length; setCategory('전체'); return { 기타: n, 예체능: m }; });
  check('기타·예체능 단추로 그 학과들이 보인다', r.기타 > 0 && r.예체능 > 0, r);
}

console.log('\n■ 5. 모집인원 0 은 자료 없음(—)');
{
  const r = await pg.evaluate(() => {
    const rec = allRecords.find(x => x.university === '국립부경대학교' && x.department === '건축공학과' &&
      ['2025', '2026'].some(y => x.years[y] && parseFloat(x.years[y].waitlist) > 0));
    if (!rec) return null;
    currentFiltered = [rec]; openDetail(0);
    const tr = [...document.querySelectorAll('#dm-grid .dm-year-table tr')].find(t => t.textContent.includes('모집인원'));
    const cells = tr ? [...tr.querySelectorAll('td')].map(td => td.textContent.trim()) : null;
    closeDetail();
    return { cells, q: SURVEY_YEARS.map(y => rec.years[y] && rec.years[y].quotaTotal) };
  });
  check('국립부경대 건축공학과가 있다', !!r, r);
  check("'24·'25 모집인원이 0 이 아니라 —", r && r.cells && r.cells[0] === '—' && r.cells[1] === '—', r);
  check("'26 모집인원은 숫자 그대로", r && r.cells && /^\d+$/.test(r.cells[2]), r);
}

console.log('\n■ 6. 문구');
{
  const r = await pg.evaluate(() => {
    const rec = allRecords.find(x => x.yearCount >= 2);
    const reasons = ['안정', '적정', '소신', '위험'].map(L => {
      for (let g = 1; g <= 9; g += 0.05) { const d = classify(g, rec); if (d.label === L) return diagReason(g, d); }
      return '';
    });
    const one = allRecords.find(x => x.yearCount === 1);
    const oneY = SURVEY_YEARS.find(y => one.years[y] && one.years[y].grade70 != null);
    currentFiltered = [one]; const card1 = cardsHtml(3);
    currentFiltered = [rec]; const card3 = cardsHtml(3);
    const tr = [-0.5, 0, 0.5].map(dl => gradeTrend({ trendDelta: dl }).arrow);
    return { reasons, oneY, card1, card3, tr };
  });
  check("판정 설명에 '이(가)' 가 없다", r.reasons.every(s => s && !s.includes('이(가)')), r.reasons);
  check("판정 설명은 'N.NN등급은' 으로", r.reasons.every(s => /\d\.\d\d등급은/.test(s)), r.reasons);
  const yr = String(parseInt(r.oneY, 10) - 1);
  check(`1년치 카드는 '${yr} 70%컷' (평균이라 하지 않는다)`, r.card1.includes(`${yr} 70%컷`) && !r.card1.includes('1년 평균'), r.card1.match(/<p class="k">[^<]*/)?.[0]);
  check('2~3년치 카드는 그대로 평균', /[23]년 평균 70%컷/.test(r.card3));
  check('추세 화살표는 ▲▼ 가 아니다 (▲▼ 는 내 등급과의 차이)', r.tr.every(a => !/[▲▼]/.test(a)), r.tr);
  check('추세 안내(오른쪽 설명)도 같은 화살표', !/[▲▼] 컷 (상승|하락)/.test(H), H.match(/.{0,10}컷 상승/)?.[0]);
  check("출처 안내(맨 아래)가 2024~2026학년도", /본 도구는 2024~2026학년도 어디가 수시 입결/.test(H));
  const career = fs.readFileSync(path.join(ROOT, 'career.html'), 'utf8');
  check("진로진학 카드 설명이 2024~2026학년도 (2025 수시 입결 아님)", career.includes('2024~2026학년도') && !career.includes('2025 수시 입결'));
  const lbl = await pg.evaluate(() => { setRange(0.1); showAmbitious = true; render();
    const b = getBounds(getTargetGrade()); return { t: document.getElementById('range-label').textContent, lo: b.lower.toFixed(2), hi: b.upper.toFixed(2) }; });
  check('검색 범위 옆에 소신 포함 실제 범위가 보인다', lbl.t.includes('±0.10') && lbl.t.includes('소신') && lbl.t.includes(lbl.lo) && lbl.t.includes(lbl.hi), lbl);
  const lbl2 = await pg.evaluate(() => { showAmbitious = false; render(); return document.getElementById('range-label').textContent; });
  check('소신을 끄면 ±0.10 만', lbl2.trim() === '±0.10', lbl2);
}

check('페이지 오류 없음', errs.length === 0, errs);

console.log('\n■ 7. 휴대폰 — 단어 중간에서 줄이 바뀌지 않는다');
{
  const { pg: m } = await open({ width: 360, height: 780 });
  const r = await m.evaluate(() => {
    const sel = ['.kind-opt', '.reset-btn', '.toggle-label span', '.range-pill span', '.range-tab', '.elig-chip', '.cat-chip .name'];
    const split = [];
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      // 낱말 하나(공백 없는 글자 묶음)가 두 줄에 걸치면 단어 중간에서 끊긴 것
      // 글자 조각(text node)마다 잰다 — 단추 안 작은 숫자 칸은 높이가 달라 한 줄이어도 top 이 다르다
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n; (n = walk.nextNode());) {
        const t = n.textContent.trim(); if (!t || /\s/.test(t)) continue;
        const range = document.createRange(); range.selectNodeContents(n);
        const lines = new Set([...range.getClientRects()].map(x => Math.round(x.top))).size;
        if (lines > 1) split.push(s + ' ' + t);
      }
    }
    return { kb: getComputedStyle(document.body).wordBreak, split, sw: document.documentElement.scrollWidth, w: innerWidth };
  });
  check('본문이 word-break: keep-all', r.kb === 'keep-all', r.kb);
  check('단추 글자가 단어 중간에서 끊기지 않는다', r.split.length === 0, r.split);
  check('가로로 넘치지 않는다', r.sw <= r.w, r);
}

await b.close();
console.log(`\n${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
