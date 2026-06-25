const admin = require('firebase-admin');

// ── Firebase 초기화 ──────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'ynhs-7b5ba'
});
const db = admin.firestore();

// ── Gemini API 요약 ──────────────────────────────────────
async function summarizeWeekly() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY 없음');

  // Firestore에서 가장 최근 주차 HTML 가져오기
  const indexSnap = await db.collection('weeklyData').doc('index').get();
  if (!indexSnap.exists) throw new Error('주차 목록 없음');

  const weeks = indexSnap.data().weeks || [];
  if (!weeks.length) throw new Error('주차 데이터 없음');

  // 최근 주차 slug로 HTML 가져오기
  const recentWeek = weeks[0];
  const slug = recentWeek.href.split('/202633/').pop().replace(/\//g, '');
  const weekSnap = await db.collection('weeklyData').doc('week-' + slug).get();

  let html = '';
  if (weekSnap.exists) {
    html = weekSnap.data().html || '';
  }

  // HTML 없으면 current 시도
  if (!html) {
    const currentSnap = await db.collection('weeklyData').doc('current').get();
    html = currentSnap.exists ? (currentSnap.data().html || '') : '';
  }

  if (!html) throw new Error('주간활동 HTML 없음');

  // HTML 태그 제거
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);

  const prompt = `다음은 영남고등학교 이번 주 주간교육활동 내용입니다. 담당 교사가 한눈에 파악할 수 있도록 핵심 일정과 업무를 3~5줄로 간결하게 요약해주세요. 날짜와 대상 학년을 포함하고, 불필요한 반복이나 형식적인 말은 빼고 핵심만 써주세요.\n\n${text}`;

  const res = await fetch(
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

  const data = await res.json();
  const summary = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!summary) throw new Error('Gemini 응답 없음: ' + JSON.stringify(data));

  // Firestore 저장
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
