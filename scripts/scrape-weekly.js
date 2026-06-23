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

// ── 페이지에서 내용 추출 (HTML 보존 방식) ─────────────────────────
async function extractContent(page) {
  return await page.evaluate(() => {
    // 노드 및 조상을 타고 올라가며 인라인 스타일을 직접 읽어 합산
    // (구글 사이트는 getComputedStyle이 아닌 인라인 style 속성에 서식이 들어있음)
    function extractAllowedStyle(el) {
      const PROPS = [
        ['color',          'color'],
        ['fontWeight',     'font-weight'],
        ['fontStyle',      'font-style'],
        ['textDecoration', 'text-decoration'],
        ['fontSize',       'font-size'],
        ['fontFamily',     'font-family'],
        ['letterSpacing',  'letter-spacing'],
        ['textAlign',      'text-align'],
      ];
      const seen = new Set();
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body) {
        const s = cur.style;
        for (const [jsKey, cssKey] of PROPS) {
          if (seen.has(cssKey)) continue;
          const val = s[jsKey];
          if (!val || val === 'normal' || val === 'none' || val === 'auto') continue;
          // 기본 검정색은 생략
          if (cssKey === 'color' && (val === 'rgb(0, 0, 0)' || val === '#000000' || val === '#000')) continue;
          seen.add(cssKey);
          parts.push(`${cssKey}:${val}`);
        }
        cur = cur.parentElement;
      }
      return parts.join(';');
    }

    // 엘리먼트를 안전한 HTML 문자열로 직렬화
    // 허용 태그만 유지하고, href는 절대 URL로 고정, 스타일은 필터링
    function sanitizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      const ALLOWED_TAGS = new Set(['a','b','strong','i','em','u','s','br','span','p','ul','ol','li','div']);
      const BLOCK_TAGS   = new Set(['p','ul','ol','li','div','br']);

      // 허용되지 않은 태그 → 자식만 재귀 처리
      if (!ALLOWED_TAGS.has(tag)) {
        return Array.from(node.childNodes).map(sanitizeNode).join('');
      }

      const style = extractAllowedStyle(node);
      let attrs = style ? ` style="${style}"` : '';

      if (tag === 'a') {
        const href = node.href || '';  // 이미 절대 URL
        if (href && (href.startsWith('http') || href.startsWith('mailto'))) {
          attrs += ` href="${href.replace(/"/g,'&quot;')}" target="_blank" rel="noopener"`;
        } else {
          // 유효하지 않은 링크는 span으로 강등
          const inner = Array.from(node.childNodes).map(sanitizeNode).join('');
          return `<span${attrs}>${inner}</span>`;
        }
      }

      if (tag === 'br') return '<br>';

      const inner = Array.from(node.childNodes).map(sanitizeNode).join('');
      if (!inner.trim()) return '';  // 빈 블록 제거

      return `<${tag}${attrs}>${inner}</${tag}>`;
    }

    // ── 제목 추출 ──
    const titleEl = document.querySelector('h1, [role="heading"][aria-level="1"]');
    const title = titleEl ? titleEl.textContent.trim() : '';

    // ── 섹션 구분 헬퍼 ──
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

    const SKIP = ['Skip to', 'Report abuse', 'Page details', '이 사이트 검색', 'Google Sites'];

    // ── DOM 순회 (리프 노드 기준) ──
    const sections = [];
    let currentSection = null;
    let currentItem = null;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName?.toLowerCase();
      if (['script','style','nav','header','footer'].includes(tag)) continue;
      const text = node.textContent.trim();
      if (!text || text.length < 2) continue;
      if (SKIP.some(s => text.startsWith(s))) continue;
      if (node.children.length > 0) continue;  // 리프만 처리

      const isH2 = tag === 'h2' || node.getAttribute?.('aria-level') === '2';
      const isH3 = tag === 'h3' || node.getAttribute?.('aria-level') === '3';

      if (isH2 || isDept(text)) {
        currentSection = { title: text, titleHtml: sanitizeNode(node), items: [] };
        sections.push(currentSection);
        currentItem = null;
      } else if (isH3 || isItem(text)) {
        if (!currentSection) { currentSection = { title: '공지', titleHtml: '공지', items: [] }; sections.push(currentSection); }
        currentItem = { title: text, titleHtml: sanitizeNode(node), lines: [] };
        currentSection.items.push(currentItem);
      } else if (text.length >= 2) {
        if (!currentSection) continue;
        if (!currentItem) {
          currentItem = { title: '', titleHtml: '', lines: [] };
          currentSection.items.push(currentItem);
        }
        // 링크가 있는 노드는 부모까지 올라가서 HTML 보존
        const parentA = node.closest('a');
        if (parentA) {
          currentItem.lines.push(sanitizeNode(parentA));
        } else {
          currentItem.lines.push(sanitizeNode(node));
        }
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
