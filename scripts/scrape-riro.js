// scripts/scrape-riro.js
const { chromium } = require('playwright');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const RIRO_ID = process.env.RIRO_ID;
const RIRO_PW = process.env.RIRO_PW;
const SITE    = 'https://yeungnam.riroschool.kr';

// Firebase 초기화
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// ── 진단 로그 ─────────────────────────────────────────────────────────
// 저장소가 공개라 Actions 로그를 누구나 본다. 본문(학생 이름·점수, 계정 주인 이름이
// 섞일 수 있다)은 찍지 않고 상태 코드·걸린 시간·응답한 서버·몇 가지 낱말 유무만 남긴다.
// 2026-10-15 부터 '파싱 완료: 0명' 으로 매일 실패했는데, 상벌점 페이지가 25ms 만에
// 끝났다(정상일 땐 2초 남짓). 한국 서버까지 갔다 올 수 없는 시간이라 중간에서 누가
// 대신 답한 것으로 보인다 — 무엇이 답하는지 보려고 남긴다.
function edgeOf(h = {}) {
  const out = [];
  if (h['server'])       out.push(`server=${h['server']}`);
  if (h['cf-ray'])       out.push(`cloudflare=${String(h['cf-ray']).split('-').pop()}`);  // 응답한 지점(공항 코드)
  if (h['x-amz-cf-pop']) out.push(`cloudfront=${h['x-amz-cf-pop']}`);
  if (h['x-cache'])      out.push(`x-cache=${h['x-cache']}`);
  if (h['via'])          out.push(`via=${h['via']}`);
  return out.join(' ') || '-';
}
const MARKS = { 상벌점표: 'mypage_record_pc', 로그인화면: 'action=signin', 로그아웃: 'logout', 차단: '차단', 해외: '해외',
                비밀번호변경: '비밀번호 변경', captcha: 'captcha', cloudflare: 'cloudflare', 'Access Denied': 'access denied',
                Forbidden: 'forbidden', 'request blocked': 'request blocked' };
function marksOf(text) {
  const t = String(text || '').toLowerCase();
  return Object.entries(MARKS).filter(([, k]) => t.includes(k)).map(([n]) => n).join(',') || '-';
}
async function go(page, label, url) {
  const t = Date.now();
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const u = new URL(page.url());
  const title = (await page.title().catch(() => '')).slice(0, 40);
  console.log(`  ${label}: HTTP ${res ? res.status() : '-'} · ${Date.now() - t}ms · ${u.host}${u.pathname} · 제목「${title}」`
    + ` · ${edgeOf(res ? res.headers() : {})} · 표시: ${marksOf(await page.content())}`);
  return res;
}
// 브라우저 없이 같은 서버에서 한 번 — 막히는 게 이 컴퓨터(IP) 자체인지 본다
async function probe(label, url) {
  const t = Date.now();
  try {
    const r = await fetch(url, { redirect: 'manual' });
    const body = await r.text();
    const h = Object.fromEntries(r.headers.entries());
    console.log(`  ${label}: HTTP ${r.status} · ${Date.now() - t}ms · ${body.length}자${h.location ? ' · →' + new URL(h.location, url).pathname : ''}`
      + ` · ${edgeOf(h)} · 표시: ${marksOf(body)}`);
  } catch (e) {
    console.log(`  ${label}: 연결 실패 · ${Date.now() - t}ms · ${e.cause ? e.cause.code || e.cause.message : e.message}`);
  }
}

async function main() {
  console.log('접속 확인 (브라우저 없이)...');
  await probe('로그인 화면', `${SITE}/user.php?action=signin`);
  await probe('첫 화면', `${SITE}/`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  // 1. 로그인
  console.log('리로스쿨 로그인 중...');
  await go(page, '로그인 화면', `${SITE}/user.php?action=signin`);
  const lt = Date.now();
  const login = await page.request.post(`${SITE}/ajax.php`, {
    form: {
      app:      'user',
      mode:     'login',
      userType: '1',
      id:       RIRO_ID,
      pw:       RIRO_PW,
    }
  });
  {
    // 응답 본문은 안 찍는다. JSON 이면 키 이름과 숫자·참거짓 값만 (문자열엔 이름이 있을 수 있다)
    const body = await login.text();
    let shape = '본문 JSON 아님';
    try {
      const j = JSON.parse(body);
      shape = 'JSON ' + Object.keys(j).map(k => {
        const v = j[k];
        return (v === null || typeof v === 'number' || typeof v === 'boolean') ? `${k}=${v}` : `${k}(${typeof v === 'string' ? v.length + '자' : typeof v})`;
      }).join(', ');
    } catch (e) {}
    console.log(`  로그인 요청: HTTP ${login.status()} · ${Date.now() - lt}ms · ${body.length}자 · ${shape}`
      + ` · ${edgeOf(login.headers())} · 표시: ${marksOf(body)}`);
  }

  // 로그인 후 메인 페이지 이동
  await go(page, '첫 화면', `${SITE}`);
  console.log('로그인 요청 끝');

  // 2. 상벌점 전체 내역 페이지
  console.log('상벌점 페이지 로딩...');
  await go(page, '상벌점 페이지',
    `${SITE}/my_page.php?club=index&action=record&Appwin=reload&Class=*45&yy=2026`);

  // 3. HTML 파싱
  console.log('데이터 파싱 중...');
  const students = await page.evaluate(() => {
    const rows = document.querySelectorAll('table.mypage_record_pc tr[align="center"]');
    const result = [];
    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length < 7) return;

      const hakbun = tds[1]?.textContent?.trim();
      if (!hakbun || hakbun.length < 4) return;

      // 학번 파싱: 10101 → 1학년 01반 01번
      const grade = parseInt(hakbun[0]);
      const room  = parseInt(hakbun.slice(1, 3));
      const num   = parseInt(hakbun.slice(3));

      const name     = tds[2]?.textContent?.trim();
      const total    = parseInt(tds[3]?.textContent?.trim()) || 0;
      const merit    = parseInt(tds[4]?.textContent?.trim()) || 0;
      const demerit  = parseInt(tds[5]?.textContent?.trim()) || 0;
      const deducted = parseInt(tds[6]?.textContent?.trim()) || 0;

      // 최근 기록
      const recordEl = row.querySelector('.record-p');
      const records  = [];
      if (recordEl) {
        const labels = recordEl.querySelectorAll('.label-record');
        labels.forEach(label => {
          const date   = label.textContent.trim();
          const span   = label.nextElementSibling;
          const detail = span ? span.textContent.replace(/\s+/g, ' ').trim() : '';
          if (date && detail) records.push({ date, detail });
        });
      }

      if (name) result.push({ hakbun, grade, room, num, name, total, merit, demerit, deducted, records });
    });
    return result;
  });

  console.log(`파싱 완료: ${students.length}명`);
  if (students.length === 0) {
    console.error('학생 데이터가 없습니다. 로그인 실패 또는 페이지 구조 변경 가능성');
    await browser.close();
    process.exit(1);
  }

  // 4. Firestore 저장 (학년별)
  const byGrade = { 1: [], 2: [], 3: [] };
  students.forEach(s => {
    if (byGrade[s.grade]) byGrade[s.grade].push(s);
  });

  const now = new Date().toISOString();
  for (const [grade, list] of Object.entries(byGrade)) {
    await db.collection('riro_points').doc(`grade${grade}`).set({
      students: list,
      updatedAt: now,
      count: list.length,
    });
    console.log(`${grade}학년 ${list.length}명 저장 완료`);
  }
  await db.collection('riro_points').doc('meta').set({
    updatedAt: now,
    total: students.length,
  });

  console.log(`전체 ${students.length}명 저장 완료!`);
  await browser.close();
}

main().catch(e => {
  console.error('오류:', e);
  process.exit(1);
});
