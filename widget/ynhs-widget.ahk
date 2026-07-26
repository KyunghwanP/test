#Requires AutoHotkey v2.0
#SingleInstance Force
CoordMode "Mouse", "Screen"
; WebView2 라이브러리(thqby/ahk2_lib) — 저장소를 통째로 받아 폴더 구조 유지.
;   같은 폴더에  ComVar.ahk · Promise.ahk 등 최상위 .ahk  +  WebView2\ 폴더  +  WebView2Loader.dll
#Include %A_ScriptDir%\WebView2\WebView2.ahk

; ============================================================
;  영남고 앱 — 바탕화면 위젯 (AutoHotkey v2 + WebView2)
;  · 정보 위젯은 바탕화면(Progman)의 '자식'으로 붙여 Win+D(바탕화면 보기)에도
;    사라지지 않고 바탕화면에 착 붙어 있다. (트레이드오프: 입력 위젯은 타이핑을 위해
;    일반 창으로 두므로 Win+D에 함께 최소화됨 — memo·fulltt)
;  · 트레이 아이콘 우클릭 → "위젯 추가 / 선택"으로 언제든 추가·제거.
;  · 손잡이 바는 웹 위에 '겹쳐' 뜨는 별도 창 → 웹 내용이 밀리지 않아 오클릭 없음.
;      이름 …… [투명도 슬라이더] [↗ 앱] [✕]
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
global HANDLE_TOP := 8   ; 손잡이 바를 위젯 맨 위에서 이만큼 내림 → 위쪽 테두리(크기조절)를 잡을 여지
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
global WidgetWins := Map()   ; gui.hwnd -> {panel, opacity, gui, wvc, handleGui, ...}
global HandleToWidget := Map()   ; 손잡이 바 hwnd -> 위젯 hwnd (드래그·호버 역참조)
global dragHwnd := 0, grabOffX := 0, grabOffY := 0, dragW := 0, dragH := 0
global pendingSaveHwnd := 0   ; 리사이즈 저장 디바운스 대상
global SNAP := 30       ; 자석 스냅 거리(px) — 이동·크기조절 모두 이 거리 안에서 착 붙음

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
global WV2ENV := ""      ; 모든 위젯이 공유하는 단일 WebView2 환경

try DirCreate(SESSION)
; 참고: 세션 잠김(0x8007139F)은 EnsureEnv/CreateWidget이 '실패했을 때만' CleanupOrphanWebViews로
;   정리한다(매 실행마다 프로세스를 종료하지 않음 → 백신 행위 탐지를 덜 자극).
OnMessage(0x201, OnLButtonDown)
OnMessage(0x214, OnSizing)   ; WM_SIZING — 크기 조절 시 테두리 자석 스냅

; 세션 폴더당 환경은 하나만 허용 → 처음 한 번만 만들어 재사용(모든 컨트롤러가 공유)
EnsureEnv() {
    global WV2ENV, SESSION, DLL_PATH
    if WV2ENV
        return WV2ENV
    loop 3 {
        try {
            WV2ENV := WebView2.CreateEnvironmentAsync(0, SESSION, "", DLL_PATH).await()
            return WV2ENV
        } catch as e {
            if (A_Index < 3) {
                CleanupOrphanWebViews()
                Sleep 800
                continue
            }
            throw e
        }
    }
}

; WebView2 세션 잠김(0x8007139F 등)으로 인한 비동기 오류는 조용히 넘긴다
;   → 해당 위젯만 비고 스크립트/다른 위젯은 계속 유지(무서운 오류창 방지).
OnError(SuppressWebView2Err)
SuppressWebView2Err(e, mode) {
    msg := ""
    try msg := e.Message
    return InStr(msg, "8007139F") ? 1 : 0
}

; 우리 세션 폴더(YnhsWidget\Session)를 쓰는 msedgewebview2.exe만 골라 종료(다른 앱은 건드리지 않음)
CleanupOrphanWebViews() {
    global SESSION
    killed := 0
    try {
        wmi := ComObjGet("winmgmts:\\.\root\cimv2")
        for proc in wmi.ExecQuery("SELECT ProcessId,CommandLine FROM Win32_Process WHERE Name='msedgewebview2.exe'") {
            cl := ""
            try cl := proc.CommandLine
            if (cl != "" && InStr(cl, SESSION)) {
                try {
                    ProcessClose(proc.ProcessId)
                    killed++
                }
            }
        }
    }
    if killed
        Sleep 500   ; 잠금이 풀릴 시간을 준다
    return killed
}

; ── 트레이 메뉴 ────────────────────────────────────────────
try A_TrayMenu.Delete()
A_TrayMenu.Add("위젯 추가 / 선택", (*) => ShowSelector())
A_TrayMenu.Add("현재 위치·크기 저장", (*) => SaveAll())
A_TrayMenu.Add()
A_TrayMenu.Add("종료", (*) => ExitApp())
A_TrayMenu.Default := "위젯 추가 / 선택"

ShowSelector()
SetTimer(HoverCheck, 120)    ; 마우스 올린 위젯만 손잡이 바 표시

; Win+D를 우리가 직접 처리 → 위젯은 남기고 '다른 앱 창'만 최소화/복원(정상 토글 유지)
global gDesktopShown := false
global gMinList := []

#d:: {
    global gDesktopShown, gMinList, WidgetWins
    if !gDesktopShown {
        gMinList := []
        for hwnd in WinGetList() {          ; 보이는 최상위 창들(맨 앞→맨 뒤 Z-order 순)
            if WidgetWins.Has(hwnd)         ; 우리 위젯은 건드리지 않음(계속 떠 있음)
                continue
            if !IsAppWindow(hwnd)
                continue
            ; 창 크기(가로·세로)는 저장하지 않는다. 다만 '최대화 상태였는지'만 1비트 기억한다.
            ;   → 최대화 창을 그냥 최소화→WinRestore 하면 보통 크기로 줄어드는 걸 막기 위함.
            gMinList.Push({hwnd: hwnd, max: (WinGetMinMax("ahk_id " hwnd) = 1)})
            WinMinimize("ahk_id " hwnd)
        }
        gDesktopShown := true
    } else {
        ; 최소화의 '역순'으로 복원해야 원래 앞뒤 순서(Z-order)가 유지된다.
        ;   (기억한 순서 그대로 복원하면 맨 뒤 창이 마지막에 올라와 앞뒤가 뒤집힌다)
        i := gMinList.Length
        while (i >= 1) {
            item := gMinList[i]
            try {
                if item.max
                    WinMaximize("ahk_id " item.hwnd)   ; 최대화였던 창은 다시 최대화(크기 유지)
                else
                    WinRestore("ahk_id " item.hwnd)
            }
            i--
        }
        gMinList := []
        gDesktopShown := false
    }
}

; '일반 앱 창'(작업표시줄/Alt+Tab에 뜨는 것) 판별 — 도구창·소유된 대화상자·제목없는 창 제외
IsAppWindow(hwnd) {
    if !DllCall("IsWindowVisible", "ptr", hwnd)
        return false
    if (WinGetMinMax("ahk_id " hwnd) = -1)          ; 이미 최소화됨
        return false
    if (WinGetExStyle("ahk_id " hwnd) & 0x80)       ; WS_EX_TOOLWINDOW → 제외
        return false
    if DllCall("GetWindow", "ptr", hwnd, "uint", 4, "ptr")   ; GW_OWNER 있으면(대화상자 등) 제외
        return false
    return WinGetTitle("ahk_id " hwnd) != ""
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
    global CONFIG, DEF_OPACITY, WidgetWins, HandleToWidget, APP_BASE, SESSION, DLL_PATH, PROGMAN, INPUT_PANELS, pendingSaveHwnd
    key := p[1], label := p[2]
    x  := Integer(IniRead(CONFIG, "pos_" key, "x", p[3]))
    y  := Integer(IniRead(CONFIG, "pos_" key, "y", p[4]))
    ww := Integer(IniRead(CONFIG, "pos_" key, "w", p[5]))
    hh := Integer(IniRead(CONFIG, "pos_" key, "h", p[6]))
    op := Integer(IniRead(CONFIG, "pos_" key, "opacity", DEF_OPACITY))

    ; 예전 DPI 런어웨이 버그로 저장된 값이 화면보다 크게 부풀었을 수 있다 →
    ;   비정상 크기는 이 패널의 기본 위치·크기로 되돌린다(한 번 정상 크기로 뜨면 이후엔 그대로 유지됨).
    vsW := SysGet(78), vsH := SysGet(79)   ; SM_CXVIRTUALSCREEN / SM_CYVIRTUALSCREEN (전체 가상 화면)
    if (ww < 150 || ww > vsW || hh < 120 || hh > vsH)
        x := p[3], y := p[4], ww := p[5], hh := p[6]

    ; 위젯 본체 — 웹만 꽉 채우는 창(손잡이 컨트롤은 별도 창으로 겹쳐 띄운다 → 내용 안 밀림)
    ; -DPIScale: AHK의 GUI 자동 DPI 스케일을 끈다. 켜져 있으면 Show(w/h)는 배율만큼 확대되는데
    ;   WinGetPos는 물리 픽셀을 돌려줘 저장→복원마다 창이 배율만큼 커진다(런어웨이).
    g := Gui("-Caption +Resize +ToolWindow -DPIScale")   ; 테두리없음·크기조절·작업표시줄제외
    g.BackColor := "FFFFFF"
    g.Show(Format("x{} y{} w{} h{} NoActivate", x, y, ww, hh))

    ; WebView2 컨트롤러 생성 — 모든 위젯이 '하나의 환경(Environment)'을 공유한다.
    ;   (위젯마다 환경을 새로 만들면 같은 세션 폴더에 환경이 여러 개가 되어 0x8007139F 발생)
    wvc := ""
    loop 2 {
        try {
            wvc := EnsureEnv().CreateCoreWebView2ControllerAsync(g.hwnd).await()
            break
        } catch as e {
            if (A_Index = 1) {
                CleanupOrphanWebViews()
                Sleep 800
                continue
            }
            g.Destroy()
            MsgBox("'" label "' 위젯을 열지 못했습니다.`n`nWebView2 세션이 잠겨 있을 수 있습니다. 작업관리자에서 msedgewebview2.exe를 모두 종료하거나 PC를 재시작한 뒤 다시 실행해 주세요.`n`n(" e.Message ")", "영남고 위젯", 0x30)
            return
        }
    }
    wvc.CoreWebView2.Navigate(PanelUrl(key) "&t=" A_Now)   ; &t= : 실행마다 최신 페이지 로드(캐시 지연 방지)
    g.OnEvent("Size", OnResize)
    SetWidgetOpacity(g.hwnd, op)   ; 창 전체 반투명(슬라이더) — 어느 윈도우에서나 확실히 동작

    ; 참고: 예전의 '그림자 제거'(NCRENDERING_POLICY=DISABLED)는 DWM 비클라이언트 렌더링을 꺼서
    ;   둥근 모서리·테두리 색까지 무효화(회색 사각 프레임 잔존)했기에 제거함. → 둥근 모서리+파란
    ;   테두리를 살리고, 대신 은은한 그림자는 유지(둥근 창엔 자연스러움).
    StyleWindow(g.hwnd)   ; 둥근 모서리 + 얇은 파란 테두리(Win11)

    ; ── 손잡이 바(별도 최상위 창) — 호버 시 웹 위에 '겹쳐' 나타남 → 내용이 밀리지 않는다
    h := Gui("-Caption +AlwaysOnTop +ToolWindow -Resize")
    h.BackColor := "FFFFFF"
    h.SetFont("s9 c555555", "맑은 고딕")
    hlbl := h.Add("Text",   Format("x8 y5 w{} h16 +0x200", ww - 190), label)
    hsld := h.Add("Slider", Format("x{} y4 w78 h18 Range70-255 Line5 Page20", ww - 178), op)
    hApp := h.Add("Button", Format("x{} y3 w58 h20", ww - 94), "↗ 앱")
    hX   := h.Add("Button", Format("x{} y3 w26 h20", ww - 30), "✕")
    hsld.OnEvent("Change", (ctrl, *) => SetWidgetOpacity(g.hwnd, ctrl.Value))
    hApp.OnEvent("Click", (*) => LaunchMain(key))
    ; ✕ 는 자기 자신(손잡이 창) 안에서 그 창을 파괴하므로, 이벤트가 끝난 뒤 실행하도록 미룸
    ; (즉시 파괴하면 스크립트가 크래시 → 위젯이 전부 사라짐)
    hX.OnEvent("Click", (*) => SetTimer(() => DestroyWidget(g.hwnd, true), -1))
    StyleWindow(h.hwnd)   ; 손잡이 바도 둥근 모서리 + 테두리 없음(위젯과 통일)

    ; 모든 위젯: 소유자=바탕화면(뒤 레이어)이되 최상위 창이라 클릭·타이핑 O.
    ;   Win+D 최소화는 위의 최소화-복원 훅이 즉시 되돌린다(사용자 선택).
    wantPin := true
    ApplyPin(g.hwnd, wantPin)
    ; 바탕화면 자식으로 바꾸면 좌표 기준이 부모(바탕화면)로 바뀌므로 위치만 재적용.
    ;   크기는 건드리지 않는다(-DPIScale + 클라이언트 크기 저장 기준을 유지 → 드리프트 없음).
    WinMove(x, y, , , "ahk_id " g.hwnd)
    SetWebViewBounds(wvc, g.hwnd, 0)   ; 웹뷰는 항상 창 전체 — 호버해도 내용이 밀리지 않음

    WidgetWins[g.hwnd] := {panel: key, opacity: op, gui: g, wvc: wvc, label: label,
                           handleGui: h, hlbl: hlbl, hsld: hsld, hApp: hApp, hX: hX,
                           handleShown: false, pinned: wantPin}
    HandleToWidget[h.hwnd] := g.hwnd

    ; 크기 조절 시 웹뷰 리사이즈 + 크기 저장(디바운스). 손잡이 폭은 표시될 때 재배치(PositionHandle)
    OnResize(gg, minmax, w, hgt) {
        SetWebViewBounds(wvc, g.hwnd, 0)
        pendingSaveHwnd := g.hwnd
        SetTimer(FlushSave, -500)   ; 마지막 리사이즈 0.5초 후 1회 저장(같은 타이머로 디바운스)
    }
}

; 위젯의 '실제 보이는' 화면 사각형(리사이즈용 투명 여백 제외) — DWMWA_EXTENDED_FRAME_BOUNDS(9)
;   +Resize 창은 좌우·아래에 ~8px 투명 여백이 창 좌표에 포함돼, 손잡이 바가 그만큼 넓게 뜬다.
WidgetVisibleRect(hwnd, &vx, &vy, &vw, &vh) {
    rc := Buffer(16)
    if (DllCall("dwmapi\DwmGetWindowAttribute", "ptr", hwnd, "int", 9, "ptr", rc, "int", 16) = 0) {
        vx := NumGet(rc, 0, "int"), vy := NumGet(rc, 4, "int")
        vw := NumGet(rc, 8, "int") - vx, vh := NumGet(rc, 12, "int") - vy
        return
    }
    WinGetPos(&vx, &vy, &vw, &vh, "ahk_id " hwnd)   ; DWM 미지원 시 폴백
}

; 손잡이 바를 위젯 위쪽 가장자리에 겹쳐 표시(보이는 폭에 정확히 맞춤)
PositionHandle(widgetHwnd) {
    global WidgetWins, HANDLE_H, HANDLE_TOP
    if !WidgetWins.Has(widgetHwnd)
        return
    w := WidgetWins[widgetHwnd]
    WidgetVisibleRect(widgetHwnd, &wx, &wy, &wW, &wH)
    w.hlbl.Move(8, 5, wW - 190, 16)
    w.hsld.Move(wW - 178, 4)
    w.hApp.Move(wW - 94, 3)
    w.hX.Move(wW - 30, 3)
    ; 맨 위 HANDLE_TOP 만큼 비워 위쪽 테두리로 크기조절 가능하게(손잡이는 그 아래에 겹침)
    w.handleGui.Show(Format("x{} y{} w{} h{} NoActivate", wx, wy + HANDLE_TOP, wW, HANDLE_H))
}

SetWidgetOpacity(hwnd, val) {
    global WidgetWins
    WinSetTransparent(val, "ahk_id " hwnd)   ; 창 전체 반투명(70~255) — 어느 윈도우에서나 확실히 동작
    if WidgetWins.Has(hwnd)
        WidgetWins[hwnd].opacity := val
}

; 창 모양 다듬기(Win11 DWM) — 둥근 모서리 + 얇은 파란 테두리(회색 두꺼운 포커스 테두리 대체)
;   · DWMWA_WINDOW_CORNER_PREFERENCE(33)=2(ROUND)
;   · DWMWA_BORDER_COLOR(34)=COLORREF(0x00BBGGRR) → 얇은 테두리를 조화로운 파란색으로
;   (Win10 등 미지원 환경에선 조용히 무시되어 각진 창으로 표시됨)
global BORDER_COLOR := 0x00C8825A   ; RGB(90,130,200) 소프트 블루 (COLORREF는 BGR 순서)
StyleWindow(hwnd) {
    global BORDER_COLOR
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 33, "int*", 2, "int", 4)
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 34, "uint*", BORDER_COLOR, "int", 4)
}

; ── 바탕화면 층에 놓기(상호작용 유지) ─────────────────────
;  위젯을 '최상위 창'으로 두되 소유자만 바탕화면(Progman)으로 지정한다.
;  · 최상위 창이라 클릭·타이핑·로그인이 모두 된다(바탕화면 자식이면 입력 불가라 못 씀).
;  · 소유자=바탕화면이라 다른 창들 '뒤'(바탕화면 층)에 깔린다.
;  · Win+D 최소화는 최소화-복원 훅이 즉시 되돌려 바탕화면 층에 그대로 남긴다.
ApplyPin(hwnd, doPin := true) {
    global PROGMAN
    DllCall("SetParent", "ptr", hwnd, "ptr", 0)                    ; 최상위(상호작용 O)
    DllCall("SetWindowLongPtr", "ptr", hwnd, "int", -8            ; 소유자=바탕화면(뒤 레이어) / 해제
        , "ptr", (doPin && PROGMAN) ? PROGMAN : 0, "ptr")
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

; ── 위젯 '위쪽 가장자리'에 마우스를 올렸을 때만 손잡이 바를 겹쳐 표시 ──
;  본문(목록) 위에선 손잡이가 안 떠서 클릭이 정상. 위쪽 끝으로 가면 손잡이가 뜬다.
HoverCheck() {
    global WidgetWins, HandleToWidget, dragHwnd, HANDLE_H, HANDLE_TOP
    MouseGetPos(&mx, &my, &win)
    if (win = "" || !win) {          ; 마우스 밑에 창이 없으면 빈 문자열 → DllCall에 넘기면 오류
        win := 0, root := 0
    } else
        root := DllCall("GetAncestor", "ptr", win, "uint", 2, "ptr")   ; GA_ROOT
    target := 0
    if HandleToWidget.Has(root)
        target := HandleToWidget[root]            ; 손잡이 바 위 → 계속 표시
    else if WidgetWins.Has(root) {
        WinGetPos(&wx, &wy, , , "ahk_id " root)
        ; 맨 위 HANDLE_TOP(리사이즈용 여백)~손잡이 아래까지가 손잡이 표시 영역
        if (my >= wy + HANDLE_TOP && my <= wy + HANDLE_TOP + HANDLE_H + 4)
            target := root
    }
    if dragHwnd
        target := dragHwnd            ; 드래그 중엔 계속 표시
    for hwnd, w in WidgetWins {
        if !WinExist("ahk_id " hwnd)      ; 닫히는 중인 위젯은 건너뜀
            continue
        want := (hwnd = target)
        if (w.handleShown != want) {
            w.handleShown := want
            try {
                if want
                    PositionHandle(hwnd)
                else
                    w.handleGui.Hide()
            }
        }
    }
}

; ── 손잡이 바 드래그(수동 이동) ────────────────────────────
;  클릭은 손잡이 바(별도 창)의 배경/라벨에서 받는다 → 위젯 본체를 함께 움직인다.
OnLButtonDown(wParam, lParam, msg, hwnd) {
    global HandleToWidget, dragHwnd, grabOffX, grabOffY, dragW, dragH
    if !HandleToWidget.Has(hwnd)      ; 손잡이 바 배경/라벨만(버튼·슬라이더·웹뷰 제외)
        return
    widget := HandleToWidget[hwnd]
    MouseGetPos(&cx, &cy)
    WinGetPos(&wx, &wy, &wW, &wH, "ahk_id " widget)
    dragHwnd := widget, grabOffX := cx - wx, grabOffY := cy - wy, dragW := wW, dragH := wH
    SetTimer(DragMove, 10)
}

DragMove() {
    global dragHwnd, grabOffX, grabOffY, dragW, dragH, WidgetWins, SNAP, HANDLE_TOP
    if !dragHwnd || !GetKeyState("LButton", "P") {
        if dragHwnd
            SaveWidget(dragHwnd)
        dragHwnd := 0
        SetTimer(DragMove, 0)
        return
    }
    MouseGetPos(&cx, &cy)
    nx := cx - grabOffX, ny := cy - grabOffY
    ; 다른 위젯 가장자리에 가까우면 자석처럼 붙임(이동)
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
    if WidgetWins.Has(dragHwnd) {          ; 손잡이 바도 위젯의 '보이는' 위치로 따라 이동
        WidgetVisibleRect(dragHwnd, &vx, &vy, &vw, &vh)
        try WidgetWins[dragHwnd].handleGui.Move(vx, vy + HANDLE_TOP)
    }
}

; ── 크기 조절 시 테두리 자석 스냅(WM_SIZING) ───────────────
;  창 가장자리를 끌어 크기를 바꿀 때, 끌고 있는 변을 이웃 위젯의 변에 착 붙인다.
;   lParam = 조절 중인 사각형(RECT, 화면좌표) → 수정하면 그대로 반영된다.
;   wParam = 어느 변을 끄는지(WMSZ): 1=좌 2=우 3=상 4=좌상 5=우상 6=하 7=좌하 8=우하
OnSizing(wParam, lParam, msg, hwnd) {
    global WidgetWins, SNAP
    if !WidgetWins.Has(hwnd)
        return
    L := NumGet(lParam, 0, "int")
    T := NumGet(lParam, 4, "int")
    R := NumGet(lParam, 8, "int")
    B := NumGet(lParam, 12, "int")
    dragL := (wParam = 1 || wParam = 4 || wParam = 7)
    dragR := (wParam = 2 || wParam = 5 || wParam = 8)
    dragT := (wParam = 3 || wParam = 4 || wParam = 5)
    dragB := (wParam = 6 || wParam = 7 || wParam = 8)
    for h2, w in WidgetWins {
        if (h2 = hwnd) || !WinExist("ahk_id " h2)
            continue
        WinGetPos(&gx, &gy, &gw, &gh, "ahk_id " h2)
        gRight  := gx + gw
        gBottom := gy + gh
        ; 끌고 있는 변을 이웃의 맞붙는 변 또는 같은 쪽 변에 스냅(헬퍼로 단순화)
        if (dragL)
            L := SnapEdge(L, gRight, gx)      ; 내 왼쪽 ↔ 이웃 오른쪽(맞붙음)/왼쪽(정렬)
        if (dragR)
            R := SnapEdge(R, gx, gRight)      ; 내 오른쪽 ↔ 이웃 왼쪽(맞붙음)/오른쪽(정렬)
        if (dragT)
            T := SnapEdge(T, gBottom, gy)     ; 내 위 ↔ 이웃 아래(맞붙음)/위(정렬)
        if (dragB)
            B := SnapEdge(B, gy, gBottom)     ; 내 아래 ↔ 이웃 위(맞붙음)/아래(정렬)
    }
    NumPut("int", L, lParam, 0)
    NumPut("int", T, lParam, 4)
    NumPut("int", R, lParam, 8)
    NumPut("int", B, lParam, 12)
    return true
}

; 값(변 좌표)이 두 후보 변 중 SNAP 거리 안이면 거기에 붙인 값을 돌려준다
SnapEdge(val, edgeA, edgeB) {
    global SNAP
    if (Abs(val - edgeA) <= SNAP)
        return edgeA
    if (Abs(val - edgeB) <= SNAP)
        return edgeB
    return val
}

DestroyWidget(hwnd, fromButton := false) {
    global WidgetWins, HandleToWidget, CONFIG
    if !WidgetWins.Has(hwnd)
        return
    SaveWidget(hwnd)
    IniWrite("0", CONFIG, "selected", WidgetWins[hwnd].panel)
    w := WidgetWins[hwnd]
    g := w.gui, h := w.handleGui
    HandleToWidget.Delete(h.hwnd)
    WidgetWins.Delete(hwnd)     ; 먼저 목록에서 제거 → 타이머가 파괴 중 컨트롤을 안 만짐
    try h.Destroy()
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
    ; 복원(g.Show)과 기준을 일치시킨다: 위치는 창 바깥 좌상단, 크기는 클라이언트 영역.
    ;   (WinGetPos의 크기는 테두리를 포함해 Show의 클라이언트 기준보다 커서, 그대로 저장하면
    ;    실행할 때마다 테두리 두께(~8px)만큼 창이 커지고 위치가 밀린다.)
    WinGetPos(&wx, &wy, , , "ahk_id " hwnd)
    WinGetClientPos( , , &cw, &ch, "ahk_id " hwnd)
    IniWrite(wx, CONFIG, "pos_" w.panel, "x"), IniWrite(wy, CONFIG, "pos_" w.panel, "y")
    IniWrite(cw, CONFIG, "pos_" w.panel, "w"), IniWrite(ch, CONFIG, "pos_" w.panel, "h")
    IniWrite(w.opacity, CONFIG, "pos_" w.panel, "opacity")
}

SaveAll() {
    global WidgetWins
    for hwnd, w in WidgetWins
        SaveWidget(hwnd)
}

; 리사이즈 디바운스 저장 (같은 함수 참조라 SetTimer가 하나로 묶임)
FlushSave() {
    global pendingSaveHwnd
    if pendingSaveHwnd {
        SaveWidget(pendingSaveHwnd)
        pendingSaveHwnd := 0
    }
}

; ── 전역 단축키 ────────────────────────────────────────────
#!h:: {
    global widgetsHidden, WidgetWins
    widgetsHidden := !widgetsHidden
    for hwnd, w in WidgetWins {
        if widgetsHidden {
            w.gui.Hide(), w.handleGui.Hide(), w.handleShown := false
        } else
            w.gui.Show("NoActivate")
    }
}
#!t:: {   ; 마우스 올린 위젯을 맨 앞으로 ↔ 바탕화면 자식으로 전환
    global WidgetWins
    MouseGetPos(, , &win)
    root := (win = "" || !win) ? 0 : DllCall("GetAncestor", "ptr", win, "uint", 2, "ptr")
    if !WidgetWins.Has(root) {
        TrayTip("전환할 위젯 위에 마우스를 올리고 Win+Alt+T", "영남고 위젯", 0x10)
        return
    }
    w := WidgetWins[root]
    w.onTop := !(w.HasOwnProp("onTop") && w.onTop)
    if w.onTop {
        ApplyPin(root, false)                    ; 최상위 창으로
        WinSetAlwaysOnTop(true, "ahk_id " root)
    } else {
        WinSetAlwaysOnTop(false, "ahk_id " root)
        ApplyPin(root, true)                      ; 다시 바탕화면 층
    }
    TrayTip(w.onTop ? "이 위젯: 항상 맨 앞" : "이 위젯: 바탕화면 층", "영남고 위젯", 0x10)
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
