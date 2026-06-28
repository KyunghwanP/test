const { chromium } = require('@playwright/test');
const admin = require('firebase-admin');
const { google } = require('googleapis');

// ── Firebase 초기화 ──────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'ynhs-7b5ba'
});
const db = admin.firestore();

const SITES_BASE = 'https://sites.google.com/yeungnam.hs.kr/202633';
const SCHEDULE_SHEET_ID = '1dWQEv1xgl4AGillRWPfUkJAb0cM3ChLHEC0uiIwRpB4';

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
        const wait = delayMs * attempt; // 점증 백오프 (3s, 6s, 9s)
        console.log(`     ${wait/1000}초 후 재시도...`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ── Google Sheets 인증 (서비스 계정) ──────────────────────
// 인증 클라이언트를 미리 만들어 토큰을 명시적으로 확보해 둔다.
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  // 토큰을 미리 발급받아 둔다 (여기서 Premature close가 나면 재시도로 흡수)
  const client = await auth.getClient();
  await withRetry('토큰 발급', () => client.getAccessToken());
  return google.sheets({ version: 'v4', auth: client });
}

// ── 학사일정 읽기 ─────────────────────────────────────────
async function fetchSchedule() {
  console.log('📅 학사일정 읽는 중...');

  // 인증 + 토큰 확보까지 재시도로 감쌈
  const sheets = await withRetry('Sheets 인증', () => getSheetsClient());

  // 시트 목록 가져오기 (재시도)
  const meta = await withRetry('시트 목록 조회', () =>
    sheets.spreadsheets.get({ spreadsheetId: SCHEDULE_SHEET_ID })
  );
  const sheetList = meta.data.sheets.map(s => s.properties.title);
  console.log(`  → 시트 ${sheetList.length}개: ${sheetList.join(', ')}`);

  const result = {}; // { '2026년 7월': [{date, day, content}], ... }

  for (const sheetName of sheetList) {
    try {
      const res = await withRetry(`${sheetName} 읽기`, () =>
        sheets.spreadsheets.values.get({
          spreadsheetId: SCHEDULE_SHEET_ID,
          range: `'${sheetName}'!A1:E50`,
        })
      );
      const rows = res.data.values || [];

      // 월 이름 추출 (시트명에서)
      const monthMatch = sheetName.match(/(\d+)월/);
      const month = monthMatch ? parseInt(monthMatch[1]) : null;
      const yearMatch = sheetName.match(/(\d{4})/);
      const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      if (!month) continue;

      // 현재 파싱 중인 월 (헤더 감지 시 변경될 수 있음)
      let curMonth = month;
      const eventsByMonth = {}; // { month: [events] }

      for (const row of rows) {
        const cellD = String(row[3] || '').trim();

        // D열에 'X월 교육활동 내용' 헤더가 나오면 파싱 월 변경
        const headerMatch = cellD.match(/^(\d+)월\s*교육활동/);
        if (headerMatch) {
          curMonth = parseInt(headerMatch[1]);
          continue;
        }

        // B열(1): 날짜
        const cellB = String(row[1] || '').trim();
        let date = null;
        if (/^\d{1,2}$/.test(cellB) && parseInt(cellB) >= 1 && parseInt(cellB) <= 31) {
          date = parseInt(cellB);
        }
        // C열(2): 요일
        const cellC = String(row[2] || '').trim();
        const day = /^[월화수목금토일]$/.test(cellC) ? cellC : '';

        // D열(3): 교육활동 내용 (이름 패턴 제외)
        let evContent = '';
        if (cellD.length >= 2 && !/^[①②③ㆍ]/.test(cellD) && !/^[가-힣]{2,4}$/.test(cellD)) {
          evContent = cellD;
        }

        if (date && evContent) {
          const lastDay = new Date(year, curMonth, 0).getDate();
          if (date <= lastDay) {
            const key = curMonth;
            if (!eventsByMonth[key]) eventsByMonth[key] = [];
            eventsByMonth[key].push({ date, day, content: evContent });
          }
        }
      }

      // 각 월별로 result에 저장
      for (const [m, evs] of Object.entries(eventsByMonth)) {
        if (evs.length > 0) {
          const key = `${year}-${String(m).padStart(2,'0')}`;
          if (!result[key]) result[key] = [];
          // 중복 제거 후 병합
          const existing = new Set(result[key].map(e => e.date + '-' + e.content));
          evs.forEach(e => {
            if (!existing.has(e.date + '-' + e.content)) result[key].push(e);
          });
          console.log(`  → ${sheetName} → ${key}: ${evs.length}개 일정`);
        }
      }
    } catch(e) {
      console.warn(`  ⚠️  ${sheetName} 읽기 최종 실패:`, e.message);
    }
  }

  return result;
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
    await page.waitForTimeout(2000); // JS 렌더링 여유 시간

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

    // 3) Firestore에 저장
    console.log('☁️  Firestore 저장 중...');
    const now = new Date().toISOString();

    // 주차 목록 저장
    await db.collection('weeklyData').doc('index').set({
      weeks: weekLinks.slice(0, 20),
      updatedAt: now
    });
    console.log('  → 주차 목록 저장 완료');

    // 4) 학사일정 읽기 및 저장 (전체를 재시도로 감쌈)
    try {
      const schedule = await fetchSchedule();
      // 저장도 재시도
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
