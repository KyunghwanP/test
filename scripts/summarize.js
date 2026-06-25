const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'ynhs-7b5ba'
});
const db = admin.firestore();

const APPS_SCRIPT_PROXY = 'https://script.google.com/macros/s/AKfycbxVT4Z20BvZ9DUwLH79h3_5LhJCazcPOJ3lAWNi1Z_WkwjvOXsomWrs242wpiPUokmbXA/exec';
const SITES_BASE = 'https://sites.google.com/yeungnam.hs.kr/202633';

async function summarizeWeekly() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 없음');

  // 1) 최신 주차 목록 가져오기
  const indexSnap = await db.collection('weeklyData').doc('index').get();
  if (!indexSnap.exists) throw new Error('주차 목록 없음');
  const weeks = indexSnap.data().weeks || [];
  if (!weeks.length) throw new Error('주차 데이터 없음');

  // 2) 최신 주차 URL로 Apps Script 프록시 통해 HTML 가져오기
  const recentWeek = weeks[0];
  const url = recentWeek.href || SITES_BASE;
  console.log(`📄 주간활동 fetch: ${recentWeek.text} (${url})`);

  const res = await fetch(`${APPS_SCRIPT_PROXY}?url=${encodeURIComponent(url)}`,
    { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('프록시 fetch 실패: ' + res.status);
  const html = await res.text();

  // 디버그: HTML 내용 확인
  console.log(`  → HTML 길이: ${html.length}자`);
  console.log(`  → HTML 앞 500자:\n${html.slice(0, 500)}`);

  if (html.length < 100) throw new Error('HTML 너무 짧음');

  // 3) HTML 태그 제거 후 텍스트 추출
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
  console.log(`  → 추출 텍스트 길이: ${text.length}자`);
  console.log(`  → 텍스트 앞 300자:\n${text.slice(0, 300)}`);

  // 4) Gemini 요약 (503 등 일시 오류 시 최대 5회 재시도)
  console.log('🤖 Gemini 요약 중...');
  const prompt = `다음은 영남고등학교 이번 주 주간교육활동 내용입니다.
담당 교사가 한눈에 파악할 수 있도록 핵심 일정과 업무를 5~8줄로 요약하세요.

규칙:
- 요약한 내용만 출력하세요. 인사말, "요약입니다", "다음과 같습니다" 같은 말 절대 금지
- 날짜와 대상 학년을 반드시 포함
- 중요한 행사, 시험, 제출 마감, 학년별 주요 일정 위주로
- 줄바꿈으로 항목 구분
- 불필요한 반복 금지

주간교육활동 내용:
${text}`;

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const GEMINI_BODY = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2000, temperature: 0.3, responseMimeType: "text/plain" }
  });

  let data;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: GEMINI_BODY,
      signal: AbortSignal.timeout(30000)
    });
    data = await geminiRes.json();
    if (geminiRes.ok) break;

    const code = data?.error?.code;
    const retryable = [429, 500, 503].includes(code);
    console.warn(`  ⚠️  Gemini ${code} (시도 ${attempt}/5)`);
    if (!retryable || attempt === 5) throw new Error('Gemini 응답 없음: ' + JSON.stringify(data));

    const wait = attempt * 10;
    console.log(`  ⏳ ${wait}초 후 재시도...`);
    await new Promise(r => setTimeout(r, wait * 1000));
  }

  const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!summary) throw new Error('Gemini 응답 없음: ' + JSON.stringify(data));

  // 5) Firestore 저장
  await db.collection('weeklyData').doc('summary').set({
    summary,
    weekText: recentWeek.text,
    updatedAt: new Date().toISOString()
  });

  console.log('✅ AI 요약 저장 완료');
  console.log(summary);
}

summarizeWeekly()
  .catch(err => {
    console.error('❌ 오류:', err.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
