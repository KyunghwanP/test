#Requires AutoHotkey v2.0
#SingleInstance Force
CoordMode "Mouse", "Screen"
; WebView2 라이브러리(thqby/ahk2_lib) — 저장소를 통째로 받아 폴더 구조 유지.
;   같은 폴더에  ComVar.ahk · Promise.ahk 등 최상위 .ahk  +  WebView2\ 폴더  +  WebView2Loader.dll
#Include %A_ScriptDir%\WebView2\WebView2.ahk

; ============================================================
;  영남고 앱 — 바탕화면 위젯 (AutoHotkey v2 + WebView2)
;  · 실행하면 "위젯 선택창"에서 원하는 위젯만 고른다(선택 기억).
;  · 트레이 아이콘 우클릭 → "위젯 추가 / 선택"으로 언제든 추가·제거.
;  · 손잡이 바:  ⠿ 이름 …… [투명도 슬라이더] [↗ 앱] [✕]
;      - 손잡이 바 드래그 → 이동   - 슬라이더 → 투명도
;      - ↗ 앱 → 메인 앱   - ✕ → 이 위젯 닫기   - 웹 위 마우스 휠 → 스크롤(원래대로)
;  · 창 가장자리 드래그 → 크기 조절. 검색창 등 입력도 정상 동작.
;  · Win+D(바탕화면 보기)로 최소화돼도 즉시 되살아나 계속 표시.
;  · 위치·크기·투명도·선택은 %AppData%\YnhsWidget\config.ini 에 저장/복원.
;
;  단축키: Win+Alt+H 숨김/보임 · Win+Alt+T 항상위 토글 · Win+Alt+A 위젯추가 · Win+Alt+S 저장 · Win+Alt+Q 종료
; ============================================================

global APP_BASE := "https://kyunghwanp.github.io/test/?widget="
global SESSION  := A_AppData "\YnhsWidget\Session"
global CONFIG   := A_AppData "\YnhsWidget\config.ini"
global NEU_EXE  := A_ScriptDir "\ynhs-app.exe"
global APP_URL  := "https://kyunghwanp.github.io/test/"
global HANDLE_H := 26
global DEF_OPACITY := 240

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

global widgetsHidden := false, alwaysTop := false
global WidgetWins := Map()   ; gui.hwnd -> {panel, opacity, gui, wvc}
global dragHwnd := 0, grabOffX := 0, grabOffY := 0

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
OnMessage(0x201, OnLButtonDown)

; ── 트레이 메뉴 (위젯 추가/저장/종료 버튼) ─────────────────
try A_TrayMenu.Delete()
A_TrayMenu.Add("위젯 추가 / 선택", (*) => ShowSelector())
A_TrayMenu.Add("현재 위치·크기 저장", (*) => SaveAll())
A_TrayMenu.Add()
A_TrayMenu.Add("종료", (*) => ExitApp())
A_TrayMenu.Default := "위젯 추가 / 선택"

; ── 시작: 위젯 선택창 ──────────────────────────────────────
ShowSelector()
SetTimer(KeepVisible, 300)   ; Win+D 등으로 최소화되면 되살림

ShowSelector() {
    global ALL_PANELS, CONFIG
    sel := Gui("+AlwaysOnTop -MinimizeBox", "영남고 위젯 선택")
    sel.SetFont("s10", "맑은 고딕")
    sel.Add("Text", "", "띄울 위젯을 선택하세요 (체크=표시, 해제=닫기):")
    checks := Map()
    for p in ALL_PANELS {
        on := FindWidgetByPanel(p[1]) ? true : (IniRead(CONFIG, "selected", p[1], p[7]) = "1")
        checks[p[1]] := sel.Add("CheckBox", "y+8 " (on ? "Checked" : ""), p[2])
    }
    b := sel.Add("Button", "y+16 w160 h32 Default", "적용")
    b.OnEvent("Click", Apply)
    sel.OnEvent("Close", (*) => sel.Destroy())
    sel.Show()

    Apply(*) {
        for p in ALL_PANELS {
            picked := checks[p[1]].Value
            IniWrite(picked ? "1" : "0", CONFIG, "selected", p[1])
            ex := FindWidgetByPanel(p[1])
            if (picked && !ex)
                CreateWidget(p)
            else if (!picked && ex)
                DestroyWidget(ex)
        }
        sel.Destroy()
    }
}

FindWidgetByPanel(panel) {
    global WidgetWins
    for hwnd, w in WidgetWins
        if (w.panel = panel)
            return hwnd
    return 0
}

; ── 위젯 창 생성 ───────────────────────────────────────────
CreateWidget(p) {
    global CONFIG, DEF_OPACITY, WidgetWins, APP_BASE, SESSION, DLL_PATH
    key := p[1], label := p[2]
    x  := Integer(IniRead(CONFIG, "pos_" key, "x", p[3]))
    y  := Integer(IniRead(CONFIG, "pos_" key, "y", p[4]))
    ww := Integer(IniRead(CONFIG, "pos_" key, "w", p[5]))
    hh := Integer(IniRead(CONFIG, "pos_" key, "h", p[6]))
    op := Integer(IniRead(CONFIG, "pos_" key, "opacity", DEF_OPACITY))

    g := Gui("-Caption +Resize +ToolWindow")   ; 테두리없음·크기조절·작업표시줄제외 (활성화 가능 → 입력됨)
    g.BackColor := "FFFFFF"
    g.SetFont("s9 c555555", "맑은 고딕")
    g.Add("Text", Format("x8 y5 w{} h16 +0x200", ww - 190), label)
    sld := g.Add("Slider", Format("x{} y4 w78 h18 Range70-255 Line5 Page20", ww - 178), op)
    sld.OnEvent("Change", OnOpacity)
    bApp := g.Add("Button", Format("x{} y3 w58 h20", ww - 94), "↗ 앱")
    bApp.OnEvent("Click", (*) => LaunchMain(key))
    bX := g.Add("Button", Format("x{} y3 w26 h20", ww - 30), "✕")
    bX.OnEvent("Click", (*) => DestroyWidget(g.hwnd, true))
    g.Show(Format("x{} y{} w{} h{} NoActivate", x, y, ww, hh))

    wvc := WebView2.CreateControllerAsync(g.hwnd, 0, SESSION, "", DLL_PATH).await()
    SetWebViewBounds(wvc, g.hwnd)
    wvc.CoreWebView2.Navigate(APP_BASE key)
    g.OnEvent("Size", (*) => SetWebViewBounds(wvc, g.hwnd))
    WinSetTransparent(op, "ahk_id " g.hwnd)
    WidgetWins[g.hwnd] := {panel: key, opacity: op, gui: g, wvc: wvc}

    OnOpacity(ctrl, *) {
        WinSetTransparent(ctrl.Value, "ahk_id " g.hwnd)
        if WidgetWins.Has(g.hwnd)
            WidgetWins[g.hwnd].opacity := ctrl.Value
    }
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

; ── 손잡이 바 드래그(수동 이동) ────────────────────────────
OnLButtonDown(wParam, lParam, msg, hwnd) {
    global WidgetWins, dragHwnd, grabOffX, grabOffY
    if !WidgetWins.Has(hwnd)          ; Gui 배경/라벨만(버튼·슬라이더·웹뷰 제외)
        return
    MouseGetPos(&cx, &cy)
    WinGetPos(&wx, &wy, , , "ahk_id " hwnd)
    dragHwnd := hwnd, grabOffX := cx - wx, grabOffY := cy - wy
    SetTimer(DragMove, 10)
}

DragMove() {
    global dragHwnd, grabOffX, grabOffY
    if !dragHwnd || !GetKeyState("LButton", "P") {
        if dragHwnd
            SaveWidget(dragHwnd)
        dragHwnd := 0
        SetTimer(DragMove, 0)
        return
    }
    MouseGetPos(&cx, &cy)
    WinMove(cx - grabOffX, cy - grabOffY, , , "ahk_id " dragHwnd)
}

; ── Win+D 등 최소화 시 되살림 ──────────────────────────────
KeepVisible() {
    global WidgetWins, widgetsHidden
    if widgetsHidden
        return
    for hwnd, w in WidgetWins
        if WinExist("ahk_id " hwnd) && WinGetMinMax("ahk_id " hwnd) = -1
            WinRestore("ahk_id " hwnd)
}

; ── 위젯 제거 ──────────────────────────────────────────────
DestroyWidget(hwnd, fromButton := false) {
    global WidgetWins, CONFIG
    if !WidgetWins.Has(hwnd)
        return
    SaveWidget(hwnd)
    IniWrite("0", CONFIG, "selected", WidgetWins[hwnd].panel)
    WidgetWins[hwnd].gui.Destroy()
    WidgetWins.Delete(hwnd)
    ; ✕로 마지막 위젯까지 닫아도 트레이는 남겨 다시 추가할 수 있게 함(종료는 트레이 메뉴/Win+Alt+Q)
}

; ── 메인 앱 실행 ───────────────────────────────────────────
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

; ── 저장 ───────────────────────────────────────────────────
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
#!h:: {
    global widgetsHidden, WidgetWins
    widgetsHidden := !widgetsHidden
    for hwnd, w in WidgetWins
        widgetsHidden ? w.gui.Hide() : w.gui.Show("NoActivate")
}
#!t:: {
    global WidgetWins, alwaysTop
    alwaysTop := !alwaysTop
    for hwnd, w in WidgetWins
        WinSetAlwaysOnTop(alwaysTop, "ahk_id " hwnd)
}
#!a::ShowSelector()
#!s::SaveAll()
#!q::ExitApp

OnExit(OnExitFn)
OnExitFn(*) {
    global DLL_PATH
    SaveAll()
    if A_IsCompiled
        try FileDelete(DLL_PATH)
}
