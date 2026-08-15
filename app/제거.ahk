#Requires AutoHotkey v2.0
#SingleInstance Off
; ============================================================
;  영남고 통합앱 — 제거기 (서명된 AutoHotkey로 구동)
;  · 실행 중인 앱 종료 → 바탕화면/시작프로그램 바로가기 삭제
;    → 로그인·설정 데이터 삭제 → 이 폴더 자체 삭제
; ============================================================

res := MsgBox("영남고 앱을 제거할까요?`n`n"
    . "· 실행 중인 앱 종료`n"
    . "· 바탕화면 바로가기 삭제`n"
    . "· 로그인/설정 데이터 삭제`n"
    . "· 이 폴더 삭제", "영남고 제거", "YesNo Icon!")
if (res != "Yes")
    ExitApp

; 실행 중인 앱·위젯 종료
try ProcessClose("영남고.exe")
try ProcessClose("위젯.exe")
Sleep 700

; 바로가기 삭제 (바탕화면·시작메뉴·시작프로그램)
try FileDelete(A_Desktop "\영남고.lnk")
try FileDelete(A_Programs "\영남고.lnk")
try FileDelete(A_Programs "\영남고 제거.lnk")
try FileDelete(A_Startup "\영남고.lnk")

; 로그인/설정 데이터 삭제 (앱 + 위젯)
try DirDelete(A_AppData "\YnhsApp", true)
try DirDelete(A_AppData "\YnhsWidget", true)

; 이 폴더 자체는 제거기 종료 후 삭제 (실행 중엔 자기 폴더를 못 지움)
folder := A_ScriptDir
MsgBox("제거되었습니다.`n이 폴더는 잠시 후 자동으로 삭제됩니다.", "영남고 제거", "Iconi")
Run(A_ComSpec ' /c ping -n 3 127.0.0.1 >nul & rmdir /s /q "' folder '"', , "Hide")
ExitApp
