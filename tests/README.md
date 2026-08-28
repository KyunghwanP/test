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

`students/main` 을 통째로 갈아치우는 데다 되돌릴 수단이 없어서(시점 복구 불가),
'돌아간다'가 아니라 **무엇이 저장되는지**를 값으로 확인한다.

```bash
PS_FILE=/경로/편성표.xlsx node tests/upload-pyeonseong.test.mjs       # 파싱·병합·막는 조건
PS_FILE=/경로/편성표.xlsx node tests/upload-pyeonseong-page.test.mjs  # 실제 화면에서 저장까지
```

파일이 없으면 조용히 건너뛴다(개인정보라 저장소에 안 둔다). 화면 검사는
`prev-students.json` · `prev-contact.json` 로 기존 명렬을 흉내내야 한다 —
같은 폴더의 파서로 편성표에서 만들어 쓰면 된다.

### 외출증 화면 (Chromium)

```bash
python3 tests/build-pass-harness.py /tmp/ph.html   # index.html 에서 코드·마크업·CSS 추출
PASS_HARNESS=/tmp/ph.html node tests/pass-ui.test.mjs
```

FAB(모바일 발급 버튼)은 `#passPage` 바깥의 `position:fixed` 라 하네스가 아니라
따로 본다. 설치만 되어 있으면 바로 돌아간다.

```bash
node tests/pass-fab.test.mjs                       # FAB 이 외출증 화면에서만 뜨는지
node tests/consult-weekend.test.mjs                # 상담 주말 슬롯 + 7칸 폭 측정
node tests/task-share.test.mjs                     # 공유받은 업무에 작성자·함께 받은 사람
node tests/cal-consult.test.mjs                    # 업무 캘린더의 상담 예약 표시·상세
```

가짜 Firestore를 물려 목록 렌더·사진 표시·발급 폼·저장 payload를 실제 DOM에서 본다.

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
