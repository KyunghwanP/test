// 날씨 자동 갱신 — GitHub Actions에서 30분마다 실행
// Open-Meteo를 GitHub 러너 IP로 호출해 Firestore appdata/weather에 저장.
// 학교 공인 IP가 Open-Meteo에 rate limit 걸려도 앱에서는 이 공유 캐시로 날씨가 뜬다.
// (index.html의 fetchWeather()가 로컬캐시 → appdata/weather → 직접 호출 순으로 조회)
const admin = require('firebase-admin');

// ── Firebase 초기화 ──────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'ynhs-7b5ba'
});
const db = admin.firestore();

const URL = 'https://api.open-meteo.com/v1/forecast?latitude=35.87&longitude=128.60' +
  '&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m' +
  '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
  '&timezone=Asia%2FSeoul&forecast_days=7';

async function fetchWithRetry(retries = 3, delayMs = 5000) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(URL, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn(`⚠️ Open-Meteo 시도 ${attempt}/${retries} 실패: ${e.message}`);
      if (attempt < retries) await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
  throw lastErr;
}

(async () => {
  console.log('🌤 Open-Meteo 호출 중 (GitHub 러너 IP)...');
  const data = await fetchWithRetry();
  if (!data.current || !data.daily) throw new Error('응답 형식 이상: ' + JSON.stringify(data).slice(0, 200));

  await db.doc('appdata/weather').set({
    t: Date.now(),
    data,
    src: 'actions'
  });
  console.log(`✅ appdata/weather 저장 완료 — 현재 ${data.current.temperature_2m}°C (${new Date().toISOString()})`);
  process.exit(0);
})().catch(e => {
  console.error('❌ 실패:', e.message);
  process.exit(1);
});
