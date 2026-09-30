// 적정 대학 진단 — 막대 보기.
//
// 확인하는 것
//   · 전형을 섞어 평균 내지 않는다. 결과 한 줄(대학·전형·모집단위) = 막대 한 줄.
//     (여러 전형을 평균 내면 어느 전형에도 없는 컷이 나온다 — 다른 사이트가 그랬다)
//   · 비어 있는 값을 지어내지 않는다. 50%컷이 없으면 띠가 아니라 70%컷 점 하나.
//   · 50%컷이 70%컷보다 좋은(숫자가 작은 게 아니라 큰) 곳도 오류로 다루지 않고 그대로 그린다 —
//     등급컷은 대학 환산점수 순위의 50%째·70%째 학생 '등급'이라 실제로 뒤바뀐다.
//   · 자료가 적은 전형은 연하게 + 표시. 3년 평균과 똑같이 믿으면 안 된다.
//   · '등급컷은 대학마다 계산 기준이 다르다' 안내가 붙는다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const H = fs.readFileSync(import.meta.dirname + '/../jindan.html', 'utf8');
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));
const grab = name => { const m = new RegExp(`^\\s*function ${name}\\(`, 'm').exec(H); if (!m) throw new Error('못 찾음 ' + name);
  let i = H.indexOf('{', m.index), d = 0;
  for (let j = i; ; j++) { if (H[j] === '{') d++; else if (H[j] === '}' && --d === 0) return H.slice(m.index, j + 1); } };
const line = re => { const m = re.exec(H); if (!m) throw new Error('못 찾음 ' + re); return m[0]; };

console.log('\n■ 배선');
check('보기 버튼에 막대가 있다', /id="view-bar" onclick="setViewMode\('bar'\)"/.test(H));
check('막대 보기를 기억한다', /\(v === 'list' \|\| v === 'bar'\) \? v : 'card'/.test(H));
check('그릴 때 막대 보기를 고른다', /viewMode === 'bar' \? barsHtml\(target\)/.test(H));
check('다른 보기로 바꾸면 막대를 지운다', /querySelectorAll\('\.uni-card, \.uni-table-wrap, \.bar-wrap, #load-more-wrap'\)/.test(H));
check('오른쪽 설명에도 계산 기준 안내', /등급컷은 대학마다 계산 기준이 다릅니다<\/b> — 반영 과목/.test(H));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
// 원본 CSS(막대 부분)를 그대로 — 위치는 CSS 로 잡히므로 없으면 잴 수 없다
const CSS = H.slice(H.indexOf('/* ─── 막대 보기 ───'), H.indexOf('        @media (max-width: 640px) {', H.indexOf('/* ─── 막대 보기 ───')));
if (CSS.length < 500) throw new Error('막대 CSS 를 못 찾음');
await pg.setContent(`<style>:root{--slate-100:#f1f5f9;--slate-400:#94a3b8;--slate-500:#64748b;--slate-800:#1e293b;--slate-900:#0f172a;--slate-50:#f8fafc;--indigo-50:#eef2ff;--indigo-100:#e0e7ff}${CSS}</style><body><div id="out"></div>`);
await pg.addScriptTag({ content: [
  line(/const SURVEY_YEARS = \[[^\]]+\];/),
  line(/const yearCut = [^\n]+/),
  line(/const BAR_CLS = [^\n]+/),
  line(/const BAR_MANY = [^\n]+/),
  "let visibleCount = 150, admissionKind = '교과', currentFiltered = [];",
  grab('classify'), grab('barScale'), grab('barsHtml'),
].join('\n') });

// 가짜 전형 — 값만 필요한 만큼 채운다(parseCSV 가 만드는 모양 그대로)
const rec = (name, y, a70, a50, extra = {}) => ({
  university: name, campus: '본교', department: '전자공학과', admissionName: '학생부교과(' + name + ')',
  years: Object.fromEntries(y.map(k => [k, { grade70: a70 }])), averageGrade: a70, avg50: a50,
  yearCount: y.length, vol70: 0.2, ...extra });
const Y3 = ['2025', '2026', '2027'];
const draw = (recs, target, kind = '교과') => pg.evaluate(([recs, target, kind]) => {
  currentFiltered = recs; admissionKind = kind;
  const html = barsHtml(target);
  const out = document.getElementById('out'); out.innerHTML = html;
  const rows = [...out.querySelectorAll('.bar-row')].map(r => {
    const band = r.querySelector('.bar-band'), dot = r.querySelector('.bar-dot'), me = r.querySelector('.bar-me');
    const box = el => el && el.getBoundingClientRect();
    const tr = box(r.querySelector('.bar-track'));
    const rel = el => el ? { l: (box(el).left - tr.left) / tr.width, r: (box(el).right - tr.left) / tr.width } : null;
    return { cls: r.className, band: band && band.className, dot: dot && dot.className, bandPos: rel(band), dotPos: rel(dot), me: rel(me),
             chips: [...r.querySelectorAll('.chip')].map(c => c.textContent), cuts: r.querySelector('.bar-cuts').innerText.replace(/\s+/g, ' ').trim() };
  });
  return { html, rows, note: (out.querySelector('.bar-note') || {}).textContent || '', tip: !!out.querySelector('.bar-note.tip'),
           ticks: [...out.querySelectorAll('.ticks span')].map(s => s.textContent) };
}, [recs, target, kind]);

console.log('\n■ 한 줄 = 전형 하나');
{
  const r = await draw([rec('가', Y3, 3.7, 3.6), rec('나', Y3, 2.9, 2.7), rec('다', Y3, 1.4, 1.3)], 3.0);
  check('결과 3건 → 막대 3줄', r.rows.length === 3, r.rows.length);
  check('같은 학과라도 전형마다 따로 — 평균 낸 줄이 없다', r.rows.every((x, i) => x.cuts.includes(['3.70', '2.90', '1.40'][i])), r.rows.map(x => x.cuts));
  check('눈금이 모든 값과 내 등급을 담는다', r.ticks[0] === '1.0' && r.ticks[r.ticks.length - 1] === '4.0', r.ticks);
}

console.log('\n■ 띠 위치 · 내 등급선');
{
  const r = await draw([rec('가', Y3, 3.5, 3.0)], 3.25);
  const x = r.rows[0];
  // 눈금 2.5~4.0 에서 3.0 → 1/3, 3.5 → 2/3, 3.25 → 1/2
  const near = (a, b) => Math.abs(a - b) < 0.02;
  check('띠가 50%컷 3.0 에서 70%컷 3.5 까지', near(x.bandPos.l, 1 / 3) && near(x.bandPos.r, 2 / 3), x.bandPos);
  check('내 등급선이 3.25 자리에', near((x.me.l + x.me.r) / 2, 0.5), x.me);
}

console.log('\n■ 비어 있는 값을 지어내지 않는다');
{
  const r = await draw([rec('가', Y3, 3.4, null)], 3.0);
  const x = r.rows[0];
  check('50%컷이 없으면 띠가 아니라 점', !x.band && !!x.dot, x);
  check('점은 70%컷 자리에 (눈금 2.5~3.5 에서 3.4 → 90%)', x.dotPos && Math.abs((x.dotPos.l + x.dotPos.r) / 2 - 0.9) < 0.02, x.dotPos);
  check('숫자 칸에 50% 는 – 로', /50% – 70% 3\.40/.test(x.cuts), x.cuts);
}

console.log('\n■ 50%컷이 70%컷보다 큰 곳 — 오류로 다루지 않는다');
{
  const r = await draw([rec('가', Y3, 1.9, 2.08)], 2.5);
  const x = r.rows[0];
  check('작은 값~큰 값으로 띠를 그린다', x.band && x.bandPos.r > x.bandPos.l + 0.05, x.bandPos);
  check('값은 원래대로 적는다', /50% 2\.08 70% 1\.90/.test(x.cuts), x.cuts);
  check('오류 표시를 붙이지 않는다', !/오류|⚠/.test(x.chips.join('')), x.chips);
}

console.log('\n■ 자료가 적은 전형');
{
  const r = await draw([rec('가', ['2027'], 3.0, 2.9), rec('나', ['2025', '2026'], 3.1, 3.0), rec('다', Y3, 3.2, 3.1)], 3.0);
  check('1년 자료 → 연하게 + 표시', /\by1\b/.test(r.rows[0].cls) && r.rows[0].chips.includes('1년 자료'), r.rows[0]);
  check('최신 해가 비었으면 "최근 미공개"', r.rows[1].chips.includes('최근 미공개') && r.rows[1].chips.includes('2년 자료'), r.rows[1].chips);
  check('3년 자료는 표시 없이 진하게', /\by3\b/.test(r.rows[2].cls) && !r.rows[2].chips.some(c => /자료|미공개/.test(c)), r.rows[2]);
}

console.log('\n■ 색 = 진단 라벨');
{
  const r = await draw([rec('안', Y3, 3.8, 3.6), rec('위', Y3, 2.0, 1.9)], 3.0);
  check('안정 → 파랑', /b-safe/.test(r.rows[0].band) && r.rows[0].chips[0].startsWith('안정'), r.rows[0]);
  check('위험 → 빨강', /b-risk/.test(r.rows[1].band) && r.rows[1].chips[0].startsWith('위험'), r.rows[1]);
  const j = await draw([rec('종', Y3, 3.0, 2.8)], 3.0, '종합');
  check('종합전형은 진단 색·라벨 없이', /b-none/.test(j.rows[0].band) && !j.rows[0].chips.some(c => /안정|적정|소신|위험/.test(c)), j.rows[0]);
}

console.log('\n■ 안내');
{
  const r = await draw([rec('가', Y3, 3.0, 2.9)], 3.0);
  check('계산 기준 안내가 붙는다', /등급컷은 대학마다 계산 기준이 다릅니다/.test(r.note) && /대학 환산점수/.test(r.note), r.note);
  check('막대가 적으면 좁히라는 말은 없다', !r.tip);
  const many = await draw(Array.from({ length: 61 }, (_, i) => rec('대학' + i, Y3, 2 + i / 40, 1.9 + i / 40)), 3.0);
  check('막대가 많으면 학과명으로 좁히라고 알려 준다', many.tip);
  const none = await draw([], 3.0);
  check('결과가 없으면 아무것도 안 그린다(검색 결과 없음 안내만)', none.html === '');
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;
await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
