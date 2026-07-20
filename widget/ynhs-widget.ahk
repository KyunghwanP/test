#Requires AutoHotkey v2.0
#SingleInstance Force
; WebView2 라이브러리(thqby/ahk2_lib) — 이 파일과 같은 폴더(Lib\)에 두세요. README 참고.
#Include %A_ScriptDir%\WebView2.ahk

; ============================================================
;  영남고 앱 — 바탕화면 위젯 (AutoHotkey v2 + WebView2)
;  · 테두리 없는 진짜 바탕화면 위젯으로 현황판 각 패널을 띄운다.
;  · 로그인 세션은 숨김 폴더(%AppData%\YnhsWidget\Session)에서 공유 → 최초 1회만 로그인.
;  · 드래그 = 위젯 이동, 단순 클릭 = Neutralino 메인 앱을 해당 화면으로 실행.
;  · WebView2Loader.dll을 exe에 내장(FileInstall)해 Widget.exe 하나로 배포.
;
;  전역 단축키:
;    Win+Alt+H : 모든 위젯 숨기기 / 보이기      Win+Alt+R : 재배치
;    Win+Alt+T : 항상 위 토글                    Win+Alt+Q : 종료
; ============================================================

; ── 1) 설정 ────────────────────────────────────────────────
global APP_BASE := "https://kyunghwanp.github.io/test/?widget="
global SESSION  := A_AppData "\YnhsWidget\Session"   ; 로그인 세션 공유(숨김) 폴더
; Neutralino 메인 앱 경로 — 본인 PC의 실제 경로로 바꾸세요(없으면 기본 브라우저로 앱을 엶).
global NEU_EXE  := A_ScriptDir "\ynhs-app.exe"
global APP_URL  := "https://kyunghwanp.github.io/test/"   ; NEU_EXE가 없을 때 브라우저 폴백

; 표시할 위젯: [패널키, X, Y, 너비, 높이]
;   패널키: schedule meal weather cal task consult timetable classtt classorg ai
global WIDGETS := [
    ["schedule",  40,  60, 380, 520],
    ["meal",      40, 600, 380, 300],
    ["weather",  440,  60, 300, 220]
]

; ── 2) WebView2Loader.dll 준비 (exe에 내장했다가 임시폴더로 꺼냄) ──
; 32bit dll을 쓰면 32/64bit 윈도우 모두 호환. 빌드 전 이 폴더에 WebView2Loader.dll을 두세요.
global DLL_TMP := A_Temp "\YnhsWidget_WebView2Loader.dll"
FileInstall("WebView2Loader.dll", DLL_TMP, 1)
try DirCreate(SESSION)

; ── 3) 위젯 창 생성 ────────────────────────────────────────
global Widgets := Map()   ; hwnd -> {panel, x, y, w, h, gui, wvc}

for w in WIDGETS
    CreateWidget(w[1], w[2], w[3], w[4], w[5])

CreateWidget(panel, x, y, ww, hh) {
    g := Gui("-Caption +AlwaysOnTop +ToolWindow +E0x80000")  ; 테두리 없음, 작업표시줄에 안 뜸
    g.BackColor := "1F3D33"
    g.Show(Format("x{} y{} w{} h{} NoActivate", x, y, ww, hh))

    ; WebView2 컨트롤러 생성 — 공유 세션 폴더 사용(로그인 1회 공유)
    ; ※ 라이브러리 버전에 따라 인자 순서가 다를 수 있음(README의 "WebView2 호출" 참고)
    wvc := WebView2.CreateControllerAsync(g.hwnd, , SESSION).await()
    wv  := wvc.CoreWebView2
    wvc.Fill()                       ; 클라이언트 영역 꽉 채움
    wv.Navigate(APP_BASE panel)

    ; 창 크기 변경 시 WebView도 리사이즈
    g.OnEvent("Size", (g, *) => (wvc && wvc.Fill()))

    Widgets[g.hwnd] := {panel: panel, x: x, y: y, w: ww, h: hh, gui: g, wvc: wvc}
}

; ── 4) 드래그(이동) vs 클릭(앱 실행) 구분 ───────────────────
; WebView2가 클라이언트 영역을 덮으므로 전역 마우스 훅으로 위젯 창을 직접 처리한다.
global dragStart := {x: 0, y: 0}, dragHwnd := 0, didDrag := false

~LButton:: {
    global dragStart, dragHwnd, didDrag
    MouseGetPos(&mx, &my, &win)
    root := GetWidgetRoot(win)
    if !root
        return
    dragHwnd := root, didDrag := false
    dragStart := {x: mx, y: my}
    SetTimer(WatchDrag, 10)
}

~LButton Up:: {
    global dragHwnd, didDrag
    SetTimer(WatchDrag, 0)
    if dragHwnd && !didDrag
        LaunchMain(Widgets[dragHwnd].panel)   ; 움직임 없었으면 클릭 → 앱 실행
    dragHwnd := 0
}

WatchDrag() {
    global dragStart, dragHwnd, didDrag
    if !dragHwnd {
        SetTimer(WatchDrag, 0)
        return
    }
    MouseGetPos(&mx, &my)
    if (Abs(mx - dragStart.x) > 5 || Abs(my - dragStart.y) > 5) {
        didDrag := true
        SetTimer(WatchDrag, 0)
        ; 제목표시줄을 잡은 것처럼 창을 드래그 (WM_NCLBUTTONDOWN, HTCAPTION)
        PostMessage(0xA1, 2, 0, , "ahk_id " dragHwnd)
    }
}

; 마우스가 올라간 창이 위젯(또는 그 WebView2 자식)인지 확인하고 루트 위젯 hwnd 반환
GetWidgetRoot(hwnd) {
    global Widgets
    cur := hwnd, depth := 0
    while (cur && depth < 6) {
        if Widgets.Has(cur)
            return cur
        cur := DllCall("GetParent", "ptr", cur, "ptr")
        depth++
    }
    return 0
}

; ── 5) 메인 앱 실행 (클릭 시) ──────────────────────────────
LaunchMain(panel) {
    global NEU_EXE, APP_URL
    goto := PanelToPage(panel)
    if FileExist(NEU_EXE)
        Run('"' NEU_EXE '" --goto=' goto)          ; Neutralino 앱을 해당 화면으로
    else
        Run(APP_URL "?goto=" goto)                 ; 폴백: 기본 브라우저로 앱 열기
}

; 위젯 패널키 → 메인 앱 탭키 (index.html navigateTo 기준)
PanelToPage(panel) {
    m := Map("schedule","schedule", "meal","meal", "weather","home",
             "cal","schedule", "task","mytask", "consult","consult",
             "timetable","timetable", "classtt","timetable", "classorg","home", "ai","weekly")
    return m.Has(panel) ? m[panel] : "home"
}

; ── 6) 전역 단축키 ─────────────────────────────────────────
global widgetsHidden := false, widgetsTop := true

#!h:: {   ; 숨기기/보이기
    global widgetsHidden, Widgets
    widgetsHidden := !widgetsHidden
    for hwnd, w in Widgets
        widgetsHidden ? w.gui.Hide() : w.gui.Show("NoActivate")
}

#!r:: {   ; 재배치
    global Widgets
    for hwnd, w in Widgets
        w.gui.Move(w.x, w.y, w.w, w.h)
}

#!t:: {   ; 항상 위 토글
    global Widgets, widgetsTop
    widgetsTop := !widgetsTop
    for hwnd, w in Widgets
        WinSetAlwaysOnTop(widgetsTop, "ahk_id " hwnd)
}

#!q::ExitApp

; ── 7) 종료 시 임시 dll 정리 ───────────────────────────────
OnExit(CleanUp)
CleanUp(*) {
    global DLL_TMP
    try FileDelete(DLL_TMP)
}
