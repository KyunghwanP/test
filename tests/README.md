# 테스트

이 폴더의 검사들은 **`index.html` 에서 실제 코드를 떼어내** 돌린다. 테스트 안에 로직을
다시 옮겨 적으면 원본이 바뀌어도 통과해 버려서, 검사가 아니라 장식이 된다.

## 바로 돌아가는 것 (설치 필요 없음)

```bash
node tests/current-period.test.mjs     # 시간표의 '지금 이 교시' — 가짜 시계로 확인
node workers/teacher-api.test.mjs      # teacher-api 워커 — fetch 를 스텁으로 물림
node workers/roster-split.test.mjs     # upload.html 분리 저장 → 워커 조회
```

## 설치가 필요한 것

```bash
npm i -D playwright @firebase/rules-unit-testing firebase firebase-tools
```

### 외출증 화면 (Chromium)

```bash
python3 tests/build-pass-harness.py /tmp/ph.html   # index.html 에서 코드·마크업·CSS 추출
PASS_HARNESS=/tmp/ph.html node tests/pass-ui.test.mjs
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
