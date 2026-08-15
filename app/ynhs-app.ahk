#Requires AutoHotkey v2.0
#SingleInstance Off
Persistent()
#Include %A_ScriptDir%\WebView2\WebView2.ahk

; ============================================================
;  영남고 통합앱 (AutoHotkey v2 + WebView2)
;  · 서명된 정품 AutoHotkey로 구동 → 백신 오탐 위험 낮음
;  · 포털(ynhs)을 전체 창으로 로드. 포털은 github.io에서 실시간이라 항상 최신.
;  · 링크(target=_blank·window.open) → 앱 안이 아니라 기본 브라우저로 연다.
;  · 트레이 상주: 닫기(X)는 종료 대신 트레이로 숨김, 트레이/메뉴로 다시 열기·종료.
;  · 중복 실행 방지: 이미 떠 있으면 두 번째 실행은 경고 없이 기존 창만 띄우고 종료.
; ============================================================

; ── WebView2 브라우저 인자 (어떤 WebView2 호출보다 먼저 설정해야 한다) ──
;  · QUIC(HTTP/3) 끄기 — UDP 443 이 막힌 망에서 접속이 타임아웃되는 것을 피한다.
;    WebView2 는 브라우저 프로세스를 '처음 띄울 때' 이 환경변수를 읽으므로,
;    웹뷰를 만드는 시점에 설정하면 이미 떠 있는 프로세스를 재사용해 무시된다.
;  · 넷로그(선택) — %AppData%\YnhsApp\netlog.on 파일이 있으면 진단 로그를 남긴다.
;    앱은 브라우저·위젯과 별개의 프로필을 쓰므로, 앱만 먹통일 때 원인을 볼 수단이 없었다.
_wvArgs := "--disable-quic"
if FileExist(A_AppData "\YnhsApp\netlog.on")
    _wvArgs .= " --log-net-log=" A_AppData "\YnhsApp\netlog.json --net-log-capture-mode=Default"
EnvSet("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", _wvArgs)

APP_URL := "https://kyunghwanp.github.io/test/"
main := 0
wvc := 0
WIDGET_EXE := A_ScriptDir "\위젯.exe"          ; 바탕화면 위젯(별도 서명 AutoHotkey)
WIDGET_PREF := A_AppData "\YnhsApp\widget.on"  ; 위젯 켜짐 상태 기억(파일 존재=켜짐)
GOTO_FILE := A_AppData "\YnhsApp\goto.txt"     ; 위젯 ↗앱이 적어두는 이동할 페이지
gWidgetOn := false                             ; 위젯 '사용자 의도' 상태(체크 표시의 기준)

; 두 번째 인스턴스 → 기존 창 띄우기 신호 / 위젯 ↗앱 → 특정 페이지로 이동 신호 (시스템 전역 고유 메시지)
MSG_SHOW := DllCall("RegisterWindowMessage", "str", "YNHS_APP_SHOW_v1", "uint")
MSG_GOTO := DllCall("RegisterWindowMessage", "str", "YNHS_APP_GOTO_v1", "uint")

; ── 중복 실행 방지(이름 있는 뮤텍스) ──
hMutex := DllCall("CreateMutexW", "ptr", 0, "int", 0, "str", "Local\YnhsAppSingleton_v1", "ptr")
if (A_LastError = 183) {                        ; ERROR_ALREADY_EXISTS
    PostMessage(MSG_SHOW, 0, 0, , "ahk_id 0xFFFF")   ; HWND_BROADCAST → 기존 인스턴스가 창을 띄움
    ExitApp
}

; ── WebView2Loader.dll 경로 ──
DLL := ""
for p in [A_ScriptDir "\WebView2Loader.dll", A_ScriptDir "\WebView2\WebView2Loader.dll"]
    if FileExist(p) {
        DLL := p
        break
    }
if (DLL = "") {
    MsgBox("WebView2Loader.dll을 찾지 못했습니다.`n압축을 폴더째 풀고 '영남고.exe'를 실행하세요.", "영남고", 0x30)
    ExitApp
}

; ── 메인 창 ──
main := Gui("+Resize", "영남고등학교")
main.BackColor := "FFFFFF"
main.OnEvent("Size", OnSize)
main.OnEvent("Close", (*) => main.Hide())        ; X → 종료 대신 트레이로 숨김
main.Show("w1040 h1010")
SetWindowIcon()

; ── 트레이 ──
try TraySetIcon(A_ScriptDir "\icon.ico")
A_IconTip := "영남고등학교"
A_TrayMenu.Delete()
A_TrayMenu.Add("열기", (*) => ShowApp())
A_TrayMenu.Add("바탕화면 위젯", (*) => ToggleWidget())
A_TrayMenu.Add()
A_TrayMenu.Add("종료", (*) => ExitApp())
A_TrayMenu.Default := "열기"

; 지난번 켜둔 상태면 위젯 자동 복원 (앱이 부팅 자동실행이면 위젯도 함께 뜸)
if FileExist(WIDGET_PREF) {
    gWidgetOn := true
    A_TrayMenu.Check("바탕화면 위젯")
    StartWidget()
}
; 위젯을 (위젯 자체 트레이 '종료' 등) 외부에서 끄면 체크 표시가 따라 꺼지도록 주기 반영
SetTimer(RefreshWidgetCheck, 1500)

; 두 번째 실행 신호 수신 → 창 띄우기 / 위젯 ↗앱 신호 → 해당 페이지로 이동+표시
OnMessage(MSG_SHOW, (*) => ShowApp())
OnMessage(MSG_GOTO, (*) => GotoFromFile())

; 바탕화면 바로가기(영남고 로고) — 없으면 생성
EnsureDesktopShortcut()

; ── WebView2 로드 ──
SESSION := A_AppData "\YnhsApp\Session"
RESET_FLAG := A_AppData "\YnhsApp\reset.flag"
gNavTries := 0
gResetAsked := false
ResetProfileIfRequested()          ; 예약돼 있으면 웹뷰를 만들기 전에 프로필을 지운다
try DirCreate(SESSION)
try {
    env := WebView2.CreateEnvironmentAsync(0, SESSION, "", DLL).await()
    wvc := env.CreateCoreWebView2ControllerAsync(main.Hwnd).await()
    ; 위젯 ↗앱으로 실행됐으면 goto.txt의 페이지로 바로 진입, 아니면 메인
    startPage := ReadGoto()
    try wvc.CoreWebView2.add_NavigationCompleted(OnNavDone)    ; 실패 시 자동 재시도
    wvc.CoreWebView2.Navigate(startPage != "" ? APP_URL "?goto=" startPage : APP_URL)
    try wvc.CoreWebView2.add_NewWindowRequested(OnNewWindow)   ; 새 창 → 기본 브라우저
    SetBounds()
} catch as e {
    MsgBox("포털을 여는 데 실패했습니다.`n인터넷 연결을 확인한 뒤 다시 실행해 주세요.`n`n(" e.Message ")", "영남고", 0x30)
}

; ── 함수 ──
; navigate 실패 시 자동 재시도 → 망이 잠깐 흔들려도 흰 화면으로 멈추지 않는다.
; 재시도로도 안 되면 프로필이 나쁜 상태에 갇힌 것일 수 있어 초기화를 한 번 묻는다.
OnNavDone(sender, args) {
    global gNavTries, wvc
    ok := 1                        ; 속성을 못 읽으면 성공으로 간주(잘못된 재로드 폭주 방지)
    try ok := args.IsSuccess
    if ok {
        gNavTries := 0
        return
    }
    if (gNavTries >= 4) {
        OfferProfileReset()
        return
    }
    gNavTries += 1
    SetTimer(RetryNav, -1500 * gNavTries)
}
RetryNav() {
    global wvc, APP_URL
    if wvc
        try wvc.CoreWebView2.Navigate(APP_URL)
}

; ── WebView2 프로필 자가 복구 ──
; 프로필 폴더는 WebView2 가 떠 있는 동안 잠겨 있어 지울 수 없다.
; 그래서 '다음 시작 때 지우기'로 예약하고 재시작한다.
ResetProfileIfRequested() {
    global SESSION, RESET_FLAG
    if !FileExist(RESET_FLAG)
        return
    try FileDelete(RESET_FLAG)
    Sleep 400
    try DirDelete(SESSION, 1)
}
OfferProfileReset() {
    global gResetAsked, RESET_FLAG
    if gResetAsked
        return
    gResetAsked := true
    r := MsgBox("포털을 계속 불러오지 못하고 있습니다.`n`n"
              . "앱 저장소를 초기화하고 다시 시작할까요?`n"
              . "(설정은 유지되고, 앱 로그인만 다시 하시면 됩니다)",
                "영남고", 0x24)
    if (r != "Yes")
        return
    try FileAppend("", RESET_FLAG)
    Reload
}

; 위젯 ↗앱이 적어둔 이동 페이지를 한 번 읽고 지운다(없으면 "")
ReadGoto() {
    global GOTO_FILE
    p := ""
    try {
        if FileExist(GOTO_FILE) {
            p := Trim(FileRead(GOTO_FILE), " `t`r`n")
            FileDelete(GOTO_FILE)
        }
    }
    return p
}
; 위젯 ↗앱 신호: goto.txt 페이지로 WebView 이동 + 창 표시
GotoFromFile() {
    global wvc, APP_URL
    p := ReadGoto()
    if (p != "" && wvc)
        try wvc.CoreWebView2.Navigate(APP_URL "?goto=" p)
    ShowApp()
}

ShowApp(*) {
    global main
    if !main
        return
    main.Show()
    try WinActivate("ahk_id " main.Hwnd)
}

OnSize(gui, minmax, w, h) {
    if (minmax = -1)          ; 최소화 상태면 리사이즈 무시
        return
    SetBounds()
}

SetBounds() {
    global wvc, main
    if !wvc
        return
    rc := Buffer(16)
    DllCall("GetClientRect", "ptr", main.Hwnd, "ptr", rc)
    r := Buffer(16)
    NumPut("int", 0, r, 0), NumPut("int", 0, r, 4)
    NumPut("int", NumGet(rc, 8, "int"), r, 8), NumPut("int", NumGet(rc, 12, "int"), r, 12)
    wvc.Bounds := r
}

OnNewWindow(sender, args) {
    ; 앱 안 새 창은 막고 URL을 기본 브라우저로 연다
    try {
        args.Handled := true
        u := args.Uri
        if (u != "")
            Run(u)
    }
}

; ── 바탕화면 위젯 켜기/끄기 (풀 기능 위젯 = 위젯.exe → ynhs-widget.ahk) ──
ToggleWidget() {
    global WIDGET_PREF, gWidgetOn
    gWidgetOn := !gWidgetOn        ; 프로세스 존재가 아니라 '사용자 의도'로 토글 방향 결정
    if gWidgetOn {
        ; 켜기: 체크 즉시 표시 → 남은(멈춘) 프로세스가 있으면 먼저 정리 → 새로 확실히 실행
        A_TrayMenu.Check("바탕화면 위젯")
        try DirCreate(A_AppData "\YnhsApp")
        try FileAppend("", WIDGET_PREF)
        CloseWidgetProcesses()     ; 잔류 프로세스 정리 후
        StartWidget()              ; 항상 새로 띄운다(= 눌렀는데 안 뜨는 일 없음)
    } else {
        ; 끄기: 체크 즉시 해제 + 프로세스 정리
        A_TrayMenu.Uncheck("바탕화면 위젯")
        try FileDelete(WIDGET_PREF)
        CloseWidgetProcesses()
    }
    ; 위젯을 밖에서 껐을 때의 보정은 주기 타이머(RefreshWidgetCheck)가 담당한다.
}
; 위젯 프로세스를 모두(런처/본체가 같은 이름이라 여러 개일 수 있음) 확실히 종료.
;   ProcessClose(=TerminateProcess)는 종료까지 동기 대기하므로 긴 Sleep 없이 연속 종료(트레이 안 멈춤).
CloseWidgetProcesses() {
    loop 10 {
        pid := ProcessExist("위젯.exe")
        if !pid
            break
        try ProcessClose(pid)
    }
}
StartWidget() {
    global WIDGET_EXE
    if FileExist(WIDGET_EXE)
        Run('"' WIDGET_EXE '"', A_ScriptDir)
}
; 체크 표시는 '사용자 의도(gWidgetOn)'를 따른다. 다만 위젯을 (위젯 자체 트레이 종료 등)
;   밖에서 껐을 때는 프로세스가 사라진 걸 감지해 자동으로 꺼짐 처리한다.
;   (멈춘 프로세스가 남아도 체크를 강제로 켜지 않음 → 토글이 '끄기'로만 갇히는 문제 방지)
RefreshWidgetCheck() {
    global gWidgetOn, wvc
    running := ProcessExist("위젯.exe")
    if (gWidgetOn && !running) {
        gWidgetOn := false
        A_TrayMenu.Uncheck("바탕화면 위젯")
    }
    ; 알림 담당자 선출: 위젯 실행 중이면 위젯이 토스트로 띄우므로, 앱은 OS 알림을 양보한다.
    ;   웹앱(showAppNotify)이 읽는 플래그를 주기적으로 주입한다.
    try wvc.CoreWebView2.ExecuteScriptAsync("window.__ynhsWidgetRunning=" (running ? "true" : "false"))
}

; 바탕화면에 '영남고' 바로가기 생성(로고 아이콘). 이미 있으면 건너뜀.
EnsureDesktopShortcut() {
    lnk := A_Desktop "\영남고.lnk"
    if FileExist(lnk)
        return
    exe := A_ScriptDir "\영남고.exe"
    if !FileExist(exe)          ; 개발 중(다른 이름) 등엔 만들지 않음
        return
    try FileCreateShortcut(exe, lnk, A_ScriptDir, "", "영남고 포털", A_ScriptDir "\icon.ico")
}

SetWindowIcon() {
    global main
    ico := A_ScriptDir "\icon.ico"
    if !FileExist(ico)
        return
    ; IMAGE_ICON=1, LR_LOADFROMFILE=0x10
    hs := DllCall("LoadImage", "ptr", 0, "str", ico, "uint", 1, "int", 16, "int", 16, "uint", 0x10, "ptr")
    hl := DllCall("LoadImage", "ptr", 0, "str", ico, "uint", 1, "int", 32, "int", 32, "uint", 0x10, "ptr")
    if hs
        SendMessage(0x0080, 0, hs, , "ahk_id " main.Hwnd)   ; WM_SETICON small
    if hl
        SendMessage(0x0080, 1, hl, , "ahk_id " main.Hwnd)   ; WM_SETICON big
}
