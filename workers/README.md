# 학부모 상담 예약 API (Cloudflare Worker)

기존 Google Apps Script(GAS)를 대체하는 백엔드입니다. `consult-api.js` 한 파일이 전부입니다.

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

## 학생 사진 고화질 (R2) — 선택

안 해도 앱은 그대로 돕니다. 설정하면 학생 사진이 **150×200 → 600×800**이 됩니다.

**왜 필요한가**: Firestore는 문서 하나가 1MB라 반 40명을 한 문서에 담으려면 장당
10KB(150×200)가 한계였습니다. R2는 그 제한이 없습니다.

### 1) 버킷 만들기

Cloudflare 대시보드 → **R2** → *Create bucket* → 이름 `ynhs-photos`.
**공개 접근은 켜지 마세요.** 워커만 통해서 나가야 합니다.

### 2) 워커에 연결

Workers → `consult-api` → **Settings → Bindings → Add → R2 bucket**

| 항목 | 값 |
|---|---|
| Variable name | `PHOTOS` |
| R2 bucket | `ynhs-photos` |

`FIREBASE_API_KEY`도 있어야 합니다(교사 토큰 검증용). 이미 '실제 권한으로 보기'를
쓰고 계시면 설정돼 있습니다.

### 3) 워커 코드 갱신 후 배포

`consult-api.js` 최신본을 붙여넣고 Deploy.

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
