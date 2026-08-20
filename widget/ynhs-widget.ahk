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

; UDP(HTTP/3=QUIC)를 막는 망에서 접속이 타임아웃되는 문제 → QUIC 끄고 TCP만 사용.
;   WebView2는 '브라우저 프로세스를 처음 띄울 때' 이 환경변수를 읽는다. 웹뷰를 만드는
;   시점(EnsureEnv)에 설정하면, 그 전에 이미 msedgewebview2.exe 가 떠 있는 경우 기존
;   프로세스를 재사용해 인자가 무시된다. 그래서 스크립트 맨 위에서 먼저 설정한다.
; 네트워크 진단 로그(선택) — %AppData%\YnhsWidget\netlog.on 파일이 있으면 켜진다.
;   위젯은 브라우저와 별개의 WebView2 프로필을 쓰므로, 브라우저는 되는데 위젯만
;   먹통일 때 원인을 볼 방법이 없었다. 이 로그에 DNS·TCP·TLS 어느 단계에서 무슨
;   오류로 끊겼는지가 그대로 남는다. 평소에는 파일이 없으니 아무 영향이 없다.
_wvArgs := "--disable-quic"
_netlogDir := A_AppData "\YnhsApp"          ; 통합앱과 같은 위치를 봐야 인자가 일치한다
if FileExist(_netlogDir "\netlog.on")
    _wvArgs .= " --log-net-log=" _netlogDir "\netlog.json --net-log-capture-mode=Default"
EnvSet("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", _wvArgs)

global APP_BASE := "https://kyunghwanp.github.io/test/?widget="
; 손상된 WebView2 프로필을 우회 — 새 폴더로 깨끗하게 시작.
;   (손상된 프로필은 브라우저·앱은 멀쩡한데 위젯 WebView2만 인터넷 연결 실패/시간초과가 나던 원인.
;    프로필 쓰기 도중 위젯이 비정상 종료(크래시)하면 프로필이 깨질 수 있음 → ERR_FAILED.
;    이때는 폴더 번호를 올려 새 프로필로 시작하면 복구됨. 앱 재로그인만 한 번 필요.)
; 통합앱과 '같은' WebView2 프로필을 쓴다 → 앱에서 로그인해 두면 위젯도 그대로 로그인 상태.
;   WebView2 는 같은 사용자 데이터 폴더를 여러 프로세스가 쓰는 것을 허용하지만,
;   환경 옵션(브라우저 인자)이 다르면 0x8007139F 로 거부한다. 그래서 아래 인자 계산을
;   통합앱과 완전히 동일하게 맞춘다(넷로그 플래그도 같은 위치를 본다).
;   혹시 공유에 실패하면 위젯 전용 폴더로 물러난다(로그인은 따로 해야 하지만 동작은 함).
global SESSION       := A_AppData "\YnhsApp\Session"
global SESSION_OWN   := A_AppData "\YnhsWidget\Session3"
global CONFIG   := A_AppData "\YnhsWidget\config.ini"
global NEU_EXE  := A_ScriptDir "\ynhs-app.exe"
global APP_URL  := "https://kyunghwanp.github.io/test/"
global HANDLE_H := 26
global HANDLE_TOP := 8   ; 손잡이 바를 위젯 맨 위에서 이만큼 내림 → 위쪽 테두리(크기조절)를 잡을 여지
global DEF_OPACITY := 240
global gDark := false   ; 위젯 다크모드(모든 위젯 공통) — config [ui] dark 에 저장
global gGlass := false  ; 위젯 글래스(아크릴) 모드 — config [ui] glass 에 저장 (실험적, 기본 꺼짐)
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
global GAP  := 8        ; 자석으로 붙었을 때 위젯 사이 '보이는' 간격(px) — 상하·좌우 모두 동일

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
    global WV2ENV, SESSION, SESSION_OWN, DLL_PATH
    if WV2ENV
        return WV2ENV
    loop 3 {
        try {
            WV2ENV := WebView2.CreateEnvironmentAsync(0, SESSION, "", DLL_PATH).await()
            return WV2ENV
        } catch as e {
            ; ① 통합앱과 공유 실패(브라우저 인자 불일치 등) → 위젯 전용 폴더로 물러난다.
            ;    이때는 잔류 프로세스 정리가 필요 없다(폴더가 달라졌으므로) — 바로 다시 시도.
            if (SESSION != SESSION_OWN) {
                SESSION := SESSION_OWN
                continue
            }
            ; ② 전용 폴더에서도 실패 → 세션 잠김일 수 있으니 정리 후 재시도.
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

; ── WebView2 프로필 자가 복구 ────────────────────────────────────────────────
; 브라우저는 멀쩡한데 위젯만 계속 실패하는 경우가 있다. 위젯은 자체 프로필을 쓰므로
; 그 안의 캐시·소켓 상태가 나쁘게 굳으면 재시도로는 풀리지 않는다.
; 프로필 폴더는 WebView2가 떠 있는 동안 잠겨 있어 지울 수 없으므로,
; '다음 시작 때 지우기'로 예약해 두고 재시작한다.
global RESET_FLAG := A_AppData "\YnhsWidget\reset.flag"
global _resetAsked := false

; 시작 시 호출 — 예약이 있으면 프로필을 지우고 깨끗하게 시작한다.
ResetProfileIfRequested() {
    global SESSION, SESSION_OWN, RESET_FLAG
    if !FileExist(RESET_FLAG)
        return
    ; 공유 프로필은 통합앱 것이기도 하다 → 위젯이 지우면 앱 로그인까지 날아간다.
    ; 공유 중이면 위젯 전용 폴더만 정리하고, 공유 프로필은 건드리지 않는다.
    if (SESSION != SESSION_OWN) {
        try FileDelete(RESET_FLAG)
        try DirDelete(SESSION_OWN, 1)
        return
    }
    try FileDelete(RESET_FLAG)
    CleanupOrphanWebViews()      ; 남은 웹뷰 프로세스가 폴더를 잡고 있으면 못 지운다
    Sleep 600
    try DirDelete(SESSION, 1)
}

; 재시도로도 복구되지 않을 때 1회만 묻는다(계속 뜨면 성가시다).
OfferProfileReset() {
    global _resetAsked, RESET_FLAG
    if _resetAsked
        return
    _resetAsked := true
    r := MsgBox("위젯이 페이지를 계속 불러오지 못하고 있습니다.`n`n"
              . "웹뷰 저장소를 초기화하고 다시 시작할까요?`n"
              . "(위젯 표시 설정은 그대로 유지되고, 앱 로그인만 다시 하시면 됩니다)",
                "영남고 위젯", 0x24)
    if (r != "Yes")
        return
    try FileAppend("", RESET_FLAG)
    Reload
}

; 우리 세션 폴더(YnhsWidget\Session)를 쓰는 msedgewebview2.exe만 골라 종료(다른 앱은 건드리지 않음)
CleanupOrphanWebViews() {
    global SESSION, SESSION_OWN
    ; 통합앱과 프로필을 공유하는 동안에는 이 정리를 하지 않는다.
    ; 같은 폴더를 쓰는 msedgewebview2 에는 '통합앱의 웹뷰'도 포함돼 있어서,
    ; 여기서 죽이면 앱 화면까지 같이 꺼진다(위젯 문제를 앱 장애로 키우는 셈).
    if (SESSION != SESSION_OWN)
        return 0
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

; ── 트레이 아이콘(위젯 전용: 로고 + 파란 W 배지) ──────────────
;   같은 번들 폴더의 widget.ico(위젯 전용) 우선, 없으면 앱 아이콘(icon.ico)으로 대체.
;   전체를 try로 감싸 어떤 이유로든(파일/아이콘 문제) 시작이 막히지 않게 한다.
try {
    ico := ""
    if FileExist(A_ScriptDir "\widget.ico")
        ico := A_ScriptDir "\widget.ico"
    else if FileExist(A_ScriptDir "\icon.ico")
        ico := A_ScriptDir "\icon.ico"
    if (ico != "")
        TraySetIcon(ico)
    A_IconTip := "영남고 위젯"
}

; 저장된 다크모드·글래스 설정 읽기
try gDark := (IniRead(CONFIG, "ui", "dark", "0") = "1")
try gGlass := (IniRead(CONFIG, "ui", "glass", "0") = "1")

; ── 트레이 메뉴 ────────────────────────────────────────────
try A_TrayMenu.Delete()
A_TrayMenu.Add("위젯 추가 / 선택", (*) => ShowSelector())
A_TrayMenu.Add("🌙 다크 모드", (*) => ToggleDark())
; 글래스(실험) 토글은 잠시 숨김 — 기능/코드는 남겨둠(ToggleGlass/ApplyGlass). 다시 쓰려면 아래 줄 주석 해제.
; A_TrayMenu.Add("🔷 글래스(실험)", (*) => ToggleGlass())
A_TrayMenu.Add("현재 위치·크기 저장", (*) => SaveAll())
A_TrayMenu.Add()
A_TrayMenu.Add("종료", (*) => ExitApp())
A_TrayMenu.Default := "위젯 추가 / 선택"
if gDark
    A_TrayMenu.Check("🌙 다크 모드")
gGlass := false   ; 글래스 모드 잠시 보류(토글 숨김) — 항상 꺼짐으로 시작

; 글래스(아크릴) 토글: 설정 저장 + 모든 위젯에 유리 효과 적용/해제 + 새로 로드
ToggleGlass() {
    global gGlass, gDark, CONFIG, WidgetWins
    gGlass := !gGlass
    try IniWrite(gGlass ? "1" : "0", CONFIG, "ui", "glass")
    if gGlass
        A_TrayMenu.Check("🔷 글래스(실험)")
    else
        A_TrayMenu.Uncheck("🔷 글래스(실험)")
    for hwnd, w in WidgetWins {
        try ApplyGlass(hwnd, w.wvc, gGlass)
        try SetWidgetOpacity(hwnd, w.opacity)   ; 글래스면 창 불투명(글자 선명), 끄면 슬라이더 값 복원
        try w.wvc.CoreWebView2.Navigate(WidgetUrl(w.panel, w.opacity))
    }
}

; 글래스 모드 창 처리 — 레이어드 창과 호환되는 ACCENT 아크릴(블러비하인드) 사용.
;   · 새 SYSTEMBACKDROP은 레이어드 창과 충돌(노랑)했지만, 이 ACCENT API는 틴트 색을 직접 지정할 수 있어
;     노랑을 막고 진짜 젖빛 블러를 낸다. 글자는 그 위에 선명하게 남는다.
;   · GradientColor는 0xAABBGGRR(알파=틴트 농도). on일 때만 켜고, 웹뷰 배경은 투명(아크릴이 비치도록).
ApplyGlass(hwnd, wvc, on) {
    global gDark, WidgetWins
    ; ── 리퀴드 글래스: 진짜 바탕화면을 블러해서 은은하게 비친다(Windows 아크릴). ──
    ;   창 아크릴이 '뒤 바탕화면 블러'를 담당하고, 웹(CSS)이 그 위에 유리 카드 질감(테두리·글로우)을 얹는다.
    ;   틴트는 옅게 → 바탕화면이 은은하게 보임. 슬라이더로 틴트 농도(뿌연 정도) 조절.
    ;   · 라이트: 흰 틴트 옅게(0x28~0x70)  · 다크: 깊은 남색 옅게(0x48~0x8C)
    op := (WidgetWins.Has(hwnd) ? WidgetWins[hwnd].opacity : 200)
    f  := (op - 70) / 185                                ; 0~1
    a  := gDark ? Round(0x48 + f * (0x8C - 0x48)) : Round(0x28 + f * (0x70 - 0x28))
    tint := (a << 24) | (gDark ? 0x241810 : 0xFAF7F5)   ; ABGR: 다크=깊은 남색 / 라이트=흰
    accent := Buffer(16, 0)
    NumPut("uint", on ? 4 : 0, accent, 0)         ; AccentState: 4=ACRYLICBLURBEHIND, 0=off
    NumPut("uint", on ? tint : 0, accent, 8)      ; GradientColor(ABGR)
    data := Buffer(24, 0)
    NumPut("uint", 19, data, 0)                   ; WCA_ACCENT_POLICY=19
    NumPut("ptr", accent.Ptr, data, 8)
    NumPut("uptr", accent.Size, data, 16)
    try DllCall("user32\SetWindowCompositionAttribute", "ptr", hwnd, "ptr", data)
    try wvc.DefaultBackgroundColor := on ? 0x00000000 : (gDark ? 0xFF0B1220 : 0xFFFFFFFF)  ; 웹뷰 투명 → 아크릴 비침
}

; 다크모드 토글: 설정 저장 + 떠 있는 모든 위젯을 새 테마로 다시 로드
ToggleDark() {
    global gDark, gGlass, CONFIG, WidgetWins, BORDER_COLOR, BORDER_COLOR_DARK
    gDark := !gDark
    try IniWrite(gDark ? "1" : "0", CONFIG, "ui", "dark")
    if gDark
        A_TrayMenu.Check("🌙 다크 모드")
    else
        A_TrayMenu.Uncheck("🌙 다크 모드")
    for hwnd, w in WidgetWins {
        try w.gui.BackColor := gDark ? "111A2D" : "FFFFFF"   ; 창 배경도 함께(상단 흰 띠 방지)
        try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 20, "int*", gDark ? 1 : 0, "int", 4)  ; DWM 프레임 다크
        try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 34, "uint*", gDark ? BORDER_COLOR_DARK : BORDER_COLOR, "int", 4)  ; 테두리 색
        try StyleWindow(w.handleGui.hwnd)   ; 손잡이 바 테두리도 함께
        ; 웹뷰 배경: 글래스면 투명(아크릴 비침), 아니면 투명(배경 틴트가 비침 — 배경만 반투명 모드)
        try w.wvc.DefaultBackgroundColor := 0x00000000
        try w.wvc.CoreWebView2.Navigate(WidgetUrl(w.panel, w.opacity))
        if (!gGlass)
            try ApplyWidgetBg(hwnd, w.opacity)   ; 새 테마에 맞춰 배경 틴트(다크/라이트) 다시 적용
    }
}

; 시작 시: 저장해둔(선택된) 위젯을 '선택창 없이' 바로 복원해서 띄운다.
;   선택된 게 하나도 없으면(설정 초기화 등) 그때만 선택창을 띄워 고르게 한다.
; 지난 실행에서 초기화가 예약됐으면, 웹뷰를 만들기 전에 프로필을 지운다.
; (웹뷰가 뜬 뒤에는 폴더가 잠겨 지울 수 없다 — 반드시 이 시점이어야 한다)
ResetProfileIfRequested()
RestoreSelected()
; 손잡이 바는 이제 웹(HTML)에 내장 → 네이티브 오버레이/호버 타이머 미사용(DPI·겹침 문제 제거)
; SetTimer(HoverCheck, 120)

; ── 비활성될 때 배경 투명이 풀려 창 바탕색이 드러나던 문제 ──
;   위젯 밖을 클릭하면 Windows가 ACCENT(투명)를 되돌려서 다크=파랗게, 라이트=흰색 불투명으로 보였다.
;   활성/비활성 전환(WM_NCACTIVATE) 직후 투명 효과를 다시 적용해 항상 유지한다.
OnMessage(0x0086, WidgetNCActivate)   ; WM_NCACTIVATE
WidgetNCActivate(wParam, lParam, msg, hwnd) {
    global WidgetWins
    if WidgetWins.Has(hwnd)
        SetTimer(ReapplyWidgetBg.Bind(hwnd), -20)   ; 전환 직후(Windows가 되돌린 뒤) 다시 적용
    ; return 안 함 → 기본 비클라이언트 처리 유지
}
ReapplyWidgetBg(hwnd) {
    global WidgetWins, gGlass
    if !WidgetWins.Has(hwnd)
        return
    if (gGlass) {
        try ApplyGlass(hwnd, WidgetWins[hwnd].wvc, true)
    } else {
        try ApplyWidgetBg(hwnd, WidgetWins[hwnd].opacity)
    }
}


; ── 전역 초기화 ──────────────────────────────────────────────
; AHK v2 의 자동 실행 구역은 '첫 핫키 정의'에서 끝난다. 아래 값들은 원래 쓰이는 자리
; (테두리색·토스트·이모지) 근처에 두었는데 그게 첫 핫키(#d)보다 뒤라 한 번도 실행되지
; 않았다 → gToastSeen 이 "has not been assigned a value" 로 터졌다.
; 최상위 global 은 슈퍼전역이라 함수들이 선언 없이 쓰는 곳이 여럿이다. 그래서 함수로
; 감싸지 않고 '위치만' 핫키 앞으로 올린다.
global BORDER_COLOR      := 0x00C8825A   ; 라이트: RGB(90,130,200) 소프트 블루 (COLORREF는 BGR 순서)
global BORDER_COLOR_DARK := 0x0020120B   ; 다크: 다크모드 배경 남색 #0B1220 (BGR)
global gToasts := []          ; 활성 토스트 [{g,hwnd,h,onClick,timer}] — 오래된→최신 순
global gToastHooked := false
global gToastSeen := Map()     ; 웹에서 온 알림 중복 방지(이미 띄운 이벤트 id) — 여러 위젯이 같은 걸 보내도 1회
global TOAST_W := 344, TOAST_H := 94, TOAST_GAP := 10, TOAST_MARGIN := 16
global EMOJI_B64 := Map()
EMOJI_B64["notice"] := "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"
EMOJI_B64["cal"] := "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"
EMOJI_B64["deadline"] := "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"
EMOJI_B64["memo"] := "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"
EMOJI_B64["grade"] := "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"
EMOJI_B64["bell"] := "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"
global gEmojiDir := A_Temp "\ynhs_emoji"

; Win+D를 우리가 직접 처리 → 위젯은 남기고 '다른 앱 창'만 최소화/복원(정상 토글 유지)
global gDesktopShown := false
global gMinList := []

#d:: {
    global gDesktopShown, gMinList, WidgetWins
    ; 즉각 반응 최적화(핵심 2가지):
    ;   1) 애니메이션 off — 창별 슬라이드가 사라져 즉시 사라짐/나타남
    ;   2) ShowWindowAsync 사용 — 예전 WinMinimize/WinRestore는 창마다 응답을 '기다리는'
    ;      동기 호출이라 창이 많거나 느린 앱이 있으면 줄줄이 밀려 느렸다. Async는 명령만 쏘고
    ;      바로 리턴 → OS가 병렬 처리하므로 창 개수와 거의 무관하게 빠르다.
    ;   SW: 6=MINIMIZE, 9=RESTORE, 3=SHOWMAXIMIZED
    static SW_MIN := 6, SW_RESTORE := 9, SW_MAX := 3
    prevAnim := GetMinAnimation()
    if prevAnim
        SetMinAnimation(false)
    if !gDesktopShown {
        gMinList := []
        for hwnd in WinGetList() {          ; 보이는 최상위 창들(맨 앞→맨 뒤 Z-order 순)
            if WidgetWins.Has(hwnd)         ; 우리 위젯은 건드리지 않음(계속 떠 있음)
                continue
            if !IsAppWindow(hwnd)
                continue
            ; 창 크기(가로·세로)는 저장하지 않는다. 다만 '최대화 상태였는지'만 1비트 기억한다.
            ;   → 최대화 창을 그냥 최소화→복원 하면 보통 크기로 줄어드는 걸 막기 위함.
            gMinList.Push({hwnd: hwnd, max: (WinGetMinMax("ahk_id " hwnd) = 1)})
            DllCall("ShowWindowAsync", "ptr", hwnd, "int", SW_MIN)
        }
        gDesktopShown := true
    } else {
        ; 먼저 async로 전부 복원(빠름). async는 처리 순서가 보장되지 않아 이 단계만으론
        ;   앞뒤 순서가 섞인다 → 잠시 뒤 Z-order를 한 번에 다시 맞춘다(RestoreZOrder).
        saved := gMinList
        i := saved.Length
        while (i >= 1) {
            item := saved[i]
            try DllCall("ShowWindowAsync", "ptr", item.hwnd, "int", item.max ? SW_MAX : SW_RESTORE)
            i--
        }
        gMinList := []
        gDesktopShown := false
        SetTimer(() => RestoreZOrder(saved), -250)   ; 복원이 처리된 뒤 순서 재정렬
    }
    ; 애니메이션은 창들이 async 명령을 처리한 뒤에 되돌린다(즉시 되돌리면 처리 전이라 다시 슬라이드됨).
    if prevAnim
        SetTimer(() => SetMinAnimation(true), -400)
}

; async 복원 뒤 원래 앞뒤 순서(Z-order)를 다시 맞춘다.
;   list는 [맨앞 … 맨뒤] 순. '맨 뒤 → 맨 앞' 순으로 각 창을 최상단에 올리면
;   원래 맨 앞 창이 마지막에 올라와 앞뒤가 그대로 복원된다.
;   SetWindowPos(HWND_TOP=0, SWP_NOSIZE|NOMOVE|NOACTIVATE=0x13) → 이동·크기·포커스는 안 건드리고 순서만.
RestoreZOrder(list) {
    i := list.Length
    while (i >= 1) {
        try DllCall("SetWindowPos", "ptr", list[i].hwnd, "ptr", 0
                    , "int", 0, "int", 0, "int", 0, "int", 0, "uint", 0x13)
        i--
    }
    if (list.Length >= 1)
        try WinActivate("ahk_id " list[1].hwnd)   ; 원래 맨 앞 창에 포커스 복귀
}

; ── 최소화/복원 애니메이션 on/off (ANIMATIONINFO{ UINT cbSize; int iMinAnimate }) ──
;   SPI_GETANIMATION=0x48 / SPI_SETANIMATION=0x49. fWinIni=0 → 저장·브로드캐스트 안 함(빠름).
GetMinAnimation() {
    ai := Buffer(8, 0)
    NumPut("uint", 8, ai, 0)
    DllCall("SystemParametersInfoW", "uint", 0x48, "uint", 8, "ptr", ai, "uint", 0)
    return NumGet(ai, 4, "int") ? 1 : 0
}
SetMinAnimation(on) {
    ai := Buffer(8, 0)
    NumPut("uint", 8, ai, 0)
    NumPut("int", on ? 1 : 0, ai, 4)
    DllCall("SystemParametersInfoW", "uint", 0x49, "uint", 8, "ptr", ai, "uint", 0)
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

; 저장된 선택 상태(config의 selected=1)대로 위젯을 바로 생성. 하나도 없으면 선택창을 띄운다.
RestoreSelected() {
    global ALL_PANELS, CONFIG
    ; 최초 실행(설정에 [selected] 자체가 없음)이면 기본 위젯을 임의로 띄우지 않고
    ; 선택창을 먼저 보여 준다. 사용자가 고른 뒤부터 그 선택이 복원된다.
    sec := ""
    try sec := IniRead(CONFIG, "selected")
    if (sec = "") {
        ShowSelector()
        return
    }
    any := false
    for p in ALL_PANELS {
        sel := p[7]
        try sel := IniRead(CONFIG, "selected", p[1], p[7])
        if (sel = "1") {
            CreateWidget(p)
            any := true
        }
    }
    if !any
        ShowSelector()
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
            try IniWrite(picked ? "1" : "0", CONFIG, "selected", p[1])
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
    global CONFIG, DEF_OPACITY, WidgetWins, HandleToWidget, APP_BASE, SESSION, DLL_PATH, PROGMAN, INPUT_PANELS, pendingSaveHwnd, gDark, gGlass
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
    g.BackColor := gDark ? "111A2D" : "FFFFFF"   ; 다크모드면 창 배경도 어둡게 → 상단 흰 띠 제거
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
    ; WebView2 자체 기본 배경색 — 다크면 어둡게(글래스면 투명). 페이지가 그리기 전/안 덮는 맨 위 영역에
    ;   흰 배경이 띠처럼 비치던 문제를 없앤다(웹 CSS로는 못 덮는 웹뷰 기본색).
    try wvc.DefaultBackgroundColor := 0x00000000   ; 웹뷰 투명 → 창의 배경 틴트(반투명)가 비침(배경만 반투명, 글자 불투명)
    ; navigate 실패(간헐 ERR_FAILED·타임아웃) 자동 재시도 → "되다가 안되다가" 자가 복구.
    try wvc.CoreWebView2.add_NavigationCompleted(OnNavDone.Bind(g.hwnd))
    wvc.CoreWebView2.Navigate(WidgetUrl(key, op))
    ; 웹 내장 손잡이 바(HTML) → AHK 브릿지: 투명도/닫기/앱/이동. 네이티브 손잡이 대체.
    try wvc.CoreWebView2.add_WebMessageReceived(OnWebMsg.Bind(g.hwnd, key))
    g.OnEvent("Size", OnResize)
    SetWidgetOpacity(g.hwnd, op)   ; 창 전체 반투명(슬라이더) — 어느 윈도우에서나 확실히 동작

    ; 참고: 예전의 '그림자 제거'(NCRENDERING_POLICY=DISABLED)는 DWM 비클라이언트 렌더링을 꺼서
    ;   둥근 모서리·테두리 색까지 무효화(회색 사각 프레임 잔존)했기에 제거함. → 둥근 모서리+파란
    ;   테두리를 살리고, 대신 은은한 그림자는 유지(둥근 창엔 자연스러움).
    StyleWindow(g.hwnd)   ; 둥근 모서리 + 얇은 파란 테두리(Win11)
    ; DWM 프레임(맨 위 비클라이언트 영역)을 다크로 → 다크모드에서 위쪽에 뜨던 밝은 띠 제거.
    ;   (창 배경·웹뷰 배경으론 못 없앰 — 이 영역은 DWM이 따로 그린다. attr 20 = USE_IMMERSIVE_DARK_MODE)
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", g.hwnd, "int", 20, "int*", gDark ? 1 : 0, "int", 4)
    if gGlass                       ; 글래스 모드면 아크릴 배경 적용(실험적)
        try ApplyGlass(g.hwnd, wvc, true)

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
    ; (예전엔 비입력 위젯에 WS_EX_NOACTIVATE를 걸어 '그룹 상승'을 막았으나, 비활성 창은
    ;   WebView2가 클릭·스크롤 입력을 못 받아 '먹통'이 됐다 → 제거. 앞으로-정렬은 RaiseWidget로만 처리.)
    ; 바탕화면 자식으로 바꾸면 좌표 기준이 부모(바탕화면)로 바뀌므로 위치만 재적용.
    ;   크기는 건드리지 않는다(-DPIScale + 클라이언트 크기 저장 기준을 유지 → 드리프트 없음).
    WinMove(x, y, , , "ahk_id " g.hwnd)
    SetWebViewBounds(wvc, g.hwnd, 0)   ; 웹뷰는 항상 창 전체 — 호버해도 내용이 밀리지 않음

    WidgetWins[g.hwnd] := {panel: key, opacity: op, gui: g, wvc: wvc, label: label,
                           handleGui: h, hlbl: hlbl, hsld: hsld, hApp: hApp, hX: hX,
                           handleShown: false, pinned: wantPin, navTries: 0}
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
    global WidgetWins, gGlass
    if WidgetWins.Has(hwnd)
        WidgetWins[hwnd].opacity := val
    if (gGlass) {
        WinSetTransparent(255, "ahk_id " hwnd)
        if WidgetWins.Has(hwnd)
            try ApplyGlass(hwnd, WidgetWins[hwnd].wvc, true)
    } else {
        ; 예전엔 WinSetTransparent(val)로 '창 전체'를 반투명하게 했는데, 이는 LWA_ALPHA라
        ;   글자까지 같이 흐려졌다. 이제 픽셀 단위 투명(ACCENT TRANSPARENTGRADIENT)을 써서
        ;   '배경만' 반투명하게 하고 글자(불투명 픽셀)는 100% 선명하게 유지한다.
        ApplyWidgetBg(hwnd, val)
    }
}

; 배경만 '흐림 없이' 또렷하게 투명(글자·선은 100% 선명) — 컬러키(LWA_COLORKEY) 방식.
;   · 아크릴(블러) 대신 순수 투명: 웹이 '테마 배경색'으로 칠한 영역만 완전 투명 처리 → 그 자리로
;     바탕화면이 또렷이(흐림 없이) 비친다. 글자·테두리는 다른 색이라 그대로 불투명하게 남는다.
;   · 키 색을 '테마 배경색'으로 두는 이유: (1) 혹시 컬러키가 안 먹어도 평소 위젯처럼 보임(사고 방지)
;     (2) 글자 안티에일리어싱 색번짐이 테마색이라 눈에 안 띔.
;   · LWA라 포커스와 무관 → 밖 클릭해도 안 변함(아크릴의 비활성 파래짐/라이트 먹통 없음).
ApplyWidgetBg(hwnd, val) {
    global gDark, WidgetWins
    key := gDark ? "0x0B1220" : "0xF1F5F9"        ; 투명 키 = 테마 배경색
    ; 아크릴/ACCENT 끄기(컬러키만 사용)
    accent := Buffer(16, 0)
    NumPut("uint", 0, accent, 0)
    data := Buffer(24, 0)
    NumPut("uint", 19, data, 0)
    NumPut("ptr", accent.Ptr, data, 8)
    NumPut("uptr", accent.Size, data, 16)
    try DllCall("user32\SetWindowCompositionAttribute", "ptr", hwnd, "ptr", data)
    if WidgetWins.Has(hwnd)
        try WidgetWins[hwnd].wvc.DefaultBackgroundColor := gDark ? 0xFF0B1220 : 0xFFF1F5F9  ; 웹뷰 기본배경=키색(불투명)
    ; 키색=완전 투명(바탕 뚫림 항상 유지). 색 뒤 알파(val 70~255)=글자·패널 불투명도(슬라이더).
    ;   · 255=지금처럼 글자 쨍  · 내리면 글자·패널이 은은해짐(바탕 뚫림은 그대로)
    a := (val < 70 ? 70 : (val > 255 ? 255 : val))
    try WinSetTransColor(key " " a, "ahk_id " hwnd)
}

; 창 모양 다듬기(Win11 DWM) — 둥근 모서리 + 얇은 파란 테두리(회색 두꺼운 포커스 테두리 대체)
;   · DWMWA_WINDOW_CORNER_PREFERENCE(33)=2(ROUND)
;   · DWMWA_BORDER_COLOR(34)=COLORREF(0x00BBGGRR) → 얇은 테두리를 조화로운 파란색으로
;   (Win10 등 미지원 환경에선 조용히 무시되어 각진 창으로 표시됨)
; (BORDER_COLOR·BORDER_COLOR_DARK 는 자동 실행 구역으로 옮김 — 파일 앞쪽 「전역 초기화」 참고)
StyleWindow(hwnd) {
    global BORDER_COLOR, BORDER_COLOR_DARK, gDark
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 33, "int*", 2, "int", 4)
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 34, "uint*", gDark ? BORDER_COLOR_DARK : BORDER_COLOR, "int", 4)
}

; ══════════════════════════════════════════════════════════════
;  카톡풍 토스트 알림 (ShowToast)
;   · 우측 하단에서 페이드로 떠서 dur(ms) 후 자동으로 사라진다.
;   · 클릭하면 onClick 실행 후 닫힘(예: 앱 열기). 여러 개면 위로 쌓인다(최신이 맨 아래).
;   · 포커스를 뺏지 않음(WS_EX_NOACTIVATE) → 작업 중 방해 최소. 둥근모서리·테두리는 위젯과 동일한 DWM.
;   · 알림 '기능'(언제 무슨 내용을 띄울지)과는 분리된 순수 UI 함수 → 트리거는 나중에 연결.
;   사용 예:  ShowToast("영남고 통합앱", "새 공지가 등록됐어요", { emoji:"📢", dur:6000, onClick:(*)=>Run(APP_URL) })
; ══════════════════════════════════════════════════════════════
; (토스트·이모지 전역값은 자동 실행 구역으로 옮김 — 파일 앞쪽 「전역 초기화」 참고)

; ── 종류별 컬러 이모지(공지/시간표/마감/과제/성적/기본) ─────────────────────
;   GDI 텍스트 컨트롤은 이모지를 흑백으로만 그린다. 컬러로 보이게 하려고 NotoColorEmoji로
;   렌더한 48px PNG를 base64로 내장 → 실행 시 임시 PNG로 풀어 Picture 컨트롤로 표시한다.

; base64 이모지를 임시 PNG로 1회 풀어두고 그 경로를 반환한다(실패/없음이면 "").
EmojiPng(key) {
    global EMOJI_B64, gEmojiDir
    if !EMOJI_B64.Has(key)
        return ""
    path := gEmojiDir "\" key ".png"
    if FileExist(path)
        return path
    if !DirExist(gEmojiDir)
        try DirCreate(gEmojiDir)
    b64 := EMOJI_B64[key]
    size := 0
    if !DllCall("crypt32\CryptStringToBinaryW", "wstr", b64, "uint", 0, "uint", 1, "ptr", 0, "uint*", &size, "ptr", 0, "ptr", 0)
        return ""
    buf := Buffer(size)
    if !DllCall("crypt32\CryptStringToBinaryW", "wstr", b64, "uint", 0, "uint", 1, "ptr", buf, "uint*", &size, "ptr", 0, "ptr", 0)
        return ""
    try {
        f := FileOpen(path, "w")
        f.RawWrite(buf, size)
        f.Close()
        return path
    }
    return ""
}


ShowToast(title, body, opts := unset) {
    global gDark, gToasts, gToastHooked, TOAST_W, TOAST_H, APP_URL
    o := IsSet(opts) ? opts : {}
    dur   := (o is Object && o.HasOwnProp("dur"))     ? o.dur     : 5000
    emoji := (o is Object && o.HasOwnProp("emoji"))   ? o.emoji   : "🔔"
    onClk := (o is Object && o.HasOwnProp("onClick")) ? o.onClick : ""
    typ   := (o is Object && o.HasOwnProp("type"))    ? o.type    : ""   ; 종류별 컬러 이모지 키(notice/cal/deadline/memo/grade/bell)
    goPage:= (o is Object && o.HasOwnProp("goto"))    ? o.goto    : ""   ; 클릭 시 열 앱 페이지(있으면 영남고 앱으로)
    if (onClk = "" && goPage != "")
        onClk := OpenAppPage.Bind(goPage)                                ; 커스텀 onClick 없으면 goto로 앱 열기
    if !gToastHooked {
        OnMessage(0x201, OnToastClick)      ; WM_LBUTTONDOWN → 카드 클릭 감지
        OnMessage(0x200, OnToastMove)       ; WM_MOUSEMOVE  → 호버 시작(자동닫힘 멈춤)
        OnMessage(0x2A3, OnToastLeave)      ; WM_MOUSELEAVE → 호버 끝(카운트다운 재개)
        gToastHooked := true
    }
    ; 카드는 다크모드에서도 '항상 흰색'(요청) → 글자는 진한 남색/회색으로 고정.
    fg  := "1A2540"                          ; 제목(진한 남색)
    sub := "5B6B84"                          ; 본문(회색)
    ; 기본(학교/앱) 아이콘 — 위젯 전용 widget.ico가 아니라 '앱 기본 아이콘'을 쓴다(요청).
    ;   1순위: icon.ico(기본 아이콘 파일)  2·3순위: 앱 실행파일에 박힌 아이콘(Icon1)  → 없으면 이모지
    icoFile := "", icoOpt := ""
    if FileExist(A_ScriptDir "\icon.ico")
        icoFile := A_ScriptDir "\icon.ico"
    else if FileExist(A_ScriptDir "\영남고.exe")
        icoFile := A_ScriptDir "\영남고.exe", icoOpt := "Icon1 "
    else if FileExist(A_ScriptDir "\ynhs-app.exe")
        icoFile := A_ScriptDir "\ynhs-app.exe", icoOpt := "Icon1 "
    g := Gui("-Caption +AlwaysOnTop +ToolWindow +E0x08000000")   ; NOACTIVATE: 포커스 안 뺏음
    g.BackColor := "FFFFFF"
    g.MarginX := 0, g.MarginY := 0
    if (icoFile != "")
        g.Add("Picture", "x16 y25 w44 h44 " icoOpt, icoFile)                ; 기본 앱 아이콘(세로중앙)
    else {                                                                   ; 아이콘 없으면 이모지로 폴백
        g.SetFont("s22", "Segoe UI Emoji")
        g.Add("Text", "x16 y0 w44 h" TOAST_H " Center +0x200", emoji)
    }
    ; 제목 줄: (종류별 컬러 이모지) + 제목  — 이모지가 '무슨 알림'인지 한눈에
    titleX := 72
    emoPng := (typ != "") ? EmojiPng(typ) : ""
    if (emoPng != "") {
        g.Add("Picture", "x72 y19 w22 h22", emoPng)
        titleX := 100
    }
    g.SetFont("s11 Bold", "Malgun Gothic")
    g.Add("Text", Format("x{} y17 w{} h24 c{}", titleX, TOAST_W-titleX-16, fg), title)
    g.SetFont("s10 Norm", "Malgun Gothic")
    g.Add("Text", Format("x72 y46 w{} h34 c{}", TOAST_W-72-16, sub), body)
    g.Show("Hide w" TOAST_W " h" TOAST_H)
    hwnd := g.Hwnd
    ApplyToastStyle(hwnd)
    try WinSetTransparent(0, "ahk_id " hwnd)   ; 완전 투명으로 시작(깜빡임 방지)
    g.Show("NoActivate")
    t := {g: g, hwnd: hwnd, h: TOAST_H, onClick: onClk, dur: dur, hover: false, timer: 0}
    gToasts.Push(t)
    t.timer := DismissToast.Bind(hwnd)
    SetTimer(t.timer, -dur)                     ; ★ 자동 닫힘을 '먼저' 확실히 예약(페이드/인덱스와 무관)
    ReflowToasts()                             ; 새 토스트 포함 전체 위치 재배치(투명 상태에서)
    FadeToast(hwnd, 0, 255)                     ; 페이드 인
    return hwnd
}

ApplyToastStyle(hwnd) {
    global gDark
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 20, "int*", gDark ? 1 : 0, "int", 4)                        ; 다크 프레임
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 33, "int*", 2, "int", 4)                                    ; 둥근 모서리
    try DllCall("dwmapi\DwmSetWindowAttribute", "ptr", hwnd, "int", 34, "uint*", gDark ? 0x00403428 : 0x00E2E2E2, "int", 4)     ; 얇은 테두리(BGR)
}

; 우측 하단 기준으로 전체 토스트를 다시 쌓는다(최신=맨 아래, 위로 누적).
;   ★ DPI 배율(125/150%) 대응: 상수 TOAST_W/H(논리값)로 위치를 잡으면 실제 창은 배율만큼
;      커져 화면 밖으로 잘린다. 그래서 각 창의 '실제 픽셀 크기'(WinGetPos)로 위치를 계산한다.
ReflowToasts() {
    global gToasts, TOAST_W, TOAST_H, TOAST_GAP, TOAST_MARGIN
    MonitorGetWorkArea(MonitorGetPrimary(), &wl, &wt, &wr, &wb)
    y := wb - TOAST_MARGIN
    i := gToasts.Length
    while (i >= 1) {
        t := gToasts[i]
        ww := 0, wh := 0
        try WinGetPos(, , &ww, &wh, "ahk_id " t.hwnd)   ; 실제(물리) 크기
        if (ww = 0)                                       ; 못 읽으면 논리값으로 폴백
            ww := TOAST_W, wh := TOAST_H
        x := wr - ww - TOAST_MARGIN
        y -= wh
        try WinMove(x, y, , , "ahk_id " t.hwnd)
        y -= TOAST_GAP
        i--
    }
}

; 부드러운 투명도 전환(약 0.14초). from·to: 0~255
FadeToast(hwnd, from, to) {
    Loop 12 {
        a := from + (to - from) * (A_Index / 12)
        try WinSetTransparent(Round(a), "ahk_id " hwnd)
        Sleep 12
    }
}

DismissToast(hwnd, *) {
    global gToasts
    Critical "On"                      ; 페이드 중 다른 타이머가 끼어들어 목록을 헝클지 못하게
    idx := 0
    for i, t in gToasts
        if (t.hwnd = hwnd) {
            idx := i
            break
        }
    if !idx {                          ; 이미 닫힘(중복 호출) → 조용히 무시
        Critical "Off"
        return
    }
    t := gToasts[idx]
    try SetTimer(t.timer, 0)           ; 자동닫힘 타이머 취소(수동 클릭 시 중복 방지)
    gToasts.RemoveAt(idx)              ; ★ 목록에서 '먼저' 제거 → 재진입/중복에도 안전
    Critical "Off"
    FadeToast(hwnd, 255, 0)
    try t.g.Destroy()
    ReflowToasts()                     ; 남은 토스트 아래로 당겨 재정렬
}

OnToastClick(wParam, lParam, msg, hwnd) {
    global gToasts
    for t in gToasts
        if (t.hwnd = hwnd) {
            cb := t.onClick
            if cb
                try cb.Call()
            DismissToast(hwnd)
            return 0
        }
}

; 마우스가 토스트 위로 올라오면 자동닫힘을 멈춘다(카톡/윈도우 알림과 동일).
OnToastMove(wParam, lParam, msg, hwnd) {
    global gToasts
    for t in gToasts
        if (t.hwnd = hwnd) {
            if !t.hover {
                t.hover := true
                try SetTimer(t.timer, 0)                 ; 호버 중엔 카운트다운 정지
                tme := Buffer(A_PtrSize = 8 ? 24 : 16, 0)   ; TRACKMOUSEEVENT
                NumPut("uint", tme.Size, tme, 0)         ; cbSize
                NumPut("uint", 0x2, tme, 4)              ; dwFlags = TME_LEAVE
                NumPut("ptr", hwnd, tme, 8)              ; hwndTrack
                try DllCall("TrackMouseEvent", "ptr", tme)   ; 벗어날 때 WM_MOUSELEAVE 받기
            }
            return
        }
}

; 마우스가 토스트를 벗어나면 다시 카운트다운(남은 시간 대신 dur만큼 새로 준다 → 여유있게).
OnToastLeave(wParam, lParam, msg, hwnd) {
    global gToasts
    for t in gToasts
        if (t.hwnd = hwnd) {
            if t.hover {
                t.hover := false
                try SetTimer(t.timer, -t.dur)
            }
            return
        }
}

; 알림 클릭 → 브라우저가 아니라 '영남고 통합앱'으로 연다(위젯 ↗앱과 동일한 goto 방식).
;   page="" 이면 앱만 띄우고, page가 있으면 그 페이지로 이동시킨다.
OpenAppPage(page := "") {
    global APP_URL
    dir := A_AppData "\YnhsApp"
    try DirCreate(dir)
    if (page != "") {
        try FileDelete(dir "\goto.txt")
        try FileAppend(page, dir "\goto.txt")
    }
    if ProcessExist("영남고.exe") {                 ; 이미 실행 중 → 메시지로 표시(+이동)
        nm  := (page != "") ? "YNHS_APP_GOTO_v1" : "YNHS_APP_SHOW_v1"
        msg := DllCall("RegisterWindowMessage", "str", nm, "uint")
        PostMessage(msg, 0, 0, , "ahk_id 0xFFFF")   ; HWND_BROADCAST
        return
    }
    appExe := A_ScriptDir "\영남고.exe"             ; 아니면 앱 실행(앱이 시작 시 goto.txt 읽음)
    if FileExist(appExe)
        Run('"' appExe '"', A_ScriptDir)
    else
        Run(page != "" ? (APP_URL "?goto=" page) : APP_URL)   ; 앱 없으면 브라우저 폴백
}

; 테스트 미리보기: Win+Shift+T → 카톡풍 토스트 3개(스택·종류별 컬러 이모지 확인). 클릭 시 영남고 앱 열림.
#+t:: {
    ShowToast("새 공지", "급식 변경 안내가 등록되었습니다. 클릭하면 앱이 열려요.", { type: "notice", onClick: (*) => OpenAppPage() })
    SetTimer(() => ShowToast("시간표 알림", "3교시는 물리 · 2-11 이동수업입니다.", { type: "cal" }), -700)
    SetTimer(() => ShowToast("과제 마감", "수학 과제 제출이 1시간 남았습니다.", { type: "deadline" }), -1400)
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
    global dragHwnd, grabOffX, grabOffY, dragW, dragH, WidgetWins, SNAP, GAP
    if !dragHwnd || !GetKeyState("LButton", "P") {
        if dragHwnd
            SaveWidget(dragHwnd)
        dragHwnd := 0
        SetTimer(DragMove, 0)
        return
    }
    MouseGetPos(&cx, &cy)
    nx := cx - grabOffX, ny := cy - grabOffY
    ; +Resize 창은 좌·우·아래에 ~8px 투명 여백이 창 좌표에 포함된다. 스냅을 '창 좌표' 기준으로
    ;   하면 방향마다 이 여백이 다르게 끼어(세로 8px·가로 16px 등) 간격이 제각각이 된다.
    ;   → 스냅을 '보이는영역(visible)' 기준으로 계산해, 어느 방향이든 항상 같은 간격(GAP)이 되게 한다.
    WidgetFrameOffsets(dragHwnd, &offL, &offT, &offR, &offB)
    vW := dragW - offL - offR, vH := dragH - offT - offB   ; 드래그 위젯의 '보이는' 크기
    vnx := nx + offL, vny := ny + offT                      ; 제안 위치(보이는영역 좌상단)
    for hwnd, w in WidgetWins {
        if (hwnd = dragHwnd) || !WinExist("ahk_id " hwnd)
            continue
        WidgetVisibleRect(hwnd, &ox, &oy, &oW, &oH)
        ; 세로로 겹치는 구간이 있을 때만 좌우 스냅(맞붙음=GAP, 같은쪽=정렬)
        if (vny < oy + oH && vny + vH > oy) {
            if Abs((vnx + vW + GAP) - ox) <= SNAP
                vnx := ox - GAP - vW
            else if Abs(vnx - (ox + oW + GAP)) <= SNAP
                vnx := ox + oW + GAP
            else if Abs(vnx - ox) <= SNAP
                vnx := ox
            else if Abs((vnx + vW) - (ox + oW)) <= SNAP
                vnx := ox + oW - vW
        }
        ; 가로로 겹치는 구간이 있을 때만 상하 스냅(맞붙음=GAP, 같은쪽=정렬)
        if (vnx < ox + oW && vnx + vW > ox) {
            if Abs((vny + vH + GAP) - oy) <= SNAP
                vny := oy - GAP - vH
            else if Abs(vny - (oy + oH + GAP)) <= SNAP
                vny := oy + oH + GAP
            else if Abs(vny - oy) <= SNAP
                vny := oy
            else if Abs((vny + vH) - (oy + oH)) <= SNAP
                vny := oy + oH - vH
        }
    }
    ; 모니터 가장자리(베젤)에도 자석 스냅 — 보이는 가장자리를 작업영역 가장자리에 딱 붙임
    hMon := DllCall("MonitorFromWindow", "ptr", dragHwnd, "uint", 2, "ptr")   ; NEAREST
    if hMon {
        mi := Buffer(40, 0), NumPut("uint", 40, mi, 0)
        if DllCall("GetMonitorInfo", "ptr", hMon, "ptr", mi) {
            mL := NumGet(mi, 20, "int"), mT := NumGet(mi, 24, "int")   ; rcWork
            mR := NumGet(mi, 28, "int"), mB := NumGet(mi, 32, "int")
            if Abs(vnx - mL) <= SNAP
                vnx := mL
            else if Abs((vnx + vW) - mR) <= SNAP
                vnx := mR - vW
            if Abs(vny - mT) <= SNAP
                vny := mT
            else if Abs((vny + vH) - mB) <= SNAP
                vny := mB - vH
        }
    }
    ; 보이는영역 기준 좌표를 다시 창 좌표로 되돌려 이동
    WinMove(vnx - offL, vny - offT, , , "ahk_id " dragHwnd)
    ; (손잡이 바는 웹 내장이라 창과 함께 자동 이동 → 별도 추종 불필요)
}

; 창 좌표 ↔ '보이는영역' 좌표 사이의 네 변 여백(투명 리사이즈 테두리 두께)을 구한다.
;   offL/offT/offR/offB = 각 변에서 창 좌표가 보이는영역보다 바깥으로 나간 픽셀 수.
;   여백은 창 크기와 무관한 '상수'이므로, 반드시 '현재' 창의 실제 크기(WinGetPos)로 계산한다.
;   (크기 조절 중 '새 크기'를 넣으면 offR/offB가 변화량만큼 어긋나 스냅이 깨진다)
WidgetFrameOffsets(hwnd, &offL, &offT, &offR, &offB) {
    WinGetPos(&wx, &wy, &ww, &wh, "ahk_id " hwnd)
    WidgetVisibleRect(hwnd, &vx, &vy, &vw, &vh)
    offL := vx - wx
    offT := vy - wy
    offR := (wx + ww) - (vx + vw)
    offB := (wy + wh) - (vy + vh)
}

; ── 크기 조절 시 테두리 자석 스냅(WM_SIZING) ───────────────
;  창 가장자리를 끌어 크기를 바꿀 때, 끌고 있는 변을 이웃 위젯의 변에 착 붙인다.
;   lParam = 조절 중인 사각형(RECT, 화면좌표) → 수정하면 그대로 반영된다.
;   wParam = 어느 변을 끄는지(WMSZ): 1=좌 2=우 3=상 4=좌상 5=우상 6=하 7=좌하 8=우하
OnSizing(wParam, lParam, msg, hwnd) {
    global WidgetWins, SNAP, GAP
    if !WidgetWins.Has(hwnd)
        return
    L := NumGet(lParam, 0, "int")
    T := NumGet(lParam, 4, "int")
    R := NumGet(lParam, 8, "int")
    B := NumGet(lParam, 12, "int")
    ; 리사이즈 사각형(창 좌표)을 '보이는영역' 좌표로 바꿔, 이동 스냅과 똑같이 GAP 간격으로 붙인다.
    WidgetFrameOffsets(hwnd, &offL, &offT, &offR, &offB)
    vL := L + offL, vT := T + offT, vR := R - offR, vB := B - offB
    dragL := (wParam = 1 || wParam = 4 || wParam = 7)
    dragR := (wParam = 2 || wParam = 5 || wParam = 8)
    dragT := (wParam = 3 || wParam = 4 || wParam = 5)
    dragB := (wParam = 6 || wParam = 7 || wParam = 8)
    for h2, w in WidgetWins {
        if (h2 = hwnd) || !WinExist("ahk_id " h2)
            continue
        WidgetVisibleRect(h2, &gx, &gy, &gw, &gh)
        gRight  := gx + gw
        gBottom := gy + gh
        ; 끌고 있는 변(보이는영역)을 이웃의 맞붙는 변+GAP 또는 같은 쪽 변(정렬)에 스냅
        if (dragL)
            vL := SnapEdge(vL, gRight + GAP, gx)
        if (dragR)
            vR := SnapEdge(vR, gx - GAP, gRight)
        if (dragT)
            vT := SnapEdge(vT, gBottom + GAP, gy)
        if (dragB)
            vB := SnapEdge(vB, gy - GAP, gBottom)
    }
    ; 보이는영역 좌표 → 창 좌표로 환원
    NumPut("int", vL - offL, lParam, 0)
    NumPut("int", vT - offT, lParam, 4)
    NumPut("int", vR + offR, lParam, 8)
    NumPut("int", vB + offB, lParam, 12)
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
    try IniWrite("0", CONFIG, "selected", WidgetWins[hwnd].panel)
    w := WidgetWins[hwnd]
    g := w.gui, h := w.handleGui
    HandleToWidget.Delete(h.hwnd)
    WidgetWins.Delete(hwnd)     ; 먼저 목록에서 제거 → 타이머가 파괴 중 컨트롤을 안 만짐
    try w.wvc.Close()           ; WebView2 컨트롤러 명시적 종료 → msedgewebview2.exe 즉시 정리(잔류·잠김 방지)
    try h.Destroy()
    try g.Destroy()
}

; ↗ 앱: 브라우저 새 창이 아니라 통합앱(영남고.exe) 창을 '해당 패널 페이지'로 띄운다.
;   · 이동할 페이지를 공유 파일(goto.txt)에 적어두면 앱이 읽어 그 페이지로 이동.
;   · 이미 실행 중이면 GOTO 메시지 브로드캐스트, 아니면 영남고.exe 실행(앱이 시작 시 읽음).
;   · 영남고.exe가 없으면(구 standalone) 브라우저로 ?goto= 열기.
LaunchMain(panel) {
    global APP_URL
    page := PanelToPage(panel)
    dir := A_AppData "\YnhsApp"
    try DirCreate(dir)
    try FileDelete(dir "\goto.txt")
    try FileAppend(page, dir "\goto.txt")
    if ProcessExist("영남고.exe") {
        msg := DllCall("RegisterWindowMessage", "str", "YNHS_APP_GOTO_v1", "uint")
        PostMessage(msg, 0, 0, , "ahk_id 0xFFFF")   ; HWND_BROADCAST → 앱이 그 페이지로 이동+표시
        return
    }
    appExe := A_ScriptDir "\영남고.exe"
    if FileExist(appExe)
        Run('"' appExe '"', A_ScriptDir)
    else
        Run(APP_URL "?goto=" page)
}

; ── 웹 내장 손잡이 바에서 온 메시지 처리 (투명도/닫기/앱/이동) ──
OnWebMsg(gh, key, sender, args) {
    m := ""
    try m := args.TryGetWebMessageAsString()
    if (m = "")
        try m := Trim(args.WebMessageAsJson, '"')
    if (m = "close")
        SetTimer(() => DestroyWidget(gh, true), -1)   ; 이벤트 끝난 뒤 파괴(즉시 파괴 시 크래시)
    else if (m = "app")
        LaunchMain(key)
    else if (m = "drag")
        StartDragFromMouse(gh)
    else if (m = "raise")
        RaiseWidget(gh)
    else if (SubStr(m, 1, 3) = "op:")
        SetWidgetOpacity(gh, Integer(SubStr(m, 4)))
    else if (SubStr(m, 1, 6) = "toast" Chr(31))    ; 웹앱 알림 → 위젯 토스트로
        HandleToastMsg(m)
}

; 웹앱(index.html)이 보낸 알림을 위젯 토스트로 띄운다.
;   형식: "toast"<US>id<US>type<US>goto<US>title<US>body   (US=Chr(31))
;   여러 위젯 웹뷰가 같은 이벤트를 보낼 수 있어 id로 1회만 표시(gToastSeen).
HandleToastMsg(m) {
    global gToastSeen
    parts := StrSplit(m, Chr(31))
    if (parts.Length < 6)
        return
    id := parts[2], typ := parts[3], goPage := parts[4], title := parts[5], body := parts[6]
    if (id != "") {
        if gToastSeen.Has(id)
            return
        gToastSeen[id] := true
    }
    opts := { type: (typ != "" ? typ : "bell") }
    if (goPage != "")
        opts.goto := goPage
    else
        opts.onClick := (*) => OpenAppPage()       ; 페이지 없으면 앱만 표시
    ShowToast(title, body, opts)
}
; 누른 위젯만 다른 위젯들보다 앞으로 (다른 위젯을 이 위젯 바로 뒤로 내림 →
;   이 위젯의 z-order 자체는 안 올려서 '앱 창 위로 튀어나오는' 일이 없다)
RaiseWidget(gh) {
    global WidgetWins
    if !WinExist("ahk_id " gh)
        return
    for hwnd, w in WidgetWins {
        if (hwnd = gh) || !WinExist("ahk_id " hwnd)
            continue
        ; hwnd를 gh 바로 아래에 배치(SWP_NOMOVE|NOSIZE|NOACTIVATE)
        DllCall("SetWindowPos", "ptr", hwnd, "ptr", gh, "int", 0, "int", 0, "int", 0, "int", 0, "uint", 0x13)
    }
}
; 웹에서 드래그 시작 신호 → 현재 마우스 기준으로 창 이동 시작(기존 DragMove 재사용)
StartDragFromMouse(gh) {
    global dragHwnd, grabOffX, grabOffY, dragW, dragH
    if !WinExist("ahk_id " gh)
        return
    MouseGetPos(&cx, &cy)
    WinGetPos(&wx, &wy, &wW, &wH, "ahk_id " gh)
    dragHwnd := gh, grabOffX := cx - wx, grabOffY := cy - wy, dragW := wW, dragH := wH
    SetTimer(DragMove, 10)
}

; 위젯 페이지 URL — 메모는 독립 페이지(memo2.html), 나머지는 index.html?widget=
PanelUrl(panel) {
    global APP_BASE, APP_URL
    if (panel = "memo")
        return APP_URL "memo2.html?embed=1"
    return APP_BASE panel
}

; 위젯이 실제로 로드할 전체 URL(테마·투명도·캐시버스터 포함). 최초 로드/재시도 공용.
WidgetUrl(panel, op) {
    global gDark, gGlass
    return PanelUrl(panel) "&op=" op "&dark=" (gDark ? "1" : "0") "&glass=" (gGlass ? "1" : "0") "&t=" A_Now
}

; navigate 완료 콜백 — 성공하면 재시도 카운터 리셋, 실패(ERR_FAILED·타임아웃 등)면
;   잠시 뒤 자동 재시도. "되다가 안되다가" 하는 간헐적 네트워크 실패가 새로고침 없이 스스로 복구된다.
;   (thqby 래퍼: 핸들러는 (sender, args)를 뒤에 붙여 호출 → Bind(hwnd)로 hwnd가 앞에 온다)
OnNavDone(hwnd, sender, args) {
    global WidgetWins
    if !WidgetWins.Has(hwnd)
        return
    w := WidgetWins[hwnd]
    ok := 1   ; 속성을 못 읽으면(래퍼 차이) 성공으로 간주 — 잘못된 재로드 폭주 방지(안전측)
    try ok := args.IsSuccess
    if ok {
        w.navTries := 0
        return
    }
    ; 실패 — 최대 4회까지, 점점 간격을 늘려(1.5·3·4.5·6초) 재시도. 그 뒤엔 멈춘다(무한 루프 방지).
    if (w.navTries >= 4) {
        OfferProfileReset()      ; 재시도로도 안 되면 프로필이 나쁜 상태에 갇힌 것일 수 있다
        return
    }
    w.navTries += 1
    SetTimer(RetryNav.Bind(hwnd), -1500 * w.navTries)
}

RetryNav(hwnd) {
    global WidgetWins
    if !WidgetWins.Has(hwnd)
        return
    w := WidgetWins[hwnd]
    try w.wvc.CoreWebView2.Navigate(WidgetUrl(w.panel, w.opacity))
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
    ; 저장 실패(디스크 꽉 참 등)에도 위젯이 죽지 않게 방어 — 다음 저장 때 다시 시도된다.
    try {
        IniWrite(wx, CONFIG, "pos_" w.panel, "x"), IniWrite(wy, CONFIG, "pos_" w.panel, "y")
        IniWrite(cw, CONFIG, "pos_" w.panel, "w"), IniWrite(ch, CONFIG, "pos_" w.panel, "h")
        IniWrite(w.opacity, CONFIG, "pos_" w.panel, "opacity")
    }
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
    global DLL_PATH, WidgetWins
    SaveAll()
    ; 각 위젯의 WebView2 컨트롤러를 명시적으로 닫아 msedgewebview2.exe가 즉시 정리되게 한다.
    ;   (안 닫으면 종료가 느리고, 세션 폴더가 한동안 잠겨 바로 재실행하면 안 뜬다)
    for hwnd, w in WidgetWins {
        try w.wvc.Close()
    }
    if A_IsCompiled
        try FileDelete(DLL_PATH)
}
