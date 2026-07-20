# 영남고 앱 — 바탕화면 위젯

현황판(홈)의 각 패널을 **바탕화면 위젯**으로 띄우는 기능. 두 가지 방식이 있습니다.

| 파일 | 방식 | 특징 |
|---|---|---|
| **`ynhs-widget.ahk`** | AutoHotkey + **WebView2** (권장) | 테두리 없는 진짜 위젯. `Widget.exe` 하나로 배포. 드래그=이동, 클릭=메인 앱 실행 |
| `ynhs-widgets.ahk` | AutoHotkey + 크롬 앱 모드 (간편판) | 설정 없이 바로 실행되나 창 테두리가 살짝 있고 단일 exe 배포는 안 됨 |

공통으로 웹 위젯 페이지(`index.html?widget=<패널>`)를 사용합니다. 이 페이지는 이미 배포돼 있어
브라우저에서 바로 확인 가능합니다:
```
https://kyunghwanp.github.io/test/?widget=schedule   (학사일정)
https://kyunghwanp.github.io/test/?widget=meal        (급식)
https://kyunghwanp.github.io/test/?widget=weather     (날씨)
```
패널키: `schedule meal weather cal task consult timetable classtt classorg ai`

---

## A. WebView2 방식 (`ynhs-widget.ahk`) — 권장

### 구조
- **테두리 없는 창** 여러 개를 바탕화면에 배치. 각 창 안에서 WebView2가 위젯 페이지를 렌더링.
- **로그인 세션 공유**: 숨김 폴더 `%AppData%\YnhsWidget\Session`. 최초 1회만 로그인하면 모든 위젯이 공유.
- **드래그 = 위젯 이동**, **단순 클릭 = Neutralino 메인 앱을 해당 화면으로 실행** (없으면 기본 브라우저로 앱 열기).
- **단일 exe**: `WebView2Loader.dll`을 `FileInstall`로 exe에 내장 → `Widget.exe` 하나만 배포.

### 준비물 (저장소엔 라이선스/용량 때문에 미포함)

#### 1) WebView2 라이브러리 — **저장소를 통째로 받아 폴더 구조를 유지**해야 합니다
`WebView2.ahk` 파일 하나만 받으면 그 안에서 `..\ComVar.ahk` 등 다른 파일을 `#Include`하기 때문에
"cannot be opened" 오류가 연쇄적으로 납니다. 반드시 아래처럼 하세요.

1. [thqby/ahk2_lib](https://github.com/thqby/ahk2_lib) → 초록색 **Code** → **Download ZIP** → 압축 해제
2. 압축 푼 `ahk2_lib-master`에서 다음을 `ynhs-widget.ahk`가 있는 폴더로 복사:
   - **`ComVar.ahk`** 파일 (저장소 최상위에 있음)
   - **`WebView2\` 폴더 전체** (그 안의 파일들 포함)
3. 최종 폴더 구조:
   ```
   ynhs-widget\
   ├── ynhs-widget.ahk
   ├── ComVar.ahk
   ├── WebView2Loader.dll      ← 아래 2)에서 준비
   └── WebView2\
       └── WebView2.ahk  (+ 폴더 내 다른 파일들)
   ```
   > 실행 시 또 다른 파일(예: `Promise.ahk` 등)이 "cannot be opened"으로 뜨면, 같은 이름의 파일을
   > `ahk2_lib-master` 최상위에서 찾아 `ynhs-widget.ahk` 옆(같은 폴더)에 복사하면 됩니다.

#### 2) `WebView2Loader.dll` — 로더 (32bit 권장: 32/64bit 윈도우 모두 호환)
- Microsoft **WebView2 Runtime**은 최신 윈도우10/11에 이미 깔려 있지만, 로더 DLL은 별도로 있어야 합니다.
- `WebView2Loader.dll`은 NuGet 패키지 `Microsoft.Web.WebView2`의
  `runtimes\win-x86\native\WebView2Loader.dll`에서 얻거나, thqby 라이브러리 배포본에 동봉된 것을 쓰세요.
- **이 파일을 `ynhs-widget.ahk`와 같은 폴더에 두세요.**
  - **스크립트로 실행할 때**: 스크립트가 이 파일을 직접 찾아 씁니다(없으면 안내 후 종료).
  - **exe로 빌드할 때**: `FileInstall`이 이 파일을 exe 안에 내장합니다(`A_IsCompiled`일 때만 동작).
    빌드 후엔 exe 하나만 배포하면 되고, 실행 시 임시폴더로 꺼내 쓰고 종료 시 지웁니다.

### 실행 (테스트)
1. [AutoHotkey v2](https://www.autohotkey.com/) 설치
2. `widget/` 폴더에 `ynhs-widget.ahk`, `WebView2.ahk`, `WebView2Loader.dll`이 함께 있는지 확인
3. `ynhs-widget.ahk` 더블클릭 → 위젯들이 뜸
4. 뜬 위젯에서 **최초 1회 구글 로그인**(@yeungnam.hs.kr). 이후 자동 유지

### 단일 exe 빌드 (설치 없이 배포)
1. AutoHotkey v2와 함께 설치되는 **`Ahk2Exe.exe`** 실행
2. **Source**: `ynhs-widget.ahk` / **Base File**: `AutoHotkey64.exe` (v2)
3. **Convert** → `ynhs-widget.exe` 생성. `FileInstall` 덕분에 `WebView2Loader.dll`이 exe 안에 들어갑니다
4. 배포는 **exe 파일 하나만** 전달. 받는 분이 실행하면 각자 PC에 세션 폴더가 새로 생기고, 각자 1회 로그인
   - ⚠️ `%AppData%\YnhsWidget\Session` 폴더에는 **본인 로그인 정보**가 들어 있으니 남에게 보내지 마세요

> 명령줄 빌드:
> ```
> "C:\Program Files\AutoHotkey\Compiler\Ahk2Exe.exe" /in ynhs-widget.ahk /out ynhs-widget.exe /base "C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe"
> ```

### 메인 앱(클릭 시 실행) 연결
- `ynhs-widget.ahk` 상단 `NEU_EXE`를 **본인 Neutralino 앱 exe의 실제 경로**로 바꾸세요.
- 위젯을 클릭하면 그 패널에 맞는 화면으로 앱이 열립니다. 앱은 실행 인자 `--goto=<탭>`을 받아
  해당 탭으로 이동합니다(index.html에 이미 구현됨). Neutralino exe가 없으면 기본 브라우저로
  `...?goto=<탭>`을 열어 같은 결과가 됩니다.

### 위치·크기·패널 바꾸기
`ynhs-widget.ahk` 상단 `WIDGETS` 목록만 수정: `["패널키", X, Y, 너비, 높이]`
```ahk
global WIDGETS := [
    ["schedule",  40,  60, 380, 520],
    ["meal",      40, 600, 380, 300],
    ["weather",  440,  60, 300, 220],
    ["timetable",440, 300, 360, 300]   ; 원하는 만큼 추가
]
```

### 단축키
| 키 | 동작 |
|---|---|
| `Win+Alt+H` | 모든 위젯 숨기기 / 보이기 |
| `Win+Alt+R` | 위치·크기 재배치 |
| `Win+Alt+T` | 항상 위 토글 |
| `Win+Alt+Q` | 종료 |

### 알아둘 점 (윈도우에서 확인 필요)
- 이 스크립트는 리눅스 환경에서 만들어져 **AHK 실행 자체는 테스트하지 못했습니다.** 웹 위젯 페이지 동작은
  헤드리스 브라우저로 검증했습니다.
- WebView2 컨트롤러를 만드는 한 줄
  `WebView2.CreateControllerAsync(g.hwnd, , SESSION).await()` 은 thqby 라이브러리 **버전에 따라 인자
  순서/이름이 다를 수 있습니다.** 실행 시 이 부분에서 오류가 나면, 사용하는 `WebView2.ahk`의
  `CreateControllerAsync` 시그니처(특히 사용자 데이터 폴더 인자 위치)에 맞춰 조정하면 됩니다.
  막히면 오류 메시지를 알려주세요 — 바로 고쳐드립니다.

---

## B. 크롬 앱 모드 방식 (`ynhs-widgets.ahk`) — 간편판

WebView2 준비가 번거로우면 이 방식으로 **바로** 확인할 수 있습니다. 크롬(또는 엣지) 앱 모드로
위젯 페이지를 띄우고 AHK가 위치를 잡습니다. 자세한 사용법은 스크립트 상단 주석 참고.
- 장점: 준비물 없이 바로 실행. 단점: 창 테두리가 약간 있고, 단일 exe 배포/클릭-앱실행은 미지원.

---

## 웹 쪽 구현 요약 (참고)
- `index.html?widget=<패널>` : 현황판 섹션 하나만 창 전체에 표시(상단바·사이드바 숨김). 현황판 코드를
  그대로 재사용하므로 앱이 바뀌어도 위젯이 자동 동기화됩니다.
- `index.html?goto=<탭>` (브라우저) / 실행 인자 `--goto=<탭>` (Neutralino) : 로그인 후 해당 탭으로 이동.
