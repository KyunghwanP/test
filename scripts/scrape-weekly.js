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
    // 1) 메인 페이지 로드
    console.log('📡 구글 사이트 접속 중...');
    await page.goto(SITES_BASE, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2) 주차 네비게이션 링크 추출
    console.log('🗂  주차 목록 추출 중...');
    const weekLinks = await page.evaluate(() => {
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
    });
    console.log(`  → 주차 ${weekLinks.length}개 발견`);

    // 3) 현재 주차 내용 추출
    console.log('📄 현재 주차 내용 추출 중...');
    const contentData = await extractContent(page, SITES_BASE);

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
    await db.collection('weeklyData').doc('current').set({
      ...contentData,
      sourceUrl: SITES_BASE,
      fetchedAt: now
    });
    console.log('  → 현재 주차 내용 저장 완료');

    // 5) 최근 2개 주차 내용 저장
    for (let i = 0; i < Math.min(2, weekLinks.length); i++) {
      const link = weekLinks[i];
      const weekSlug = link.href.split('/202633/').pop().replace(/\//g, '');
      if (!weekSlug) continue;

      console.log(`📄 주차 내용 저장: ${link.text}`);
      try {
        await page.goto(link.href, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForTimeout(1500);
        const weekContent = await extractContent(page, link.href);
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

// ── 페이지 본문 HTML 통째로 추출 후 정제 ────────────────────────────
// 구글 사이트의 렌더링된 DOM에서 본문 컨테이너를 통째로 가져오고,
// 구글 전용 클래스/속성/불필요한 태그만 제거해 저장합니다.
async function extractContent(page, sourceUrl) {
  return await page.evaluate((srcUrl) => {

    // ── 제목 추출 ──
    const titleEl = document.querySelector('h1, [role="heading"][aria-level="1"]');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // ── 본문 컨테이너 탐색 ──
    // 구글 사이트는 JS 렌더링 후 본문이 여러 div에 나뉘어 들어감
    // 텍스트가 가장 많은 div를 본문으로 간주 (네비/헤더/푸터 제외)
    let main = null;
    let maxLen = 0;
    document.querySelectorAll('div, section, article, main').forEach(el => {
      if (el.closest('nav, header, footer, [role="navigation"]')) return;
      const len = el.textContent.trim().length;
      if (len > maxLen) { maxLen = len; main = el; }
    });
    if (!main || maxLen < 100) main = document.body;

    // ── 불필요한 요소 제거 (원본 DOM 건드리지 않도록 clone) ──
    const clone = main.cloneNode(true);

    // 제거할 요소들: 네비게이션, 헤더, 검색, 앵커 전용 링크, 신고 버튼 등
    const REMOVE_SELECTORS = [
      'nav', 'header', 'footer',
      'script', 'style', 'noscript',
      '[role="navigation"]',
      '[role="search"]',
      '[aria-label="Site actions"]',
      // 구글 사이트 앵커 링크 (#h.xxx 형태) - 아이콘만 있는 링크
      'a[href^="#"]',
    ];
    REMOVE_SELECTORS.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    // "Report abuse", "Page details", "Skip to" 텍스트만 있는 요소 제거
    const SKIP_TEXTS = ['Report abuse', 'Page details', 'Page updated', 'Skip to main content', 'Skip to navigation', 'Search this site'];
    clone.querySelectorAll('*').forEach(el => {
      if (el.children.length === 0) {
        const t = el.textContent.trim();
        if (SKIP_TEXTS.some(s => t === s || t.startsWith(s))) {
          el.closest('div, p, span, li') ? el.closest('div, p, span, li').remove() : el.remove();
        }
      }
    });

    // ── 속성 정제: 허용 속성만 남기고 나머지 제거 ──
    // href, target, rel, style만 허용. class/id/data-* 등 구글 전용 속성 제거
    function cleanAttrs(el) {
      const ALLOWED_ATTRS = new Set(['href', 'target', 'rel', 'style', 'src', 'alt']);
      Array.from(el.attributes).forEach(attr => {
        if (!ALLOWED_ATTRS.has(attr.name)) el.removeAttribute(attr.name);
      });

      // style에서 배경색, 레이아웃 관련 속성 제거, 텍스트 서식만 남김
      if (el.style) {
        const REMOVE_STYLE_PROPS = [
          'background', 'background-color', 'background-image',
          'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
          'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
          'width', 'height', 'max-width', 'min-width',
          'display', 'position', 'top', 'left', 'right', 'bottom',
          'float', 'clear', 'overflow', 'z-index',
          'border', 'border-radius', 'box-shadow',
          'line-height', 'list-style',
        ];
        REMOVE_STYLE_PROPS.forEach(prop => el.style.removeProperty(prop));
      }

      // 링크: 외부 URL만 허용, 구글 내부 앵커/추적 링크는 텍스트로 강등
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.includes('google.com/url?')) {
          // 앵커 or 추적 링크 → span으로 교체
          const span = document.createElement('span');
          span.innerHTML = el.innerHTML;
          el.replaceWith(span);
          return; // replaceWith 후엔 el이 DOM에서 사라지므로 children 처리 불필요
        }
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }

      // 재귀적으로 자식도 처리
      Array.from(el.children).forEach(cleanAttrs);
    }
    cleanAttrs(clone);

    // ── 빈 블록 요소 제거 (여러 번 반복해서 중첩 빈 div도 제거) ──
    for (let pass = 0; pass < 3; pass++) {
      clone.querySelectorAll('div, p, span, li').forEach(el => {
        if (!el.textContent.trim() && !el.querySelector('img, br')) el.remove();
      });
    }

    // ── 최종 HTML 반환 ──
    return {
      title,
      html: clone.innerHTML,
    };

  }, sourceUrl);
}

main().catch(err => {
  console.error('❌ 오류:', err);
  process.exit(1);
});
