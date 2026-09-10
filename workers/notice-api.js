/**
 * 공지 API — Cloudflare Worker
 * ============================================================================
 * 현황판 전체 공지의 '이미지'만 담는다. 글(본문 HTML)은 Firestore 의
 * appNotice 문서에 그대로 들어가고, 여기로는 오지 않는다.
 *
 * 왜 워커를 또 파나
 *  teacher-api 에 얹으면 공지를 고치려고 배포했다가 학생 사진이 죽을 수 있다.
 *  그 워커는 손으로 배포하고 되돌릴 길이 붙여넣기뿐이다. 같은 이유로 이미
 *  consult-api / teacher-api 를 나눠 두었고, 이번에도 같은 선택을 한다.
 *  대가로 공통 코드(토큰 검증·CORS) 약 60줄이 또 중복된다. 앞의 둘과 달리
 *  서비스 계정·Firestore 쪽은 아예 안 들고 왔다 — 이 워커는 Firestore 를
 *  건드리지 않으므로 서명 코드도, SA_JSON 도 필요 없다.
 *
 * 왜 이미지를 Firestore 에 안 넣나
 *  넣을 수는 있다(학생 사진의 작은 쪽이 그렇게 들어간다). 그런데 문서 하나가
 *  1MiB 를 못 넘고, 무엇보다 현황판은 모든 교사가 매번 연다 — 공지에 그림이
 *  있으면 그 용량을 매번 다 받는다. R2 에 두면 문서는 글자 몇 KB 로 남고
 *  그림은 따로 받아 브라우저가 하루치 캐시한다.
 *
 * 담당
 *  · GET  /img?k=<key>              공지 이미지 내려주기 (교사면 누구나)
 *  · POST {action:'put'}            이미지 올리기 (관리자만) → { key }
 *  · POST {action:'del'}            이미지 지우기 (관리자만)
 *  · POST {action:'sweep'}          문서에 안 쓰이는 이미지 청소 (관리자만)
 *
 * 지우는 경로를 왜 처음부터 두나
 *  공지를 고치거나 지우면 R2 파일은 저절로 사라지지 않는다. 나중에 붙이면
 *  그때까지 쌓인 것을 손으로 치워야 한다. 용량이 넉넉해 티가 안 나는 것이
 *  오히려 함정이다.
 *
 * 필요한 변수 (대시보드 Settings → Variables and Secrets)
 *  · ALLOWED_ORIGINS : 쉼표 구분 허용 Origin. 예) https://kyunghwanp.github.io
 *  · FIREBASE_API_KEY: 교사 토큰 검증용. index.html 에 이미 공개된 값이다.
 *  · NOTICES         : R2 버킷 바인딩. 없으면 이미지 기능이 꺼진다(글은 뜬다).
 *  서비스 계정 키(SA_JSON)는 필요 없다 — Firestore 를 워커가 안 건드린다.
 */

const ADMIN_EMAIL = 'pkh910518@yeungnam.hs.kr';

// 표준 base64(dataURL 본문) → Uint8Array
function bytesFromB64(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const nowSec = () => Math.floor(Date.now() / 1000);

// ── 교사 인증 ────────────────────────────────────────────────────────────────
// 토큰 검증 결과를 잠깐 재사용한다. 공지에 그림이 여럿이면 화면이 한꺼번에
// 여러 장을 받는데, 장마다 Identity Toolkit 왕복이 붙으면 그만큼 늦어진다.
const _teacherCache = new Map();   // idToken → { who, exp }
const TEACHER_TTL = 120;           // 초

// 교사 Firebase ID 토큰 검증 → { email, admin } / 실패면 null
async function verifyTeacher(env, idToken) {
  if (!idToken || !env.FIREBASE_API_KEY) return null;
  const hit = _teacherCache.get(idToken);
  if (hit && hit.exp > nowSec()) return hit.who;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }) });
  if (!res.ok) return null;
  const u = ((await res.json()).users || [])[0];
  const email = String(u && u.email || '').toLowerCase();
  if (!u || !u.emailVerified || !email.endsWith('@yeungnam.hs.kr')) return null;
  if (/^[0-9]{7}@yeungnam\.hs\.kr$/.test(email)) return null;    // 학생 계정 제외
  // uid 는 반드시 여기서만 꺼낸다. 요청 본문에 적힌 값을 믿으면 남의 칸에
  // 쓰거나 남의 칸을 청소할 수 있다 — 캘린더 그림의 담이 바로 이 한 줄이다.
  const uid = String(u.localId || '');
  if (!SAFE.test(uid)) return null;
  const who = { email, uid,
                admin: email === String(env.ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase() };
  if (_teacherCache.size > 200) _teacherCache.clear();
  _teacherCache.set(idToken, { who, exp: nowSec() + TEACHER_TTL });
  return who;
}

// Authorization: Bearer <idToken> 에서 뽑아 검증
async function whoFromHeader(env, request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  return verifyTeacher(env, m ? m[1] : '');
}

// ── 공지 이미지 (R2) ─────────────────────────────────────────────────────────
// 키는 배포별로 가른다. test 와 운영이 같은 버킷을 봐도 서로 섞이지 않게.
//   notices/<배포>/<공지id>/<파일id>.jpg
// 바깥에서 받은 문자열을 그대로 경로에 쓰면 '../' 로 남의 자리를 건드릴 수 있다.
// 글자 종류를 좁혀서 애초에 그런 문자가 못 들어오게 한다.
const SAFE = /^[A-Za-z0-9_-]{1,40}$/;
const safe = v => SAFE.test(String(v || ''));

// 공지 그림 — notices/<배포>/<공지id>/<파일id>.jpg
function noticeKey(scope, noticeId, fileId) {
  if (!safe(scope) || !safe(noticeId) || !safe(fileId)) return null;
  return `notices/${scope}/${noticeId}/${fileId}.jpg`;
}
// 업무캘린더 메모 그림 — tasks/<배포>/<올린이uid>/<일정id>/<파일id>.jpg
// uid 칸이 한 칸 더 있는 것이 요점이다. 교사 누구나 그림을 올리므로, 각자의
// 칸을 갈라 두지 않으면 청소 한 번에 남의 그림까지 쓸려 나간다.
function taskKey(scope, uid, taskId, fileId) {
  if (!safe(scope) || !safe(uid) || !safe(taskId) || !safe(fileId)) return null;
  return `tasks/${scope}/${uid}/${taskId}/${fileId}.jpg`;
}
// 키 문자열을 되받을 때도 같은 모양인지 다시 본다(조작 방지).
function validKey(k) {
  const s = String(k || '');
  let m = /^notices\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{1,40})\.jpg$/.exec(s);
  if (m) return { kind: 'notice', scope: m[1], id: m[2], fileId: m[3] };
  m = /^tasks\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{1,40})\/([A-Za-z0-9_-]{1,40})\.jpg$/.exec(s);
  if (m) return { kind: 'task', scope: m[1], uid: m[2], id: m[3], fileId: m[4] };
  return null;
}
// 이 사람이 이 그림을 지울 수 있나. 공지는 관리자만, 캘린더는 자기 칸만.
function mayWrite(who, key) {
  const k = typeof key === 'string' ? validKey(key) : key;
  if (!k) return false;
  if (k.kind === 'notice') return !!who.admin;
  return k.uid === who.uid || !!who.admin;
}

const MAX_BYTES = 3 * 1024 * 1024;   // 장당 3MB. 화면에서 줄여 보내므로 넉넉한 상한이다.

// 이미지 내려주기 — GET /img?k=<key> + Authorization: Bearer <idToken>
// POST 로 하면 브라우저가 응답을 캐시하지 않는다. 같은 공지를 다시 열 때마다
// 다시 받게 되므로 GET 으로 둔다(Cache-Control 이 살아난다).
async function handleImgGet(env, request, cors) {
  if (!env.NOTICES) return json({ success: false, error: 'NO_BUCKET' }, 503, cors);
  const who = await whoFromHeader(env, request);
  if (!who) return json({ success: false, error: 'AUTH' }, 403, cors);

  const k = new URL(request.url).searchParams.get('k');
  if (!validKey(k)) return json({ success: false, error: 'BAD_KEY' }, 400, cors);

  const obj = await env.NOTICES.get(k);
  if (!obj) return json({ success: false, error: 'NOT_FOUND' }, 404, cors);
  return new Response(obj.body, {
    status: 200,
    headers: { ...cors, 'Content-Type': 'image/jpeg',
               // 키가 파일마다 새로 생기므로(같은 키를 덮어쓰지 않는다) 오래 잡아둬도 안전하다.
               'Cache-Control': 'private, max-age=604800, immutable' }
  });
}

// 이미지 올리기 — 관리자만. 본문은 dataURL 문자열로 온다(화면에서 이미 줄여 보낸다).
async function handleImgPut(env, body) {
  if (!env.NOTICES) return { success: false, error: 'NO_BUCKET' };
  const who = await verifyTeacher(env, String(body.idToken || ''));
  if (!who) return { success: false, error: 'AUTH' };

  // 어디에 올리는 그림인가로 권한이 갈린다.
  //   notice — 전 교사가 보는 공지다. 관리자만.
  //   task   — 자기 업무 메모다. 교사 누구나. 단, 칸 이름(uid)은 요청이 아니라
  //            토큰을 확인한 결과에서 꺼낸다. 남의 칸을 적어 보낼 길이 없다.
  const kind = body.kind === 'task' ? 'task' : 'notice';
  let key;
  if (kind === 'notice') {
    if (!who.admin) return { success: false, error: 'FORBIDDEN' };
    key = noticeKey(body.scope, body.noticeId, body.fileId);
  } else {
    key = taskKey(body.scope, who.uid, body.taskId, body.fileId);
  }
  if (!key) return { success: false, error: 'BAD_KEY' };

  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
  if (!m) return { success: false, error: 'BAD_IMAGE' };
  const bytes = bytesFromB64(m[2]);
  if (!bytes.length) return { success: false, error: 'BAD_IMAGE' };
  if (bytes.length > MAX_BYTES) return { success: false, error: 'TOO_BIG', limit: MAX_BYTES };

  await env.NOTICES.put(key, bytes, {
    httpMetadata: { contentType: 'image/jpeg' },
  });
  return { success: true, key };
}

// 이미지 지우기 — 관리자만. 공지에서 그림을 빼거나 공지를 지울 때 부른다.
async function handleImgDel(env, body) {
  if (!env.NOTICES) return { success: false, error: 'NO_BUCKET' };
  const who = await verifyTeacher(env, String(body.idToken || ''));
  if (!who) return { success: false, error: 'AUTH' };

  // 키 하나하나를 따로 본다. 공지 그림은 관리자만, 캘린더 그림은 자기 것만.
  // 넘어온 목록에 남의 것이 섞여 있으면 그것만 빼고 나머지를 지운다.
  // '모양이 틀린 키'와 '내 것이 아닌 키'는 다른 이야기라 답도 갈라 준다 —
  // 합쳐 두면 화면에서 무엇이 잘못됐는지 알 수 없다.
  const keys  = Array.isArray(body.keys) ? body.keys : [body.key];
  const valid = keys.filter(validKey);
  if (!valid.length) return { success: false, error: 'BAD_KEY' };
  const ok = valid.filter(k => mayWrite(who, k));
  if (!ok.length) return { success: false, error: 'FORBIDDEN' };
  await Promise.all(ok.map(k => env.NOTICES.delete(k)));
  return { success: true, deleted: ok.length };
}

// 안 쓰이는 이미지 청소 — 관리자만.
// 지우기를 부르지 못한 채 창을 닫는 일이 있으므로(저장 안 하고 나가기 등) 남는
// 파일이 생긴다. 지금 문서가 쓰고 있는 키를 받아 그 밖의 것을 지운다.
async function handleSweep(env, body) {
  if (!env.NOTICES) return { success: false, error: 'NO_BUCKET' };
  const who = await verifyTeacher(env, String(body.idToken || ''));
  if (!who) return { success: false, error: 'AUTH' };
  const scope = String(body.scope || '');
  if (!safe(scope)) return { success: false, error: 'BAD_KEY' };

  // 어디를 훑을지가 이 기능의 전부다. 훑는 자리를 잘못 잡으면 남의 그림이
  // '안 쓰이는 것'으로 보여 통째로 지워진다.
  //
  //   notice — 관리자는 모든 공지를 볼 수 있다. 그래서 배포 전체를 훑어도 된다.
  //   task   — 자기 일정만 볼 수 있다. 남의 일정이 무슨 그림을 쓰는지 모르는
  //            채로 배포 전체를 훑으면 남의 것을 다 지운다. 그래서 훑는 자리를
  //            자기 칸 안으로 못 박는다. 칸 이름은 토큰에서 나온 uid 다.
  const kind = body.kind === 'task' ? 'task' : 'notice';
  let prefix;
  if (kind === 'notice') {
    if (!who.admin) return { success: false, error: 'FORBIDDEN' };
    prefix = `notices/${scope}/`;
  } else {
    prefix = `tasks/${scope}/${who.uid}/`;
  }

  const keep = new Set((Array.isArray(body.keep) ? body.keep : []).filter(validKey));
  // 한 번에 1000개까지만 본다. 그 위로는 다음 청소 때 이어서 지워진다 —
  // 한 사람 칸에 그만큼 쌓일 일이 없으므로 이어받기(cursor)는 두지 않는다.
  const list = await env.NOTICES.list({ prefix, limit: 1000 });
  // prefix 로 이미 갈렸지만 한 번 더 본다. 목록에 엉뚱한 것이 섞여 들어오는
  // 경우(버킷을 다른 데서 같이 쓰는 등)에도 남의 것을 지우지 않게.
  const gone = list.objects.map(o => o.key)
    .filter(k => !keep.has(k) && k.startsWith(prefix) && mayWrite(who, k));
  await Promise.all(gone.map(k => env.NOTICES.delete(k)));
  return { success: true, deleted: gone.length, kept: keep.size };
}

// ── CORS · 응답 ──────────────────────────────────────────────────────────────
function corsHeaders(env, origin) {
  // 끝 슬래시·대소문자 차이로 매칭이 어긋나는 사고가 잦아 정규화해서 비교한다.
  const norm = s => String(s || '').trim().replace(/\/+$/, '').toLowerCase();
  const allow = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(norm).filter(Boolean);
  // 허용 목록이 비어 있으면(초기 설정 전) 아무 곳도 허용하지 않는다 — 안전측.
  const ok = allow.includes(norm(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // 이미지 조회는 GET + Authorization 이다(브라우저 캐시를 쓰려면 GET이어야 한다)
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
// 오류 응답은 절대 캐시되면 안 된다. 405·404 등은 규격상 브라우저가 임의로 캐시해도 되는
// 상태 코드라, no-store가 없으면 배포를 고친 뒤에도 옛 오류가 계속 나온다.
// 이미지 본문만 예외로 handleImgGet 에서 따로 캐시 헤더를 붙여 내보낸다.
const json = (obj, status, headers) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8',
                     'Cache-Control': 'no-store', ...headers }
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (cors['Access-Control-Allow-Origin'] === 'null') {
      return json({ success: false, error: 'ORIGIN' }, 403, cors);
    }
    // 이미지 조회만 GET (브라우저 캐시를 쓰기 위해). 나머지는 전부 POST + JSON.
    if (request.method === 'GET') {
      if (new URL(request.url).pathname === '/img') {
        try { return await handleImgGet(env, request, cors); }
        catch (e) { console.error('imgGet', e && e.message);
                    return json({ success: false, error: 'SERVER' }, 500, cors); }
      }
      return json({ success: false, error: 'METHOD' }, 405, cors);
    }
    if (request.method !== 'POST') return json({ success: false, error: 'METHOD' }, 405, cors);

    let body;
    try { body = await request.json(); }
    catch { return json({ success: false, error: 'BAD_JSON' }, 400, cors); }

    try {
      switch (body.action) {
        case 'put':   return json(await handleImgPut(env, body),  200, cors);
        case 'del':   return json(await handleImgDel(env, body),  200, cors);
        case 'sweep': return json(await handleSweep(env, body),   200, cors);
        default:      return json({ success: false, error: 'UNKNOWN_ACTION' }, 400, cors);
      }
    } catch (e) {
      // 내부 오류 메시지는 그대로 노출하지 않는다(키·경로 유출 방지).
      console.error('notice-api', body.action, e && e.message);
      return json({ success: false, error: 'SERVER' }, 500, cors);
    }
  }
};
