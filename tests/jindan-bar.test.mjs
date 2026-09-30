// 적정 대학 진단 — 막대 보기.
//
// 확인하는 것
//   · 전형을 섞어 평균 내지 않는다. 결과 한 줄(대학·전형·모집단위) = 막대 한 줄.
//     (여러 전형을 평균 내면 어느 전형에도 없는 컷이 나온다 — 다른 사이트가 그랬다)
//   · 막대는 모두 1.0 에서 시작하는 길이 막대, 눈금은 1.0~9.0 고정 — 줄끼리 길이를 바로 견준다.
//   · 비어 있는 값을 지어내지 않는다. 50%컷이 없으면 50% 막대를 그리지 않는다.
//   · 50%컷이 70%컷보다 큰 곳도 오류로 다루지 않고 그대로 그린다 —
//     등급컷은 대학 환산점수 순위의 50%째·70%째 학생 '등급'이라 실제로 뒤바뀐다.
//   · 자료가 적은 전형은 이름 아래에 알린다. 3년 평균과 똑같이 믿으면 안 된다.
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
// 좁은 화면 규칙(@media)까지 — 휴대폰에서는 줄마다 선을 그리는지도 본다
const CSS_END = '            .bar-track .bar-range, .bar-track .bar-me { display: block; }\n        }\n';
const CSS = H.slice(H.indexOf('/* ─── 막대 보기 ───'), H.indexOf(CSS_END) + CSS_END.length);
if (CSS.length < 500) throw new Error('막대 CSS 를 못 찾음');
await pg.setContent(`<style>:root{--slate-50:#f8fafc;--slate-100:#f1f5f9;--slate-300:#cbd5e1;--slate-400:#94a3b8;--slate-500:#64748b;--indigo:#4f46e5}${CSS}</style><body><div id="out"></div>`);
await pg.addScriptTag({ content: [
  line(/const SURVEY_YEARS = \[[^\]]+\];/),
  line(/const yearCut = [^\n]+/),
  line(/const AMBITIOUS_EXTEND = [^\n]+/),
  line(/const BAR_MANY = [^\n]+/),
  line(/const barPct = [^\n]+/),
  "let visibleCount = 150, admissionKind = '교과', currentFiltered = [], searchRange = 0.5, showAmbitious = false, selectedUniversity = '';",
  grab('getBounds'), grab('classify'), grab('barsHtml'),
].join('\n') });

// 가짜 전형 — 값만 필요한 만큼 채운다(parseCSV 가 만드는 모양 그대로)
const rec = (name, y, a70, a50, extra = {}) => ({
  university: name, campus: '본교', department: '전자공학과', admissionName: '학생부교과(' + name + ')',
  years: Object.fromEntries(y.map(k => [k, { grade70: a70 }])), averageGrade: a70, avg50: a50,
  yearCount: y.length, vol70: 0.2, ...extra });
const Y3 = ['2025', '2026', '2027'];
const draw = (recs, target, kind = '교과', range = 0.5, amb = false, uni = '') => pg.evaluate(([recs, target, kind, range, amb, uni]) => {
  currentFiltered = recs; admissionKind = kind; searchRange = range; showAmbitious = amb; selectedUniversity = uni;
  const html = barsHtml(target);
  const out = document.getElementById('out'); out.innerHTML = html;
  const rows = [...out.querySelectorAll('.bar-row')].map(r => {
    const tr = r.querySelector('.bar-track').getBoundingClientRect();
    const rel = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: (b.left - tr.left) / tr.width, r: (b.right - tr.left) / tr.width }; };
    const lab = r.querySelector('.lab');
    const shown = el => el && getComputedStyle(el).display !== 'none' ? el : null;
    return { b50: rel(r.querySelector('.b50')), b70: rel(r.querySelector('.b70')),
             me: rel(shown(r.querySelector('.bar-me'))), rg: rel(shown(r.querySelector('.bar-range'))),
             lab: lab && lab.className + ' ' + lab.textContent, few: (r.querySelector('.few') || {}).textContent || '',
             cuts: r.querySelector('.bar-cuts').innerText.replace(/\s+/g, ' ').trim() };
  });
  // 목록 전체를 가로지르는 한 벌(넓은 화면). 첫 줄 막대 칸을 기준으로 자리를 잰다.
  const tr0 = out.querySelector('.bar-track') && out.querySelector('.bar-track').getBoundingClientRect();
  const list = out.querySelector('.bar-rows') && out.querySelector('.bar-rows').getBoundingClientRect();
  const ov = sel => { const el = out.querySelector(sel); if (!el || getComputedStyle(el.closest('.bar-lines')).display === 'none') return null;
    const b = el.getBoundingClientRect(); return { l: (b.left - tr0.left) / tr0.width, r: (b.right - tr0.left) / tr0.width, top: b.top - list.top, bottom: list.bottom - b.bottom,
      px: (b.left + b.right) / 2 - tr0.left, w: tr0.width }; };
  const lines = tr0 ? { me: ov('.bar-lines.over .bar-me'), rg: ov('.bar-lines.under .bar-range:not(.ext)'), ext: ov('.bar-lines.under .bar-range.ext') } : {};
  return { html, rows, lines, legend: ((out.querySelector('.bar-legend') || {}).textContent || '').replace(/\s+/g, ' ').trim(), note: (out.querySelector('.bar-note') || {}).textContent || '', tip: !!out.querySelector('.bar-note.tip'),
           ticks: [...out.querySelectorAll('.ticks span')].map(s => s.textContent) };
}, [recs, target, kind, range, amb, uni]);
const near = (a, b) => Math.abs(a - b) < 0.012;
const at = v => (v - 1) / 8;       // 1.0~9.0 눈금에서의 자리

console.log('\n■ 한 줄 = 전형 하나');
{
  const r = await draw([rec('가', Y3, 3.7, 3.6), rec('나', Y3, 2.9, 2.7), rec('다', Y3, 1.4, 1.3)], 3.0);
  check('결과 3건 → 막대 3줄', r.rows.length === 3, r.rows.length);
  check('같은 학과라도 전형마다 따로 — 평균 낸 줄이 없다', r.rows.every((x, i) => x.cuts.includes(['3.70', '2.90', '1.40'][i])), r.rows.map(x => x.cuts));
  check('눈금은 1.0~9.0 고정', r.ticks[0] === '1.0' && r.ticks[r.ticks.length - 1] === '9.0' && r.ticks.length === 17, r.ticks);
}

console.log('\n■ 막대 길이');
{
  const x = (await draw([rec('가', Y3, 3.5, 3.0)], 3.25)).rows[0];
  check('두 막대 모두 1.0(왼쪽 끝)에서 시작', near(x.b50.l, 0) && near(x.b70.l, 0), [x.b50, x.b70]);
  check('50% 막대가 3.0 까지', near(x.b50.r, at(3.0)), x.b50);
  check('70% 막대가 3.5 까지', near(x.b70.r, at(3.5)), x.b70);
}

console.log('\n■ 내 등급선 · 검색 범위 — 넓은 화면은 목록 전체에 한 벌');
{
  const r = await draw([rec('가', Y3, 3.5, 3.0), rec('나', Y3, 3.1, 2.9), rec('다', Y3, 3.3, 3.2)], 3.25);
  const me = r.lines.me, rg = r.lines.rg;
  // 비율로 재면 몇 px 어긋나도 통과한다 — 선은 막대 끝과 겹쳐 보이는 것이라 픽셀로 잰다
  check('내 등급선이 3.25 자리에 — 막대 눈금과 1.5px 안으로 맞는다', me && Math.abs(me.px - at(3.25) * me.w) < 1.5, me && [me.px, at(3.25) * me.w]);
  check('선이 줄 사이에서 끊기지 않는다 — 목록 위에서 아래까지', me && me.top <= 0.5 && me.bottom <= 0.5, me);
  check('검색 범위 띠 = 2.75~3.75 (±0.5), 목록 끝까지', rg && near(rg.l, at(2.75)) && near(rg.r, at(3.75)) && rg.top <= 0.5 && rg.bottom <= 0.5, rg);
  check('줄마다 따로 그린 선은 숨긴다(겹쳐 보이지 않게)', r.rows.every(x => !x.me && !x.rg), r.rows.map(x => [x.me, x.rg]));
  const all = await draw([rec('가', Y3, 3.5, 3.0)], 3.25, '교과', 'all');
  check('범위가 "전체"면 범위 띠가 없다', !all.lines.rg && !!all.lines.me, all.lines);
}

console.log('\n■ 소신 지원 포함 — 상향 쪽 확장은 옅은 두 번째 겹으로');
{
  const off = await draw([rec('가', Y3, 3.5, 3.0)], 3.25, '교과', 0.5, false);
  check('소신 끄면 한 겹만', !off.lines.ext && /목록 범위 2\.75~3\.75/.test(off.legend) && !/소신 확장/.test(off.legend), off.legend);
  const on = await draw([rec('가', Y3, 3.5, 3.0)], 3.25, '교과', 0.5, true);
  // ±0.5 에 소신을 켜면 상향 쪽이 1.0 까지 → 2.25~2.75 가 확장, 2.75~3.75 가 기본
  check('기본 범위는 그대로 2.75~3.75', on.lines.rg && near(on.lines.rg.l, at(2.75)) && near(on.lines.rg.r, at(3.75)), on.lines.rg);
  check('확장 겹은 2.25~2.75 — 기본 범위 바로 왼쪽', on.lines.ext && near(on.lines.ext.l, at(2.25)) && near(on.lines.ext.r, at(2.75)), on.lines.ext);
  check('범례에 둘을 나눠 적는다', /목록 범위 2\.75~3\.75/.test(on.legend) && /소신 확장 2\.25~2\.75/.test(on.legend), on.legend);
  check('무엇을 기준으로 거른 범위인지 적는다(70%컷)', /범위는 70%컷 기준/.test(on.legend), on.legend);
}

console.log('\n■ 대학명을 지정하면 — 목록을 범위로 거르지 않으므로 띠도 없다');
{
  const r = await draw([rec('가', Y3, 3.5, 3.0)], 3.25, '교과', 0.5, true, '가천');
  check('범위 띠·확장 겹 없음', !r.lines.rg && !r.lines.ext && !/목록 범위|소신 확장|70%컷 기준/.test(r.legend), [r.lines, r.legend]);
  check('내 등급선은 그대로', !!r.lines.me);
}

console.log('\n■ 휴대폰 — 줄마다 그대로');
{
  await pg.setViewportSize({ width: 390, height: 800 });
  const r = await draw([rec('가', Y3, 3.5, 3.0), rec('나', Y3, 3.1, 2.9)], 3.25);
  check('목록 전체 선은 안 쓴다 (이름 글자를 가로지르므로)', !r.lines.me && !r.lines.rg, r.lines);
  check('줄마다 내 등급선이 3.25 자리에', r.rows.every(x => x.me && near((x.me.l + x.me.r) / 2, at(3.25))), r.rows.map(x => x.me));
  check('줄마다 범위 띠', r.rows.every(x => x.rg && near(x.rg.l, at(2.75)) && near(x.rg.r, at(3.75))), r.rows.map(x => x.rg));
  await pg.setViewportSize({ width: 1200, height: 800 });
}

console.log('\n■ 비어 있는 값을 지어내지 않는다');
{
  const x = (await draw([rec('가', Y3, 3.4, null)], 3.0)).rows[0];
  check('50%컷이 없으면 50% 막대를 안 그린다', !x.b50 && !!x.b70, x);
  check('70% 막대는 그대로 3.4 까지', near(x.b70.r, at(3.4)), x.b70);
  check('숫자 칸에 50% 는 –', /^– 3\.40$/.test(x.cuts), x.cuts);
}

console.log('\n■ 50%컷이 70%컷보다 큰 곳 — 오류로 다루지 않는다');
{
  const x = (await draw([rec('가', Y3, 1.9, 2.08)], 2.5)).rows[0];
  check('두 막대를 값 그대로 — 50% 막대가 더 길다', x.b50 && x.b70 && x.b50.r > x.b70.r, [x.b50, x.b70]);
  check('값은 원래대로 적는다', /^2\.08 1\.90$/.test(x.cuts), x.cuts);
  check('오류 표시를 붙이지 않는다', !/오류|⚠/.test(x.few + (x.lab || '')), x);
}

console.log('\n■ 자료가 적은 전형');
{
  const r = await draw([rec('가', ['2027'], 3.0, 2.9), rec('나', ['2025', '2026'], 3.1, 3.0), rec('다', Y3, 3.2, 3.1)], 3.0);
  check('1년 자료 → 이름 아래 "1년 자료"', r.rows[0].few === '1년 자료', r.rows[0].few);
  check('최신 해가 비었으면 "최근 미공개"', r.rows[1].few === '2년 자료 · 최근 미공개', r.rows[1].few);
  check('3년 자료는 아무 표시 없음', r.rows[2].few === '', r.rows[2].few);
}

console.log('\n■ 진단 라벨');
{
  const r = await draw([rec('안', Y3, 3.8, 3.6), rec('위', Y3, 2.0, 1.9)], 3.0);
  check('안정', /lab-safe 안정/.test(r.rows[0].lab), r.rows[0].lab);
  check('위험', /lab-risk 위험/.test(r.rows[1].lab), r.rows[1].lab);
  const j = await draw([rec('종', Y3, 3.0, 2.8)], 3.0, '종합');
  check('종합전형은 진단 라벨 없이', !j.rows[0].lab, j.rows[0]);
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
