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
  if (html.length < 100) throw new Error('HTML 너무 짧음');

  // 3) HTML 태그 제거 후 텍스트 추출
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);

  // 4) Gemini 요약
  console.log('🤖 Gemini 요약 중...');
  const prompt = `다음은 영남고등학교 이번 주 주간교육활동 내용입니다. 담당 교사가 한눈에 파악할 수 있도록 핵심 일정과 업무를 3~5줄로 간결하게 요약해주세요. 날짜와 대상 학년을 포함하고, 불필요한 반복이나 형식적인 말은 빼고 핵심만 써주세요.\n\n${text}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.3 }
      }),
      signal: AbortSignal.timeout(20000)
    }
  );
  const data = await geminiRes.json();
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
