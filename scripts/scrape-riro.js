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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  // 1. 로그인
  console.log('리로스쿨 로그인 중...');
  await page.goto(`${SITE}/user.php?action=signin`, { waitUntil: 'domcontentloaded' });
  await page.request.post(`${SITE}/ajax.php`, {
    form: {
      app:      'user',
      mode:     'login',
      userType: '1',
      id:       RIRO_ID,
      pw:       RIRO_PW,
    }
  });

  // 로그인 후 메인 페이지 이동
  await page.goto(`${SITE}`, { waitUntil: 'domcontentloaded' });
  console.log('로그인 완료');

  // 2. 상벌점 전체 내역 페이지
  console.log('상벌점 페이지 로딩...');
  await page.goto(
    `${SITE}/my_page.php?club=index&action=record&Appwin=reload&Class=*45&yy=2026`,
    { waitUntil: 'domcontentloaded', timeout: 60000 }
  );

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
