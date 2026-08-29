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
