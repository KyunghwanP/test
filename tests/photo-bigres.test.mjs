// 학생 사진 고화질 — 받는 중에 눌러도 고화질이 들어오고, 창이 튀지 않는다.
//
// 신고된 것: 상벌점 상세에서 사진을 누르면 가끔 저화질에 머문다.
//
// 원인은 고화질 받기(s360BigPhoto)가 '받는 중'을 null(없음)로 박아 둔 것이었다.
// 썸네일이 고화질을 받는 사이 사진을 누르면, 확대 창이 두 번째로 물어 null 을 받고
// '고화질 없음'으로 알아 작은 사진에 멈췄다. 종합검색도 같았다.
//
// 그래서 여기서는 원본 함수를 그대로 떼어 와, 워커 응답을 붙잡아 두었다가 **누른 뒤에**
// 풀어 준다. 그리고 확대 창은 처음부터 고화질 크기로 열려 크기는 그대로, 그림만
// 또렷해져야 한다(전에는 작게 열렸다가 고화질이 오면 커지며 한 번 튀었다).
import { chromium } from 'playwright';
import fs from 'node:fs';

const HTML = fs.readFileSync(import.meta.dirname + '/../index.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

const grab = name => {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(HTML);
  if (!m) throw new Error('못 찾음: ' + name);
  let i = HTML.indexOf('{', m.index), d = 0;
  for (let j = i; j < HTML.length; j++) {
    if (HTML[j] === '{') d++;
    else if (HTML[j] === '}' && --d === 0) return HTML.slice(m.index, j + 1);
  }
  throw new Error('닫는 괄호 못 찾음: ' + name);
};
const cut = (from, to, label) => {
  const a = HTML.indexOf(from);
  if (a < 0) throw new Error('못 찾음: ' + label);
  const b = HTML.indexOf(to, a);
  if (b < 0) throw new Error('끝을 못 찾음: ' + label);
  return HTML.slice(a, b + to.length);
};
const MARKUP = cut('<div class="pts-detail-modal" id="ptsDetailModal"', '\n</div>\n', '상벌점 상세')
             + cut('<div class="s360-zoom" id="s360PhotoZoom">', '\n</div>\n', '사진 크게 보기');
const CSS = [...HTML.matchAll(/^  \.(?:pts-detail-(?:modal|box|head|who|photo)|s360-zoom)[^{]*\{[^}]*\}/gm)]
  .map(m => m[0]).join('\n');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage({ viewport: { width: 1000, height: 1000 } });
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${MARKUP}`);

const SVG = c => `<svg xmlns="http://www.w3.org/2000/svg" width="3" height="4"><rect width="3" height="4" fill="${c}"/></svg>`;
await pg.addScriptTag({ content: `
  // ── 워커 대역: 요청을 붙잡아 두고 검사가 원하는 때 원하는 답으로 풀어 준다 ──
  window.__calls = [];
  window.__held  = [];
  window.fetch = (url, opt) => {
    __calls.push(url);
    return new Promise((ok, ng) => __held.push({ url, ok, ng }));
  };
  window.answer_ = (n, kind) => {          // n 번 학생 요청에 답한다
    const i = __held.findIndex(h => new URL(h.url, location.href).searchParams.get('n') === String(n));
    if (i < 0) return false;
    const h = __held.splice(i, 1)[0];
    if (kind === 'net') { h.ng(new Error('네트워크')); return true; }
    const img = kind === 'img';
    h.ok({ ok: img, headers: { get: () => img ? 'image/svg+xml' : 'text/plain' },
           blob: async () => new Blob([${JSON.stringify(SVG('navy'))}], { type: 'image/svg+xml' }) });
    return true;
  };
  const TEACHER_WORKER = 'https://w.example';
  const fbAuth = { currentUser: { getIdToken: async () => 'tok' } };
  const fbDb = {};
  function doc(db, col, id) { return { col, id }; }
  async function getDoc(ref) { return { exists: () => true, data: () => __docs[ref.id] }; }
  const escapeHtml = v => String(v).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  function isOutsideClick(e, el) { return e.target === el; }

  const s360PhotoCache = {}, s360BigCache = {}, s360PhotoVer = {};
  ${/^const s360BigPending = \{\};.*$/m.exec(HTML)?.[0] || 'THROW_선언없음'}
  let _zoomFor = 0, _ptsPhotoFor = 0;

  ${grab('s360BigKey')}
  ${grab('s360BigPhoto')}
  ${grab('s360OpenPhotoZoom')}
  ${grab('s360ClosePhotoZoom')}
  ${grab('ptsShowPhoto')}
  ${grab('showPtsDetail')}
  ${grab('closePtsDetail')}
  ${grab('closePtsDetailBtn')}

  window.open_ = s => showPtsDetail(0, encodeURIComponent(JSON.stringify(
    { total: 0, merit: 0, demerit: 0, deducted: 0, records: [], ...s })));
  window.zoom_ = () => {
    const ov = document.getElementById('s360PhotoZoom'), im = document.getElementById('s360ZoomImg');
    return { open: ov.classList.contains('open'), big: ov.classList.contains('big'),
             src: im.getAttribute('src') || '', w: Math.round(im.getBoundingClientRect().width) };
  };
  window.thumb_ = () => document.getElementById('ptsDetailPhoto').getAttribute('src') || '';
` });
if (errs.length) { console.log('하네스 오류:', errs.join('\n')); process.exit(1); }

const SMALL = n => `data:small-${n}`;
await pg.evaluate(p => { window.__docs = { '1-3': { photos: p, updatedAt: 'v1' } }; },
  { 7: SMALL(7), 8: SMALL(8), 9: SMALL(9), 10: SMALL(10), 11: SMALL(11) });

const tick = (ms = 0) => pg.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
const open  = async n => { await pg.evaluate(n => window.open_({ name: '학생' + n, grade: 1, room: 3, num: n }), n); await tick(); };
const answer = async (n, kind) => { const ok = await pg.evaluate(([n, k]) => window.answer_(n, k), [n, kind]); await tick(); return ok; };
const zoom  = () => pg.evaluate(() => window.zoom_());
const thumb = () => pg.evaluate(() => window.thumb_());
const calls = () => pg.evaluate(() => window.__calls.length);
// transition(.18s)이 끝난 뒤의 크기를 재야 '튀었는지'를 볼 수 있다
const settled = async () => { await tick(260); return zoom(); };
const closeZoom = () => pg.evaluate(() => s360ClosePhotoZoom());

console.log('\n■ 받는 중에 누르면 — 신고된 그 상황');
{
  await open(7);
  check('(썸네일은 작은 사진, 고화질은 받는 중)', (await thumb()) === SMALL(7) && (await calls()) === 1);
  await pg.click('#ptsDetailPhoto');
  let z = await settled();
  check('누르면 바로 열린다 — 우선 작은 사진으로', z.open && z.src === SMALL(7), z);
  check('처음부터 고화질 크기로 연다', z.big && z.w === 520, z);
  check('워커에 또 묻지 않는다 — 받는 중인 것을 같이 기다린다', (await calls()) === 1, await calls());
  const wBefore = z.w;

  await answer(7, 'img');
  z = await settled();
  check('받아지는 즉시 확대 창이 고화질로 바뀐다', z.src.startsWith('blob:'), z);
  check('크기는 그대로 — 그림만 또렷해진다', z.w === wBefore && z.big, { 전: wBefore, 후: z.w });
  check('썸네일도 고화질로', (await thumb()) === z.src, await thumb());
  await closeZoom();
}

console.log('\n■ 고화질을 이미 받은 학생');
{
  await open(7);
  check('썸네일이 곧장 고화질', (await thumb()).startsWith('blob:'));
  await pg.click('#ptsDetailPhoto');
  const z = await settled();
  check('확대 창도 곧장 고화질·큰 크기', z.src.startsWith('blob:') && z.big && z.w === 520, z);
  check('다시 받지 않는다', (await calls()) === 1, await calls());
  await closeZoom();
}

console.log('\n■ 고화질이 없는 학생 — 뭉개지지 않는 크기로');
{
  await open(8);
  await pg.click('#ptsDetailPhoto');
  let z = await settled();
  check('(모를 때는 큰 크기로 연다)', z.big, z);
  await answer(8, '404');
  z = await settled();
  check('없다고 알게 되면 작은 크기로 줄인다', !z.big && z.w === 330 && z.src === SMALL(8), z);
  await closeZoom();

  await open(8);
  await pg.click('#ptsDetailPhoto');
  z = await zoom();
  check('없는 걸 이미 알면 처음부터 작은 크기', !z.big && z.src === SMALL(8), z);
  check('없는 것도 다시 묻지 않는다', (await calls()) === 2, await calls());
  await closeZoom();
}

console.log('\n■ 받다가 끊기면');
{
  await open(9);
  await answer(9, 'net');
  await pg.click('#ptsDetailPhoto');
  const z = await settled();
  check('작은 사진·작은 크기로 보인다', z.src === SMALL(9) && !z.big, z);
  await closeZoom();
}

console.log('\n■ 늦게 온 고화질이 엉뚱한 데 들어가지 않는다');
{
  // 확대 창을 닫은 뒤에 도착
  await open(10);
  await pg.click('#ptsDetailPhoto');
  await closeZoom();
  await answer(10, 'img');
  let z = await zoom();
  check('닫은 창이 다시 열리거나 그림이 들어가지 않는다', !z.open && z.src === '', z);

  // 다른 학생 확대 창이 열려 있을 때 앞 학생 것이 도착
  await open(11);
  await pg.click('#ptsDetailPhoto');                       // 11번 받는 중
  await pg.evaluate(() => s360OpenPhotoZoom('data:small-7', { name: '학생7', grade: 1, room: 3, num: 7 }));
  await answer(11, 'img');
  z = await zoom();
  const seven = await pg.evaluate(() => s360BigCache[s360BigKey({ grade: 1, room: 3, num: 7 })]);
  check('지금 보고 있는 학생(7번) 사진 그대로', z.src === seven, { 창: z.src, 칠번: seven });
  await closeZoom();
}

console.log('\n■ 여러 곳이 한꺼번에 물어도 요청은 하나');
{
  const r = await pg.evaluate(async () => {
    const s = { grade: 2, room: 1, num: 5 };
    s360PhotoVer['2-1'] = 'v9';
    const n0 = __calls.length;
    const ps = [s360BigPhoto(s), s360BigPhoto(s), s360BigPhoto(s)];
    const n1 = __calls.length;
    await new Promise(r => setTimeout(r, 0));
    window.answer_(5, 'img');
    const got = await Promise.all(ps);
    return { 요청: n1 - n0 + (__calls.length - n1), 같은답: got.every(g => g && g === got[0]) };
  });
  check('세 번 물어도 워커 요청은 한 번, 셋 다 같은 고화질', r.요청 === 1 && r.같은답, r);
}

console.log('\n■ 썸네일 크기');
{
  const r = await pg.evaluate(() => {
    const im = document.getElementById('ptsDetailPhoto');
    const b = im.getBoundingClientRect();
    return [Math.round(b.width), Math.round(b.height)];
  });
  check('120×160 (3:4)', r[0] === 120 && r[1] === 160, r);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;
await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
