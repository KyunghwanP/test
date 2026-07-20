# 영남고 앱 — 바탕화면 위젯

현황판(홈)의 각 위젯(학사일정·급식·날씨·달력·업무·상담·시간표·학급편성·주간요약)을
**바탕화면에 원하는 위치·크기로 띄우는** 기능입니다.

## 구조 (역할 분담)

| 구성 | 역할 |
|---|---|
| **크롬 앱 모드** | 위젯 화면을 그림. 앱과 같은 주소라 **로그인 세션을 그대로 공유** → 시간표·급식 등 로그인 데이터도 보임 |
| **AutoHotkey (`ynhs-widgets.ahk`)** | 크롬 창들을 원하는 위치·크기로 배치하고, 숨기기/종료 단축키 제공. `.exe`로 빌드 |
| **`index.html?widget=<패널>`** | 현황판 코드를 그대로 재사용해 해당 패널 하나만 창 전체에 표시 (앱이 바뀌어도 위젯 자동 동기화) |

위젯 페이지는 이미 배포돼 있어 브라우저에서 바로 확인할 수 있습니다. 예:
```
https://kyunghwanp.github.io/test/?widget=schedule
https://kyunghwanp.github.io/test/?widget=meal
https://kyunghwanp.github.io/test/?widget=weather
```
쓸 수 있는 패널키: `schedule meal weather cal task consult timetable classtt classorg ai`

## 사용법 (윈도우)

### 1) 그냥 스크립트로 실행 (AutoHotkey v2 설치 시)
1. [AutoHotkey v2](https://www.autohotkey.com/) 설치
2. `ynhs-widgets.ahk` 더블클릭 → 위젯들이 뜸
3. 뜬 크롬 창에서 **최초 1회 구글 로그인**(@yeungnam.hs.kr). 이후엔 자동 로그인 유지

### 2) .exe 로 빌드 (설치 없이 배포하고 싶을 때)
1. AutoHotkey v2 설치 시 함께 깔리는 **`Ahk2Exe.exe`**(컴파일러)를 실행
2. **Source**: `ynhs-widgets.ahk` 선택
3. **Base File**: `AutoHotkey64.exe` (v2) 선택
4. **Convert** → `ynhs-widgets.exe` 생성
5. 만든 exe를 실행하면 AutoHotkey 없이도 동작. 시작프로그램에 넣으면 부팅 시 자동 실행

> 명령줄로 빌드하려면:
> ```
> "C:\Program Files\AutoHotkey\Compiler\Ahk2Exe.exe" /in ynhs-widgets.ahk /out ynhs-widgets.exe /base "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
> ```

## 위젯 추가·이동·크기 조절

`ynhs-widgets.ahk` 상단의 `WIDGETS` 목록만 고치면 됩니다. 형식은
`["패널키", "제목표시명", X, Y, 너비, 높이]`:

```ahk
global WIDGETS := [
  ["schedule", "학사일정",       40,  60, 380, 520],   ; 왼쪽 위
  ["meal",     "급식",           40, 600, 380, 300],   ; 왼쪽 아래
  ["weather",  "날씨",          440,  60, 300, 220],   ; 가운데 위
  ["timetable","내 시간표",      440, 300, 360, 300]    ; 원하는 만큼 추가
]
```
- **X, Y** = 화면 왼쪽 위 기준 픽셀 좌표, **너비·높이** = 창 크기(픽셀)
- **제목표시명**은 페이지가 창 제목에 붙이는 한글명과 같아야 합니다
  (`schedule→학사일정, meal→급식, weather→날씨, cal→달력, task→진행중인 업무,
  consult→상담 일정, timetable→내 시간표, classtt→우리반 시간표,
  classorg→학급 편성, ai→주간 요약`).

## 단축키

| 키 | 동작 |
|---|---|
| `Win+Alt+H` | 모든 위젯 숨기기 / 다시 보이기 |
| `Win+Alt+R` | 위치·크기 재배치 (틀어졌을 때) |
| `Win+Alt+Q` | 모든 위젯 종료 + 런처 종료 |

## 참고 / 한계

- **로그인**: 위젯 전용 크롬 프로필(`%APPDATA%\ynhs-widgets`)을 써서 평소 크롬과 분리됩니다.
  최초 1회만 로그인하면 됩니다. 학교 내부망에서 로그인이 막히면 앱 로그인과 동일한 방법으로 처리됩니다.
- **엣지**도 자동 인식합니다(크롬이 없으면). 둘 다 없으면 스크립트 상단 `BROWSER` 경로를 직접 지정하세요.
- 크롬의 `--window-position/--window-size` 플래그가 무시되는 환경을 대비해 AutoHotkey가 창을 다시 배치합니다.
- "바탕화면에 완전히 파묻힌(아이콘 뒤) 위젯"까지는 이 스크립트 범위 밖입니다. 필요하면 알려주세요.
