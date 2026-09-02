# 테스트

이 폴더의 검사들은 **`index.html` 에서 실제 코드를 떼어내** 돌린다. 테스트 안에 로직을
다시 옮겨 적으면 원본이 바뀌어도 통과해 버려서, 검사가 아니라 장식이 된다.

## 바로 돌아가는 것 (설치 필요 없음)

```bash
node tests/current-period.test.mjs     # 시간표의 '지금 이 교시' + 자정 넘김 — 가짜 시계로 확인
node tests/sw-cache.test.mjs           # 서비스워커 캐시 전략 — Cache/fetch 를 스텁으로 물림
node tests/operating.test.mjs          # 운영표(요일 대체·창체 이동·시험·휴일) 해석
node tests/account-gate.test.mjs       # 학생 계정 차단 — 화면·규칙·워커가 같은 조건인지
node tests/inline-handlers.test.mjs    # onclick 이 부르는 함수가 window 에 있는지
node tests/widget-config.test.mjs      # 위젯이 설정 폴더를 만들고 쓰는지(.ahk 원본 확인)
node workers/teacher-api.test.mjs      # teacher-api 워커 — fetch 를 스텁으로 물림
node workers/roster-split.test.mjs     # upload.html 분리 저장 → 워커 조회
node workers/parent-verify.test.mjs    # 학부모 인증 — 나뉜 명렬에서 생년월일 찾기
```

## 설치가 필요한 것

```bash
npm i -D playwright @firebase/rules-unit-testing firebase firebase-tools
npm i -D xlsx@0.18.5            # 편성표 검사 — upload.html 이 쓰는 그 버전
```

### 편성표 업로드 (실제 편성표 파일 필요)

편성표 한 파일이 **명렬 · 선택과목 · 원본 파일** 세 곳을 갈아치우는 데다 되돌릴
수단이 없어서(시점 복구 불가), '돌아간다'가 아니라 **무엇이 저장되는지**를 값으로
확인한다. 같은 시트의 왼쪽(신원)이 명렬, `주소` 오른쪽이 과목이다.

```bash
PS_FILE=/경로/편성표.xlsx node tests/upload-pyeonseong.test.mjs        # 파싱·병합·막는 조건
PS_FILE=/경로/편성표.xlsx node tests/upload-pyeonseong-worker.test.mjs # 저장될 값으로 워커를 돌려 봄
PS_FILE=/경로/편성표.xlsx node tests/upload-pyeonseong-page.test.mjs   # 실제 화면에서 저장까지
```

파일이 없으면 조용히 건너뛴다(개인정보라 저장소에 안 둔다). 진짜 파일이 없을 때는
같은 지문(1020명 / 제외 55 / 343·322·355 / 앞 0 3건 / 번호 구멍 13반)을 재현한
대체 파일을 만들어 쓴다. 화면 검사가 쓰는 `prev-students.json` · `prev-contact.json`
(기존 DB 흉내)도 여기서 같이 나온다.

```bash
node tests/make-pyeonseong-fixture.mjs /tmp
PS_FILE=/tmp/pyeonseong.xlsx node tests/upload-pyeonseong-page.test.mjs
```

`upload-pyeonseong-worker` 는 `consult-api` 의 `handleVerify` 판정식과 `teacher-api` 의
`photoKey` 를 **워커 소스에서 그대로 떼어** 저장될 명렬에 돌린다. 학부모 인증이
전원 통과하는지, 사진 자리에 남의 얼굴이 붙지 않는지를 업로드 전에 값으로 본다.

화면 검사는 세 시나리오를 돈다 — 셋 다 저장 / 한 항목만 끄고 저장 / `주소` 열이
없는 학년이 있을 때. 마지막이 특히 중요하다: 못 읽은 학년은 저장 때 '이번에 없는 반'
으로 취급돼 **선택과목이 통째로 삭제**되므로, 그 항목만 잠기고 명렬은 그대로
저장돼야 한다.

### 교원 비상연락망 다시 올리기

```bash
node tests/upload-staff-contact-guard.test.mjs      # 편성표 파일 필요 없음
```

내려받은 파일에는 휴대폰이 **비어 있다** — 번호는 `contactsPhone` 에 있고 규칙이
브라우저 읽기를 막아 놓았다(워커만 읽는다). 그 파일을 고쳐 다시 올리면 저장이
통째로 덮어쓰기라 전 교직원의 번호가 한 번에 날아가고, 되돌릴 수단이 없다.

규칙(`contactsPhone` 읽기 = 관리자)을 올리고 나면 사람별로 합칠 수 있다 — 휴대폰
칸이 비면 저장된 번호를 그대로 두고, 적은 사람만 바꾼다. 지우려면 `-` 를 적는다.
아직 안 올렸을 때도 앱이 돌아가야 하므로 **양쪽 상태를 다 돌려 본다.** 규칙 전에는
번호를 못 읽어 병합이 안 되니, 명단의 `hasPhone` 으로 '몇 명이 지워지는지'를 세서
막고 `명단만 저장` 을 내준다.
저장은 통째로 갈아치우기라 **파일에 없는 사람은 명단에서 사라진다.** 퇴직·전출을
그렇게 처리하니 그 자체는 맞는 동작인데, '몇 명만 고쳐서 올리는' 경우와 파일만
봐서는 구분할 수 없다. 실제로 2명짜리 파일을 올려 30명이 2명이 됐다. 그래서
사라질 사람을 이름으로 보여 주고, 지울 때만 확인을 받는다.

검사는 실제 화면에 파일을 올려 저장까지 눌러 보고 **무엇이 저장됐는지를 값으로**
본다 — 막히는지, `명단만 저장` 이 `contactsPhone` 을 안 건드리는지, `hasPhone` 이
그대로인지, 번호가 든 원본은 예전처럼 둘 다 저장되는지, 일부만 든 파일이 확인
없이는 저장되지 않는지.

**퇴직 자리에 신규임용이 오는 경우**를 따로 본다. 그 행의 이름을 바꾸고 새 번호를
넣는 실제 상황인데, 여기서 절대 안 되는 것은 **퇴직자 번호가 신규자에게 붙는 것**
이다. 번호는 이름으로 찾으니 새 이름은 못 찾아야 정상이다. 번호를 깜빡하고 이름만
바꾼 경우에도 빈칸으로 남아야 한다.

### 동아리 개별 입력

```bash
node tests/upload-club-per-student.test.mjs      # 편성표 파일 필요 없음
```

편성표에 동아리 열이 없어서, 명렬을 갱신하면 새로 전입한 학생만 동아리가 빈다.
그 몇 명을 채우는 화면인데 `students/main` 을 통째로 다시 쓰므로,
**동아리 말고는 한 글자도 안 바뀌는지**를 저장된 배열과 원본을 필드 단위로 비교해
확인한다. 연락처 문서(`studentsContact`)는 아예 안 건드려야 한다.

### 외출증 화면 (Chromium)

```bash
python3 tests/build-pass-harness.py /tmp/ph.html   # index.html 에서 코드·마크업·CSS 추출
PASS_HARNESS=/tmp/ph.html node tests/pass-ui.test.mjs
```

FAB(모바일 발급 버튼)은 `#passPage` 바깥의 `position:fixed` 라 하네스가 아니라
따로 본다. 설치만 되어 있으면 바로 돌아간다.

```bash
node tests/pass-fab.test.mjs                       # FAB 이 외출증 화면에서만 뜨는지
node tests/seat-inpage.test.mjs                    # 자리 배치 '크게 보기' → 앱 안 화면 + 돌아가기
node tests/weekly-chips-live.test.mjs              # 주차 칩이 새로고침 없이 늘어나는지
node tests/usage-stats.test.mjs                    # 사용 현황 · 전체 새로고침
node tests/consult-weekend.test.mjs                # 상담 주말 슬롯 + 7칸 폭 측정
node tests/task-share.test.mjs                     # 공유받은 업무에 작성자·함께 받은 사람
node tests/cal-consult.test.mjs                    # 업무 캘린더의 상담 예약 표시·상세
```

가짜 Firestore를 물려 목록 렌더·사진 표시·발급 폼·저장 payload를 실제 DOM에서 본다.

### 사용 현황 (usage.html · 🥚 빠른 메모 제목 5연타)

화면은 **`usage.html` 로 따로 뺐고, 앱 안에서 iframe 으로 띄운다**(자리 배치와 같은
방식). `index.html` 은 전 교사에게 내려가므로 거기 두면 관리자 혼자 보는 화면의
코드가 모두에게 실린다 — 여기에는 껍데기(iframe·돌아가기)만 둔다. 자료를 지키는 것은
여전히 규칙이다(`usage` 읽기 = 관리자) — 파일을 나눈 것은 굳이 안 내려보내려는
것이지 그것으로 막는 것이 아니다. `index.html` 에는 **세는 코드만** 남는다.


로그인 이벤트로는 사용량을 못 센다 — 세션이 유지돼 한 번 로그인하면 몇 달씩 다시
안 뜬다. 그래서 **앱을 연 횟수**와 **탭을 연 횟수**를 센다. 한 사람 한 달치가 문서
하나(`usage/{이메일}/m/{YYYY-MM}`)라, 잘못 쓰면 그 달 전체가 날아간다.

- 세는 게 맞는가 — 앱 열기·탭 이동·다시 열었을 때 이어지기
- 저장이 **그날 줄만** 건드리는가(merge), 탭마다 저장하지 않고 모아서 보내는가
- 관리자 말고는 못 들어가는가 — 다른 교사·보기 모드에서 5연타해도 안 열린다
- 전 교사에게 내려가는 파일에 화면 코드가 남아 있지 않은가
- **usage.html 이 실제로 뜨는가** — 가짜 Firestore를 물려 띄우고, 런타임 오류·집계·
  기능별 막대·옛 버전 표시·'모두 새로고침'을 값으로 본다
- 화면 집계가 맞는가 — 사람 수·횟수·날짜별 막대·기능 순위·안 쓴 사람
- **부르는 함수가 원본에 정말 있는가**

**전체 새로고침**도 여기서 본다. 배포해도 탭을 켜 둔 사람은 옛 화면을 계속 쓴다 —
서비스워커의 '새 버전' 안내는 화면을 새로 열 때만 뜨니 켜 둔 탭에는 영영 안 뜬다.
관리자가 `appNotice/reload` 의 번호를 올리면 열려 있는 화면들이 스냅샷으로 받는다.

- 처음 보는 기기는 번호만 적어 둔다(안 그러면 배포 순간 전원이 새로고침한다)
- 같은 번호가 다시 와도 아무 일 없다
- **묻지 않고 조용히 새로고침한다** — 막대도 카운트다운도 없다
- **보던 탭·스크롤로 돌아간다.** 기존 `restoreLastView` 는 시간표 안의 선택만
  되살리고 어떤 탭이었는지는 모른다 — 그대로 두면 현황판으로 튄다
- **적고 있으면 안 한다** — 그때만 막대를 띄우고 본인이 누를 때까지 기다린다
- 사람별 표에 지금 쓰는 버전이 뜨고, 옛 버전은 빨갛게 짚어 준다

'적는 중'은 넷 중 하나다 — 커서가 있는 입력칸에 글자가 있다 · 커서가 있는 편집
영역에 내용이 있다 · 모달이 열려 있다 · 화면에 보이는 `textarea` 중 내용이 있는
것이 하나라도 있다. 마지막이 중요하다. 적다가 다른 데를 클릭하면 커서가 빠지는데,
그때도 적던 내용은 살아 있어야 한다.

`location.reload` 는 덮어쓸 수 없어서(읽기 전용) 실제로 새로고침이 일어난다. 그래서
'몇 번 다시 받아 갔는지'를 라우트에서 센다. `setContent` 로 띄우면 localStorage 가
막힌 출처가 돼 저장 경로를 아예 못 보므로, 진짜 출처처럼 띄운다.

화면을 실제로 띄우는 검사가 왜 필요한가: index.html 에서 화면을 떼어 오면서 함수
밖에 있던 `let _usageBusy` 를 안 옮겼는데, 함수 호출을 훑는 정적 검사로는 변수
참조를 못 본다. 화면은 통째로 비고 콘솔에만 ReferenceError 가 떴다.

아래 항목은 하네스의 함정 때문에 넣었다. 하네스가 없는 함수를 대신 정의해 주면
원본에 없어도 검사는 통과한다. 실제로 그렇게 통과시켰다 — `esc()` 는 index.html 에
없고 `escapeHtml()` 이 맞는데, 하네스가 `esc` 를 정의해 버려서 화면이
'불러오는 중…' 에서 멈추는 걸 못 잡았다. 지금은 하네스가 원본에서 `escapeHtml` 을
떼어 오고, 이 구간이 부르는 이름이 원본(또는 import)에 있는지 따로 본다.

### 보안 규칙 (Firestore 에뮬레이터)

에뮬레이터를 먼저 띄운다. `firebase.json` 에 포트를 지정해 두고:

```bash
npx firebase emulators:start --only firestore    # 기본 8099 로 맞춰 둘 것
node tests/pass-rules.test.mjs                   # 외출증 규칙
```

> 에뮬레이터가 거부된 쓰기마다 `evaluation error` 를 함께 찍는다. 규칙이
> `resource.data.…` 를 참조하는 거부 사례에서만 나오고 **결과는 항상 의도대로**다
> (거부는 거부, 허용은 허용). 원인을 끝까지 규명하지 못했으니 이 줄이 보인다고
> 규칙이 깨진 것으로 오해하지 말 것 — 판단은 통과/실패 집계로 한다.
