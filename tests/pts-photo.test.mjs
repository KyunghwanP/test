// 상벌점 상세 창에 학생 얼굴을 띄운다.
//
// 사진은 종합검색·외출증이 이미 쓰는 반별 작은 사진(studentPhotos/{학년-반})과
// R2 고화질을 그대로 빌려 쓴다. 여기서 확인하는 것은 세 가지다.
//
//   1. 뜰 때 뜨고, 없을 때는 자리를 비운다 — 앞 학생 얼굴이 남아 있으면 안 된다.
//      상벌점 창에서 **다른 학생 얼굴**이 보이는 건 사진이 안 뜨는 것보다 훨씬 나쁘다.
//   2. 늦게 도착한 사진이 그 사이 연 다른 학생 위에 덮이지 않는다.
//   3. 사진을 크게 본 채 ESC·뒤로가기를 누르면 **사진만** 닫힌다.
//      전에는 사진 확대 처리가 목록 맨 뒤에 있어 밑의 창이 먼저 닫히고 사진이 남았다.
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
// 원본의 한 덩어리를 시작 표시부터 끝 표시까지 그대로 떼어 온다
const cut = (from, to, label) => {
  const a = HTML.indexOf(from);
  if (a < 0) throw new Error('못 찾음: ' + label);
  const b = HTML.indexOf(to, a);
  if (b < 0) throw new Error('끝을 못 찾음: ' + label);
  return HTML.slice(a, b + to.length);
};

// ── 원본에서 떼어 올 것 ──
const MARKUP_PTS  = cut('<div class="pts-detail-modal" id="ptsDetailModal"', '\n</div>\n', '상벌점 상세 마크업');
const MARKUP_ZOOM = cut('<div class="s360-zoom" id="s360PhotoZoom">', '\n</div>\n', '사진 크게 보기 마크업');
const CSS = [...HTML.matchAll(/^  \.(?:pts-detail-(?:modal|box|head|who|photo)|s360-zoom)[^{]*\{[^}]*\}/gm)]
  .map(m => m[0]).join('\n');
const ZOOM_ESC = cut("document.addEventListener('keydown', e => {\n  if (e.key !== 'Escape') return;\n  if (!document.getElementById('s360PhotoZoom')",
                     '}, true);', '사진 ESC 리스너');
const ESC_ALL  = cut('// ESC 키로 열린 모달 닫기', '\n});', '모달 ESC 핸들러');
const popAt = HTML.indexOf("window.addEventListener('popstate'");
const POP = HTML.slice(popAt, HTML.indexOf('\n});', popAt));
const LET_FOR = /^let _ptsPhotoFor = 0;$/m.exec(HTML);
if (!LET_FOR) throw new Error('_ptsPhotoFor 선언을 못 찾음');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
await pg.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style><body>${MARKUP_PTS}${MARKUP_ZOOM}`);

// 1×1 그림 두 장 — 작은 것과 고화질을 src 로 구분한다
const PNG = c => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="3" height="4"><rect width="3" height="4" fill="${c}"/></svg>`)}`;

await pg.addScriptTag({ content: `
  // ── Firestore 대역: 읽은 문서를 기록하고, 필요하면 붙잡아 두었다가 풀어 준다 ──
  window.__docs = {};      // '학년-반' → 문서 내용 | 'ERR'
  window.__reads = [];
  window.__gate = {};      // '학년-반' → 풀어 줄 함수(있으면 그 문서 읽기를 붙잡는다)
  const fbDb = {};
  function doc(db, col, id) { return { col, id }; }
  async function getDoc(ref) {
    __reads.push(ref.col + '/' + ref.id);
    if (__gate[ref.id]) await new Promise(r => { __gate[ref.id] = r; });
    const d = __docs[ref.id];
    if (d === 'ERR') throw new Error('네트워크');
    return { exists: () => d !== undefined, data: () => d };
  }
  const s360PhotoCache = {};
  const s360PhotoVer   = {};
  // 고화질 대역: 학생별로 붙잡아 두었다가 검사가 원하는 순서로 풀어 준다
  window.__big = {};       // '학년-반-번호' → [풀어 줄 함수...]
  function s360BigPhoto(s) {
    const k = parseInt(s.grade) + '-' + parseInt(s.room) + '-' + parseInt(s.num);
    return new Promise(r => { (__big[k] = __big[k] || []).push(r); });
  }
  window.__zoomed = [];
  function s360OpenPhotoZoom(url, s) {
    __zoomed.push([url, s.name]);
    document.getElementById('s360ZoomImg').src = url;
    document.getElementById('s360PhotoZoom').classList.add('open');
  }
  // 원본은 누른 자리·뗀 자리까지 본다. 여기선 '창 바깥을 눌렀나'만 있으면 된다.
  function isOutsideClick(e, el) { return e.target === el; }
  let _zoomFor = 0;        // 원본 s360ClosePhotoZoom 이 올린다

  ${LET_FOR[0]}
  ${grab('ptsShowPhoto')}
  ${grab('showPtsDetail')}
  ${grab('closePtsDetail')}
  ${grab('closePtsDetailBtn')}
  ${grab('s360ClosePhotoZoom')}

  window.open_ = s => showPtsDetail(0, encodeURIComponent(JSON.stringify(
    { total: 0, merit: 0, demerit: 0, deducted: 0, records: [], ...s })));
  window.bigDone_ = (k, url) => { const q = __big[k] || []; const r = q.shift(); if (r) r(url); return !!r; };
  window.state_ = () => {
    const im = document.getElementById('ptsDetailPhoto');
    const r = im.getBoundingClientRect();
    return { hidden: im.hidden, src: im.getAttribute('src'), shown: getComputedStyle(im).display !== 'none',
             w: Math.round(r.width), h: Math.round(r.height), name: document.getElementById('ptsDetailName').textContent };
  };
` });
if (errs.length) { console.log('하네스 오류:', errs.join('\n')); process.exit(1); }

const settle = () => pg.evaluate(() => new Promise(r => setTimeout(r, 0)));
const open = async s => { await pg.evaluate(x => window.open_(x), s); await settle(); };
const state = () => pg.evaluate(() => window.state_());
const reads = () => pg.evaluate(() => window.__reads.slice());
const bigDone = async (k, url) => { const ok = await pg.evaluate(([k, u]) => window.bigDone_(k, u), [k, url]); await settle(); return ok; };
const setDocs = d => pg.evaluate(d => Object.assign(window.__docs, d), d);

const S1 = PNG('red'), S2 = PNG('blue'), S3 = PNG('green');
const B1 = PNG('darkred'), B2 = PNG('navy');
await setDocs({
  '1-3': { photos: { '7': S1, '9': S2 }, updatedAt: 't1' },
  '2-1': { photos: { '4': S3 }, updatedAt: 't2' },
});

console.log('\n■ 사진이 있는 학생');
{
  await open({ name: '김가람', grade: 1, room: 3, num: 7 });
  let st = await state();
  check('작은 사진이 바로 뜬다', !st.hidden && st.shown && st.src === S1, st);
  // 72×96 은 작아서 얼굴이 잘 안 보였다 → 120×160. 이 크기면 휴대폰(3배 화면)에서
  // 작은 사진(150×200)은 흐리고 고화질(600×800)이어야 또렷하다.
  check('얼굴 칸 크기 120×160 (3:4)', st.w === 120 && st.h === 160, [st.w, st.h]);
  check('반 문서를 한 번 읽었다', JSON.stringify(await reads()) === '["studentPhotos/1-3"]', await reads());

  await bigDone('1-3-7', B1);
  st = await state();
  check('고화질이 오면 바꿔 끼운다', st.src === B1, st.src);

  await pg.click('#ptsDetailPhoto');
  const z = await pg.evaluate(() => window.__zoomed.slice());
  check('누르면 크게 보기 — 고화질로, 그 학생으로', z.length === 1 && z[0][0] === B1 && z[0][1] === '김가람', z);
  await pg.evaluate(() => { s360ClosePhotoZoom(); window.__zoomed = []; });
}

console.log('\n■ 같은 반 다른 학생 — 다시 안 받는다');
{
  await open({ name: '이나래', grade: 1, room: 3, num: 9 });
  const st = await state();
  check('그 학생 사진이 뜬다', !st.hidden && st.src === S2, st);
  check('반 문서를 또 읽지 않는다', (await reads()).length === 1, await reads());
  await bigDone('1-3-9', null);    // 고화질 없음
  check('고화질이 없으면 작은 사진 그대로', (await state()).src === S2);
}

console.log('\n■ 사진이 없는 학생 · 반');
{
  await open({ name: '박다솜', grade: 1, room: 3, num: 12 });
  let st = await state();
  check('사진명렬에 없는 학생 — 자리를 비운다', st.hidden && !st.shown && st.src === null, st);

  await open({ name: '최라온', grade: 3, room: 5, num: 1 });
  st = await state();
  check('사진명렬이 없는 반 — 자리를 비운다', st.hidden && st.src === null, st);
  await open({ name: '최라온', grade: 3, room: 5, num: 1 });
  check('없는 반도 한 번만 묻는다', (await reads()).filter(r => r === 'studentPhotos/3-5').length === 1, await reads());
}

console.log('\n■ 앞 학생 얼굴이 남지 않는다');
{
  await open({ name: '김가람', grade: 1, room: 3, num: 7 });
  check('(사진 있는 학생을 먼저 연다)', (await state()).src === S1);
  // 다음 학생의 반 문서를 붙잡아 둔다 — 받는 동안 무엇이 보이는가
  await pg.evaluate(() => { window.__gate['2-1'] = () => {}; });
  await open({ name: '정마루', grade: 2, room: 1, num: 4 });
  let st = await state();
  check('받는 동안 앞 학생 얼굴을 치운다', st.hidden && st.src === null && st.name === '정마루', st);
  await pg.evaluate(() => window.__gate['2-1']());
  await settle();
  st = await state();
  check('받고 나면 그 학생 얼굴', !st.hidden && st.src === S3, st);
  await bigDone('1-3-7', null); await bigDone('2-1-4', null);
}

console.log('\n■ 늦게 온 사진이 다른 학생 위에 덮이지 않는다');
{
  // 고화질이 늦는 경우
  await open({ name: '김가람', grade: 1, room: 3, num: 7 });
  await open({ name: '이나래', grade: 1, room: 3, num: 9 });
  await bigDone('1-3-7', B1);                 // 앞 학생 고화질이 이제 도착
  let st = await state();
  check('앞 학생 고화질이 늦게 와도 지금 학생 얼굴 그대로', st.src === S2 && st.name === '이나래', st);
  await bigDone('1-3-9', B2);
  check('지금 학생 고화질은 들어간다', (await state()).src === B2);

  // 반 문서가 늦는 경우
  await pg.evaluate(() => { delete s360PhotoCache['2-1']; window.__gate['2-1'] = () => {}; });
  await open({ name: '정마루', grade: 2, room: 1, num: 4 });   // 붙잡힘
  await open({ name: '김가람', grade: 1, room: 3, num: 7 });   // 캐시에 있음
  await pg.evaluate(() => window.__gate['2-1']());
  await settle();
  st = await state();
  check('앞 학생 반 문서가 늦게 와도 지금 학생 얼굴 그대로', st.src === S1 && st.name === '김가람', st);
  await bigDone('1-3-7', null);
}

console.log('\n■ 사진을 못 받아도 창은 멀쩡하다');
{
  await setDocs({ '3-2': 'ERR' });
  await open({ name: '한바다', grade: 3, room: 2, num: 3 });
  let st = await state();
  check('자리를 비운 채 창은 열려 있다', st.hidden && st.name === '한바다'
        && await pg.evaluate(() => document.getElementById('ptsDetailModal').classList.contains('show')), st);
  check('실패는 캐시에 안 남긴다(다음에 다시 받게)', await pg.evaluate(() => s360PhotoCache['3-2'] === undefined));
  await setDocs({ '3-2': { photos: { '3': S3 } } });
  await open({ name: '한바다', grade: 3, room: 2, num: 3 });
  st = await state();
  check('다시 열면 받아서 뜬다', !st.hidden && st.src === S3, st);
  await bigDone('3-2-3', null);
}

console.log('\n■ 사진을 크게 본 채 ESC — 사진만 닫힌다');
{
  // 원본 순서대로 건다: 먼저 등록된 다른 ESC 리스너(반 편성 창 등) → 사진 → 모달 목록.
  // 사진 리스너는 capture 라 등록 순서와 상관없이 먼저 돌아야 한다.
  await pg.addScriptTag({ content: `
    window.__otherEsc = 0;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.__otherEsc++; });
    ${ZOOM_ESC}
    ${ESC_ALL}
  ` });
  await open({ name: '김가람', grade: 1, room: 3, num: 7 });
  await pg.click('#ptsDetailPhoto');
  const opened = await pg.evaluate(() => ({
    zoom: document.getElementById('s360PhotoZoom').classList.contains('open'),
    pts:  document.getElementById('ptsDetailModal').classList.contains('show') }));
  check('사진을 눌러도 상벌점 창은 안 닫히고, 그 위에 크게 열린다', opened.zoom && opened.pts, opened);

  await pg.keyboard.press('Escape');
  let after = await pg.evaluate(() => ({
    zoom: document.getElementById('s360PhotoZoom').classList.contains('open'),
    pts:  document.getElementById('ptsDetailModal').classList.contains('show'),
    other: window.__otherEsc }));
  check('ESC 한 번 — 사진이 닫힌다', !after.zoom, after);
  check('ESC 한 번 — 상벌점 창은 그대로', after.pts, after);
  check('먼저 등록된 다른 ESC 리스너도 안 불린다', after.other === 0, after);

  await pg.keyboard.press('Escape');
  after = await pg.evaluate(() => document.getElementById('ptsDetailModal').classList.contains('show'));
  check('ESC 한 번 더 — 그제서야 상벌점 창이 닫힌다', !after);
  await bigDone('1-3-7', null);
}

console.log('\n■ 뒤로가기 — 사진을 밑의 창들보다 먼저 닫는다');
{
  const zi = POP.indexOf("'s360PhotoZoom'");
  check('뒤로가기 목록에 사진 크게 보기가 있다', zi > 0);
  // 사진이 위에 뜨는 창들: 상벌점 상세, 종합검색(cd-overlay), 자리 배치, 반 편성
  for (const below of ["'ptsDetailModal'", "'.cd-overlay.open'", "'seatModal'", "'classOrgModal'"]) {
    const bi = POP.indexOf(below);
    check(`${below.replace(/'/g, '')} 보다 먼저 본다`, bi > 0 && zi < bi, { 사진: zi, 밑: bi });
  }
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
if (errs.length) fail++;
await b.close();
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
