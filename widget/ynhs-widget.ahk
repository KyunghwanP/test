#Requires AutoHotkey v2.0
#SingleInstance Force
CoordMode "Mouse", "Screen"
; WebView2 라이브러리(thqby/ahk2_lib) — 저장소를 통째로 받아 폴더 구조 유지.
;   같은 폴더에  ComVar.ahk · Promise.ahk 등 최상위 .ahk  +  WebView2\ 폴더  +  WebView2Loader.dll
#Include %A_ScriptDir%\WebView2\WebView2.ahk

; ============================================================
;  영남고 앱 — 바탕화면 위젯 (AutoHotkey v2 + WebView2)
;  · 창의 '소유자'를 바탕화면(Progman)으로 지정 → 일반 창처럼 타이핑되면서
;    Win+D(바탕화면 보기)에도 최소화되지 않고 바탕화면 위에 남는다.
;  · 트레이 아이콘 우클릭 → "위젯 추가 / 선택"으로 언제든 추가·제거.
;  · 손잡이 바:  이름 …… [투명도 슬라이더] [↗ 앱] [✕]  (크기 조절 시 우측 정렬 유지)
;      - 손잡이 바 드래그 → 이동   - 슬라이더 → 투명도
;      - ↗ 앱 → 메인 앱   - ✕ → 이 위젯 닫기   - 웹 위 마우스 휠 → 스크롤(원래대로)
;  · 창 가장자리 드래그 → 크기 조절. 위치·크기·투명도·선택은 config.ini에 저장/복원.
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
global PROGMAN := DllCall("FindWindow", "str", "Progman", "ptr", 0, "ptr")

global ALL_PANELS := [
    ["memo",      "📝 빠른 메모",       40,  60, 340, 420, "1"],
    ["fulltt",    "📅 내 시간표",      400,  60, 640, 460, "1"],
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

global widgetsHidden := false
; 입력(검색·메모)이 필요한 패널 — 이건 일반 창(타이핑 O), 나머지는 바탕화면 완전 고정(면역)
global INPUT_PANELS := Map("memo", 1, "fulltt", 1)
global WidgetWins := Map()   ; gui.hwnd -> {panel, opacity, gui, wvc}
global dragHwnd := 0, grabOffX := 0, grabOffY := 0, dragW := 0, dragH := 0
global SNAP := 14   ; 자석 스냅 거리(px)

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

; ── 트레이 메뉴 ────────────────────────────────────────────
try A_TrayMenu.Delete()
A_TrayMenu.Add("위젯 추가 / 선택", (*) => ShowSelector())
A_TrayMenu.Add("현재 위치·크기 저장", (*) => SaveAll())
A_TrayMenu.Add()
A_TrayMenu.Add("종료", (*) => ExitApp())
A_TrayMenu.Default := "위젯 추가 / 선택"

ShowSelector()
SetTimer(KeepVisible, 300)   ; 폴백: 혹시 최소화되면 되살림
SetTimer(HoverCheck, 120)    ; 마우스 올린 위젯만 손잡이 바 표시

; 최소화 '시작' 순간을 이벤트로 잡아 즉시 되돌림 → Win+D·바탕화면 보기에도 안 사라짐
;   EVENT_SYSTEM_MINIMIZESTART = 0x0016
global gMinCb := CallbackCreate(OnMinimizeStart, "F", 7)
global gWinHook := DllCall("SetWinEventHook", "uint", 0x0016, "uint", 0x0016, "ptr", 0
    , "ptr", gMinCb, "uint", 0, "uint", 0, "uint", 0, "ptr")

OnMinimizeStart(hHook, event, hwnd, idObj, idChild, thread, time) {
    global WidgetWins
    if WidgetWins.Has(hwnd)
        DllCall("ShowWindow", "ptr", hwnd, "int", 9)   ; SW_RESTORE — 최소화되기 전에 되돌림
}

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
    global CONFIG, DEF_OPACITY, WidgetWins, APP_BASE, SESSION, DLL_PATH, PROGMAN, INPUT_PANELS
    key := p[1], label := p[2]
    x  := Integer(IniRead(CONFIG, "pos_" key, "x", p[3]))
    y  := Integer(IniRead(CONFIG, "pos_" key, "y", p[4]))
    ww := Integer(IniRead(CONFIG, "pos_" key, "w", p[5]))
    hh := Integer(IniRead(CONFIG, "pos_" key, "h", p[6]))
    op := Integer(IniRead(CONFIG, "pos_" key, "opacity", DEF_OPACITY))

    g := Gui("-Caption +Resize +ToolWindow")   ; 테두리없음·크기조절·작업표시줄제외 (활성화 가능 → 입력됨)
    g.BackColor := "FFFFFF"
    g.SetFont("s9 c555555", "맑은 고딕")
    lbl  := g.Add("Text", Format("x8 y5 w{} h16 +0x200", ww - 190), label)
    sld  := g.Add("Slider", Format("x{} y4 w78 h18 Range70-255 Line5 Page20", ww - 178), op)
    bApp := g.Add("Button", Format("x{} y3 w58 h20", ww - 94), "↗ 앱")
    bX   := g.Add("Button", Format("x{} y3 w26 h20", ww - 30), "✕")
    sld.OnEvent("Change", OnOpacity)
    bApp.OnEvent("Click", (*) => LaunchMain(key))
    bX.OnEvent("Click", (*) => DestroyWidget(g.hwnd, true))
    g.Show(Format("x{} y{} w{} h{} NoActivate", x, y, ww, hh))

    ; WebView2 생성 — 실패(세션 폴더 잠김 등) 시 재시도 후, 그래도 안 되면 이 위젯만 건너뜀
    wvc := ""
    loop 2 {
        try {
            wvc := WebView2.CreateControllerAsync(g.hwnd, 0, SESSION, "", DLL_PATH).await()
            break
        } catch as e {
            if (A_Index = 1) {
                Sleep 700
                continue
            }
            g.Destroy()
            MsgBox("'" label "' 위젯을 열지 못했습니다.`n`nWebView2 세션이 잠겨 있을 수 있습니다. 작업관리자에서 msedgewebview2.exe를 모두 종료하거나 PC를 재시작한 뒤 다시 실행해 주세요.`n`n(" e.Message ")", "영남고 위젯", 0x30)
            return
        }
    }
    wvc.CoreWebView2.Navigate(PanelUrl(key) "&t=" A_Now)   ; &t= : 실행마다 최신 페이지 로드(캐시 지연 방지)
    g.OnEvent("Size", OnResize)
    WinSetTransparent(op, "ahk_id " g.hwnd)

    ; 창 그림자 제거(DWM 비클라이언트 렌더링 끔) — 환경에 따라 효과 다를 수 있음
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", g.hwnd, "int", 2, "int*", 1, "int", 4)  ; NCRENDERING_POLICY=DISABLED

    ; 입력 필요 위젯(메모·시간표)은 일반 창(타이핑 O), 나머지는 바탕화면 완전 고정(면역)
    wantPin := !INPUT_PANELS.Has(key)
    ApplyPin(g.hwnd, wantPin)

    ; 처음엔 손잡이 바 숨김(웹 화면만) — 마우스 올리면 나타남(HoverCheck)
    lbl.Visible := false, sld.Visible := false, bApp.Visible := false, bX.Visible := false
    WidgetWins[g.hwnd] := {panel: key, opacity: op, gui: g, wvc: wvc,
                           lbl: lbl, sld: sld, bApp: bApp, bX: bX, handleShown: false, pinned: wantPin}
    SetWebViewBounds(wvc, g.hwnd, 0)

    ; 크기 조절 시 손잡이 바 컨트롤 우측 정렬 재배치 + 웹뷰 리사이즈 + 크기 저장(디바운스)
    OnResize(gg, minmax, w, h) {
        lbl.Move(8, 5, w - 190, 16)
        sld.Move(w - 178, 4)
        bApp.Move(w - 94, 3)
        bX.Move(w - 30, 3)
        SetWebViewBounds(wvc, g.hwnd, WidgetWins.Has(g.hwnd) && WidgetWins[g.hwnd].handleShown ? HANDLE_H : 0)
        SetTimer(() => SaveWidget(g.hwnd), -500)   ; 마지막 리사이즈 0.5초 후 1회 저장
    }
    OnOpacity(ctrl, *) {
        WinSetTransparent(ctrl.Value, "ahk_id " g.hwnd)
        if WidgetWins.Has(g.hwnd)
            WidgetWins[g.hwnd].opacity := ctrl.Value
    }
}

; ── 고정 모드(위젯별) ─────────────────────────────────────
;  doPin=true  : 바탕화면(Progman)의 자식 → Win+D에도 100% 안 사라짐(단, 타이핑 불가)
;  doPin=false : 일반 창(소유자만 바탕화면) → 타이핑 가능(Win+D는 이벤트 훅으로 되돌림)
ApplyPin(hwnd, doPin) {
    global PROGMAN
    if !PROGMAN
        return
    if doPin {
        DllCall("SetParent", "ptr", hwnd, "ptr", PROGMAN)          ; 바탕화면 자식(완전 고정)
    } else {
        DllCall("SetParent", "ptr", hwnd, "ptr", 0)                ; 최상위 창으로 복귀(입력 가능)
        DllCall("SetWindowLongPtr", "ptr", hwnd, "int", -8, "ptr", PROGMAN, "ptr")  ; 소유자=바탕화면(맨 아래)
    }
}

SetWebViewBounds(wvc, hwnd, topOff) {
    if !wvc
        return
    DllCall("GetClientRect", "ptr", hwnd, "ptr", rc := Buffer(16))
    r := Buffer(16)
    NumPut("int", 0, r, 0), NumPut("int", topOff, r, 4)
    NumPut("int", NumGet(rc, 8, "int"), r, 8), NumPut("int", NumGet(rc, 12, "int"), r, 12)
    wvc.Bounds := r
}

; ── 마우스 올린 위젯만 손잡이 바 표시(쌱 나타남) ────────────
HoverCheck() {
    global WidgetWins, dragHwnd, HANDLE_H
    MouseGetPos(, , &win)
    root := DllCall("GetAncestor", "ptr", win, "uint", 2, "ptr")   ; GA_ROOT
    if !WidgetWins.Has(root)
        root := 0
    for hwnd, w in WidgetWins {
        if !WinExist("ahk_id " hwnd)      ; 닫히는 중인 위젯은 건너뜀
            continue
        want := (hwnd = root) || (dragHwnd = hwnd)   ; 드래그 중엔 계속 표시
        if (w.handleShown != want) {
            w.handleShown := want
            try {
                w.lbl.Visible := want, w.sld.Visible := want, w.bApp.Visible := want, w.bX.Visible := want
                SetWebViewBounds(w.wvc, hwnd, want ? HANDLE_H : 0)
            }
        }
    }
}

; ── 손잡이 바 드래그(수동 이동) ────────────────────────────
OnLButtonDown(wParam, lParam, msg, hwnd) {
    global WidgetWins, dragHwnd, grabOffX, grabOffY
    if !WidgetWins.Has(hwnd)          ; Gui 배경/라벨만(버튼·슬라이더·웹뷰 제외)
        return
    MouseGetPos(&cx, &cy)
    WinGetPos(&wx, &wy, &wW, &wH, "ahk_id " hwnd)
    dragHwnd := hwnd, grabOffX := cx - wx, grabOffY := cy - wy, dragW := wW, dragH := wH
    SetTimer(DragMove, 10)
}

DragMove() {
    global dragHwnd, grabOffX, grabOffY, dragW, dragH, WidgetWins, SNAP
    if !dragHwnd || !GetKeyState("LButton", "P") {
        if dragHwnd
            SaveWidget(dragHwnd)
        dragHwnd := 0
        SetTimer(DragMove, 0)
        return
    }
    MouseGetPos(&cx, &cy)
    nx := cx - grabOffX, ny := cy - grabOffY
    ; 다른 위젯 가장자리에 가까우면 자석처럼 붙임
    for hwnd, w in WidgetWins {
        if (hwnd = dragHwnd)
            continue
        WinGetPos(&ox, &oy, &oW, &oH, "ahk_id " hwnd)
        ; 세로로 겹치는 구간이 있을 때만 좌우 스냅
        if (ny < oy + oH && ny + dragH > oy) {
            if Abs((nx + dragW) - ox) <= SNAP
                nx := ox - dragW
            else if Abs(nx - (ox + oW)) <= SNAP
                nx := ox + oW
            else if Abs(nx - ox) <= SNAP
                nx := ox
            else if Abs((nx + dragW) - (ox + oW)) <= SNAP
                nx := ox + oW - dragW
        }
        ; 가로로 겹치는 구간이 있을 때만 상하 스냅
        if (nx < ox + oW && nx + dragW > ox) {
            if Abs((ny + dragH) - oy) <= SNAP
                ny := oy - dragH
            else if Abs(ny - (oy + oH)) <= SNAP
                ny := oy + oH
            else if Abs(ny - oy) <= SNAP
                ny := oy
            else if Abs((ny + dragH) - (oy + oH)) <= SNAP
                ny := oy + oH - dragH
        }
    }
    WinMove(nx, ny, , , "ahk_id " dragHwnd)
}

KeepVisible() {
    global WidgetWins, widgetsHidden
    if widgetsHidden
        return
    for hwnd, w in WidgetWins
        if WinExist("ahk_id " hwnd) && WinGetMinMax("ahk_id " hwnd) = -1
            WinRestore("ahk_id " hwnd)
}

DestroyWidget(hwnd, fromButton := false) {
    global WidgetWins, CONFIG
    if !WidgetWins.Has(hwnd)
        return
    SaveWidget(hwnd)
    IniWrite("0", CONFIG, "selected", WidgetWins[hwnd].panel)
    g := WidgetWins[hwnd].gui
    WidgetWins.Delete(hwnd)     ; 먼저 목록에서 제거 → 타이머가 파괴 중 컨트롤을 안 만짐
    try g.Destroy()
}

LaunchMain(panel) {
    global NEU_EXE, APP_URL
    gotoPage := PanelToPage(panel)
    if FileExist(NEU_EXE)
        Run('"' NEU_EXE '" --goto=' gotoPage)
    else
        Run(APP_URL "?goto=" gotoPage)
}

; 위젯 페이지 URL — 메모는 독립 페이지(memo2.html), 나머지는 index.html?widget=
PanelUrl(panel) {
    global APP_BASE, APP_URL
    if (panel = "memo")
        return APP_URL "memo2.html?embed=1"
    return APP_BASE panel
}

PanelToPage(panel) {
    m := Map("memo","home", "fulltt","timetable", "schedule","schedule", "meal","meal", "weather","home",
             "cal","schedule", "task","mytask", "consult","consult", "timetable","timetable",
             "classtt","timetable", "classorg","home", "ai","weekly")
    return m.Has(panel) ? m[panel] : "home"
}

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
#!t:: {   ; 마우스 올린 위젯을: 바탕화면 완전 고정(입력 X) ↔ 일반 창(입력 O) 전환
    global WidgetWins
    MouseGetPos(, , &win)
    root := DllCall("GetAncestor", "ptr", win, "uint", 2, "ptr")
    if !WidgetWins.Has(root) {
        TrayTip("전환할 위젯 위에 마우스를 올리고 Win+Alt+T", "영남고 위젯", 0x10)
        return
    }
    w := WidgetWins[root]
    w.pinned := !w.pinned
    WinGetPos(&px, &py, , , "ahk_id " root)
    ApplyPin(root, w.pinned)
    WinMove(px, py, , , "ahk_id " root)
    TrayTip(w.pinned ? "이 위젯: 바탕화면 완전 고정(입력 불가)" : "이 위젯: 일반 창(검색·메모 입력 가능)", "영남고 위젯", 0x10)
}
#!a::ShowSelector()
#!s::SaveAll()
#!q::ExitApp

OnExit(OnExitFn)
OnExitFn(*) {
    global DLL_PATH, gWinHook
    SaveAll()
    if gWinHook
        try DllCall("UnhookWinEvent", "ptr", gWinHook)
    if A_IsCompiled
        try FileDelete(DLL_PATH)
}
