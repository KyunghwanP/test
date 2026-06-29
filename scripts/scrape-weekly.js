const { chromium } = require('@playwright/test');
const admin = require('firebase-admin');

// ── Firebase 초기화 ──────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'ynhs-7b5ba'
});
const db = admin.firestore();

const SITES_BASE = 'https://sites.google.com/yeungnam.hs.kr/202633';

// GAS 웹앱 URL (상벌점/주간요약과 동일한 프로젝트)
const GAS_URL = 'https://script.google.com/macros/s/AKfycbyLEakkCuV36RSsqg6NxGXhCeXe8OQP4tPb2d4Lzuy6yxML9caVY02st-fxT0xrO0C0YA/exec';

// ── 공용: 재시도 헬퍼 ─────────────────────────────────────
async function withRetry(label, fn, retries = 4, delayMs = 3000) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.warn(`  ⚠️  ${label} 시도 ${attempt}/${retries} 실패: ${e.message}`);
      if (attempt < retries) {
        const wait = delayMs * attempt;
        console.log(`     ${wait/1000}초 후 재시도...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ── 학사일정 읽기 (GAS 경유) ──────────────────────────────
// GAS가 구글 내부에서 시트를 읽어 JSON으로 돌려준다.
// → GitHub 러너에서 구글 OAuth 토큰을 받을 필요가 없어
//   'Premature close' 문제가 원천적으로 사라진다.
async function fetchSchedule() {
  console.log('📅 학사일정 읽는 중 (GAS 경유)...');

  const json = await withRetry('GAS 학사일정 호출', async () => {
    const res = await fetch(GAS_URL + '?action=getSchedule', {
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.success) throw new Error('GAS 오류: ' + (data.error || '알 수 없음'));
    return data.data || {};
  });

  // 월별 개수 로그
  const months = Object.keys(json);
  if (months.length === 0) {
    console.log('  → 학사일정 데이터 없음');
  } else {
    months.forEach(k => console.log(`  → ${k}: ${json[k].length}개 일정`));
  }
  return json;
}

// ── 메인 실행 ────────────────────────────────────────────
async function main() {
  console.log('🚀 스크래핑 시작:', new Date().toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}));

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    // 1) 메인 페이지 로드 (JS 실행 포함)
    console.log('📡 구글 사이트 접속 중...');
    await page.goto(SITES_BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2) 주차 네비게이션 링크 추출
    console.log('🗂  주차 목록 추출 중...');
    const weekLinks = await page.evaluate((base) => {
      const links = [];
      const seen = new Set();
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || '';
        if (!href.includes('/202633/') || seen.has(href)) return;
        const text = a.textContent.trim();
        if (!text || text.length > 30) return;
        seen.add(href);
        links.push({ text, href });
      });
      return links;
    }, SITES_BASE);

    console.log(`  → 주차 ${weekLinks.length}개 발견`);

    // 3) Firestore에 주차 목록 저장
    console.log('☁️  Firestore 저장 중...');
    const now = new Date().toISOString();

    await db.collection('weeklyData').doc('index').set({
      weeks: weekLinks.slice(0, 20),
      updatedAt: now
    });
    console.log('  → 주차 목록 저장 완료');

    // 4) 학사일정 (GAS 경유) 읽기 및 저장
    try {
      const schedule = await fetchSchedule();
      await withRetry('학사일정 저장', () =>
        db.collection('schedule').doc('main').set({
          data: schedule,
          updatedAt: now
        })
      );
      console.log('  → 학사일정 저장 완료');
    } catch(e) {
      console.warn('  ⚠️  학사일정 저장 최종 실패:', e.message);
    }

    console.log('✅ 완료!');

  } finally {
    await browser.close();
    process.exit(0);
  }
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
