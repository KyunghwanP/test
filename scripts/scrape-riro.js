// scripts/scrape-riro.js
// 리로스쿨 상벌점 스크래퍼 → Firestore 저장

import { chromium } from 'playwright';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const RIRO_ID = process.env.RIRO_ID;
const RIRO_PW = process.env.RIRO_PW;
const SITE    = 'https://yeungnam.riroschool.kr';

// Firebase 초기화
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  // 1. 로그인
  console.log('리로스쿨 로그인 중...');
  const loginRes = await page.request.post(`${SITE}/ajax.php`, {
    form: {
      app:      'user',
      mode:     'login',
      userType: '1',
      id:       RIRO_ID,
      pw:       RIRO_PW,
    }
  });
  const cookies = await context.cookies();
  console.log('로그인 완료. 쿠키 수:', cookies.length);

  // 2. 상벌점 전체 내역 페이지
  console.log('상벌점 페이지 로딩...');
  await page.goto(
    `${SITE}/my_page.php?club=index&action=record&Appwin=reload&db=&cate=&uid=&calendar_type=&my_id=&year=&sort=&sdate=&Group=&mode=&Class=*45&my_id=&Group=&yy=2026&mm=&dd=`,
    { waitUntil: 'domcontentloaded', timeout: 30000 }
  );

  // 3. HTML 파싱
  console.log('데이터 파싱 중...');
  const students = await page.evaluate(() => {
    const rows = document.querySelectorAll('table.mypage_record_pc tr[align="center"]');
    const result = [];
    rows.forEach(row => {
      const tds = row.querySelectorAll('td');
      if (tds.length < 7) return;

      const hakbun = tds[1]?.textContent?.trim(); // ex) 10101
      if (!hakbun || hakbun.length < 4) return;

      // 학번 파싱: 10101 → 1학년 1반 01번
      const grade = parseInt(hakbun[0]);
      const room  = parseInt(hakbun.slice(1, 3));
      const num   = parseInt(hakbun.slice(3));

      const name     = tds[2]?.textContent?.trim();
      const total    = parseInt(tds[3]?.textContent?.trim()) || 0;
      const merit    = parseInt(tds[4]?.textContent?.trim()) || 0;
      const demerit  = parseInt(tds[5]?.textContent?.trim()) || 0;
      const deducted = parseInt(tds[6]?.textContent?.trim()) || 0;

      // 최근 기록 파싱
      const recordEl = row.querySelector('.record-p');
      const records  = [];
      if (recordEl) {
        const labels = recordEl.querySelectorAll('.label-record');
        labels.forEach(label => {
          const date   = label.textContent.trim();
          const detail = label.nextElementSibling?.textContent
            ?.replace(/<[^>]+>/g, '')
            ?.trim() || '';
          records.push({ date, detail });
        });
      }

      result.push({ hakbun, grade, room, num, name, total, merit, demerit, deducted, records });
    });
    return result;
  });

  console.log(`파싱 완료: ${students.length}명`);

  // 4. Firestore 저장
  // 학년별로 분리 저장
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

  console.log('모든 저장 완료!');
  await browser.close();
}

main().catch(e => {
  console.error('오류:', e);
  process.exit(1);
});
