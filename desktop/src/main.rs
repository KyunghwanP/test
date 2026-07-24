// 영남고 데스크톱 앱 (wry = Tauri의 웹뷰 코어)
//  · github.io 라이브 포털을 그대로 로드 → 내용 자동 반영
//  · target=_blank / window.open(새 창 요청)은 네이티브에서 가로채 기본 브라우저로 연다
//    → 원격 페이지라도 JS 브릿지 없이 동작
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

const URL: &str = "https://kyunghwanp.github.io/test/";

fn main() -> wry::Result<()> {
    let event_loop = EventLoopBuilder::new().build();
    let window = WindowBuilder::new()
        .with_title("영남고등학교")
        .with_inner_size(LogicalSize::new(1040.0, 1010.0))
        .with_min_inner_size(LogicalSize::new(640.0, 670.0))
        .build(&event_loop)
        .expect("창 생성 실패");

    let _webview = WebViewBuilder::new(&window)
        .with_url(URL)?
        .with_new_window_req_handler(|url| {
            // 새 창 요청 → 기본 브라우저로 열고, 앱 안 새 창은 막음
            let _ = webbrowser::open(&url);
            false
        })
        .build()?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}
