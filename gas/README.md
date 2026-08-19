# Google Apps Script

`Code.gs` 는 **배포본이 아니라 사본**입니다. 실제로 도는 것은 Apps Script 쪽이고,
여기 있는 파일은 리뷰와 변경 이력을 남기기 위한 거울입니다.
고친 뒤에는 **Apps Script 편집기에 붙여넣고 새 버전으로 배포해야** 실제로 반영됩니다.

배포 URL은 `scripts/scrape-weekly.js` 의 `GAS_URL`, `parent.html` 의 GAS 경로에서 씁니다.

## 하는 일

| `?action=` | 쓰는 곳 |
|---|---|
| (없음) | 주간교육활동 구글 사이트 HTML 정리해서 반환 |
| `getSchedule` | 학사일정 시트 → 월별 JSON (`scripts/scrape-weekly.js` 가 부름) |
| `savePoints` | 상벌점 원본 시트에 한 줄 추가 |
| `triggerWeeklySummary` | scrape → summarize 워크플로 연달아 실행 |
| `verifyParent` · `getOpenSlots` · `bookSlot` · `getMyBooking` · `cancelBooking` | 학부모 상담 예약 (`parent.html`) |

## 비밀값

코드에는 없습니다. Apps Script **스크립트 속성**에만 있습니다.

- `GITHUB_TOKEN` — 워크플로 dispatch
- `FIREBASE_PROJECT_ID`, `FIREBASE_SA_JSON` — Firestore REST 접근용 서비스 계정

시트 ID(`SCHEDULE_SHEET_ID`, 상벌점 `SHEET_ID`)는 코드에 있지만, ID만으로는 열 수
없고 시트 공유 권한이 따로 필요합니다.

## 상담 예약은 워커로 옮기는 중

`workers/consult-api` 가 같은 일을 합니다. `parent.html` 의 `USE_WORKER` 를
`false` 로 되돌리면 이 GAS 경로로 돌아가므로, **배포를 아직 지우지 마세요.**
자세한 것은 `workers/README.md`.

## 고칠 때 조심할 것 — `getSchedule` 의 이름 걸러내기

D열(교육활동 내용)에 상황근무 이름이 섞여 들어오는 경우가 있어 걸러냅니다.
예전에는 **글자 모양**으로 판단했습니다:

```js
!/^[가-힣]{2,4}$/.test(cellD)     // 한글 2~4글자면 사람 이름으로 보고 버림
```

이 규칙이 `추석`(2글자)을 통째로 버리고 있었습니다. `추석 연휴`는 띄어쓰기가 있어
통과하는 바람에, 연휴만 뜨고 정작 추석 당일이 사라지는 모양이 됐습니다.
`삼일절`·`현충일`·`광복절`·`개천절`·`한글날`·`성탄절`·`어린이날` 도 같은 규칙에 걸립니다.

지금은 **E열(상황근무)에 실제로 등장하는 이름인지**로 판단합니다. 명절 이름이
상황근무 칸에 적힐 일은 없으므로 살아남고, D열에 섞인 이름은 그 사람이 다른 날
E열에 있으므로 그대로 걸러집니다. 이름을 모양으로 추측하는 규칙으로 되돌리지 마세요.
