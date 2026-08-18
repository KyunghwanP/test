# Cloudflare Workers

워커가 **둘**입니다. 경계는 '누가 부르느냐'입니다.

| 파일 | 워커 이름 | 담당 | 호출자 |
|---|---|---|---|
| `consult-api.js` | `consult-api` | 상담 인증·예약·취소 | **학부모** (인증 전 아무나 두드릴 수 있는 입구) |
| `teacher-api.js` | `teacher-api` | 학생 사진, 연락처 조회 | **교사** (모든 경로가 토큰 검증 뒤) |

### 왜 나눴나

1. **인증 성격이 정반대다.** 한 파일에 두면 학부모 쪽 실수 하나가 교직원·학생
   연락처로 새는 경로가 된다.
2. **재배포가 겹친다.** 연락처를 고치려고 배포했다가 상담 예약이 깨지면 하필
   그날이 상담 오픈일일 수 있다(반대도 마찬가지).

대가로 공통 코드(서명·Firestore REST·CORS) 약 200줄이 두 파일에 중복됩니다. 거의
바뀌지 않는 인프라 코드라 중복을 감수했습니다. **한쪽을 고치면 다른 쪽도 봐야 합니다.**

### 검증

```bash
node workers/teacher-api.test.mjs     # 워커 로직 (fetch를 스텁으로 물려 실제 경로를 태움)
node workers/roster-split.test.mjs    # upload.html 분리 저장 → 워커 조회가 이어지는지
```

> `roster-split.test.mjs`는 `upload.html`을 읽습니다. 업로드 도구는 **test 저장소에만**
> 있으므로 이 테스트도 test 저장소에서만 돕니다(ynhs에는 파일을 두지 않습니다).

---

# 학부모 상담 예약 API (`consult-api`)

기존 Google Apps Script(GAS)를 대체하는 백엔드입니다.

## 왜 바꾸나

| | GAS | Worker |
|---|---|---|
| 호출 방식 | `/exec` → **302 리다이렉트**(왕복 2회) | 직접 호출 |
| 콜드 스타트 | 1~3초 | 사실상 없음(V8 아이솔레이트) |
| 동시 실행 | 계정당 제한 → **오픈 시각에 큐·타임아웃** | 자동 확장 |
| 선착순 처리 | `LockService`로 **직렬화**(몰리면 더 느려짐) | `updateTime` 선행조건(잠금 없이 안전) |

추가로 **슬롯 조회는 워커를 아예 거치지 않습니다.** 학부모 브라우저가 Firestore의
공개 미러 문서를 직접 읽으므로, 예약 오픈 순간의 폭주가 워커에 부하를 주지 않습니다.

## 구조

```
[학부모]
  ├── 인증·예약·취소 ──→ Worker ──(서비스계정)──→ Firestore  consultations/{반}
  └── 슬롯 목록 조회 ─────직접 읽기────────────→ Firestore  consultationsPublic/{반}
                                                        (개인정보 없는 미러)
[교사 앱] ── 슬롯 편집 ─────────────────────────→ 두 문서를 한 트랜잭션으로 동시 갱신
```

- `consultations/{반}` — 원본. 예약자 이름·연락처·메모 포함. **교사만** 읽기 가능.
- `consultationsPublic/{반}` — 미러. **열린 슬롯의 `id·date·time·duration`과 `openAt`뿐.**
  개인정보가 전혀 없습니다. 그래도 아무나 못 읽도록, 워커가 발급한 토큰의
  `classKey` 클레임이 일치하는 학부모만 자기 반 문서를 읽게 규칙으로 막습니다.

## 배포 방법

### 1. 서비스 계정 키 준비

Firebase 콘솔 → **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성** → JSON 다운로드.

> 이 JSON은 **저장소에 절대 커밋하지 마세요.** 아래 시크릿으로만 넣습니다.

### 2. Worker 만들기

이미 `adiga-pdf-proxy`를 쓰고 계시므로 계정은 그대로 씁니다. **새 Worker를 따로**
만드세요(PDF 프록시와 절대 합치지 말 것 — 권한 성격이 완전히 다릅니다).

```bash
npm create cloudflare@latest consult-api      # 또는 대시보드에서 Worker 생성
# 생성된 프로젝트의 src/index.js 를 consult-api.js 내용으로 교체
npx wrangler deploy
```

대시보드에서 코드를 붙여넣어 배포해도 됩니다.

### 3. 시크릿·변수 설정

```bash
npx wrangler secret put SA_JSON          # 1단계에서 받은 JSON 전체를 붙여넣기
```

대시보드로 할 경우: **Worker → Settings → Variables and Secrets**
- `SA_JSON` — **Secret(암호화)** 로 추가. 서비스 계정 JSON 전체
- `ALLOWED_ORIGINS` — 일반 변수. `https://kyunghwanp.github.io`
- `PROJECT_ID` — (선택) 미지정 시 JSON의 `project_id` 사용

> `ALLOWED_ORIGINS`를 비워두면 **모든 요청이 403으로 거부**됩니다(안전측 기본값).
> 반드시 설정하세요.

### 4. 보안 규칙 배포

`firestore.rules`에 `consultationsPublic` 규칙이 포함되어 있습니다. Firebase 콘솔에
그대로 반영하세요.

### 5. 앱에 워커 주소 알려주기

`parent.html` 상단의 `WORKER_URL` 을 배포된 주소로 바꿉니다.

```js
const WORKER_URL = 'https://consult-api.<계정>.workers.dev';
```

## 점검

배포 후 아래가 정상이어야 합니다.

1. **Origin 차단** — 터미널에서 직접 호출하면 거부되어야 합니다.
   ```bash
   curl -X POST https://consult-api.<계정>.workers.dev \
     -H 'Content-Type: application/json' -d '{"action":"verify"}'
   # → {"success":false,"error":"ORIGIN"}   (정상)
   ```
2. **학부모 페이지** — 인증 → 슬롯 목록 → 예약 → 취소가 순서대로 동작.
3. **미러 일치** — 교사 앱에서 슬롯을 추가/삭제하면 `consultationsPublic/{반}`이
   같이 바뀌는지 콘솔에서 확인.

문제가 생기면 실시간 로그로 확인합니다.

```bash
npx wrangler tail
```

---

# 교사 전용 API (`teacher-api`)

교사 Firebase ID 토큰이 있어야만 열리는 것만 담습니다.

- `GET  /photo?g=&r=&n=` — 학생 사진 (R2)
- `POST {action:'photoPut'}` — 사진 올리기 (관리자만)
- `POST {action:'contact'}` — 학생·교원 연락처 **1건** 조회

## 배포

> **먼저 알아둘 것 — `SA_JSON`은 `consult-api`에서 복사할 수 없습니다.**
> Cloudflare는 Secret에 한 번 넣은 값을 다시 보여주지 않습니다(가려진 채로만 보입니다).
> 서비스 계정 JSON 원본 파일이 있으면 그걸 쓰고, 없으면 Firebase 콘솔에서 새로
> 발급하세요. **기존 키는 그대로 살아있어서 `consult-api`는 안 깨집니다**
> (서비스 계정 하나에 키를 여러 개 둘 수 있습니다).

### 1) Worker 만들기

Cloudflare 대시보드 → **Workers & Pages** → **Create** → *Start with Hello World!*
→ 이름을 **`teacher-api`** 로 → **Deploy**

만들어지면 **Edit code** → 기본 코드를 전부 지우고 `teacher-api.js` 내용을 붙여넣기
→ **Deploy**

### 2) 변수 2개 (일반 Text)

**Settings → Variables and Secrets → + Add**

| Type | Name | Value |
|---|---|---|
| Text | `ALLOWED_ORIGINS` | `https://kyunghwanp.github.io` |
| Text | `FIREBASE_API_KEY` | `AIzaSyCrYCGksB-Nv8LNIv1kZc_a8d6bIL_5CvA` |

`FIREBASE_API_KEY`는 `index.html`에 이미 공개돼 있는 값입니다(웹 API 키는 원래
공개용). Secret으로 둘 필요 없고, `consult-api` 대시보드에서 그대로 봐도 됩니다.

### 3) `SA_JSON` (Secret)

같은 화면에서 **+ Add** → **Type: Secret** → Name `SA_JSON` →
Value에 JSON **파일 전체**를 붙여넣습니다(`{` 부터 `}` 까지, 줄바꿈 그대로).

원본이 없으면: Firebase 콘솔 → **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**
→ JSON 다운로드.

### 4) R2 바인딩 `PHOTOS`

**Settings → Bindings → + Add → R2 bucket**

| 항목 | 값 |
|---|---|
| Variable name | `PHOTOS` ← 대문자 그대로 |
| R2 bucket | `ynhs-photos` |

> 예전에 여기서 한 번 막혔습니다. **Variable name** 칸에 버킷 이름이나
> `R2 bucket`을 적으면 안 됩니다. 코드가 찾는 이름은 정확히 `PHOTOS` 입니다.

### 5) 다시 Deploy

**변수를 추가해도 이미 돌고 있는 버전에는 안 붙습니다.** 설정을 마친 뒤
**Deploy**를 한 번 더 눌러야 반영됩니다.

### 6) 확인

**① 배포됐는지만 먼저** — 주소창에 그대로 붙여넣습니다.

```
https://teacher-api.pkh910518.workers.dev/photo
```

`{"success":false,"error":"ORIGIN"}` 이 보이면 워커는 살아있습니다. 주소창 접속은
Origin 헤더를 안 보내므로 거부되는 것이 정상입니다.

**② 변수·바인딩까지** — 브라우저 콘솔이 가장 정확합니다. Origin 헤더를 브라우저가
붙여주고, 실제 앱이 부르는 경로와 완전히 같습니다.

`https://kyunghwanp.github.io/test/` 접속 → **F12 → Console**:

```js
fetch('https://teacher-api.pkh910518.workers.dev/photo').then(r=>r.json()).then(console.log)
```

터미널을 쓴다면:

```bash
# macOS · Linux · Git Bash
curl -s -H 'Origin: https://kyunghwanp.github.io' \
     https://teacher-api.pkh910518.workers.dev/photo
```

```powershell
# PowerShell — 'curl' 은 Invoke-WebRequest 별칭이라 -s·-H 를 못 알아듣는다.
# 반드시 curl.exe 로 부르고 한 줄로 쓴다(줄 끝 \ 는 bash 문법).
curl.exe -s -H "Origin: https://kyunghwanp.github.io" https://teacher-api.pkh910518.workers.dev/photo
```

| 돌아온 값 | 뜻 |
|---|---|
| `ORIGIN` (두 번째 명령에서도) | `ALLOWED_ORIGINS` 오타. 끝 슬래시·대소문자는 무시되니 철자를 보세요 |
| `NO_BUCKET` | R2 바인딩 이름이 `PHOTOS`가 아님 |
| `AUTH` | **정상.** 토큰이 없으니 당연히 거부 |

`SA_JSON`과 `FIREBASE_API_KEY`는 curl로는 확인이 안 됩니다(토큰 검증을 통과해야
Firestore를 건드리기 때문). 실제 앱에서 확인하세요:

`/test/` 접속 → 교원연락망에서 📞 누르기 →
- 전화 연결되면 **전부 정상**
- "불러오지 못했습니다" → **Workers → teacher-api → Logs → Begin log stream** 켜고
  다시 눌러 보면 원인이 찍힙니다(`SA_JSON 시크릿이 설정되지 않았습니다` 등)

## 연락처를 왜 워커가 내주나

예전에는 앱이 `students/main` · `contacts/main` 문서를 **통째로** 받았습니다.
화면에는 한 반(30명)만 보여주면서 실제로는 전교생 연락처를 브라우저로 내려보내고
있었던 것이라, 개발자 도구 없이 **'페이지 저장' 한 번으로 전체가 유출**됐습니다.
교원 목록은 더 노골적이어서 `href="tel:번호"`가 전원 몫으로 HTML에 박혀 있었습니다.

지금은:

- 연락처 원본은 `studentsContact/main` · `contactsPhone/main`에 있고, 보안 규칙이
  **브라우저 읽기를 차단**합니다(`read: false`). 서비스 계정만 읽힙니다.
- 앱은 상세를 연 **그 1명분**만 워커에서 받습니다.
- 조회는 전부 `accessLogs/{이메일}_{날짜}`에 기록됩니다.
- 하루에 **서로 다른 100명**을 넘기면 막힙니다. '몇 번 눌렀나'가 아니라
  '몇 사람의 번호를 봤나'로 세는데, 같은 학생을 다시 열었다고 상한이 깎이면
  정상 업무만 불편해지고 정작 막아야 할 대량 수집은 서로 다른 사람을 훑는
  행위이기 때문입니다.

> **한계**: 원천 차단은 아닙니다. 마음먹으면 100명까지는 볼 수 있습니다. 바뀌는 것은
> ① 무심코·우연히 전체가 새는 경로가 없어지고 ② 고의로 긁으면 기록에 남고
> ③ 상한에 걸린다는 점입니다.

### 접속기록 정리 (권장)

문서마다 `expireAt`(timestamp)이 붙습니다. Firebase 콘솔 → **Firestore → TTL** 에서
컬렉션 `accessLogs`, 필드 `expireAt` 으로 정책을 만들면 400일 뒤 자동 삭제됩니다.
안 만들어도 동작에는 지장이 없지만 문서가 계속 쌓입니다.

### 명렬 다시 올리기 (전환 마무리)

`upload.html`의 `KEEP_CONTACT_IN_ROSTER`가 지금 **`true`** 입니다. 운영(ynhs)이 아직
옛 코드라 `students/main`에서 연락처를 읽기 때문에, 당분간 **양쪽에** 씁니다.

ynhs 배포가 끝나면:

1. `upload.html`에서 `KEEP_CONTACT_IN_ROSTER = false` 로 변경
2. 명렬(교원·학생)을 **한 번씩 다시 업로드**

그러면 옛 문서에서 연락처가 사라지고, 그때부터 실제로 차단됩니다.
**이 두 단계를 하기 전까지는 옛 문서에 연락처가 그대로 있습니다.**

## 학생 사진 고화질 (R2)

설정하면 학생 사진이 **150×200 → 600×800**이 됩니다.

**왜 필요한가**: Firestore는 문서 하나가 1MB라 반 40명을 한 문서에 담으려면 장당
10KB(150×200)가 한계였습니다. R2는 그 제한이 없습니다.

### 1) 버킷 만들기

Cloudflare 대시보드 → **R2** → *Create bucket* → 이름 `ynhs-photos`.
**공개 접근은 켜지 마세요.** 워커만 통해서 나가야 합니다.

### 2) 워커에 연결

Workers → `teacher-api` → **Settings → Bindings → Add → R2 bucket**

| 항목 | 값 |
|---|---|
| Variable name | `PHOTOS` |
| R2 bucket | `ynhs-photos` |

`FIREBASE_API_KEY`도 있어야 합니다(교사 토큰 검증용). 이미 '실제 권한으로 보기'를
쓰고 계시면 설정돼 있습니다.

### 3) 워커 코드 갱신 후 배포

`teacher-api.js` 최신본을 붙여넣고 Deploy.

### 4) 사진명렬 다시 올리기

`upload.html` → **🪪 사진명렬 업로드**. 예전과 똑같이 파일 고르고 저장하면 됩니다.
작은 사진은 Firestore에, 고화질은 R2에 **함께** 들어갑니다.

> 다시 올리기 전까지는 기존 사진이 그대로 보입니다. R2에 없으면 앱이 작은 사진으로
> 되돌아가므로 중간에 깨지지 않습니다.

**용량**: 장당 약 90KB × 전교 600명 ≈ 54MB (무료 10GB 안).

**되돌리기**: 바인딩(`PHOTOS`)만 지우면 사진 기능은 조용히 꺼지고 작은 사진으로 돌아갑니다.

## 되돌리기

`parent.html`의 `USE_WORKER` 를 `false`로 되돌리면 즉시 기존 GAS 경로로 돌아갑니다.
그래서 **GAS 배포는 당분간 지우지 마세요.** 워커가 안정적으로 도는 것을 확인한 뒤
정리하시면 됩니다.

## 보안 메모

- 서비스 계정 키는 Cloudflare **암호화 시크릿**에만 존재합니다(GAS Script Properties와 동급).
- 워커는 `ALLOWED_ORIGINS`에 등록된 출처의 요청만 처리합니다.
- 예약·취소는 워커가 서명한 **세션 토큰**이 있어야 하고, 토큰에는 인증된
  학년·반·학생이 박혀 있어 **다른 학생 예약을 건드릴 수 없습니다.**
- 내부 오류 메시지는 클라이언트로 내보내지 않습니다(경로·키 유출 방지).
- 참고: 기존 `adiga-pdf-proxy`는 아무 URL이나 중계하는 **오픈 프록시**입니다. 이
  워커와 무관하지만, 남용되면 계정 무료 한도를 소진할 수 있으니 여유 있을 때
  허용 도메인 제한을 걸어두시길 권합니다.
