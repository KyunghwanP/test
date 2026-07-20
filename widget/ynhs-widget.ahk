#Requires AutoHotkey v2.0
#SingleInstance Force
; WebView2 라이브러리(thqby/ahk2_lib) — 저장소를 통째로 받아 폴더 구조를 유지해야 합니다.
;   이 스크립트와 같은 폴더에  ComVar.ahk · Promise.ahk 등 최상위 .ahk 파일들  +  WebView2\ 폴더를 두세요.
;   (WebView2.ahk 내부가 ..\ComVar.ahk, ..\Promise.ahk 등 형제/상위 파일을 참조하기 때문)
#Include %A_ScriptDir%\WebView2\WebView2.ahk

; ============================================================
;  영남고 앱 — 바탕화면 위젯 (AutoHotkey v2 + WebView2)
;  · 테두리 없는 위젯으로 현황판 각 패널을 띄운다.
;  · 로그인 세션은 숨김 폴더(%AppData%\YnhsWidget\Session)에서 공유 → 최초 1회만 로그인.
;  · 드래그 = 위젯 이동, 단순 클릭 = Neutralino 메인 앱을 해당 화면으로 실행.
;  · 빌드 시 WebView2Loader.dll을 exe에 내장(FileInstall)해 단일 exe로 배포.
;
;  전역 단축키:
;    Win+Alt+H : 숨기기/보이기   Win+Alt+R : 재배치   Win+Alt+T : 항상 위 토글   Win+Alt+Q : 종료
; ============================================================

; ── 0) 드래그 상태 전역 (반드시 최상단에서 먼저 초기화) ─────
;  WebView2 생성 중 .await()가 메시지 루프를 돌리므로, 그 사이 마우스를 떼도
;  핫키가 이 값들을 안전하게 참조할 수 있도록 창 생성보다 먼저 값을 넣는다.
global dragHwnd := 0, didDrag := false, dragX := 0, dragY := 0
global widgetsHidden := false, widgetsTop := true

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

; ── 2) WebView2Loader.dll 경로 결정 ────────────────────────
;  · 컴파일된 exe: FileInstall로 내장한 dll을 임시폴더로 꺼내 사용
;  · 그냥 스크립트 실행: 폴더에 있는 WebView2Loader.dll을 직접 사용
global DLL_PATH := ""
if A_IsCompiled {
    DLL_PATH := A_Temp "\YnhsWidget_WebView2Loader.dll"
    FileInstall("WebView2Loader.dll", DLL_PATH, 1)
} else {
    for p in [A_ScriptDir "\WebView2Loader.dll", A_ScriptDir "\WebView2\WebView2Loader.dll"]
        if FileExist(p) {
            DLL_PATH := p
            break
        }
    if (DLL_PATH = "") {
        MsgBox("WebView2Loader.dll을 찾지 못했습니다.`n이 스크립트와 같은 폴더에 WebView2Loader.dll을 두세요.`n(WebView2 폴더 안이나 NuGet Microsoft.Web.WebView2에서 구함)")
        ExitApp
    }
}
try DirCreate(SESSION)

; ── 3) 위젯 창 생성 ────────────────────────────────────────
global WidgetWins := Map()   ; hwnd -> {panel, x, y, w, h, gui, wvc}

for w in WIDGETS
    CreateWidget(w[1], w[2], w[3], w[4], w[5])

CreateWidget(panel, x, y, ww, hh) {
    g := Gui("-Caption +AlwaysOnTop +ToolWindow")   ; 테두리 없음, 작업표시줄에 안 뜸
    g.BackColor := "1F3D33"
    g.Show(Format("x{} y{} w{} h{} NoActivate", x, y, ww, hh))

    ; WebView2 컨트롤러 생성 — 공유 세션 폴더(dataDir) + dll 경로 지정
    ; 시그니처: CreateControllerAsync(hwnd, options, dataDir, edgeRuntime, dllPathOrFuncPtr)
    wvc := WebView2.CreateControllerAsync(g.hwnd, 0, SESSION, "", DLL_PATH).await()
    wvc.Fill()                       ; 클라이언트 영역 꽉 채움
    wvc.CoreWebView2.Navigate(APP_BASE panel)

    g.OnEvent("Size", (g, *) => (wvc && wvc.Fill()))
    WidgetWins[g.hwnd] := {panel: panel, x: x, y: y, w: ww, h: hh, gui: g, wvc: wvc}
}

; ── 4) 드래그(이동) vs 클릭(앱 실행) 구분 ───────────────────
~LButton:: {
    global dragHwnd, didDrag, dragX, dragY
    MouseGetPos(&mx, &my, &win)
    root := GetWidgetRoot(win)
    if !root
        return
    dragHwnd := root, didDrag := false, dragX := mx, dragY := my
    SetTimer(WatchDrag, 10)
}

~LButton Up:: {
    global dragHwnd, didDrag
    SetTimer(WatchDrag, 0)
    if (dragHwnd && !didDrag)
        LaunchMain(WidgetWins[dragHwnd].panel)   ; 움직임 없었으면 클릭 → 앱 실행
    dragHwnd := 0
}

WatchDrag() {
    global dragHwnd, didDrag, dragX, dragY
    if !dragHwnd {
        SetTimer(WatchDrag, 0)
        return
    }
    MouseGetPos(&mx, &my)
    if (Abs(mx - dragX) > 5 || Abs(my - dragY) > 5) {
        didDrag := true
        SetTimer(WatchDrag, 0)
        PostMessage(0xA1, 2, 0, , "ahk_id " dragHwnd)   ; WM_NCLBUTTONDOWN + HTCAPTION → 창 드래그
    }
}

; 마우스가 올라간 창이 위젯(또는 그 WebView2 자식)인지 확인하고 루트 위젯 hwnd 반환
GetWidgetRoot(hwnd) {
    global WidgetWins
    cur := hwnd, depth := 0
    while (cur && depth < 6) {
        if WidgetWins.Has(cur)
            return cur
        cur := DllCall("GetParent", "ptr", cur, "ptr")
        depth++
    }
    return 0
}

; ── 5) 메인 앱 실행 (클릭 시) ──────────────────────────────
LaunchMain(panel) {
    global NEU_EXE, APP_URL
    gotoPage := PanelToPage(panel)                 ; 'goto'는 AHK 예약어 → gotoPage 사용
    if FileExist(NEU_EXE)
        Run('"' NEU_EXE '" --goto=' gotoPage)      ; Neutralino 앱을 해당 화면으로
    else
        Run(APP_URL "?goto=" gotoPage)             ; 폴백: 기본 브라우저로 앱 열기
}

PanelToPage(panel) {
    m := Map("schedule","schedule", "meal","meal", "weather","home",
             "cal","schedule", "task","mytask", "consult","consult",
             "timetable","timetable", "classtt","timetable", "classorg","home", "ai","weekly")
    return m.Has(panel) ? m[panel] : "home"
}

; ── 6) 전역 단축키 ─────────────────────────────────────────
#!h:: {
    global widgetsHidden, WidgetWins
    widgetsHidden := !widgetsHidden
    for hwnd, w in WidgetWins
        widgetsHidden ? w.gui.Hide() : w.gui.Show("NoActivate")
}
#!r:: {
    global WidgetWins
    for hwnd, w in WidgetWins
        w.gui.Move(w.x, w.y, w.w, w.h)
}
#!t:: {
    global WidgetWins, widgetsTop
    widgetsTop := !widgetsTop
    for hwnd, w in WidgetWins
        WinSetAlwaysOnTop(widgetsTop, "ahk_id " hwnd)
}
#!q::ExitApp

; ── 7) 종료 시 임시 dll 정리 ───────────────────────────────
OnExit(CleanUp)
CleanUp(*) {
    global DLL_PATH
    if A_IsCompiled
        try FileDelete(DLL_PATH)
}
