#Requires AutoHotkey v2.0
#SingleInstance Force
; WebView2 라이브러리(thqby/ahk2_lib) — 저장소를 통째로 받아 폴더 구조 유지.
;   같은 폴더에  ComVar.ahk · Promise.ahk 등 최상위 .ahk  +  WebView2\ 폴더  +  WebView2Loader.dll
#Include %A_ScriptDir%\WebView2\WebView2.ahk

; ============================================================
;  영남고 앱 — 바탕화면 위젯 (AutoHotkey v2 + WebView2)
;  · 실행하면 먼저 "위젯 선택창"이 떠서 원하는 위젯만 고른다(선택 기억).
;  · 각 위젯 맨 위 손잡이 바:  ⠿ 이름 ......... [↗ 앱] [✕]
;      - 손잡이 바를 잡고 드래그  → 위젯 이동
;      - 손잡이 바 위에서 마우스 휠 → 투명도 조절
;      - ↗ 앱  → Neutralino 메인 앱을 해당 화면으로 실행
;      - ✕     → 이 위젯만 닫기
;  · 기본은 "바탕화면에 붙음(항상 아래)". Win+Alt+T 로 맨 앞/바탕 전환.
;  · 로그인 세션은 숨김 폴더에서 공유 → 최초 1회만 로그인.
;  · 위치·크기·투명도·선택은 %AppData%\YnhsWidget\config.ini 에 저장돼 다음 실행에 복원.
;
;  전역 단축키: Win+Alt+H 숨김/보임 · Win+Alt+T 맨앞/바탕 · Win+Alt+S 저장 · Win+Alt+Q 종료
; ============================================================

; ── 설정 상수 ──────────────────────────────────────────────
global APP_BASE := "https://kyunghwanp.github.io/test/?widget="
global SESSION  := A_AppData "\YnhsWidget\Session"
global CONFIG   := A_AppData "\YnhsWidget\config.ini"
global NEU_EXE  := A_ScriptDir "\ynhs-app.exe"
global APP_URL  := "https://kyunghwanp.github.io/test/"
global HANDLE_H := 26
global DEF_OPACITY := 240

; 전체 위젯 목록: [패널키, 라벨, 기본X, 기본Y, 기본너비, 기본높이, 기본선택(1/0)]
global ALL_PANELS := [
    ["fulltt",    "📅 내 시간표",       40,  60, 640, 460, "1"],
    ["schedule",  "📆 학사일정",       700,  60, 380, 520, "1"],
    ["meal",      "🍱 급식",           40, 540, 380, 300, "1"],
    ["weather",   "🌤 날씨",          440, 540, 300, 220, "0"],
    ["cal",       "🗓 달력",          700, 600, 380, 360, "0"],
    ["task",      "📌 진행중 업무",   1100,  60, 360, 300, "0"],
    ["consult",   "🗓️ 상담 일정",     1100, 380, 360, 300, "0"],
    ["timetable", "📅 오늘 시간표",   1100, 700, 360, 260, "0"],
    ["classtt",   "🏫 우리반 시간표",  760, 540, 360, 260, "0"],
    ["classorg",  "🏫 학급 편성",     1100, 380, 360, 220, "0"],
    ["ai",        "🤖 주간 요약",     1140, 580, 360, 300, "0"]
]

global widgetsHidden := false, hoverHwnd := 0
global WidgetWins := Map()   ; gui.hwnd -> {panel, opacity, gui, wvc}

; ── WebView2Loader.dll 경로 ────────────────────────────────
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
        MsgBox("WebView2Loader.dll을 찾지 못했습니다.`n이 스크립트와 같은 폴더에 두세요.")
        ExitApp
    }
}
try DirCreate(SESSION)
OnMessage(0x201, OnLButtonDown)   ; WM_LBUTTONDOWN — 손잡이 바 드래그

; ── 시작: 위젯 선택창 ──────────────────────────────────────
ShowSelector()
; Win+D(바탕화면 보기)나 다른 앱이 위젯을 최소화하면 즉시 되살려 바탕화면에 계속 떠있게 함
SetTimer(KeepVisible, 250)

KeepVisible() {
    global WidgetWins, widgetsHidden
    if widgetsHidden
        return
    for hwnd, w in WidgetWins {
        if WinExist("ahk_id " hwnd) && WinGetMinMax("ahk_id " hwnd) = -1 {   ; -1 = 최소화됨
            WinRestore("ahk_id " hwnd)
            SetWinBottom(hwnd)
        }
    }
}

ShowSelector() {
    global ALL_PANELS, CONFIG
    sel := Gui("+AlwaysOnTop -MinimizeBox", "영남고 위젯 선택")
    sel.SetFont("s10", "맑은 고딕")
    sel.Add("Text", "", "바탕화면에 띄울 위젯을 선택하세요:")
    checks := Map()
    for p in ALL_PANELS {
        on := IniRead(CONFIG, "selected", p[1], p[7]) = "1"
        checks[p[1]] := sel.Add("CheckBox", "y+8 " (on ? "Checked" : ""), p[2])
    }
    b := sel.Add("Button", "y+16 w160 h32", "선택한 위젯 띄우기")
    b.OnEvent("Click", StartWidgets)
    sel.OnEvent("Close", (*) => ExitApp())
    sel.Show()

    StartWidgets(*) {
        chosen := []
        for p in ALL_PANELS {
            picked := checks[p[1]].Value
            IniWrite(picked ? "1" : "0", CONFIG, "selected", p[1])
            if picked
                chosen.Push(p)
        }
        sel.Destroy()
        if !chosen.Length {
            MsgBox("선택한 위젯이 없습니다. 다시 실행해주세요.")
            ExitApp()
        }
        for p in chosen
            CreateWidget(p)
    }
}

; ── 위젯 창 생성 ───────────────────────────────────────────
CreateWidget(p) {
    global CONFIG, DEF_OPACITY, HANDLE_H, WidgetWins, APP_BASE, SESSION, DLL_PATH
    key := p[1], label := p[2]
    x  := Integer(IniRead(CONFIG, "pos_" key, "x", p[3]))
    y  := Integer(IniRead(CONFIG, "pos_" key, "y", p[4]))
    ww := Integer(IniRead(CONFIG, "pos_" key, "w", p[5]))
    hh := Integer(IniRead(CONFIG, "pos_" key, "h", p[6]))
    op := Integer(IniRead(CONFIG, "pos_" key, "opacity", DEF_OPACITY))

    ; -Caption(테두리없음) +Resize(가장자리 드래그로 크기조절) +ToolWindow(작업표시줄 제외)
    ; +E0x08000000(NOACTIVATE: 눌러도 앞으로 안 나옴 → 바탕화면에 붙은 느낌)
    g := Gui("-Caption +Resize +ToolWindow +E0x08000000")
    g.BackColor := "FFFFFF"                       ; 손잡이 바 흰색 — 아래 웹 내용과 자연스럽게 이어짐
    g.SetFont("s9 c555555", "맑은 고딕")          ; 어두운 회색 글자
    g.Add("Text", Format("x8 y5 w{} h16 +0x200", ww - 104), label)   ; 드래그 영역(투명 통과)
    bApp := g.Add("Button", Format("x{} y3 w62 h20", ww - 96), "↗ 앱")
    bApp.OnEvent("Click", (*) => LaunchMain(key))
    bX := g.Add("Button", Format("x{} y3 w26 h20", ww - 30), "✕")
    bX.OnEvent("Click", (*) => CloseWidget(g.hwnd))
    g.Show(Format("x{} y{} w{} h{} NoActivate", x, y, ww, hh))

    wvc := WebView2.CreateControllerAsync(g.hwnd, 0, SESSION, "", DLL_PATH).await()
    SetWebViewBounds(wvc, g.hwnd)
    wvc.CoreWebView2.Navigate(APP_BASE key)
    g.OnEvent("Size", (*) => SetWebViewBounds(wvc, g.hwnd))

    WinSetTransparent(op, "ahk_id " g.hwnd)
    SetWinBottom(g.hwnd)                       ; 바탕화면에 붙임(맨 아래)
    WidgetWins[g.hwnd] := {panel: key, opacity: op, gui: g, wvc: wvc}
}

SetWebViewBounds(wvc, hwnd) {
    global HANDLE_H
    if !wvc
        return
    DllCall("GetClientRect", "ptr", hwnd, "ptr", rc := Buffer(16))
    r := Buffer(16)
    NumPut("int", 0, r, 0), NumPut("int", HANDLE_H, r, 4)
    NumPut("int", NumGet(rc, 8, "int"), r, 8), NumPut("int", NumGet(rc, 12, "int"), r, 12)
    wvc.Bounds := r
}

SetWinBottom(hwnd) {
    ; HWND_BOTTOM(1), SWP_NOMOVE|NOSIZE|NOACTIVATE(0x13)
    DllCall("SetWindowPos", "ptr", hwnd, "ptr", 1, "int", 0, "int", 0, "int", 0, "int", 0, "uint", 0x13)
}

; ── 손잡이 바 드래그(창 이동) ──────────────────────────────
OnLButtonDown(wParam, lParam, msg, hwnd) {
    global WidgetWins
    if WidgetWins.Has(hwnd)                     ; Gui 배경/라벨을 눌렀을 때만(버튼·웹뷰 제외)
        PostMessage(0xA1, 2, 0, , "ahk_id " hwnd)   ; WM_NCLBUTTONDOWN + HTCAPTION
}

; ── 손잡이 바 위에서 마우스 휠 = 투명도 조절 ────────────────
#HotIf MouseOverHandle()
WheelUp::   AdjustOpacity(10)
WheelDown:: AdjustOpacity(-10)
#HotIf

MouseOverHandle() {
    global WidgetWins, HANDLE_H, hoverHwnd
    MouseGetPos(, &my, &win)          ; 3번째 인자 = 마우스 밑 '창' HWND (4번째는 컨트롤명이라 버그였음)
    root := WidgetWins.Has(win) ? win : 0
    if !root {
        par := DllCall("GetParent", "ptr", win + 0, "ptr")   ; win은 HWND(정수)
        root := (par && WidgetWins.Has(par)) ? par : 0
    }
    hoverHwnd := root
    if !root
        return false
    WinGetPos(, &wy, , , "ahk_id " root)
    return (my - wy) < HANDLE_H
}

AdjustOpacity(delta) {
    global WidgetWins, hoverHwnd
    if !hoverHwnd || !WidgetWins.Has(hoverHwnd)
        return
    w := WidgetWins[hoverHwnd]
    w.opacity := Max(70, Min(255, w.opacity + delta))
    WinSetTransparent(w.opacity, "ahk_id " hoverHwnd)
}

; ── 위젯 닫기 (이 위젯만) ──────────────────────────────────
CloseWidget(hwnd) {
    global WidgetWins, CONFIG
    if !WidgetWins.Has(hwnd)
        return
    SaveWidget(hwnd)
    IniWrite("0", CONFIG, "selected", WidgetWins[hwnd].panel)
    WidgetWins[hwnd].gui.Destroy()
    WidgetWins.Delete(hwnd)
    if !WidgetWins.Count
        ExitApp()
}

; ── 메인 앱 실행 (↗ 앱) ────────────────────────────────────
LaunchMain(panel) {
    global NEU_EXE, APP_URL
    gotoPage := PanelToPage(panel)
    if FileExist(NEU_EXE)
        Run('"' NEU_EXE '" --goto=' gotoPage)
    else
        Run(APP_URL "?goto=" gotoPage)
}

PanelToPage(panel) {
    m := Map("fulltt","timetable", "schedule","schedule", "meal","meal", "weather","home",
             "cal","schedule", "task","mytask", "consult","consult", "timetable","timetable",
             "classtt","timetable", "classorg","home", "ai","weekly")
    return m.Has(panel) ? m[panel] : "home"
}

; ── 저장 (위치·크기·투명도) ────────────────────────────────
SaveWidget(hwnd) {
    global WidgetWins, CONFIG
    if !WidgetWins.Has(hwnd) || !WinExist("ahk_id " hwnd)
        return
    w := WidgetWins[hwnd]
    WinGetPos(&wx, &wy, &wW, &wH, "ahk_id " hwnd)
    IniWrite(wx, CONFIG, "pos_" w.panel, "x"), IniWrite(wy, CONFIG, "pos_" w.panel, "y")
    IniWrite(wW, CONFIG, "pos_" w.panel, "w"), IniWrite(wH, CONFIG, "pos_" w.panel, "h")
    IniWrite(w.opacity, CONFIG, "pos_" w.panel, "opacity")
}

SaveAll() {
    global WidgetWins
    for hwnd, w in WidgetWins
        SaveWidget(hwnd)
}

; ── 전역 단축키 ────────────────────────────────────────────
#!h:: {   ; 숨김/보임
    global widgetsHidden, WidgetWins
    widgetsHidden := !widgetsHidden
    for hwnd, w in WidgetWins
        widgetsHidden ? w.gui.Hide() : (w.gui.Show("NoActivate"), SetWinBottom(hwnd))
}
#!t:: {   ; 맨 앞 / 바탕화면 전환
    static top := false
    global WidgetWins
    top := !top
    for hwnd, w in WidgetWins {
        WinSetAlwaysOnTop(top, "ahk_id " hwnd)
        if !top
            SetWinBottom(hwnd)
    }
}
#!s::SaveAll()
#!q::ExitApp

OnExit(OnExitFn)
OnExitFn(*) {
    global DLL_PATH
    SaveAll()
    if A_IsCompiled
        try FileDelete(DLL_PATH)
}
