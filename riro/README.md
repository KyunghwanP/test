# 리로스쿨 상벌점 → 앱 (학교 PC 에서)

앱의 **상벌점 조회·상세·종합검색**은 Firestore `riro_points` 를 읽습니다. 예전에는 GitHub 서버가
밤마다 리로스쿨에서 받아 왔는데(`scripts/scrape-riro.js`), **리로스쿨이 2026-10-14 부터 해외 접속을
막아서** 미국에 있는 GitHub 서버로는 받을 수 없게 됐습니다. 리로스쿨 대신 CloudFront 의
「에러페이지」(해외 접속 차단)가 오고, 스크래퍼는 매일 「파싱 완료: 0명」으로 실패했습니다.
이 일 이후 앱의 상벌점은 10/14 오전 6:35 자료에 멈춰 있었습니다.

그래서 **한국에 있는 학교 PC** 가 받습니다.

```
학교 PC  riro-push.ps1   리로스쿨 로그인 → 상벌점 페이지 → 표 해석 → 저장할 모양으로
   │                      (평일 07:50 · 16:40 · 로그인할 때, Windows 작업 스케줄러)
   ▼  PUT /riro/grade1 · grade2 · grade3 · meta     머리글 X-Riro-Key
워커 riro-ingest          열쇠만 확인하고 그대로 riro_points 의 그 문서에 쓴다
   ▼
앱                        상벌점 조회 · 상세 · 종합검색 (자료 모양은 예전과 같다)
```

- 표 해석을 PC 에서 하는 까닭: 무료 워커는 요청 하나에 CPU 10ms 까지인데, 전교생 표를 해석하면
  수십 ms 가 듭니다. PC 에는 그런 제한이 없습니다(1000명 남짓에 10초 안팎).
- PC 는 Windows 에 들어 있는 PowerShell 만 씁니다. **따로 설치할 것이 없습니다.**
- Firebase 열쇠(서비스 계정)는 PC 에 두지 않습니다. 워커에만 있습니다.

## 처음 설치

### 1. PC 고르기

- 평일 아침에 켜 두는 PC (선생님 교무실 PC 등). Windows 10·11.
- **복원 프로그램(재부팅하면 처음으로 돌아가는 것)이 없는 PC.** 있으면 설정이 날아갑니다.
- 그 PC 의 **선생님 Windows 계정**으로 로그인한 상태에서 돌아갑니다(로그인 안 하면 쉼).

### 2. PC — 내려받고 설정 (PowerShell)

시작 메뉴에서 **PowerShell** 을 열고 아래를 통째로 붙여 넣습니다.

```powershell
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$d = "$env:LOCALAPPDATA\ynhs-riro"; New-Item -ItemType Directory -Force $d | Out-Null
Invoke-WebRequest https://raw.githubusercontent.com/KyunghwanP/test/main/riro/riro-push.ps1 -OutFile "$d\riro-push.ps1" -UseBasicParsing
powershell -ExecutionPolicy Bypass -File "$d\riro-push.ps1" -Setup
```

- 리로스쿨 아이디·비밀번호를 묻습니다. **이 PC 의 이 Windows 사용자만 풀 수 있게(DPAPI)** 잠가서 저장합니다.
- 워커 주소는 그냥 Enter (`https://riro-ingest.pkh910518.workers.dev`).
- 마지막에 **전송 암호**(43자)를 보여 주고 클립보드에 복사해 둡니다 → 다음 단계에서 씁니다.

### 3. Cloudflare — 워커 만들기

1. 대시보드 → **Workers & Pages** → **Create** → Worker → 이름 `riro-ingest` → **Deploy**
2. **Edit code** → 저장소의 `workers/riro-ingest.js` 를 **통째로** 붙여 넣기 → **Deploy**
3. **Settings → Variables and Secrets** → **+ Add** 로 둘을 넣는다. 종류(Type)는 둘 다 **Secret** → **Deploy**
   - `SA_JSON` — 서비스 계정 JSON 파일의 내용 **전체** (메모장으로 열어 Ctrl+A → Ctrl+C).
     다른 워커에 넣은 값은 Cloudflare 에서 다시 볼 수 없으므로, 그 파일이 없으면 Firebase 콘솔 →
     프로젝트 설정(톱니) → **서비스 계정** → **새 비공개 키 생성** 으로 새로 받는다 (다른 워커는 그대로 돈다).
   - `RIRO_KEY` — 2단계에서 복사한 전송 암호. 다시 보려면 PC 에서 `-ShowKey`.

### 4. PC — 확인 → 한 번 저장 → 자동 실행

```powershell
$d = "$env:LOCALAPPDATA\ynhs-riro"
powershell -ExecutionPolicy Bypass -File "$d\riro-push.ps1" -Check      # 받아서 해석까지만 + 워커 연결 확인
powershell -ExecutionPolicy Bypass -File "$d\riro-push.ps1"             # 지금 한 번 저장
powershell -ExecutionPolicy Bypass -File "$d\riro-push.ps1" -Install    # 평일 07:50 · 16:40 · 로그인 3분 뒤
```

`-Check` 가 「학생 1000여 명 (1학년 … · 2학년 … · 3학년 …) · 상세 ○○건」과 「워커 연결: 정상」을
보여 주면 됩니다. 저장한 뒤 앱의 상벌점 조회 화면에서 **마지막 업데이트** 시각이 바뀝니다.

## 운영

| 할 일 | 방법 |
|---|---|
| 잘 도는지 보기 | `%LOCALAPPDATA%\ynhs-riro\riro.log` (몇 명·몇 건·HTTP 상태만 남습니다 — 학생 이름·점수는 없음) |
| 리로스쿨 비밀번호를 바꿨다 | `-Setup` 다시 (전송 암호는 그대로 둡니다) |
| 스크립트 새 판 | 2단계의 `Invoke-WebRequest` 줄만 다시 (자동 실행은 같은 파일을 부릅니다) |
| PC 를 바꾼다 | 옛 PC 에서 `-Uninstall`, 새 PC 에서 2·4단계 (전송 암호를 새로 만들었으면 워커의 `RIRO_KEY` 도) |
| 전송 암호를 바꾼다 | `-Setup -NewKey` → 워커의 `RIRO_KEY` 도 같은 값으로 |
| 전송 암호를 다시 보고 싶다 | `-ShowKey` (화면에 보여 주고 클립보드에 복사) |
| 상세가 안 읽힌다 | `-Diagnose` → 바탕화면의 `riro-diag.txt` (학생 정보는 가림: 한글 → 가, 숫자 → 0, 글자 속 영문 → a) |

## 저장하지 않는 경우 (앱 자료는 그대로 남는다)

잘못 읽은 표 하나로 앱의 상벌점이 통째로 비면 안 되므로, 아래면 **아무것도 쓰지 않고** 실패로 끝납니다.

- 학생이 300명보다 적게, 또는 한 학년이 50명보다 적게 읽혔다
- 상세 내역이 한 건도 안 읽혔다 (3월이 아닌데) — 리로스쿨 화면이 바뀌었을 가능성
- 로그인이 안 됐다 / 해외 차단 페이지가 왔다 / 워커가 거부했다

| 기록에 남은 말 | 뜻 · 할 일 |
|---|---|
| 로그인이 되지 않았습니다 | 아이디·비밀번호 확인 → `-Setup` |
| 해외 접속 차단 페이지가 왔습니다 | 그 PC 가 VPN 등으로 해외를 거쳐 나가는지 확인 |
| 상벌점 표가 없는 페이지 / 상세 내역이 한 건도 | 리로스쿨 화면이 바뀜 → `-Diagnose` 파일을 보고 해석 코드를 고쳐야 함 |
| 전송 암호가 맞지 않습니다 (HTTP 401) | 워커의 `RIRO_KEY` 와 PC 의 암호가 다름 → `RIRO_KEY` 다시 넣기 |
| HTTP 500 · SA | 워커의 `SA_JSON` 이 없거나 틀림 |

## 보안

- 계정·전송 암호: PC 에 DPAPI 로 잠가 저장 (그 PC·그 Windows 사용자만 풂).
- 워커는 **열쇠가 맞을 때만**, **`riro_points` 의 문서 넷(grade1·2·3·meta)에만** 씁니다. 쓸 문서는
  주소로 정해져 있어 열쇠가 새어도 다른 자료는 건드릴 수 없습니다. 받은 몸통은 손대지 않고 넘깁니다.
- 기록·GitHub(공개 저장소)에는 학생 자료가 남지 않습니다.

## GitHub 쪽

`.github/workflows/riro-points.yml` 의 밤 예약은 껐습니다(해외라 어차피 실패). 손으로 돌리면
`scripts/scrape-riro.js` 가 각 단계의 상태·응답한 서버를 기록하므로, 리로스쿨이 해외 차단을
풀었는지 볼 때 씁니다.

## 검사

```bash
node workers/riro-ingest.test.mjs                       # 워커 — 열쇠·주소·전달 (29)
PWSH=/경로/pwsh node tests/riro-parse.test.mjs          # 표 해석 — 크로미움(원래 코드)과 같은 답인지 (37)
PWSH=/경로/pwsh node tests/riro-push-e2e.test.mjs       # PC → 워커 → Firestore 끝까지 (35)
```

PowerShell 7(`pwsh`)이 필요합니다. 학교 PC 는 Windows PowerShell 5.1 로 돌리므로 스크립트는 5.1 문법만
씁니다. 파일은 **UTF-8 BOM** 으로 저장해야 합니다(없으면 5.1 이 한글을 깨뜨려 읽습니다).
