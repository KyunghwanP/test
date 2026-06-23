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

    // 3) 현재 주차 내용 추출
    console.log('📄 현재 주차 내용 추출 중...');
    const contentData = await extractContent(page);

    // 4) Firestore에 저장
    console.log('☁️  Firestore 저장 중...');
    const now = new Date().toISOString();

    // 주차 목록 저장
    await db.collection('weeklyData').doc('index').set({
      weeks: weekLinks.slice(0, 20),
      updatedAt: now
    });
    console.log('  → 주차 목록 저장 완료');

    // 현재 주차 내용 저장
    const slug = 'current';
    await db.collection('weeklyData').doc(slug).set({
      ...contentData,
      sourceUrl: SITES_BASE,
      fetchedAt: now
    });
    console.log('  → 현재 주차 내용 저장 완료');

    // 5) 최근 2개 주차 내용도 저장 (링크가 있을 경우)
    for (let i = 0; i < Math.min(2, weekLinks.length); i++) {
      const link = weekLinks[i];
      const weekSlug = link.href.split('/202633/').pop().replace(/\//g, '');
      if (!weekSlug) continue;

      console.log(`📄 주차 내용 저장: ${link.text}`);
      try {
        await page.goto(link.href, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(1500);
        const weekContent = await extractContent(page);
        await db.collection('weeklyData').doc('week-' + weekSlug).set({
          ...weekContent,
          weekText: link.text,
          sourceUrl: link.href,
          fetchedAt: now
        });
      } catch(e) {
        console.warn(`  ⚠️  ${link.text} 저장 실패:`, e.message);
      }
    }

    console.log('✅ 완료!');

  } finally {
    await browser.close();
    process.exit(0);
  }
}

// ── 페이지에서 내용 추출 ──────────────────────────────────
async function extractContent(page) {
  return await page.evaluate(() => {
    // 제목 추출
    const titleEl = document.querySelector('h1, [role="heading"][aria-level="1"]');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // 섹션별(부서별) 내용 추출
    const sections = [];
    let currentSection = null;
    let currentItem = null;

    const DEPT_SUFFIXES = ['부', '실', '팀'];
    const DEPT_KEYWORDS = ['교감', '교장', '행정', '사감'];

    function isDept(text) {
      if (text.length > 20 || text.length < 2) return false;
      if (DEPT_KEYWORDS.some(k => text.includes(k))) return true;
      return DEPT_SUFFIXES.some(s => text.endsWith(s));
    }
    function isItem(text) {
      return /^(0\d|1\d|2\d)_/.test(text) || /^♥/.test(text);
    }

    // 모든 텍스트 노드를 순서대로 순회
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT
    );

    const SKIP = ['Skip to', 'Report abuse', 'Page details', '이 사이트 검색', 'Google Sites'];
    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName?.toLowerCase();
      if (['script', 'style', 'nav', 'header', 'footer'].includes(tag)) continue;
      const text = node.textContent.trim();
      if (!text || text.length < 2) continue;
      if (SKIP.some(s => text.startsWith(s))) continue;
      // 자식이 있는 경우 자식에서 처리
      if (node.children.length > 0) continue;

      const isH2 = tag === 'h2' || (node.getAttribute?.('aria-level') === '2');
      const isH3 = tag === 'h3' || (node.getAttribute?.('aria-level') === '3');

      if (isH2 || isDept(text)) {
        currentSection = { title: text, items: [] };
        sections.push(currentSection);
        currentItem = null;
      } else if (isH3 || isItem(text)) {
        if (!currentSection) { currentSection = { title: '공지', items: [] }; sections.push(currentSection); }
        currentItem = { title: text, lines: [] };
        currentSection.items.push(currentItem);
      } else if (text.length >= 2) {
        // ✅ 수정: return → continue (조기 종료 버그 수정)
        if (!currentSection) continue;
        if (!currentItem) {
          currentItem = { title: '', lines: [] };
          currentSection.items.push(currentItem);
        }
        currentItem.lines.push(text);
      }
    }

    return {
      title,
      sections: sections.filter(s => s.items.length > 0)
    };
  });
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
