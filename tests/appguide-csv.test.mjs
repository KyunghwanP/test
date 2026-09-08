// 모집요강 목록(appguide.csv)과 그것을 읽는 화면.
//
// 이 파일은 사람이 엑셀로 만들어 올린다. 한글 윈도우 엑셀에서 'CSV 저장'을 하면
// CP949 + 탭으로 나가는 일이 있는데, 그러면 앱이 한 줄도 못 읽는다 — 정시를 더한
// 날 실제로 그랬고, 정시뿐 아니라 수시까지 통째로 사라졌다. 형식을 못 박아 둔다.
//
// 그리고 한 파일에 수시·정시가 같이 들어 있으므로 문서종류로 가르지 않으면
// 대학이 두 번씩 뜬다.
import { chromium } from 'playwright';
import fs from 'node:fs';

const DIR  = import.meta.dirname + '/..';
const RAW  = fs.readFileSync(DIR + '/appguide.csv');
const GUIDE = fs.readFileSync(DIR + '/appguide.html', 'utf8');
const CAREER = fs.readFileSync(DIR + '/career.html', 'utf8');

let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log('  ✅', n))
                             : (fail++, console.log('  ❌', n, x !== undefined ? '\n       → ' + JSON.stringify(x).slice(0, 300) : ''));

console.log('\n■ 파일 형식 (엑셀이 망가뜨리기 쉬운 것들)');
let text = '';
{
  check('UTF-8 로 읽힌다(CP949 아님)', (() => {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(RAW); return true; }
    catch (e) { return false; }
  })());
  check('BOM 이 있다', RAW[0] === 0xEF && RAW[1] === 0xBB && RAW[2] === 0xBF);
  if (text) {
    const head = text.replace(/^﻿/, '').split('\n')[0];
    check('머리글이 쉼표로 나뉜다(탭 아님)', head.includes(',') && !head.includes('\t'), head);
    check('머리글이 다섯 칸', head.split(',').length === 5, head);
    check('머리글 이름이 그대로',
          head === '조회연도,대학명,대학코드,문서종류,다운로드링크', head);
  }
}

// 화면과 같은 방식으로 읽는다 — 따옴표 안의 쉼표까지 다루려면 한 줄 파서가 필요하다
const parseLine = line => {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
};

console.log('\n■ 내용');
const rows = text.replace(/^﻿/, '').trim().split('\n').slice(1).map(parseLine);
{
  check('행이 200줄 이상', rows.length > 200, rows.length);
  check('모든 행이 다섯 칸', rows.every(r => r.length === 5),
        rows.filter(r => r.length !== 5).slice(0, 3));

  const susi  = rows.filter(r => r[3].includes('수시'));
  const jeong = rows.filter(r => r[3].includes('정시'));
  check('수시가 들어 있다', susi.length > 100, susi.length);
  check('정시가 들어 있다', jeong.length > 100, jeong.length);
  check('문서종류가 수시·정시 둘뿐',
        rows.every(r => r[3].includes('수시') || r[3].includes('정시')),
        [...new Set(rows.map(r => r[3]))]);

  check('대학코드 앞자리 0 이 살아 있다', rows.every(r => /^\d{7}$/.test(r[2])),
        rows.filter(r => !/^\d{7}$/.test(r[2])).slice(0, 3).map(r => r[2]));
  check('링크는 http 이거나 미등록',
        rows.every(r => /^https?:/.test(r[4]) || r[4] === '미등록'),
        rows.filter(r => !/^https?:/.test(r[4]) && r[4] !== '미등록').slice(0, 3));
  check('학년도는 2027 하나', [...new Set(rows.map(r => r[0]))].join() === '2027',
        [...new Set(rows.map(r => r[0]))]);
}

console.log('\n■ 화면 배선 (정적)');
{
  check('주소로 수시·정시를 고른다', /kind'\) === '정시' \? '정시' : '수시'/.test(GUIDE));
  check('문서종류로 거른다', /String\(c\[3\][^)]*\)\.includes\(KIND\)\) continue;/.test(GUIDE));
  check('제목도 모드를 따라간다', /document\.title = `대학 \$\{KIND_LABEL\}/.test(GUIDE));
  check('진로진학에 정시 카드가 있다',
        /id="cardGuideJeongsi"/.test(CAREER) && /appguide\.html\?kind=정시/.test(CAREER));
  check('수시 카드는 그대로', /id="cardGuide"/.test(CAREER) && /2027 수시/.test(CAREER));
}

// ── 실제로 걸러지는지 브라우저에서 ──
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const pg = await b.newPage();
const errs = [];
pg.on('pageerror', e => errs.push(e.message));
// 이 화면은 PDF 를 cdnjs 에서 받아 쓴다. 여기서는 바깥으로 못 나가고, 없으면
// pdfjsLib 를 만지는 줄에서 스크립트가 통째로 죽어 목록도 안 그려진다 — 껍데기만 준다.
await pg.route('**://cdnjs.cloudflare.com/**', r => r.fulfill({
  contentType: 'application/javascript',
  body: `window.pdfjsLib = { GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.reject(new Error('stub')) }),
    renderTextLayer: () => ({ promise: Promise.resolve() }) };`,
}));
await pg.route('https://ynhs.test/**', r => {
  const u = r.request().url();
  if (u.includes('appguide.csv'))
    return r.fulfill({ contentType: 'text/csv; charset=utf-8', body: text });
  r.fulfill({ contentType: 'text/html; charset=utf-8', body: GUIDE });
});

const names = async kind => {
  await pg.goto(`https://ynhs.test/appguide.html${kind ? '?kind=' + encodeURIComponent(kind) : ''}`);
  await pg.waitForFunction(() => /개 대학/.test(document.getElementById('db-count')?.textContent || ''), null, { timeout: 8000 });
  return pg.$eval('#db-count', e => e.textContent);
};

console.log('\n■ 화면이 실제로 가르는가');
{
  const susiCount  = await names('');
  const susiTitle  = await pg.$eval('#brandSub', e => e.textContent);
  const jeongCount = await names('정시');
  const jeongTitle = await pg.$eval('#brandSub', e => e.textContent);
  const jeongHead  = await pg.$eval('#brandTitle', e => e.textContent);

  const n = s => Number(String(s).replace(/\D/g, ''));
  check('기본은 수시', susiTitle.includes('수시'), susiTitle);
  check('수시만 셌다(전체 행보다 적다)', n(susiCount) < rows.length, [susiCount, rows.length]);
  check('정시로 들어가면 정시', jeongTitle.includes('정시'), jeongTitle);
  check('제목도 정시', jeongHead.includes('정시'), jeongHead);
  check('둘을 합치면 링크 있는 행 수와 같다',
        n(susiCount) + n(jeongCount) === rows.filter(r => /^https?:/.test(r[4])).length,
        [susiCount, jeongCount]);
  check('대학이 두 번 뜨지 않는다', n(susiCount) < n(jeongCount) + n(susiCount), [susiCount, jeongCount]);
}

console.log(errs.length ? '\n❌ 런타임 오류:\n' + errs.slice(0, 4).join('\n') : '\n✅ 런타임 오류 없음');
console.log(`\n${fail || errs.length ? '❌' : '✅'} 통과 ${pass} / 실패 ${fail}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
