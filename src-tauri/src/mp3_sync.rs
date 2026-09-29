use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const UDP_DISCOVERY_PORT: u16 = 42889;
const HTTP_PORT: u16 = 3001;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_app_data_dir(dir: PathBuf) {
    let _ = APP_DATA_DIR.set(dir);
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn get_mp3_storage_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let music_dir = PathBuf::from(profile).join("Music").join("Dotify");
            if fs::create_dir_all(&music_dir).is_ok() {
                return music_dir;
            }
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let fallback = PathBuf::from(local_app_data).join("dotify").join("mp3s");
            let _ = fs::create_dir_all(&fallback);
            return fallback;
        }
    }

    if let Some(app_dir) = APP_DATA_DIR.get() {
        let dir = app_dir.join("mp3s");
        if fs::create_dir_all(&dir).is_ok() {
            return dir;
        }
    }

    let tmp = std::env::temp_dir().join("dotify_mp3s");
    let _ = fs::create_dir_all(&tmp);
    tmp
}

pub fn get_local_lan_ip() -> String {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                let ip = addr.ip().to_string();
                if !ip.is_empty() && ip != "0.0.0.0" && ip != "127.0.0.1" {
                    return ip;
                }
            }
        }
    }
    String::from("127.0.0.1")
}

fn short_hash(input: &str) -> String {
    // FNV-1a 32-bit hash formatted as 6 hex chars
    let mut hash: u32 = 0x811c9dc5;
    for b in input.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{:06x}", hash & 0x00ff_ffff)
}

fn sanitize_filename(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(90).collect()
}

fn build_mp3_filename(artist: &str, title: &str, track_id: &str) -> String {
    let clean_artist = {
        let a = sanitize_filename(artist);
        if a.is_empty() {
            String::from("Unknown Artist")
        } else {
            a
        }
    };
    let clean_title = {
        let t = sanitize_filename(title);
        if t.is_empty() {
            String::from("Unknown Track")
        } else {
            t
        }
    };
    let h = short_hash(if track_id.is_empty() {
        &clean_title
    } else {
        track_id
    });
    format!("{} - {} [{}].mp3", clean_artist, clean_title, h)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMp3Entry {
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub album: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub artwork_url: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub stream_url: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub saved_at: u64,
    #[serde(default)]
    pub saved_reason: String,
    #[serde(default)]
    pub origin_device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp3IndexState {
    pub device_id: String,
    pub device_name: String,
    pub device_type: String,
    #[serde(default)]
    pub tracks: Vec<SavedMp3Entry>,
    #[serde(default)]
    pub deleted_ids: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub device_id: String,
    pub device_name: String,
    pub device_type: String,
    pub ip: String,
    pub port: u16,
    pub mp3_count: usize,
    pub total_size_bytes: u64,
    pub last_seen: u64,
}

static INDEX_LOCK: OnceLock<Mutex<Mp3IndexState>> = OnceLock::new();
static PEERS_LOCK: OnceLock<Mutex<HashMap<String, PeerInfo>>> = OnceLock::new();

fn default_device_identity() -> (String, String, String) {
    #[cfg(target_os = "android")]
    {
        let ip = get_local_lan_ip();
        let suffix = ip.split('.').last().unwrap_or("phone");
        let id = format!("dev_android_{}", short_hash(&ip));
        let name = format!("Dotify Mobile (Android .{})", suffix);
        return (id, name, String::from("mobile"));
    }
    #[cfg(not(target_os = "android"))]
    {
        let host = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| String::from("PC"));
        let id = format!(
            "dev_{}_{}",
            host.chars()
                .map(|c| if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                })
                .collect::<String>(),
            short_hash(&host)
        );
        let name = format!("Dotify Desktop ({})", host);
        (id, name, String::from("desktop"))
    }
}

fn get_peers_map() -> &'static Mutex<HashMap<String, PeerInfo>> {
    PEERS_LOCK.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_index_state() -> &'static Mutex<Mp3IndexState> {
    INDEX_LOCK.get_or_init(|| {
        let dir = get_mp3_storage_dir();
        let index_path = dir.join("mp3-index.json");
        let (def_id, def_name, def_type) = default_device_identity();
        let mut state = Mp3IndexState {
            device_id: def_id,
            device_name: def_name,
            device_type: def_type,
            tracks: Vec::new(),
            deleted_ids: HashMap::new(),
        };
        if let Ok(raw) = fs::read_to_string(&index_path) {
            if let Ok(parsed) = serde_json::from_str::<Mp3IndexState>(&raw) {
                state = parsed;
            }
        }
        Mutex::new(state)
    })
}

pub fn reconcile_disk_files() -> Mp3IndexState {
    let dir = get_mp3_storage_dir();
    let _ = fs::create_dir_all(&dir);
    let mut existing_files = HashSet::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            existing_files.insert(entry.file_name().to_string_lossy().to_string());
        }
    }

    let mut guard = get_index_state().lock().unwrap_or_else(|e| e.into_inner());
    let mut valid_tracks = Vec::new();
    let mut indexed_files = HashSet::new();

    for mut t in guard.tracks.drain(..) {
        if existing_files.contains(&t.file_name) {
            if let Ok(meta) = fs::metadata(dir.join(&t.file_name)) {
                if meta.len() > 1024 {
                    t.size_bytes = meta.len();
                    indexed_files.insert(t.file_name.clone());
                    valid_tracks.push(t);
                }
            }
        }
    }

    for fname in &existing_files {
        if !fname.to_ascii_lowercase().ends_with(".mp3") || indexed_files.contains(fname) {
            continue;
        }
        let full_path = dir.join(fname);
        if let Ok(meta) = fs::metadata(&full_path) {
            if !meta.is_file() || meta.len() <= 1024 {
                continue;
            }
            let stem = fname.trim_end_matches(".mp3").trim_end_matches(".MP3");
            let clean_stem = if let Some(bracket_idx) = stem.rfind(" [") {
                &stem[..bracket_idx]
            } else {
                stem
            };
            let (artist, title) = if let Some((a, b)) = clean_stem.split_once(" - ") {
                (a.trim().to_string(), b.trim().to_string())
            } else {
                (String::from("Local MP3"), clean_stem.trim().to_string())
            };
            let syn_id = format!("mp3:{}", short_hash(fname));
            if guard.deleted_ids.contains_key(&syn_id) {
                continue;
            }
            valid_tracks.push(SavedMp3Entry {
                id: syn_id.clone(),
                title,
                artist,
                album: String::from("Saved MP3s"),
                duration: ((meta.len() / 16000) as f64).max(30.0),
                artwork_url: String::new(),
                source: String::from("charts"),
                stream_url: format!("/api/mp3s/file/{}", syn_id),
                file_name: fname.clone(),
                size_bytes: meta.len(),
                saved_at: now_ms(),
                saved_reason: String::from("disk_import"),
                origin_device_name: guard.device_name.clone(),
            });
        }
    }

    valid_tracks.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    guard.tracks = valid_tracks;

    if let Ok(json_str) = serde_json::to_string_pretty(&*guard) {
        let _ = fs::write(dir.join("mp3-index.json"), json_str);
    }

    guard.clone()
}

fn save_index_state(state: &Mp3IndexState) {
    let dir = get_mp3_storage_dir();
    let _ = fs::create_dir_all(&dir);
    if let Ok(json_str) = serde_json::to_string_pretty(state) {
        let _ = fs::write(dir.join("mp3-index.json"), json_str);
    }
}

pub fn build_ping_json() -> serde_json::Value {
    let state = reconcile_disk_files();
    let total_size: u64 = state.tracks.iter().map(|t| t.size_bytes).sum();
    serde_json::json!({
        "ok": true,
        "app": "dotify-lan-sync",
        "deviceId": state.device_id,
        "deviceName": state.device_name,
        "deviceType": state.device_type,
        "ip": get_local_lan_ip(),
        "port": HTTP_PORT,
        "mp3Count": state.tracks.len(),
        "totalSizeBytes": total_size,
        "updatedAt": now_ms(),
    })
}

fn record_peer_value(val: &serde_json::Value, fallback_ip: Option<&str>) {
    if val.get("app").and_then(|v| v.as_str()) != Some("dotify-lan-sync") {
        return;
    }
    let ip = fallback_ip
        .map(|s| s.to_string())
        .or_else(|| val.get("ip").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();
    if ip.is_empty() || ip == "127.0.0.1" || ip == "0.0.0.0" {
        return;
    }
    let my_ip = get_local_lan_ip();
    let my_dev_id = get_index_state()
        .lock()
        .map(|g| g.device_id.clone())
        .unwrap_or_default();
    let peer_dev_id = val
        .get("deviceId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if (!peer_dev_id.is_empty() && peer_dev_id == my_dev_id) || ip == my_ip {
        return;
    }

    let peer = PeerInfo {
        device_id: if peer_dev_id.is_empty() {
            format!("peer_{}", ip)
        } else {
            peer_dev_id
        },
        device_name: val
            .get("deviceName")
            .and_then(|v| v.as_str())
            .unwrap_or(&format!("Dotify ({})", ip))
            .to_string(),
        device_type: val
            .get("deviceType")
            .and_then(|v| v.as_str())
            .unwrap_or("desktop")
            .to_string(),
        ip: ip.clone(),
        port: val.get("port").and_then(|v| v.as_u64()).unwrap_or(3001) as u16,
        mp3_count: val.get("mp3Count").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
        total_size_bytes: val
            .get("totalSizeBytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        last_seen: now_ms(),
    };

    if let Ok(mut map) = get_peers_map().lock() {
        map.insert(ip, peer);
    }
}

pub fn start_udp_discovery_service() {
    static STARTED: OnceLock<bool> = OnceLock::new();
    if STARTED.set(true).is_err() {
        return;
    }

    thread::spawn(|| {
        let Ok(sock) = UdpSocket::bind(("0.0.0.0", UDP_DISCOVERY_PORT)) else {
            return;
        };
        let _ = sock.set_broadcast(true);
        let _ = sock.set_read_timeout(Some(Duration::from_millis(1500)));

        let send_sock = sock.try_clone().ok();
        if let Some(tx) = send_sock {
            thread::spawn(move || loop {
                let payload = build_ping_json().to_string();
                let bytes = payload.as_bytes();
                let _ = tx.send_to(bytes, ("255.255.255.255", UDP_DISCOVERY_PORT));
                let my_ip = get_local_lan_ip();
                let parts: Vec<&str> = my_ip.split('.').collect();
                if parts.len() == 4 && my_ip != "127.0.0.1" {
                    let bcast = format!("{}.{}.{}.255", parts[0], parts[1], parts[2]);
                    let _ = tx.send_to(bytes, (bcast.as_str(), UDP_DISCOVERY_PORT));
                }
                thread::sleep(Duration::from_secs(4));
            });
        }

        let mut buf = [0u8; 4096];
        loop {
            if let Ok((n, src)) = sock.recv_from(&mut buf) {
                if let Ok(txt) = std::str::from_utf8(&buf[..n]) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(txt) {
                        let ip_str = src.ip().to_string();
                        record_peer_value(&val, Some(&ip_str));
                    }
                }
            }
        }
    });
}

fn http_get_raw(ip: &str, port: u16, path: &str, timeout_ms: u64) -> Option<(u16, Vec<u8>)> {
    let ipv4: Ipv4Addr = ip.parse().ok()?;
    let addr = SocketAddr::new(IpAddr::V4(ipv4), port);
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(timeout_ms.max(2500))));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(timeout_ms)));

    let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        path, ip, port
    );
    stream.write_all(req.as_bytes()).ok()?;

    let mut data = Vec::new();
    stream.read_to_end(&mut data).ok()?;

    let header_end = data.windows(4).position(|w| w == b"\r\n\r\n")?;
    let header_str = String::from_utf8_lossy(&data[..header_end]);
    let status_code: u16 = header_str
        .lines()
        .next()?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()?;
    let body = data[header_end + 4..].to_vec();
    Some((status_code, body))
}

fn http_post_json_raw(ip: &str, port: u16, path: &str, json_body: &str, timeout_ms: u64) -> bool {
    let Ok(ipv4) = ip.parse::<Ipv4Addr>() else {
        return false;
    };
    let addr = SocketAddr::new(IpAddr::V4(ipv4), port);
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(timeout_ms)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(timeout_ms)));
    let req = format!(
        "POST {} HTTP/1.1\r\nHost: {}:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        path,
        ip,
        port,
        json_body.len(),
        json_body
    );
    stream.write_all(req.as_bytes()).is_ok()
}

pub fn probe_peer_ip(ip: &str, port: u16, timeout_ms: u64) -> Option<PeerInfo> {
    let my_ip = get_local_lan_ip();
    if ip.is_empty() || ip == "127.0.0.1" || ip == "localhost" || (ip == my_ip && port == HTTP_PORT)
    {
        return None;
    }
    let (status, body) = http_get_raw(ip, port, "/api/mp3s/ping", timeout_ms)?;
    if status != 200 {
        return None;
    }
    let val = serde_json::from_slice::<serde_json::Value>(&body).ok()?;
    record_peer_value(&val, Some(ip));
    get_peers_map().lock().ok()?.get(ip).cloned()
}

pub fn scan_lan_subnet() -> Vec<PeerInfo> {
    let my_ip = get_local_lan_ip();
    let parts: Vec<&str> = my_ip.split('.').collect();
    if parts.len() == 4 && my_ip != "127.0.0.1" {
        let prefix = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
        let my_host: u16 = parts[3].parse().unwrap_or(0);
        let mut all_ips = Vec::with_capacity(254);
        for i in 1..=254 {
            if i != my_host {
                all_ips.push(format!("{}.{}", prefix, i));
            }
        }
        for chunk in all_ips.chunks(32) {
            let mut handles = Vec::with_capacity(chunk.len());
            for ip in chunk {
                let ip_clone = ip.clone();
                handles.push(thread::spawn(move || {
                    let _ = probe_peer_ip(&ip_clone, HTTP_PORT, 320);
                    let _ = probe_cast_device(&ip_clone, 320);
                }));
            }
            for h in handles {
                let _ = h.join();
            }
        }
    }
    get_peers_map()
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default()
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let clean = input
        .split_once(";base64,")
        .map(|(_, b)| b)
        .unwrap_or(input)
        .trim();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u8 = 0;
    for b in clean.bytes() {
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            _ => return None,
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

fn download_url_bytes(url: &str) -> Option<Vec<u8>> {
    if let Some(rest) = url.strip_prefix("http://") {
        let (host_port, path_part) = match rest.find('/') {
            Some(idx) => (&rest[..idx], &rest[idx..]),
            None => (rest, "/"),
        };
        let (host, port) = match host_port.split_once(':') {
            Some((h, p)) => (h, p.parse::<u16>().unwrap_or(80)),
            None => (host_port, 80),
        };
        if let Some((status, body)) = http_get_raw(host, port, path_part, 8000) {
            if status >= 200 && status < 300 && body.len() > 1024 {
                return Some(body);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let out = std::process::Command::new("curl.exe")
            .args([
                "-s",
                "-L",
                "--fail",
                "-A",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/133.0.0.0",
                url,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if out.status.success() && out.stdout.len() > 1024 {
            return Some(out.stdout);
        }
    }

    None
}

fn write_json_response(stream: &mut TcpStream, status_line: &str, val: &serde_json::Value) {
    let body = val.to_string();
    let res = format!(
        "{}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type, Authorization\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status_line,
        body.len(),
        body
    );
    let _ = stream.write_all(res.as_bytes());
}

pub fn save_track_bytes_or_url(
    track_val: &serde_json::Value,
    reason: &str,
    audio_b64: Option<&str>,
    source_url: Option<&str>,
    origin_device: Option<&str>,
    resolved_yt_url: Option<String>,
) -> Result<SavedMp3Entry, String> {
    let track_id = track_val
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if track_id.is_empty() {
        return Err(String::from("Missing track.id"));
    }
    let source = track_val
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("charts")
        .to_string();
    if source == "radio" {
        return Err(String::from("Live radio streams cannot be saved as MP3"));
    }

    let state = reconcile_disk_files();
    let dir = get_mp3_storage_dir();
    if let Some(existing) = state.tracks.iter().find(|t| t.id == track_id) {
        if dir.join(&existing.file_name).exists() {
            return Ok(existing.clone());
        }
    }

    let title = track_val
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Track")
        .to_string();
    let artist = track_val
        .get("artist")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown Artist")
        .to_string();
    let album = track_val
        .get("album")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let duration = track_val
        .get("duration")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let artwork_url = track_val
        .get("artworkUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let bytes = if let Some(b64) = audio_b64 {
        decode_base64(b64).ok_or_else(|| String::from("Invalid base64 audio payload"))?
    } else if let Some(surl) = source_url {
        download_url_bytes(surl)
            .ok_or_else(|| format!("Failed to download audio from {}", surl))?
    } else if let Some(yt_url) = resolved_yt_url {
        download_url_bytes(&yt_url)
            .ok_or_else(|| String::from("Failed to download resolved YouTube audio stream"))?
    } else {
        let raw_stream = track_val
            .get("streamUrl")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if raw_stream.starts_with("http") && !raw_stream.contains("dzcdn.net") {
            download_url_bytes(raw_stream)
                .ok_or_else(|| String::from("Failed to download direct streamUrl"))?
        } else {
            return Err(String::from("No downloadable audio stream available"));
        }
    };

    if bytes.len() <= 1024 {
        return Err(String::from("Audio payload is empty or too small"));
    }

    let file_name = build_mp3_filename(&artist, &title, &track_id);
    let dest_path = dir.join(&file_name);
    fs::write(&dest_path, &bytes).map_err(|e| format!("Failed writing MP3 file: {}", e))?;

    let mut guard = get_index_state().lock().unwrap_or_else(|e| e.into_inner());
    guard.deleted_ids.remove(&track_id);
    let entry = SavedMp3Entry {
        id: track_id.clone(),
        title,
        artist,
        album,
        duration: if duration > 0.0 {
            duration
        } else {
            ((bytes.len() / 16000) as f64).max(30.0)
        },
        artwork_url,
        source,
        stream_url: format!("/api/mp3s/file/{}", track_id),
        file_name,
        size_bytes: bytes.len() as u64,
        saved_at: now_ms(),
        saved_reason: reason.to_string(),
        origin_device_name: origin_device
            .map(|s| s.to_string())
            .unwrap_or_else(|| guard.device_name.clone()),
    };
    guard.tracks.retain(|t| t.id != track_id);
    guard.tracks.insert(0, entry.clone());
    save_index_state(&guard);
    Ok(entry)
}

pub fn try_handle_mp3_route<F>(
    stream: &mut TcpStream,
    req_str: &str,
    path_and_query: &str,
    range_header: Option<&str>,
    resolve_yt_fn: F,
) -> bool
where
    F: Fn(&str, u64) -> Option<String>,
{
    if !path_and_query.starts_with("/api/mp3s") {
        return false;
    }

    let path_only = path_and_query.split('?').next().unwrap_or(path_and_query);

    if path_only == "/api/mp3s/ping" {
        let payload = build_ping_json();
        write_json_response(stream, "HTTP/1.1 200 OK", &payload);
        return true;
    }

    if path_only == "/api/mp3s/list" {
        let state = reconcile_disk_files();
        let total_size: u64 = state.tracks.iter().map(|t| t.size_bytes).sum();
        let peers: Vec<PeerInfo> = get_peers_map()
            .lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        let payload = serde_json::json!({
            "ok": true,
            "deviceId": state.device_id,
            "deviceName": state.device_name,
            "deviceType": state.device_type,
            "ip": get_local_lan_ip(),
            "port": HTTP_PORT,
            "mp3Dir": get_mp3_storage_dir().to_string_lossy(),
            "mp3Count": state.tracks.len(),
            "totalSizeBytes": total_size,
            "tracks": state.tracks,
            "deletedIds": state.deleted_ids,
            "peers": peers,
        });
        write_json_response(stream, "HTTP/1.1 200 OK", &payload);
        return true;
    }

    if let Some(encoded_id) = path_only.strip_prefix("/api/mp3s/file/") {
        let track_id = percent_encoding::percent_decode_str(encoded_id)
            .decode_utf8_lossy()
            .to_string();
        let state = reconcile_disk_files();
        let Some(entry) = state.tracks.iter().find(|t| t.id == track_id) else {
            write_json_response(
                stream,
                "HTTP/1.1 404 Not Found",
                &serde_json::json!({"ok": false, "error": "Saved MP3 not found"}),
            );
            return true;
        };
        let full_path = get_mp3_storage_dir().join(&entry.file_name);
        let Ok(mut file) = fs::File::open(&full_path) else {
            write_json_response(
                stream,
                "HTTP/1.1 404 Not Found",
                &serde_json::json!({"ok": false, "error": "MP3 file missing on disk"}),
            );
            return true;
        };
        let total = file.metadata().map(|m| m.len()).unwrap_or(0);
        if total == 0 {
            write_json_response(
                stream,
                "HTTP/1.1 404 Not Found",
                &serde_json::json!({"ok": false, "error": "Empty MP3 file"}),
            );
            return true;
        }

        if let Some(r) = range_header {
            if let Some(spec) = r.strip_prefix("bytes=") {
                let mut parts = spec.splitn(2, '-');
                let start: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let end: u64 = parts
                    .next()
                    .and_then(|s| if s.is_empty() { None } else { s.parse().ok() })
                    .unwrap_or(total - 1)
                    .min(total - 1);
                if start < total && start <= end {
                    let chunk_len = end - start + 1;
                    let headers = format!(
                        "HTTP/1.1 206 Partial Content\r\nAccess-Control-Allow-Origin: *\r\nAccept-Ranges: bytes\r\nContent-Type: audio/mpeg\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        start, end, total, chunk_len
                    );
                    if stream.write_all(headers.as_bytes()).is_ok()
                        && file.seek(SeekFrom::Start(start)).is_ok()
                    {
                        let mut limited = file.take(chunk_len);
                        let _ = std::io::copy(&mut limited, stream);
                    }
                    return true;
                }
            }
        }

        let headers = format!(
            "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nAccept-Ranges: bytes\r\nContent-Type: audio/mpeg\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            total
        );
        if stream.write_all(headers.as_bytes()).is_ok() {
            let _ = std::io::copy(&mut file, stream);
        }
        return true;
    }

    let body_json: serde_json::Value = req_str
        .find("\r\n\r\n")
        .and_then(|pos| serde_json::from_str(&req_str[pos + 4..]).ok())
        .unwrap_or_else(|| serde_json::json!({}));

    if path_only == "/api/mp3s/save" {
        let Some(track_val) = body_json.get("track") else {
            write_json_response(
                stream,
                "HTTP/1.1 400 Bad Request",
                &serde_json::json!({"ok": false, "error": "Missing track object"}),
            );
            return true;
        };
        let reason = body_json
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("manual_download");
        let audio_b64 = body_json.get("audioBase64").and_then(|v| v.as_str());
        let source_url = body_json.get("sourceUrl").and_then(|v| v.as_str());
        let origin_dev = body_json.get("originDeviceName").and_then(|v| v.as_str());

        let mut yt_resolved = None;
        if audio_b64.is_none() && source_url.is_none() {
            let artist = track_val
                .get("artist")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = track_val
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let dur = track_val
                .get("duration")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let q = format!("{} {}", artist, title).trim().to_string();
            if !q.is_empty() {
                yt_resolved = resolve_yt_fn(&q, dur);
            }
        }

        match save_track_bytes_or_url(
            track_val,
            reason,
            audio_b64,
            source_url,
            origin_dev,
            yt_resolved,
        ) {
            Ok(entry) => write_json_response(
                stream,
                "HTTP/1.1 200 OK",
                &serde_json::json!({"ok": true, "entry": entry}),
            ),
            Err(err) => write_json_response(
                stream,
                "HTTP/1.1 500 Internal Server Error",
                &serde_json::json!({"ok": false, "error": err}),
            ),
        }
        return true;
    }

    if path_only == "/api/mp3s/delete" {
        let _ = reconcile_disk_files();
        let mode = body_json.get("mode").and_then(|v| v.as_str()).unwrap_or("");
        let propagate = body_json
            .get("propagate")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let keep_set: HashSet<String> = body_json
            .get("keepIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let mut target_ids: HashSet<String> = HashSet::new();
        let dir = get_mp3_storage_dir();
        let mut guard = get_index_state().lock().unwrap_or_else(|e| e.into_inner());

        if mode == "all" {
            for t in &guard.tracks {
                target_ids.insert(t.id.clone());
            }
        } else if mode == "unliked" {
            for t in &guard.tracks {
                if !keep_set.contains(&t.id) {
                    target_ids.insert(t.id.clone());
                }
            }
        } else {
            if let Some(id) = body_json.get("id").and_then(|v| v.as_str()) {
                target_ids.insert(id.to_string());
            }
            if let Some(ids) = body_json.get("ids").and_then(|v| v.as_array()) {
                for item in ids {
                    if let Some(s) = item.as_str() {
                        target_ids.insert(s.to_string());
                    }
                }
            }
        }

        let now = now_ms();
        let mut deleted_count = 0usize;
        for t in &guard.tracks {
            if target_ids.contains(&t.id) {
                let _ = fs::remove_file(dir.join(&t.file_name));
                deleted_count += 1;
            }
        }
        for tid in &target_ids {
            guard.deleted_ids.insert(tid.clone(), now);
        }
        guard.tracks.retain(|t| !target_ids.contains(&t.id));
        save_index_state(&guard);
        let tracks_snapshot = guard.tracks.clone();
        let deleted_snapshot = guard.deleted_ids.clone();
        drop(guard);

        if propagate && !target_ids.is_empty() {
            let peers: Vec<PeerInfo> = get_peers_map()
                .lock()
                .map(|m| m.values().cloned().collect())
                .unwrap_or_default();
            let ids_vec: Vec<String> = target_ids.into_iter().collect();
            let body_str = serde_json::json!({
                "ids": ids_vec,
                "propagate": false
            })
            .to_string();
            for p in peers {
                let _ = http_post_json_raw(&p.ip, p.port, "/api/mp3s/delete", &body_str, 1500);
            }
        }

        write_json_response(
            stream,
            "HTTP/1.1 200 OK",
            &serde_json::json!({
                "ok": true,
                "deletedCount": deleted_count,
                "tracks": tracks_snapshot,
                "deletedIds": deleted_snapshot,
            }),
        );
        return true;
    }

    if path_only == "/api/mp3s/peers" {
        let peers: Vec<PeerInfo> = get_peers_map()
            .lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        write_json_response(
            stream,
            "HTTP/1.1 200 OK",
            &serde_json::json!({
                "ok": true,
                "localDevice": build_ping_json(),
                "peers": peers,
            }),
        );
        return true;
    }

    if path_only == "/api/mp3s/scan" {
        let peers = scan_lan_subnet();
        write_json_response(
            stream,
            "HTTP/1.1 200 OK",
            &serde_json::json!({
                "ok": true,
                "localDevice": build_ping_json(),
                "peers": peers,
            }),
        );
        return true;
    }

    if path_only == "/api/mp3s/peers/add" {
        let raw_ip = body_json
            .get("ip")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let clean = raw_ip
            .trim_start_matches("http://")
            .trim_start_matches("https://")
            .split('/')
            .next()
            .unwrap_or("");
        let (ip_part, port_part) = match clean.split_once(':') {
            Some((i, p)) => (i, p.parse::<u16>().unwrap_or(HTTP_PORT)),
            None => (clean, HTTP_PORT),
        };
        if let Some(peer) = probe_peer_ip(ip_part, port_part, 2000) {
            let peers: Vec<PeerInfo> = get_peers_map()
                .lock()
                .map(|m| m.values().cloned().collect())
                .unwrap_or_default();
            write_json_response(
                stream,
                "HTTP/1.1 200 OK",
                &serde_json::json!({
                    "ok": true,
                    "peer": peer,
                    "peers": peers,
                }),
            );
        } else {
            write_json_response(
                stream,
                "HTTP/1.1 404 Not Found",
                &serde_json::json!({
                    "ok": false,
                    "error": format!("No Dotify device responded at {}:{}", ip_part, port_part),
                }),
            );
        }
        return true;
    }

    if path_only == "/api/mp3s/sync-from-peers" {
        let target_ip = body_json.get("targetPeerIp").and_then(|v| v.as_str());
        let force_track_id = body_json.get("forceTrackId").and_then(|v| v.as_str());

        let peers: Vec<PeerInfo> = if let Some(tip) = target_ip {
            vec![PeerInfo {
                device_id: format!("peer_{}", tip),
                device_name: format!("Dotify ({})", tip),
                device_type: String::from("desktop"),
                ip: tip.to_string(),
                port: HTTP_PORT,
                mp3_count: 0,
                total_size_bytes: 0,
                last_seen: now_ms(),
            }]
        } else {
            get_peers_map()
                .lock()
                .map(|m| m.values().cloned().collect())
                .unwrap_or_default()
        };

        let mut pulled = Vec::new();
        for peer in peers {
            let Some((status, body)) = http_get_raw(&peer.ip, peer.port, "/api/mp3s/list", 3000)
            else {
                continue;
            };
            if status != 200 {
                continue;
            }
            let Ok(peer_data) = serde_json::from_slice::<serde_json::Value>(&body) else {
                continue;
            };
            record_peer_value(&peer_data, Some(&peer.ip));

            let Some(peer_tracks) = peer_data.get("tracks").and_then(|v| v.as_array()) else {
                continue;
            };
            let peer_dev_name = peer_data
                .get("deviceName")
                .and_then(|v| v.as_str())
                .unwrap_or(&peer.device_name);

            for pt in peer_tracks {
                let Some(tid) = pt.get("id").and_then(|v| v.as_str()) else {
                    continue;
                };
                if let Some(fid) = force_track_id {
                    if tid != fid {
                        continue;
                    }
                }
                let state_now = reconcile_disk_files();
                if force_track_id.is_none() && state_now.deleted_ids.contains_key(tid) {
                    continue;
                }
                if force_track_id.is_none() && state_now.tracks.iter().any(|t| t.id == tid) {
                    continue;
                }
                let encoded = percent_encoding::utf8_percent_encode(
                    tid,
                    percent_encoding::NON_ALPHANUMERIC,
                )
                .to_string();
                let file_url = format!("http://{}:{}/api/mp3s/file/{}", peer.ip, peer.port, encoded);
                if let Ok(saved) = save_track_bytes_or_url(
                    pt,
                    "wifi_sync",
                    None,
                    Some(&file_url),
                    Some(peer_dev_name),
                    None,
                ) {
                    pulled.push(saved);
                }
            }
        }

        let final_state = reconcile_disk_files();
        let final_peers: Vec<PeerInfo> = get_peers_map()
            .lock()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        write_json_response(
            stream,
            "HTTP/1.1 200 OK",
            &serde_json::json!({
                "ok": true,
                "pulledCount": pulled.len(),
                "pulled": pulled,
                "tracks": final_state.tracks,
                "peers": final_peers,
            }),
        );
        return true;
    }

    if path_only == "/api/mp3s/open-folder" {
        let dir = get_mp3_storage_dir();
        let _ = fs::create_dir_all(&dir);
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("explorer.exe")
                .arg(&dir)
                .spawn();
        }
        write_json_response(
            stream,
            "HTTP/1.1 200 OK",
            &serde_json::json!({
                "ok": true,
                "path": dir.to_string_lossy(),
            }),
        );
        return true;
    }

    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct DiscoveredCastDevice {
    pub deviceId: String,
    pub deviceName: String,
    pub deviceType: String,
    pub role: String,
    pub isCurrentDevice: bool,
    pub isActive: bool,
    pub volume: f32,
    pub lastSeen: u64,
    pub capabilities: serde_json::Value,
    pub castDetails: serde_json::Value,
}

static DISCOVERED_CAST_DEVICES: OnceLock<Mutex<HashMap<String, DiscoveredCastDevice>>> = OnceLock::new();

fn get_cast_devices_map() -> &'static Mutex<HashMap<String, DiscoveredCastDevice>> {
    DISCOVERED_CAST_DEVICES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn get_discovered_cast_devices() -> Vec<DiscoveredCastDevice> {
    get_cast_devices_map()
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default()
}

pub fn probe_cast_device(ip: &str, timeout_ms: u64) -> Option<DiscoveredCastDevice> {
    let (status, body) = http_get_raw(ip, 8008, "/setup/eureka_info?params=name,device_info", timeout_ms)?;
    if status != 200 {
        return None;
    }
    let val: serde_json::Value = serde_json::from_slice(&body).ok()?;
    let name = val.get("name").and_then(|v| v.as_str())?;
    let model = val
        .get("device_info")
        .and_then(|di| di.get("model_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Google Cast Speaker");
    let udn = val.get("ssdp_udn").and_then(|v| v.as_str()).unwrap_or("");

    let dev_id = format!("cast:{}:8009", ip);
    let dev = DiscoveredCastDevice {
        deviceId: dev_id.clone(),
        deviceName: name.to_string(),
        deviceType: "speaker".to_string(),
        role: "active_host".to_string(),
        isCurrentDevice: false,
        isActive: false,
        volume: 0.7,
        lastSeen: now_ms(),
        capabilities: serde_json::json!({
            "canPlayAudio": true,
            "isController": false
        }),
        castDetails: serde_json::json!({
            "ip": ip,
            "port": 8009,
            "model": model,
            "udn": udn
        }),
    };

    if let Ok(mut map) = get_cast_devices_map().lock() {
        map.insert(dev_id, dev.clone());
    }
    Some(dev)
}

pub fn scan_for_cast_devices() -> Vec<DiscoveredCastDevice> {
    let my_ip = get_local_lan_ip();
    let parts: Vec<&str> = my_ip.split('.').collect();
    if parts.len() == 4 && my_ip != "127.0.0.1" {
        let prefix = format!("{}.{}.{}", parts[0], parts[1], parts[2]);
        let my_host: u16 = parts[3].parse().unwrap_or(0);
        let mut all_ips = Vec::with_capacity(254);
        for i in 1..=254 {
            if i != my_host {
                all_ips.push(format!("{}.{}", prefix, i));
            }
        }
        for chunk in all_ips.chunks(48) {
            let mut handles = Vec::with_capacity(chunk.len());
            for ip in chunk {
                let ip_clone = ip.clone();
                handles.push(thread::spawn(move || {
                    let _ = probe_cast_device(&ip_clone, 1200);
                }));
            }
            for h in handles {
                let _ = h.join();
            }
        }
    }
    get_discovered_cast_devices()
}
