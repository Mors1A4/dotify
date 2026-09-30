use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub mod mp3_sync;

static AUTH_HTML: &str = include_str!("auth.html");

fn read_full_request(stream: &mut TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(6))).ok();
    let mut data = Vec::with_capacity(32768);
    let mut buf = [0u8; 32768];
    let mut content_length = None;
    let mut header_end = None;

    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                data.extend_from_slice(&buf[..n]);

                if header_end.is_none() {
                    let probe_len = data.len().min(16384);
                    let s = String::from_utf8_lossy(&data[..probe_len]);
                    if let Some(pos) = s.find("\r\n\r\n") {
                        header_end = Some(pos + 4);
                        for line in s[..pos].lines() {
                            let lower = line.to_ascii_lowercase();
                            if lower.starts_with("content-length:") {
                                if let Some(val) = line.split(':').nth(1) {
                                    content_length = val.trim().parse::<usize>().ok();
                                }
                            }
                        }
                        if let Some(cl) = content_length {
                            if cl > 65536 {
                                stream.set_read_timeout(Some(Duration::from_secs(25))).ok();
                                data.reserve(cl);
                            }
                        }
                    }
                }

                if let Some(h_end) = header_end {
                    let cl = content_length.unwrap_or(0);
                    if data.len() >= h_end + cl {
                        break;
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                if let Some(h_end) = header_end {
                    let cl = content_length.unwrap_or(0);
                    if data.len() >= h_end + cl {
                        break;
                    }
                }
                thread::sleep(Duration::from_millis(5));
            }
            Err(_) => break,
        }
    }

    if data.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&data).to_string())
    }
}

fn handle_client(stream: &mut TcpStream, app: &AppHandle, is_done: &Arc<AtomicBool>) {
    let request_str = match read_full_request(stream) {
        Some(s) => s,
        None => return,
    };

    if request_str.starts_with("OPTIONS") {
        let response = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nConnection: close\r\n\r\n";
        stream.write_all(response.as_bytes()).ok();
        return;
    }

    if request_str.starts_with("POST /callback") || request_str.starts_with("GET /callback") {
        let mut json_data = None;

        if request_str.starts_with("POST") {
            if let Some(pos) = request_str.find("\r\n\r\n") {
                let body = request_str[pos + 4..].trim();
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body) {
                    json_data = Some(parsed);
                }
            }
        } else if let Some(query_start) = request_str.find("/callback?") {
            let line_end = request_str.find("\r\n").unwrap_or(request_str.len());
            let query = &request_str[query_start + 10..line_end];
            let space_pos = query.find(' ').unwrap_or(query.len());
            let query_clean = &query[..space_pos];

            let mut map = serde_json::Map::new();
            for pair in query_clean.split('&') {
                let mut parts = pair.split('=');
                if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                    let decoded_val = percent_encoding::percent_decode_str(v).decode_utf8_lossy();
                    map.insert(k.to_string(), serde_json::Value::String(decoded_val.to_string()));
                }
            }
            json_data = Some(serde_json::Value::Object(map));
        }

        if let Some(payload) = json_data {
            app.emit("google-auth-success", payload).ok();
            
            // Allow 5-second grace window for browser to complete closing
            let is_done_inner = Arc::clone(is_done);
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(5));
                is_done_inner.store(true, Ordering::SeqCst);
            });

            let json_ok = "{\"ok\":true}";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
                json_ok.len(),
                json_ok
            );
            stream.write_all(response.as_bytes()).ok();
            return;
        }
    }

    if request_str.starts_with("GET") {
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{}",
            AUTH_HTML.len(),
            AUTH_HTML
        );
        stream.write_all(response.as_bytes()).ok();
        return;
    }

    let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    stream.write_all(not_found.as_bytes()).ok();
}

#[tauri::command]
fn start_google_auth_server(app: AppHandle) -> Result<u16, String> {
    let listener = TcpListener::bind("0.0.0.0:18234")
        .or_else(|_| TcpListener::bind("127.0.0.1:18234"))
        .or_else(|_| TcpListener::bind("127.0.0.1:0"))
        .map_err(|e| format!("Failed to bind local auth server: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local address: {}", e))?
        .port();

    listener
        .set_nonblocking(true)
        .map_err(|e| format!("Failed to set nonblocking: {}", e))?;

    let app_clone = app.clone();
    let is_done = Arc::new(AtomicBool::new(false));
    let is_done_clone = Arc::clone(&is_done);

    thread::spawn(move || {
        let start_time = Instant::now();
        let max_duration = Duration::from_secs(120);

        while !is_done_clone.load(Ordering::SeqCst) && start_time.elapsed() < max_duration {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    handle_client(&mut stream, &app_clone, &is_done_clone);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    break;
                }
            }
        }
    });

    Ok(port)
}

#[tauri::command]
fn open_external_browser(app: AppHandle, url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|e| format!("Failed to launch default browser: {}", e))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(&url, None::<&str>)
            .map_err(|e| format!("Failed to open URL via opener: {}", e))?;
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn get_dotify_local_dir() -> std::path::PathBuf {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let p = std::path::PathBuf::from(local_app_data).join("dotify");
        let _ = std::fs::create_dir_all(&p);
        return p;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.to_path_buf();
        }
    }
    std::path::PathBuf::from(".")
}

#[tauri::command]
fn search_youtube_candidates(query: String) -> Result<String, String> {
    let clean = query.trim();
    if clean.is_empty() {
        return Ok("[]".to_string());
    }

    let encoded: String = percent_encoding::utf8_percent_encode(
        clean,
        percent_encoding::NON_ALPHANUMERIC,
    )
    .to_string();
    let target_url = format!("https://www.youtube.com/results?search_query={}&hl=en", encoded);

    let mut cmd = std::process::Command::new("curl.exe");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.args([
        "-s",
        "-L",
        "-m",
        "5",
        "-A",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        &target_url,
    ]);

    let output = cmd.output().map_err(|e| format!("Failed to run curl: {}", e))?;
    if output.status.success() {
        let html = String::from_utf8_lossy(&output.stdout).to_string();
        if html.contains("ytInitialData") {
            Ok(html)
        } else {
            Err("No ytInitialData found in response".to_string())
        }
    } else {
        Err(format!("curl error status: {:?}", output.status.code()))
    }
}


fn handle_embedded_backend_client(mut stream: TcpStream) {
    let Some(req_str) = read_full_request(&mut stream) else {
        return;
    };

    if req_str.starts_with("OPTIONS") {
        let res = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type, Authorization\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, X-Dotify-Preview-Fallback\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(res.as_bytes());
        return;
    }

    let first_line = req_str.lines().next().unwrap_or("");
    let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("/");

    let mut range_header: Option<String> = None;
    for line in req_str.lines().skip(1) {
        let trim = line.trim();
        if trim.is_empty() {
            break;
        }
        if trim.to_ascii_lowercase().starts_with("range:") {
            if let Some(v) = trim.splitn(2, ':').nth(1) {
                range_header = Some(v.trim().to_string());
            }
        }
    }

    if path_and_query.starts_with("/api/health") {
        let body = "{\"status\":\"ok\",\"name\":\"dotify-embedded-rust\"}";
        let res = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(res.as_bytes());
        return;
    }

    if path_and_query.starts_with("/api/cast/devices") {
        let devices = mp3_sync::get_discovered_cast_devices();
        let body = serde_json::json!({ "devices": devices }).to_string();
        let res = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(res.as_bytes());
        return;
    }

    if path_and_query.starts_with("/api/cast/scan") {
        let devices = mp3_sync::scan_for_cast_devices();
        let body = serde_json::json!({ "ok": true, "devices": devices }).to_string();
        let res = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(res.as_bytes());
        return;
    }

    if mp3_sync::try_handle_mp3_route(
        &mut stream,
        &req_str,
        path_and_query,
        range_header.as_deref(),
    ) {
        return;
    }

    if path_and_query.starts_with("/api/search/youtube") {
        let mut query = String::new();
        if let Some(q_idx) = path_and_query.find('?') {
            for pair in path_and_query[q_idx + 1..].split('&') {
                let mut parts = pair.splitn(2, '=');
                if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                    if k == "q" || k == "query" {
                        query = percent_encoding::percent_decode_str(&v.replace('+', " "))
                            .decode_utf8_lossy()
                            .to_string();
                        break;
                    }
                }
            }
        }
        if !query.trim().is_empty() {
            if let Ok(html) = search_youtube_candidates(query) {
                let res = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = stream.write_all(res.as_bytes());
                return;
            }
        }
        let empty = "[]";
        let res = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            empty.len(),
            empty
        );
        let _ = stream.write_all(res.as_bytes());
        return;
    }

    let not_found = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 18\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":\"NotFound\"}";
    let _ = stream.write_all(not_found.as_bytes());
}

fn spawn_backend_server() {
    thread::spawn(|| {
        loop {
            if TcpStream::connect("127.0.0.1:3001").is_err() {
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;

                    let mut candidates = vec![
                        std::path::PathBuf::from("server/server.bundle.mjs"),
                        std::path::PathBuf::from("server/index.js"),
                    ];
                    if let Ok(exe) = std::env::current_exe() {
                        if let Some(parent) = exe.parent() {
                            candidates.push(parent.join("server/server.bundle.mjs"));
                            candidates.push(parent.join("server/index.js"));
                        }
                    }
                    candidates.push(get_dotify_local_dir().join("server/server.bundle.mjs"));
                    candidates.push(get_dotify_local_dir().join("server/index.js"));
                    candidates.push(std::path::PathBuf::from("C:\\Users\\monty\\Documents\\AB\\notify\\server\\server.bundle.mjs"));
                    candidates.push(std::path::PathBuf::from("C:\\Users\\monty\\Documents\\AB\\notify\\server\\index.js"));

                    for path in &candidates {
                        if path.exists() {
                            let is_bundle = path.to_string_lossy().contains("bundle");
                            if !is_bundle {
                                let root_opt = path.parent().and_then(|p| p.parent());
                                let has_node_modules = root_opt
                                    .map(|r| r.join("node_modules").exists())
                                    .unwrap_or_else(|| std::path::Path::new("node_modules").exists());
                                if !has_node_modules {
                                    continue;
                                }
                            }
                            let mut cmd = std::process::Command::new("node");
                            cmd.arg(path);
                            if let Some(parent) = path.parent() {
                                if !parent.as_os_str().is_empty() {
                                    cmd.current_dir(parent);
                                }
                            }
                            cmd.creation_flags(CREATE_NO_WINDOW);
                            if cmd.spawn().is_ok() {
                                thread::sleep(Duration::from_millis(1000));
                                break;
                            }
                        }
                    }
                }

                // If Node backend isn't running (e.g. standalone exe or Android APK),
                // bind 0.0.0.0:3001 natively inside Rust so LAN WiFi peers can also connect!
                if TcpStream::connect("127.0.0.1:3001").is_err() {
                    mp3_sync::start_udp_discovery_service();
                    thread::spawn(|| {
                        thread::sleep(Duration::from_secs(2));
                        let _ = mp3_sync::scan_lan_subnet();
                    });
                    if let Ok(listener) = TcpListener::bind("0.0.0.0:3001")
                        .or_else(|_| TcpListener::bind("127.0.0.1:3001"))
                    {
                        for stream in listener.incoming().flatten() {
                            thread::spawn(move || {
                                handle_embedded_backend_client(stream);
                            });
                        }
                    }
                }
            }
            thread::sleep(Duration::from_secs(10));
        }
    });
}

#[cfg(target_os = "windows")]
static ICON_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[cfg(target_os = "windows")]
static ICON_SYNC_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(target_os = "windows")]
fn downsample_rgba(src: &[u8], src_w: u32, src_h: u32, dst_size: u32) -> Vec<u8> {
    if src_w == dst_size && src_h == dst_size {
        return src.to_vec();
    }
    let mut out = vec![0u8; (dst_size * dst_size * 4) as usize];
    for y in 0..dst_size {
        for x in 0..dst_size {
            let mut r_acc = 0u32;
            let mut g_acc = 0u32;
            let mut b_acc = 0u32;
            let mut a_acc = 0u32;
            for sy in 0..4u32 {
                let py = (((y * 4 + sy) * src_h) / (dst_size * 4)).min(src_h - 1);
                for sx in 0..4u32 {
                    let px = (((x * 4 + sx) * src_w) / (dst_size * 4)).min(src_w - 1);
                    let idx = ((py * src_w + px) * 4) as usize;
                    r_acc += src[idx] as u32;
                    g_acc += src[idx + 1] as u32;
                    b_acc += src[idx + 2] as u32;
                    a_acc += src[idx + 3] as u32;
                }
            }
            let d_idx = ((y * dst_size + x) * 4) as usize;
            out[d_idx] = (r_acc / 16) as u8;
            out[d_idx + 1] = (g_acc / 16) as u8;
            out[d_idx + 2] = (b_acc / 16) as u8;
            out[d_idx + 3] = (a_acc / 16) as u8;
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn rgba_to_ico_dib(rgba: &[u8], size: u32) -> Vec<u8> {
    let xor_len = (size * size * 4) as usize;
    let and_row_stride = (((size + 31) / 32) * 4) as usize;
    let and_len = and_row_stride * (size as usize);
    let mut dib = Vec::with_capacity(40 + xor_len + and_len);

    // BITMAPINFOHEADER (40 bytes)
    dib.extend_from_slice(&40u32.to_le_bytes()); // biSize
    dib.extend_from_slice(&(size as i32).to_le_bytes()); // biWidth
    dib.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // biHeight (XOR + AND)
    dib.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    dib.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    dib.extend_from_slice(&0u32.to_le_bytes()); // biCompression = BI_RGB
    dib.extend_from_slice(&(xor_len as u32).to_le_bytes()); // biSizeImage
    dib.extend_from_slice(&[0u8; 16]); // meters & colors

    // Bottom-up BGRA XOR mask
    for y in (0..size).rev() {
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            dib.push(rgba[idx + 2]); // B
            dib.push(rgba[idx + 1]); // G
            dib.push(rgba[idx]);     // R
            dib.push(rgba[idx + 3]); // A
        }
    }

    // Bottom-up 1-bit AND mask
    for y in (0..size).rev() {
        let mut row = vec![0u8; and_row_stride];
        for x in 0..size {
            let a = rgba[((y * size + x) * 4 + 3) as usize];
            if a < 16 {
                row[(x / 8) as usize] |= 1 << (7 - (x % 8));
            }
        }
        dib.extend_from_slice(&row);
    }

    dib
}

#[cfg(target_os = "windows")]
fn build_ico_and_grp(rgba: &[u8], width: u32, height: u32) -> (Vec<u8>, Vec<u8>, Vec<Vec<u8>>) {
    const SIZES: [u32; 6] = [128, 64, 48, 32, 24, 16];
    let mut dibs = Vec::with_capacity(SIZES.len());
    for &s in &SIZES {
        let scaled = downsample_rgba(rgba, width, height, s);
        dibs.push(rgba_to_ico_dib(&scaled, s));
    }

    let count = SIZES.len() as u16;
    let mut ico = Vec::new();
    ico.extend_from_slice(&0u16.to_le_bytes()); // idReserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // idType = ICO
    ico.extend_from_slice(&count.to_le_bytes()); // idCount

    let mut grp = Vec::new();
    grp.extend_from_slice(&0u16.to_le_bytes());
    grp.extend_from_slice(&1u16.to_le_bytes());
    grp.extend_from_slice(&count.to_le_bytes());

    let mut offset = 6u32 + (SIZES.len() as u32) * 16;
    for (i, (&s, dib)) in SIZES.iter().zip(dibs.iter()).enumerate() {
        let w_byte = if s >= 256 { 0u8 } else { s as u8 };
        let bytes_in_res = dib.len() as u32;

        // 16-byte ICONDIRENTRY
        ico.push(w_byte);
        ico.push(w_byte);
        ico.push(0);
        ico.push(0);
        ico.extend_from_slice(&1u16.to_le_bytes());
        ico.extend_from_slice(&32u16.to_le_bytes());
        ico.extend_from_slice(&bytes_in_res.to_le_bytes());
        ico.extend_from_slice(&offset.to_le_bytes());
        offset += bytes_in_res;

        // 14-byte GRPICONDIRENTRY
        grp.push(w_byte);
        grp.push(w_byte);
        grp.push(0);
        grp.push(0);
        grp.extend_from_slice(&1u16.to_le_bytes());
        grp.extend_from_slice(&32u16.to_le_bytes());
        grp.extend_from_slice(&bytes_in_res.to_le_bytes());
        grp.extend_from_slice(&((i as u16) + 1).to_le_bytes());
    }

    for dib in &dibs {
        ico.extend_from_slice(dib);
    }

    (ico, grp, dibs)
}

#[cfg(target_os = "windows")]
fn patch_exe_icon_resources(exe_path: &std::path::Path, grp: &[u8], dibs: &[Vec<u8>]) -> bool {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn BeginUpdateResourceW(pFileName: *const u16, bDeleteExistingResources: i32) -> *mut c_void;
        fn UpdateResourceW(
            hUpdate: *mut c_void,
            lpType: *const u16,
            lpName: *const u16,
            wLanguage: u16,
            lpData: *const c_void,
            cb: u32,
        ) -> i32;
        fn EndUpdateResourceW(hUpdate: *mut c_void, fDiscard: i32) -> i32;
    }

    let wide_path: Vec<u16> = exe_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let h_update = BeginUpdateResourceW(wide_path.as_ptr(), 0);
        if h_update.is_null() {
            return false;
        }

        const RT_ICON: usize = 3;
        const RT_GROUP_ICON: usize = 14;
        const IDI_APP: usize = 32512;
        const LANG_EN_US: u16 = 1033;

        for (i, dib) in dibs.iter().enumerate() {
            let res_id = i + 1;
            let ok = UpdateResourceW(
                h_update,
                RT_ICON as *const u16,
                res_id as *const u16,
                LANG_EN_US,
                dib.as_ptr() as *const c_void,
                dib.len() as u32,
            );
            if ok == 0 {
                let _ = EndUpdateResourceW(h_update, 1);
                return false;
            }
        }

        let ok_grp = UpdateResourceW(
            h_update,
            RT_GROUP_ICON as *const u16,
            IDI_APP as *const u16,
            LANG_EN_US,
            grp.as_ptr() as *const c_void,
            grp.len() as u32,
        );
        if ok_grp == 0 {
            let _ = EndUpdateResourceW(h_update, 1);
            return false;
        }

        EndUpdateResourceW(h_update, 0) != 0
    }
}

#[cfg(target_os = "windows")]
fn sync_installed_icons_and_shortcuts(rgba: Vec<u8>, width: u32, height: u32, seq: u64) {
    use std::ffi::c_void;
    use std::os::windows::process::CommandExt;

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(wEventId: i32, uFlags: u32, dwItem1: *const c_void, dwItem2: *const c_void);
    }

    let Ok(_guard) = ICON_SYNC_LOCK.lock() else {
        return;
    };

    // Only proceed if this is still the latest requested icon sequence
    if ICON_SEQ.load(std::sync::atomic::Ordering::Relaxed) != seq {
        return;
    }

    let dotify_dir = get_dotify_local_dir();
    if !dotify_dir.exists() {
        return;
    }

    let (ico_bytes, grp_bytes, dibs) = build_ico_and_grp(&rgba, width, height);

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(seq as u128);
    let new_ico_name = format!("theme-icon-{}.ico", ts);
    let new_ico_path = dotify_dir.join(&new_ico_name);

    let _ = std::fs::write(dotify_dir.join("icon.ico"), &ico_bytes);
    let _ = std::fs::write(&new_ico_path, &ico_bytes);

    // Clean up older theme-icon-*.ico files
    if let Ok(entries) = std::fs::read_dir(&dotify_dir) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with("theme-icon-") && fname.ends_with(".ico") && fname != new_ico_name {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    // Live-patch installed or current .exe embedded PE icon
    let exe_path = std::env::current_exe().unwrap_or_else(|_| dotify_dir.join("app.exe"));
    let tmp_exe_path = exe_path.with_extension("exe.tmp");
    let old_exe_path = exe_path.with_extension("exe.old");

    if exe_path.exists() {
        let _ = std::fs::remove_file(&tmp_exe_path);
        if std::fs::copy(&exe_path, &tmp_exe_path).is_ok() {
            if patch_exe_icon_resources(&tmp_exe_path, &grp_bytes, &dibs) {
                if std::fs::remove_file(&exe_path).is_ok() {
                    let _ = std::fs::rename(&tmp_exe_path, &exe_path);
                } else {
                    let _ = std::fs::remove_file(&old_exe_path);
                    if std::fs::rename(&exe_path, &old_exe_path).is_ok() {
                        if std::fs::rename(&tmp_exe_path, &exe_path).is_err() {
                            let _ = std::fs::rename(&old_exe_path, &exe_path);
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(&tmp_exe_path);
        }
    }

    // Update Desktop, Start Menu, Startup, and Taskbar pinned .lnk shortcuts
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let ico_str = new_ico_path.to_string_lossy().to_string();
    let ps_script = format!(
        "$ws = New-Object -ComObject WScript.Shell; \
         $paths = @(\"$env:USERPROFILE\\Desktop\\dotify.lnk\", \"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\dotify.lnk\", \"$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\dotify.lnk\"); \
         $pin = \"$env:APPDATA\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\"; \
         if (Test-Path $pin) {{ Get-ChildItem $pin -Filter '*.lnk' -Force | Where-Object {{ $_.Name -match 'dotify|notify|app' }} | ForEach-Object {{ $paths += $_.FullName }} }}; \
         foreach ($p in $paths) {{ if (Test-Path $p) {{ $s = $ws.CreateShortcut($p); $s.IconLocation = '{},0'; $s.Save(); (Get-Item $p).LastWriteTime = Get-Date }} }}",
        ico_str
    );

    let _ = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    unsafe {
        // SHCNE_ASSOCCHANGED (0x08000000) forces Explorer to refresh Desktop, Start Menu, and Taskbar icons
        SHChangeNotify(0x08000000, 0x0000, std::ptr::null(), std::ptr::null());
        SHChangeNotify(0x08000000, 0x1000, std::ptr::null(), std::ptr::null());
    }
}

#[cfg(target_os = "windows")]
fn refresh_windows_taskbar_icon(hwnd: *mut std::ffi::c_void, seq: u64) {
    use std::ffi::c_void;

    #[repr(C)]
    struct GUID {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    #[repr(C)]
    struct PROPERTYKEY {
        fmtid: GUID,
        pid: u32,
    }

    #[repr(C)]
    struct PROPVARIANT {
        vt: u16,
        w_reserved1: u16,
        w_reserved2: u16,
        w_reserved3: u16,
        pwsz_val: *const u16,
        _pad: u64,
    }

    #[repr(C)]
    struct IPropertyStoreVtbl {
        query_interface: usize,
        add_ref: usize,
        release: unsafe extern "system" fn(*mut c_void) -> u32,
        get_count: usize,
        get_at: usize,
        get_value: usize,
        set_value:
            unsafe extern "system" fn(*mut c_void, *const PROPERTYKEY, *const PROPVARIANT) -> i32,
        commit: unsafe extern "system" fn(*mut c_void) -> i32,
    }

    #[repr(C)]
    struct IPropertyStore {
        vtbl: *const IPropertyStoreVtbl,
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHGetPropertyStoreForWindow(
            hwnd: *mut c_void,
            riid: *const GUID,
            ppv: *mut *mut IPropertyStore,
        ) -> i32;
    }

    let aumid = format!("com.dotify.music.theme.{}\0", seq);
    let wide: Vec<u16> = aumid.encode_utf16().collect();

    let iid = GUID {
        data1: 0x886D8EEB,
        data2: 0x8CF2,
        data3: 0x4446,
        data4: [0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99],
    };

    let pkey = PROPERTYKEY {
        fmtid: GUID {
            data1: 0x9F4C2855,
            data2: 0x9F79,
            data3: 0x4B39,
            data4: [0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3],
        },
        pid: 5,
    };

    let pv = PROPVARIANT {
        vt: 31, // VT_LPWSTR
        w_reserved1: 0,
        w_reserved2: 0,
        w_reserved3: 0,
        pwsz_val: wide.as_ptr(),
        _pad: 0,
    };

    unsafe {
        let mut store: *mut IPropertyStore = std::ptr::null_mut();
        if SHGetPropertyStoreForWindow(hwnd, &iid, &mut store) == 0 && !store.is_null() {
            let vtbl = &*(*store).vtbl;
            let _ = (vtbl.set_value)(store as *mut c_void, &pkey, &pv);
            let _ = (vtbl.commit)(store as *mut c_void);
            let _ = (vtbl.release)(store as *mut c_void);
        }
    }
}

#[tauri::command]
fn set_app_icon_rgba(_app: AppHandle, _rgba: Vec<u8>, _width: u32, _height: u32) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        let img = tauri::image::Image::new_owned(_rgba.clone(), _width, _height);
        #[cfg(target_os = "windows")]
        let seq = ICON_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;

        for (_, window) in _app.webview_windows() {
            let _ = window.set_icon(img.clone());
            #[cfg(target_os = "windows")]
            if let Ok(hwnd) = window.hwnd() {
                refresh_windows_taskbar_icon(hwnd.0 as *mut std::ffi::c_void, seq);
            }
        }

        #[cfg(target_os = "windows")]
        thread::spawn(move || {
            sync_installed_icons_and_shortcuts(_rgba, _width, _height, seq);
        });
    }

    Ok(())
}

#[tauri::command]
fn set_android_app_icon(_app: AppHandle, _theme: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn open_mp3_folder() -> Result<String, String> {
    let dir = mp3_sync::get_mp3_storage_dir();
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer.exe")
            .arg(&dir)
            .spawn();
    }
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn install_windows_update(
    app: AppHandle,
    exe_url: String,
    setup_url: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let emit_progress = |percent: u32, status: &str, error: Option<&str>| {
            let payload = serde_json::json!({
                "percent": percent,
                "status": status,
                "error": error,
            });
            let _ = app.emit("update-download-progress", payload);
        };

        emit_progress(8, "Downloading latest Dotify update...", None);

        let dotify_dir = get_dotify_local_dir();
        let tmp_path = dotify_dir.join("dotify-update.exe.tmp");
        let _ = std::fs::remove_file(&tmp_path);

        let mut child = std::process::Command::new("curl.exe")
            .args([
                "-L",
                "-s",
                "--fail",
                "-o",
                &tmp_path.to_string_lossy(),
                &exe_url,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to start update download: {}", e))?;

        let expected_bytes: f64 = 10_400_000.0;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if !status.success() {
                        let _ = std::fs::remove_file(&tmp_path);
                        let msg = "Failed to download update binary from release server.";
                        emit_progress(0, msg, Some(msg));
                        return Err(msg.to_string());
                    }
                    break;
                }
                Ok(None) => {
                    if let Ok(meta) = std::fs::metadata(&tmp_path) {
                        let downloaded = meta.len() as f64;
                        let ratio = (downloaded / expected_bytes).min(0.95);
                        let pct = 10 + (ratio * 80.0) as u32;
                        let mb = downloaded / (1024.0 * 1024.0);
                        emit_progress(
                            pct,
                            &format!("Downloading update ({:.1} MB)...", mb),
                            None,
                        );
                    }
                    thread::sleep(Duration::from_millis(150));
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&tmp_path);
                    return Err(format!("Download interrupted: {}", e));
                }
            }
        }

        // Verify valid Windows PE header ("MZ") and reasonable size (> 1 MB)
        let valid_pe = if let Ok(mut f) = std::fs::File::open(&tmp_path) {
            let len = f.metadata().map(|m| m.len()).unwrap_or(0);
            let mut magic = [0u8; 2];
            len > 1_000_000 && f.read_exact(&mut magic).is_ok() && &magic == b"MZ"
        } else {
            false
        };

        if !valid_pe {
            let _ = std::fs::remove_file(&tmp_path);
            let msg = "Downloaded update file was incomplete or invalid.";
            emit_progress(0, msg, Some(msg));
            return Err(msg.to_string());
        }

        emit_progress(94, "Applying update to Dotify...", None);

        let current_exe = std::env::current_exe().unwrap_or_else(|_| dotify_dir.join("app.exe"));
        let old_exe = current_exe.with_extension("exe.old");
        let _ = std::fs::remove_file(&old_exe);

        let mut replaced_in_place = false;
        if std::fs::rename(&current_exe, &old_exe).is_ok() {
            if std::fs::copy(&tmp_path, &current_exe).is_ok() {
                replaced_in_place = true;
            } else {
                // Rollback if copy failed
                let _ = std::fs::rename(&old_exe, &current_exe);
            }
        }

        // Also keep %LOCALAPPDATA%\dotify\app.exe synced if running from another path
        let installed_exe = dotify_dir.join("app.exe");
        if installed_exe.exists() && installed_exe != current_exe {
            let installed_old = installed_exe.with_extension("exe.old");
            let _ = std::fs::remove_file(&installed_old);
            if std::fs::rename(&installed_exe, &installed_old).is_ok() {
                if std::fs::copy(&tmp_path, &installed_exe).is_err() {
                    let _ = std::fs::rename(&installed_old, &installed_exe);
                }
            }
        }

        let _ = std::fs::remove_file(&tmp_path);

        if replaced_in_place {
            emit_progress(100, "Update complete! Restarting Dotify...", None);
            let exe_to_launch = current_exe.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(450));
                let mut cmd = std::process::Command::new(&exe_to_launch);
                if let Some(parent) = exe_to_launch.parent() {
                    cmd.current_dir(parent);
                }
                let _ = cmd.spawn();
                std::process::exit(0);
            });
            return Ok(());
        }

        // Fallback: if in-place replacement wasn't permitted, download and launch NSIS installer
        if let Some(installer_url) = setup_url {
            emit_progress(95, "Downloading Windows setup installer...", None);
            let setup_path = dotify_dir.join("dotify-setup-update.exe");
            let _ = std::fs::remove_file(&setup_path);
            let status = std::process::Command::new("curl.exe")
                .args([
                    "-L",
                    "-s",
                    "--fail",
                    "-o",
                    &setup_path.to_string_lossy(),
                    &installer_url,
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
            if let Ok(s) = status {
                if s.success() && setup_path.exists() {
                    emit_progress(100, "Launching installer...", None);
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(350));
                        let _ = std::process::Command::new(&setup_path).spawn();
                        std::process::exit(0);
                    });
                    return Ok(());
                }
            }
        }

        Err("Could not replace running executable. Please use the Installer button.".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, exe_url, setup_url);
        Err("Windows updater is only supported on Windows desktop.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_local_data_dir() {
                mp3_sync::set_app_data_dir(dir);
            }
            #[cfg(target_os = "windows")]
            {
                let _ = std::fs::remove_file(get_dotify_local_dir().join("app.exe.old"));
                if let Ok(exe) = std::env::current_exe() {
                    let _ = std::fs::remove_file(exe.with_extension("exe.old"));
                }
            }
            spawn_backend_server();
            #[cfg(desktop)]
            if let Some(icon) = app.default_window_icon().cloned() {
                for (_, window) in app.webview_windows() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_google_auth_server,
            open_external_browser,
            set_app_icon_rgba,
            set_android_app_icon,
            open_mp3_folder,
            install_windows_update,
            search_youtube_candidates
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
