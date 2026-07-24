fn main() {
    // Windows: exe에 아이콘 + 버전/제작사 메타데이터 임베드
    //  · 메타데이터가 비어 있으면 백신 휴리스틱이 '정체불명 실행파일'로 오탐하기 쉬움
    //  · 아이콘은 탐색기·작업표시줄 고정 시 표시
    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("icon.ico");

        // 버전 정보 문자열 (파일 속성 > 자세히 탭에 표시)
        res.set("FileDescription", "영남고등학교 포털");
        res.set("ProductName", "영남고등학교 포털");
        res.set("CompanyName", "영남고등학교");
        res.set("LegalCopyright", "\u{00A9} 2026 영남고등학교");
        res.set("OriginalFilename", "ynhs-desktop.exe");
        res.set("InternalName", "ynhs-desktop");
        res.set("FileVersion", "1.0.0.0");
        res.set("ProductVersion", "1.0.0.0");

        // 숫자 버전 (1.0.0.0)
        let version: u64 = 0x0001_0000_0000_0000;
        res.set_version_info(winresource::VersionInfo::FILEVERSION, version);
        res.set_version_info(winresource::VersionInfo::PRODUCTVERSION, version);

        if let Err(e) = res.compile() {
            eprintln!("winresource: {e}");
        }
    }
}
