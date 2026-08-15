// 영남고 데스크톱 앱 (wry = Tauri의 웹뷰 코어)
//  · github.io 라이브 포털을 그대로 로드 → 내용 자동 반영
//  · target=_blank / window.open(새 창 요청)은 네이티브에서 가로채 기본 브라우저로 연다
//  · 트레이 상주: X(닫기)는 종료 대신 트레이로 숨김, 트레이 아이콘/메뉴로 다시 열기·종료
//  · 중복 실행 방지: 이미 떠 있으면 두 번째 실행은 경고 없이 기존 창만 띄우고 즉시 종료
//    (레지스트리 쓰기·WinRT 알림 같은 오탐 유발 API는 쓰지 않음 — 뮤텍스/트레이만)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem},
    MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent,
};
use wry::WebViewBuilder;

const URL: &str = "https://kyunghwanp.github.io/test/";

// 이벤트 루프로 보내는 내부 신호
#[derive(Debug, Clone, Copy)]
enum UserEvent {
    Show, // 창 다시 띄우기 (트레이 클릭·메뉴·두 번째 실행)
    Quit, // 완전 종료
}

// 실행 중 창/작업표시줄 아이콘
fn load_icon() -> Option<tao::window::Icon> {
    let img = image::load_from_memory(include_bytes!("../icon.png"))
        .ok()?
        .into_rgba8();
    let (w, h) = img.dimensions();
    tao::window::Icon::from_rgba(img.into_raw(), w, h).ok()
}

// 트레이 아이콘 이미지
fn load_tray_icon() -> Option<tray_icon::Icon> {
    let img = image::load_from_memory(include_bytes!("../icon.png"))
        .ok()?
        .into_rgba8();
    let (w, h) = img.dimensions();
    tray_icon::Icon::from_rgba(img.into_raw(), w, h).ok()
}

// ── 중복 실행 방지(이름 있는 뮤텍스) + '기존 창 띄우기' 신호(이름 있는 이벤트) ──
//    흔한 CreateMutex/CreateEvent만 사용 — 백신 오탐 위험이 낮은 표준 API.
#[cfg(windows)]
mod single {
    use std::os::raw::c_void;
    type Handle = *mut c_void;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    const EVENT_MODIFY_STATE: u32 = 0x0002;
    const INFINITE: u32 = 0xFFFF_FFFF;
    const MUTEX_NAME: &str = "Local\\YnhsDesktopSingleton_v1";
    const EVENT_NAME: &str = "Local\\YnhsDesktopShow_v1";

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(a: *const c_void, owner: i32, name: *const u16) -> Handle;
        fn CreateEventW(a: *const c_void, manual: i32, initial: i32, name: *const u16) -> Handle;
        fn OpenEventW(access: u32, inherit: i32, name: *const u16) -> Handle;
        fn SetEvent(h: Handle) -> i32;
        fn WaitForSingleObject(h: Handle, ms: u32) -> u32;
        fn CloseHandle(h: Handle) -> i32;
        fn GetLastError() -> u32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub struct Guard {
        _mutex: Handle,
        event: Handle,
    }

    pub enum Instance {
        First(Guard),
        Already,
    }

    pub fn acquire() -> Instance {
        unsafe {
            let _mutex = CreateMutexW(std::ptr::null(), 0, wide(MUTEX_NAME).as_ptr());
            if GetLastError() == ERROR_ALREADY_EXISTS {
                return Instance::Already; // 이미 실행 중
            }
            let event = CreateEventW(std::ptr::null(), 0, 0, wide(EVENT_NAME).as_ptr());
            Instance::First(Guard { _mutex, event })
        }
    }

    // 두 번째 인스턴스 → 기존 인스턴스에 '창 띄워라' 신호만 보내고 끝
    pub fn signal_show() {
        unsafe {
            let ev = OpenEventW(EVENT_MODIFY_STATE, 0, wide(EVENT_NAME).as_ptr());
            if !ev.is_null() {
                SetEvent(ev);
                CloseHandle(ev);
            }
        }
    }

    // 기존 인스턴스: 신호가 오면 콜백 실행(창 띄우기)
    pub fn spawn_watcher<F: Fn() + Send + 'static>(guard: &Guard, on_show: F) {
        let addr = guard.event as usize;
        std::thread::spawn(move || {
            let h = addr as Handle;
            if h.is_null() {
                return;
            }
            loop {
                let r = unsafe { WaitForSingleObject(h, INFINITE) };
                if r == 0 {
                    on_show();
                } else {
                    break;
                }
            }
        });
    }
}

fn main() -> wry::Result<()> {
    // UDP(HTTP/3=QUIC)를 막는 망에서 접속이 간헐적으로 타임아웃되는 문제 → QUIC 끄고 TCP만.
    //   브라우저는 사이트의 HTTP/3 지원 여부를 프로필에 기억해 뒀다가 UDP 443 으로 접속을
    //   시도하는데, 그 포트가 막힌 망에서는 ERR_TIMED_OUT 이 난다(시크릿 창은 그 기억이
    //   없어 멀쩡한 것이 단서였다). 사용자가 브라우저 설정을 바꾸지 않아도 되도록 앱에서
    //   꺼 준다. WebView2 가 브라우저 프로세스를 띄울 때 읽으므로 가장 먼저 설정한다.
    // 네트워크 진단 로그(선택) — %AppData%\YnhsWidget\netlog.on 파일이 있으면 켜진다.
    //   앱은 브라우저와 별개의 WebView2 프로필을 쓰므로, 브라우저는 되는데 앱만 먹통일 때
    //   원인을 볼 방법이 없었다. DNS·TCP·TLS 어느 단계에서 끊겼는지가 로그에 남는다.
    let mut args = String::from("--disable-quic");
    if let Some(dir) = std::env::var_os("APPDATA") {
        let dir = std::path::Path::new(&dir).join("YnhsWidget");
        if dir.join("netlog.on").exists() {
            args.push_str(&format!(
                " --log-net-log={} --net-log-capture-mode=Default",
                dir.join("netlog-app.json").display()
            ));
        }
    }
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", &args);

    // 이미 실행 중이면 기존 창만 띄우고 조용히 종료
    #[cfg(windows)]
    let _singleton = match single::acquire() {
        single::Instance::First(g) => g,
        single::Instance::Already => {
            single::signal_show();
            return Ok(());
        }
    };

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    // 두 번째 실행이 보낸 신호 감시 → 창 띄우기
    #[cfg(windows)]
    {
        let p = proxy.clone();
        single::spawn_watcher(&_singleton, move || {
            let _ = p.send_event(UserEvent::Show);
        });
    }

    let window = WindowBuilder::new()
        .with_title("영남고등학교")
        .with_inner_size(LogicalSize::new(1040.0, 1010.0))
        .with_min_inner_size(LogicalSize::new(640.0, 670.0))
        .with_window_icon(load_icon())
        .build(&event_loop)
        .expect("창 생성 실패");

    let _webview = WebViewBuilder::new(&window)
        .with_url(URL)?
        .with_new_window_req_handler(|url| {
            let _ = webbrowser::open(&url);
            false
        })
        .build()?;

    // ── 트레이 아이콘 + 메뉴(열기 / 종료) ──
    let tray_menu = Menu::new();
    let open_item = MenuItem::new("열기", true, None);
    let quit_item = MenuItem::new("종료", true, None);
    let _ = tray_menu.append(&open_item);
    let _ = tray_menu.append(&quit_item);
    let open_id = open_item.id().clone();
    let quit_id = quit_item.id().clone();

    let mut builder = TrayIconBuilder::new()
        .with_tooltip("영남고등학교")
        .with_menu(Box::new(tray_menu));
    if let Some(ic) = load_tray_icon() {
        builder = builder.with_icon(ic);
    }
    let _tray = builder.build().ok();
    let has_tray = _tray.is_some();

    // 트레이 좌클릭 → 열기
    let p_tray = proxy.clone();
    TrayIconEvent::set_event_handler(Some(move |e: TrayIconEvent| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = e
        {
            let _ = p_tray.send_event(UserEvent::Show);
        }
    }));

    // 메뉴(열기/종료)
    let p_menu = proxy.clone();
    MenuEvent::set_event_handler(Some(move |e: MenuEvent| {
        if e.id == open_id {
            let _ = p_menu.send_event(UserEvent::Show);
        } else if e.id == quit_id {
            let _ = p_menu.send_event(UserEvent::Quit);
        }
    }));

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Show) => {
                window.set_visible(true);
                window.set_minimized(false);
                window.set_focus();
            }
            Event::UserEvent(UserEvent::Quit) => {
                *control_flow = ControlFlow::Exit;
            }
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                if has_tray {
                    // 종료 대신 트레이로 숨김
                    window.set_visible(false);
                } else {
                    *control_flow = ControlFlow::Exit;
                }
            }
            _ => {}
        }
    });
}
