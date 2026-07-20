#Requires AutoHotkey v2.0
#SingleInstance Force
SetTitleMatchMode 2   ; 창 제목 부분일치 매칭

; ============================================================
;  영남고 앱 바탕화면 위젯 런처 (AutoHotkey v2)
;  - 크롬(또는 엣지) '앱 모드'로 현황판 위젯 페이지들을 띄우고
;    지정한 위치·크기로 배치한다.
;  - 로그인은 전용 프로필에서 최초 1회만 하면 이후 모든 위젯이
;    같은 세션을 공유한다(구글 로그인 재입력 불필요).
;
;  전역 단축키:
;    Win+Alt+H : 모든 위젯 숨기기 / 다시 보이기
;    Win+Alt+R : 모든 위젯 위치·크기 재배치
;    Win+Alt+Q : 모든 위젯 종료 + 런처 종료
; ============================================================

; ── 1) 설정 ────────────────────────────────────────────────
APP_BASE := "https://kyunghwanp.github.io/test/?widget="
PROFILE  := A_AppData "\ynhs-widgets"   ; 위젯 전용 크롬 프로필(로그인 1회 공유)

; 표시할 위젯 목록: [패널키, 제목표시명, X, Y, 너비, 높이]
;   패널키 종류: schedule(학사일정) meal(급식) weather(날씨) cal(달력)
;                task(진행중인 업무) consult(상담 일정) timetable(내 시간표)
;                classtt(우리반 시간표) classorg(학급 편성) ai(주간 요약)
;   제목표시명은 index.html이 창 제목에 붙이는 한글명과 동일해야 한다.
global WIDGETS := [
  ["schedule", "학사일정",       40,  60, 380, 520],
  ["meal",     "급식",           40, 600, 380, 300],
  ["weather",  "날씨",          440,  60, 300, 220]
]

; ── 2) 브라우저 자동 탐지 (크롬 → 엣지) ──────────────────────
global BROWSER := ""
for path in [
    A_ProgramFiles "\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    EnvGet("LOCALAPPDATA") "\Google\Chrome\Application\chrome.exe",
    A_ProgramFiles "\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" ] {
    if FileExist(path) {
        BROWSER := path
        break
    }
}
if (BROWSER = "") {
    MsgBox "크롬 또는 엣지를 찾지 못했습니다.`n스크립트 상단 BROWSER 경로를 직접 지정하세요."
    ExitApp
}

; ── 3) 위젯 실행 + 배치 ─────────────────────────────────────
LaunchAll()

LaunchAll() {
    for w in WIDGETS {
        panel := w[1], title := w[2], x := w[3], y := w[4], ww := w[5], hh := w[6]
        url := APP_BASE panel
        args := '--app="' url '"'
              . ' --user-data-dir="' PROFILE '"'
              . ' --window-size=' ww ',' hh
              . ' --window-position=' x ',' y
              . ' --no-first-run --no-default-browser-check'
        Run '"' BROWSER '" ' args
        ; 창이 뜨면 AHK가 위치·크기를 다시 확정(크롬 플래그가 무시되는 경우 대비)
        wt := "영남고 위젯 · " title
        if WinWait(wt, , 12) {
            WinMove(x, y, ww, hh, wt)
        }
        Sleep 400
    }
}

; ── 4) 전역 단축키 ─────────────────────────────────────────
global hidden := false

#!h:: {           ; Win+Alt+H : 숨기기/보이기 토글
    global hidden
    hidden := !hidden
    for w in WIDGETS {
        wt := "영남고 위젯 · " w[2]
        if WinExist(wt)
            hidden ? WinHide(wt) : WinShow(wt)
    }
}

#!r:: {           ; Win+Alt+R : 재배치
    for w in WIDGETS {
        wt := "영남고 위젯 · " w[2]
        if WinExist(wt)
            WinMove(w[3], w[4], w[5], w[6], wt)
    }
}

#!q:: {           ; Win+Alt+Q : 전체 종료
    for w in WIDGETS {
        wt := "영남고 위젯 · " w[2]
        while WinExist(wt)
            WinClose(wt)
    }
    ExitApp
}
