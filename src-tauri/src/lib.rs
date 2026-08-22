use base64::Engine;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};
use image::ImageEncoder;

#[derive(Debug, Deserialize, Serialize, Default)]
struct ApiKeys {
    poof: Vec<String>,
    removebg: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Config {
    input_folder_path: String,
    output_folder_path: String,
    api_keys: ApiKeys,
    svg_files: HashMap<String, String>,
}

fn resource_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().resource_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default()
    });

    if cfg!(debug_assertions) {
        let mut candidate = dir.clone();
        for _ in 0..3 {
            candidate.pop();
            if candidate.join("tauri.conf.json").exists() {
                return candidate;
            }
        }
    }

    dir
}

fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_local_data_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default()
    })
}

fn load_config(app: &tauri::AppHandle) -> Result<Config, String> {
    let config_path = data_dir(app).join("config.json");
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.json at {:?}: {}", config_path, e))?;

    // Try new format first
    if let Ok(config) = serde_json::from_str::<Config>(&content) {
        return Ok(config);
    }

    // Migration: old flat api_keys array → provider-keyed dictionary
    let mut json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid config.json: {}", e))?;

    if let Some(keys) = json.get("api_keys").and_then(|v| v.as_array()) {
        let mut poof = Vec::new();
        let mut removebg = Vec::new();
        for k in keys {
            if let Some(s) = k.as_str() {
                if s.starts_with("pk_f") {
                    poof.push(s.to_string());
                } else {
                    removebg.push(s.to_string());
                }
            }
        }
        json["api_keys"] = serde_json::json!({ "poof": poof, "removebg": removebg });

        let _ = fs::write(&config_path, serde_json::to_string_pretty(&json).unwrap_or_default());
    }

    serde_json::from_value(json).map_err(|e| format!("Invalid config.json after migration: {}", e))
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => continue,
            Component::ParentDir => { normalized.pop(); },
            other => normalized.push(other),
        }
    }
    normalized
}

fn parse_svg_height(svg: &str) -> f64 {
    if let Some(start) = svg.find("height=\"") {
        let rest = &svg[start + 8..];
        if let Some(end) = rest.find("mm") {
            if let Ok(h) = rest[..end].trim().parse::<f64>() {
                return h.max(1.0);
            }
        }
    }
    297.0
}

fn patch_svg_path(app: &tauri::AppHandle, svg_path: &str) -> Result<PathBuf, String> {
    let content = fs::read_to_string(svg_path)
        .map_err(|e| format!("Failed to read SVG: {}", e))?;

    let temp_svg = data_dir(app).join("tmp").join("template.svg");
    fs::create_dir_all(temp_svg.parent().unwrap())
        .map_err(|e| format!("Failed to create tmp dir: {}", e))?;
    fs::write(&temp_svg, &content)
        .map_err(|e| format!("Failed to write patched SVG: {}", e))?;

    Ok(temp_svg)
}

fn resolve(app: &tauri::AppHandle, path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    let resolved = if p.is_absolute() { p } else { resource_dir(app).join(&p) };
    normalize_path(&resolved)
}

fn resolve_data(app: &tauri::AppHandle, path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    let resolved = if p.is_absolute() { p } else { data_dir(app).join(&p) };
    normalize_path(&resolved)
}

fn svg_to_pdf(svg_content: &str, tmp_dir: &Path) -> Result<Vec<u8>, String> {
    let mut options = svg2pdf::usvg::Options::default();
    options.dpi = 72.0;
    options.resources_dir = Some(tmp_dir.to_path_buf());
    options.fontdb_mut().load_system_fonts();

    let rtree = svg2pdf::usvg::Tree::from_str(svg_content, &options)
        .map_err(|e| format!("SVG parse error: {}", e))?;

    let pdf_bytes = svg2pdf::to_pdf(
        &rtree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    ).map_err(|e| format!("PDF conversion error: {}", e))?;

    Ok(pdf_bytes)
}

const NO_API_MAX_PX: u32 = 600;

fn resize_if_needed(bytes: &[u8]) -> Vec<u8> {
    let img = match image::load_from_memory(bytes) {
        Ok(i) => i,
        Err(_) => return bytes.to_vec(),
    };

    if img.width() <= NO_API_MAX_PX && img.height() <= NO_API_MAX_PX {
        return bytes.to_vec();
    }

    let resized = img.resize(NO_API_MAX_PX, NO_API_MAX_PX, image::imageops::FilterType::Lanczos3);
    let mut buf = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut buf);
    resized.write_to(&mut cursor, image::ImageFormat::Png).unwrap_or(());
    if buf.is_empty() { bytes.to_vec() } else { buf }
}

#[derive(Debug, Serialize)]
struct SvgTemplate {
    key: String,
    path: String,
    name: String,
}

#[tauri::command]
fn check_config(app_handle: tauri::AppHandle) -> bool {
    data_dir(&app_handle).join("config.json").exists()
}

#[tauri::command]
fn save_config(
    app_handle: tauri::AppHandle,
    poof_keys: Vec<String>,
    removebg_keys: Vec<String>,
) -> Result<(), String> {
    let res = resource_dir(&app_handle);
    let mut svg_files = HashMap::new();

    if let Ok(entries) = fs::read_dir(res.join("SVGs")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "svg") {
                let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                let rel = path.strip_prefix(&res).unwrap_or(&path).to_string_lossy().to_string();
                svg_files.insert(stem, rel);
            }
        }
    }

    if svg_files.is_empty() {
        svg_files.insert("1x1".into(), "SVGs/1x1.svg".into());
        svg_files.insert("2x2".into(), "SVGs/2x2.svg".into());
        svg_files.insert("Mixed".into(), "SVGs/Mixed.svg".into());
    }

    let config = Config {
        input_folder_path: "input".into(),
        output_folder_path: ".".into(),
        api_keys: ApiKeys {
            poof: poof_keys,
            removebg: removebg_keys,
        },
        svg_files,
    };

    let d = data_dir(&app_handle);
    fs::create_dir_all(&d).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(d.join("config.json"), &json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_config(app_handle: tauri::AppHandle) -> Result<ApiKeys, String> {
    let config = load_config(&app_handle)?;
    Ok(config.api_keys)
}

#[tauri::command]
fn update_config(
    app_handle: tauri::AppHandle,
    poof_keys: Vec<String>,
    removebg_keys: Vec<String>,
) -> Result<(), String> {
    let mut config = load_config(&app_handle)?;
    config.api_keys = ApiKeys {
        poof: poof_keys,
        removebg: removebg_keys,
    };
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize error: {}", e))?;
    let config_path = data_dir(&app_handle).join("config.json");
    fs::write(&config_path, &json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_svg_templates(app_handle: tauri::AppHandle) -> Result<Vec<SvgTemplate>, String> {
    let d = data_dir(&app_handle);
    let mut config = load_config(&app_handle)?;

    let res = resource_dir(&app_handle);
    let mut changed = false;
    if let Ok(entries) = fs::read_dir(res.join("SVGs")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "svg") {
                let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
                if stem.starts_with("Polaroid") { continue; }
                if !config.svg_files.contains_key(&stem) {
                    let rel = path.strip_prefix(&res).unwrap_or(&path).to_string_lossy().to_string();
                    config.svg_files.insert(stem, rel);
                    changed = true;
                }
            }
        }
    }

    if changed {
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = fs::write(d.join("config.json"), &json);
        }
    }

    let mut templates = Vec::new();
    for (key, rel_path) in &config.svg_files {
        let full_path = resolve(&app_handle, rel_path);
        let name = full_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        templates.push(SvgTemplate { key: key.clone(), path: full_path.to_string_lossy().to_string(), name });
    }
    templates.sort_by(|a, b| {
        let a_dev = a.key.to_lowercase().starts_with("dev");
        let b_dev = b.key.to_lowercase().starts_with("dev");
        match (a_dev, b_dev) {
            (true, false) => std::cmp::Ordering::Greater,
            (false, true) => std::cmp::Ordering::Less,
            _ => a.key.cmp(&b.key),
        }
    });
    Ok(templates)
}

#[tauri::command]
async fn remove_bg(app_handle: tauri::AppHandle, image_base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let config = load_config(&app_handle)?;

    let input_dir = resolve_data(&app_handle, &config.input_folder_path);
    fs::create_dir_all(&input_dir).map_err(|e| format!("Failed to create input dir: {}", e))?;
    fs::write(input_dir.join("input.png"), &bytes)
        .map_err(|e| format!("Failed to write input file: {}", e))?;

    let output_dir = resolve_data(&app_handle, &config.output_folder_path);
    fs::create_dir_all(&output_dir).map_err(|e| format!("Failed to create output dir: {}", e))?;
    let output_path = output_dir.join("picture.png");

    let client = reqwest::Client::new();
    let all_keys: Vec<(&str, &str, &str, &str)> = config.api_keys.removebg
        .iter()
        .map(|k| (k.as_str(), "https://api.remove.bg/v1.0/removebg", "X-Api-Key", "auto"))
        .chain(
            config.api_keys.poof
                .iter()
                .map(|k| (k.as_str(), "https://api.poof.bg/v1/remove", "x-api-key", "preview"))
        )
        .collect();

    for (i, (api_key, endpoint, auth_header, size_param)) in all_keys.iter().enumerate() {
        let prefix: String = api_key.chars().take(5).collect();

        let file_part = reqwest::multipart::Part::bytes(bytes.clone())
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| format!("Mime error: {}", e))?;
        let form = reqwest::multipart::Form::new()
            .part("image_file", file_part)
            .text("size", *size_param);
        let total_start = std::time::Instant::now();
        let response = client
            .post(*endpoint)
            .multipart(form)
            .header(*auth_header, *api_key)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await;
        let send_ms = total_start.elapsed().as_millis() as u64;

        match response {
            Ok(resp) if resp.status() == 200 => {
                let bytes_start = std::time::Instant::now();
                let data = resp.bytes().await.map_err(|e| format!("Read response error: {}", e))?;
                let bytes_ms = bytes_start.elapsed().as_millis() as u64;

                let write_start = std::time::Instant::now();
                fs::write(&output_path, &data).map_err(|e| format!("Failed to write output: {}", e))?;
                let write_ms = write_start.elapsed().as_millis() as u64;
                let total_ms = total_start.elapsed().as_millis() as u64;

                app_handle.emit("key_used", i).ok();
                app_handle.emit("api_log", serde_json::json!({
                    "key_prefix": format!("{}...", prefix),
                    "ok": true,
                    "status": 200,
                    "send_ms": send_ms,
                    "bytes_ms": bytes_ms,
                    "write_ms": write_ms,
                    "total_ms": total_ms,
                    "endpoint": endpoint,
                    "error": null,
                })).ok();
                return Ok(base64::engine::general_purpose::STANDARD.encode(&data));
            }
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                let total_ms = total_start.elapsed().as_millis() as u64;
                app_handle.emit("api_log", serde_json::json!({
                    "key_prefix": format!("{}...", prefix),
                    "ok": false,
                    "status": status,
                    "send_ms": send_ms,
                    "bytes_ms": 0,
                    "write_ms": 0,
                    "total_ms": total_ms,
                    "endpoint": endpoint,
                    "error": body,
                })).ok();
            }
            Err(e) => {
                let total_ms = total_start.elapsed().as_millis() as u64;
                app_handle.emit("api_log", serde_json::json!({
                    "key_prefix": format!("{}...", prefix),
                    "ok": false,
                    "status": "error",
                    "send_ms": send_ms,
                    "bytes_ms": 0,
                    "write_ms": 0,
                    "total_ms": total_ms,
                    "endpoint": endpoint,
                    "error": e.to_string(),
                })).ok();
            }
        }
    }
    Err("All API keys failed. Check your API keys and internet connection.".to_string())
}

#[tauri::command]
fn write_picture(app_handle: tauri::AppHandle, image_base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let bytes = resize_if_needed(&bytes);
    let output_path = data_dir(&app_handle).join("picture.png");
    fs::write(&output_path, &bytes).map_err(|e| format!("Failed to write picture.png: {}", e))?;
    Ok("ok".into())
}

#[tauri::command]
fn export_pdf(app_handle: tauri::AppHandle, svg_path: String, save_path: String, tab: String) -> Result<String, String> {
    let tmp_dir = data_dir(&app_handle).join("tmp");
    let patched_svg = patch_svg_path(&app_handle, &svg_path)?;
    let svg_content = fs::read_to_string(&patched_svg)
        .map_err(|e| format!("Failed to read SVG: {}", e))?;

    let mut pdf_path = PathBuf::from(&save_path);
    if pdf_path.extension().is_none_or(|e| e != "pdf") {
        pdf_path.set_extension("pdf");
    }

    let pdf_bytes = svg_to_pdf(&svg_content, &tmp_dir)?;
    fs::write(&pdf_path, &pdf_bytes).map_err(|e| format!("Failed to write PDF: {}", e))?;

    if pdf_path.exists() {
        let log_id = log_activity(&app_handle, "pdf_export", &tab, 1);
        deduct_materials_for_export(&app_handle, &tab, 1);
        let template_key = Path::new(&svg_path).file_stem().unwrap_or_default().to_string_lossy().to_string();
        auto_create_sale(&app_handle, &tab, &template_key, 1, log_id, None);
        Ok(pdf_path.to_string_lossy().to_string())
    } else {
        Err("PDF generation failed".to_string())
    }
}

fn cleanup_temp_pdfs() {
    let temp_dir = std::env::temp_dir();
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("rush_id_print_") && name_str.ends_with(".pdf") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

fn activity_db_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("activity.db")
}

fn init_activity_db(app: &tauri::AppHandle) -> Result<(), String> {
    let path = activity_db_path(app);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            tab TEXT,
            page_count INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_created_at ON activity_log(created_at);

        CREATE TABLE IF NOT EXISTS materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            unit TEXT NOT NULL,
            current_stock REAL NOT NULL,
            low_stock_threshold REAL NOT NULL DEFAULT 0,
            linked_tab TEXT,
            deduct_per_export REAL NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS stock_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            material_id INTEGER NOT NULL REFERENCES materials(id),
            change_amount REAL NOT NULL,
            reason TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            template_key TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            tab TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            tab TEXT,
            template_key TEXT,
            amount REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            note TEXT,
            activity_log_id INTEGER,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pricing_tiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id INTEGER NOT NULL,
            layout TEXT NOT NULL,
            price REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pricing_tiers_service_id ON pricing_tiers(service_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_tiers_service_layout ON pricing_tiers(service_id, layout);

        CREATE TABLE IF NOT EXISTS resumes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            template_key TEXT NOT NULL,
            data_json TEXT NOT NULL,
            docx_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resumes_updated_at ON resumes(updated_at);",
    )
    .map_err(|e| format!("Failed to create activity_log table: {}", e))?;

    // Migration: add template_key to sales if missing (existing databases)
    let _ = conn.execute("ALTER TABLE sales ADD COLUMN template_key TEXT", []);

    // Migration: drop old service_prices table if present
    let _ = conn.execute("DROP TABLE IF EXISTS service_prices", []);

    Ok(())
}

fn log_activity(app: &tauri::AppHandle, event_type: &str, tab: &str, page_count: i32) -> Option<i64> {
    let path = activity_db_path(app);
    if let Ok(conn) = Connection::open(&path) {
        let now = Utc::now().to_rfc3339();
        if conn.execute(
            "INSERT INTO activity_log (event_type, tab, page_count, created_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![event_type, tab, page_count, now],
        ).is_ok() {
            return Some(conn.last_insert_rowid());
        }
    }
    None
}

#[tauri::command]
fn log_print_reminder(app_handle: tauri::AppHandle, tab: String) -> Result<(), String> {
    log_activity(&app_handle, "print_reminder_shown", &tab, 1);
    Ok(())
}

#[derive(Debug, Serialize)]
struct Material {
    id: i64,
    name: String,
    unit: String,
    current_stock: f64,
    low_stock_threshold: f64,
    linked_tab: Option<String>,
    deduct_per_export: f64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct MaterialsSummary {
    total: i32,
    low_count: i32,
}

#[derive(Debug, Serialize)]
struct Sale {
    id: i64,
    source: String,
    tab: Option<String>,
    template_key: Option<String>,
    amount: f64,
    quantity: i32,
    note: Option<String>,
    activity_log_id: Option<i64>,
    created_at: String,
}

#[derive(Debug, Serialize)]
struct SalesSummary {
    today_total: f64,
    today_count: i32,
}

#[derive(Debug, Serialize)]
struct SalesTrend {
    date: String,
    total: f64,
}

#[derive(Debug, Serialize)]
struct TemplateBreakdown {
    template_key: String,
    total: f64,
    quantity: i32,
}

#[derive(Debug, Serialize)]
struct TemplateHourCell {
    template_key: String,
    display_name: String,
    hour: i32,
    count: i32,
    total: f64,
}

#[derive(Debug, Serialize)]
struct PricingExport {
    exported_at: String,
    services: HashMap<String, f64>,
    tiers: HashMap<String, HashMap<String, f64>>,
}

#[derive(Debug, Serialize)]
struct Service {
    id: i64,
    template_key: String,
    display_name: String,
    price: f64,
    tab: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct PricingTier {
    id: i64,
    service_id: i64,
    layout: String,
    price: f64,
    created_at: String,
    updated_at: String,
}

fn deduct_materials_for_export(app: &tauri::AppHandle, tab: &str, page_count: i32) {
    let path = activity_db_path(app);
    if let Ok(conn) = Connection::open(&path) {
        let mut stmt = match conn.prepare(
            "SELECT id, deduct_per_export FROM materials WHERE linked_tab = ?1"
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let now = Utc::now().to_rfc3339();
        let rows: Vec<(i64, f64)> = stmt.query_map(rusqlite::params![tab], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map(|r| r.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();

        for (id, deduct) in rows {
            let amount = deduct * page_count as f64;
            let _ = conn.execute(
                "UPDATE materials SET current_stock = current_stock - ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![amount, now, id],
            );
            let _ = conn.execute(
                "INSERT INTO stock_adjustments (material_id, change_amount, reason, created_at) VALUES (?1, ?2, 'Auto-deduct', ?3)",
                rusqlite::params![id, -amount, now],
            );
        }
    }
}

fn calculate_3r_price(base_2pcs: f64, base_4pcs: f64, layout: &str) -> f64 {
    let n: i32 = layout.replace("pcs", "").parse().unwrap_or(0);
    if n % 2 != 0 || n < 2 {
        return 0.0;
    }
    let a4_pages = n / 4;
    let a5_pages = (n % 4) / 2;
    (a4_pages as f64 * base_4pcs) + (a5_pages as f64 * base_2pcs)
}

fn calculate_5r_price(base_1pc: f64, base_2pcs: f64, layout: &str) -> f64 {
    let n: i32 = layout.replace("pcs", "").parse().unwrap_or(0);
    if n < 1 {
        return 0.0;
    }
    let a4_pages = n / 2;
    let a5_pages = n % 2;
    (a4_pages as f64 * base_2pcs) + (a5_pages as f64 * base_1pc)
}

fn calculate_4r_price(base_2pcs: f64, base_3pcs: f64, layout: &str) -> f64 {
    let n: i32 = layout.replace("pcs", "").parse().unwrap_or(0);
    if n < 2 {
        return 0.0;
    }
    let a4_pages = n / 3;
    let a5_pages = (n % 3) / 2;
    (a4_pages as f64 * base_3pcs) + (a5_pages as f64 * base_2pcs)
}

fn calculate_wallet_price(base_9pcs: f64, layout: &str) -> f64 {
    let n: i32 = layout.replace("pcs", "").parse().unwrap_or(0);
    if n < 9 || n % 9 != 0 {
        return 0.0;
    }
    (n / 9) as f64 * base_9pcs
}

fn calculate_8r_price(base_1pc: f64, layout: &str) -> f64 {
    let n: i32 = layout.replace("pcs", "").parse().unwrap_or(0);
    if n < 1 {
        return 0.0;
    }
    n as f64 * base_1pc
}

fn get_base_price(conn: &Connection, service_id: i64, layout: &str) -> f64 {
    conn.query_row(
        "SELECT price FROM pricing_tiers WHERE service_id = ?1 AND layout = ?2",
        rusqlite::params![service_id, layout],
        |row| row.get(0),
    ).unwrap_or(0.0)
}

fn get_price_for_layout(conn: &Connection, service_id: i64, template_key: &str, layout: &str) -> f64 {
    // 1. Look up tier in pricing_tiers
    let tier_price: Option<f64> = conn.query_row(
        "SELECT price FROM pricing_tiers WHERE service_id = ?1 AND layout = ?2",
        rusqlite::params![service_id, layout],
        |row| row.get(0),
    ).ok();

    if let Some(price) = tier_price {
        return price;
    }

    // 2. Calculate from base prices if applicable
    match template_key {
        "3r" => {
            let base_2pcs = get_base_price(conn, service_id, "2pcs");
            let base_4pcs = get_base_price(conn, service_id, "4pcs");
            calculate_3r_price(base_2pcs, base_4pcs, layout)
        }
        "5r" => {
            let base_1pc = get_base_price(conn, service_id, "1pcs");
            let base_2pcs = get_base_price(conn, service_id, "2pcs");
            calculate_5r_price(base_1pc, base_2pcs, layout)
        }
        "4r" => {
            let base_2pcs = get_base_price(conn, service_id, "2pcs");
            let base_3pcs = get_base_price(conn, service_id, "3pcs");
            calculate_4r_price(base_2pcs, base_3pcs, layout)
        }
        "8r" => {
            let base_1pc = get_base_price(conn, service_id, "1pcs");
            calculate_8r_price(base_1pc, layout)
        }
        "wallet" => {
            let base_9pcs = get_base_price(conn, service_id, "9pcs");
            calculate_wallet_price(base_9pcs, layout)
        }
        _ => 0.0,
    }
}

fn auto_create_sale(app: &tauri::AppHandle, tab: &str, template_key: &str, quantity: i32, activity_log_id: Option<i64>, layout: Option<&str>) {
    let path = activity_db_path(app);
    if let Ok(conn) = Connection::open(&path) {
        // 1. Get service_id
        let service_id: i64 = conn.query_row(
            "SELECT id FROM services WHERE template_key = ?1",
            rusqlite::params![template_key],
            |row| row.get(0),
        ).unwrap_or(0);

        if service_id == 0 {
            return;
        }

        // 2. Get price (tier-based or fallback)
        let price = if let Some(layout) = layout {
            get_price_for_layout(&conn, service_id, template_key, layout)
        } else {
            conn.query_row(
                "SELECT price FROM services WHERE id = ?1",
                rusqlite::params![service_id],
                |row| row.get(0),
            ).unwrap_or(0.0)
        };

        if price <= 0.0 {
            return;
        }

        let amount = price * quantity as f64;
        let now = Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT INTO sales (source, tab, template_key, amount, quantity, note, activity_log_id, created_at) VALUES ('auto', ?1, ?2, ?3, ?4, NULL, ?5, ?6)",
            rusqlite::params![tab, template_key, amount, quantity, activity_log_id, now],
        );
    }
}

fn seed_services_from_svg(app: &tauri::AppHandle) {
    let path = activity_db_path(app);
    let conn = match Connection::open(&path) {
        Ok(c) => c,
        Err(_) => return,
    };
    let res = resource_dir(app);
    let svg_dir = res.join("SVGs");
    let Ok(entries) = fs::read_dir(&svg_dir) else { return };

    let now = Utc::now().to_rfc3339();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "svg") {
            let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let display_name: String = stem
                .replace('_', " ")
                .split_whitespace()
                .map(|w| {
                    let mut c = w.chars();
                    match c.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");

            let tab = if stem.to_lowercase().contains("passport") {
                "passport"
            } else if stem.starts_with("multi_") {
                "multi"
            } else if stem == "1x1" || stem == "2x2" || stem.starts_with("Dev ") || stem.to_lowercase() == "mixed" {
                "single"
            } else if stem.starts_with("Polaroid") {
                "polaroid"
            } else {
                "other"
            };

            let _ = conn.execute(
                "INSERT OR IGNORE INTO services (template_key, display_name, price, tab, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?4, ?4)",
                rusqlite::params![stem, display_name, tab, now],
            );
            let _ = conn.execute(
                "UPDATE services SET tab = ?1 WHERE template_key = ?2 AND tab != ?1",
                rusqlite::params![tab, stem],
            );
            if stem.starts_with("multi_") {
                let single_key = &stem[6..];
                let _ = conn.execute(
                    "UPDATE services SET price = (SELECT price FROM services WHERE LOWER(template_key) = LOWER(?1)) WHERE template_key = ?2",
                    rusqlite::params![single_key, stem],
                );
            }
            if stem.to_lowercase() == "passport2" {
                let _ = conn.execute(
                    "UPDATE services SET price = (SELECT price * 2 FROM services WHERE template_key = 'passport1') WHERE template_key = 'passport2'",
                    [],
                );
            }
            if stem.starts_with("Dev ") {
                let main_key = &stem[4..];
                let _ = conn.execute(
                    "UPDATE services SET price = (SELECT price FROM services WHERE LOWER(template_key) = LOWER(?1)) WHERE template_key = ?2",
                    rusqlite::params![main_key, stem],
                );
            }

            // Seed pricing tiers for quantity-based templates
            if stem == "3r" {
                let service_id: i64 = conn.query_row(
                    "SELECT id FROM services WHERE template_key = '3r'",
                    [],
                    |row| row.get(0),
                ).unwrap_or(0);
                for layout in &["2pcs", "4pcs"] {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO pricing_tiers (service_id, layout, price, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
                        rusqlite::params![service_id, layout, now],
                    );
                }
            }
            if stem == "5r" {
                let service_id: i64 = conn.query_row(
                    "SELECT id FROM services WHERE template_key = '5r'",
                    [],
                    |row| row.get(0),
                ).unwrap_or(0);
                for layout in &["1pcs", "2pcs"] {
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO pricing_tiers (service_id, layout, price, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
                        rusqlite::params![service_id, layout, now],
                    );
                }
            }
        }
    }

    // Seed unified 4r service with tiered pricing (separate from 4r2pcs/4r3pcs SVGs)
    let _ = conn.execute(
        "INSERT OR IGNORE INTO services (template_key, display_name, price, tab, created_at, updated_at) VALUES ('4r', '4r', 0, 'other', ?1, ?1)",
        rusqlite::params![now],
    );
    if let Ok(service_id) = conn.query_row(
        "SELECT id FROM services WHERE template_key = '4r'",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        for layout in &["2pcs", "3pcs"] {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO pricing_tiers (service_id, layout, price, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
                rusqlite::params![service_id, layout, now],
            );
        }
        let _ = conn.execute(
            "DELETE FROM pricing_tiers WHERE service_id = ?1 AND layout IN ('5pcs', '6pcs')",
            rusqlite::params![service_id],
        );
    }

    // Seed unified 8r service with flat per-photo pricing
    let _ = conn.execute(
        "INSERT OR IGNORE INTO services (template_key, display_name, price, tab, created_at, updated_at) VALUES ('8r', '8r', 0, 'other', ?1, ?1)",
        rusqlite::params![now],
    );
    if let Ok(service_id) = conn.query_row(
        "SELECT id FROM services WHERE template_key = '8r'",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO pricing_tiers (service_id, layout, price, created_at, updated_at) VALUES (?1, '1pcs', 0, ?2, ?2)",
            rusqlite::params![service_id, now],
        );
    }

    // Seed unified wallet service with tiered pricing (separate from wallet2pcs/3pcs/9pcs SVGs)
    let _ = conn.execute(
        "INSERT OR IGNORE INTO services (template_key, display_name, price, tab, created_at, updated_at) VALUES ('wallet', 'Wallet', 0, 'other', ?1, ?1)",
        rusqlite::params![now],
    );
    if let Ok(service_id) = conn.query_row(
        "SELECT id FROM services WHERE template_key = 'wallet'",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        for layout in &["2pcs", "3pcs", "9pcs"] {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO pricing_tiers (service_id, layout, price, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)",
                rusqlite::params![service_id, layout, now],
            );
        }
        let _ = conn.execute(
            "DELETE FROM pricing_tiers WHERE service_id = ?1 AND layout IN ('18pcs', '27pcs')",
            rusqlite::params![service_id],
        );
    }

    // Apply default prices from bundled JSON (first install only)
    let default_pricing_path = resource_dir(app).join("default-pricing.json");
    if let Ok(content) = fs::read_to_string(&default_pricing_path) {
        if let Ok(defaults) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(services) = defaults.get("services").and_then(|v| v.as_object()) {
                for (template_key, price) in services {
                    if let Some(p) = price.as_f64() {
                        let _ = conn.execute(
                            "UPDATE services SET price = ?1, updated_at = ?2 WHERE LOWER(template_key) = LOWER(?3) AND price = 0",
                            rusqlite::params![p, now, template_key],
                        );
                    }
                }
            }
            if let Some(tiers) = defaults.get("tiers").and_then(|v| v.as_object()) {
                for (service_key, layouts) in tiers {
                    if let Some(layouts_obj) = layouts.as_object() {
                        for (layout, price) in layouts_obj {
                            if let Some(p) = price.as_f64() {
                                let _ = conn.execute(
                                    "UPDATE pricing_tiers SET price = ?1, updated_at = ?2 WHERE service_id = (SELECT id FROM services WHERE LOWER(template_key) = LOWER(?3)) AND LOWER(layout) = LOWER(?4) AND price = 0",
                                    rusqlite::params![p, now, service_key, layout],
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn get_materials(app_handle: tauri::AppHandle) -> Result<Vec<Material>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT id, name, unit, current_stock, low_stock_threshold, linked_tab, deduct_per_export, created_at, updated_at FROM materials ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let materials = stmt.query_map([], |row| {
        Ok(Material {
            id: row.get(0)?,
            name: row.get(1)?,
            unit: row.get(2)?,
            current_stock: row.get(3)?,
            low_stock_threshold: row.get(4)?,
            linked_tab: row.get(5)?,
            deduct_per_export: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?
    .filter_map(|r| r.ok()).collect();
    Ok(materials)
}

#[tauri::command]
fn add_material(
    app_handle: tauri::AppHandle,
    name: String,
    unit: String,
    current_stock: f64,
    low_stock_threshold: f64,
    linked_tab: Option<String>,
    deduct_per_export: Option<f64>,
) -> Result<Material, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();
    let deduct = deduct_per_export.unwrap_or(1.0);
    conn.execute(
        "INSERT INTO materials (name, unit, current_stock, low_stock_threshold, linked_tab, deduct_per_export, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![name, unit, current_stock, low_stock_threshold, linked_tab, deduct, now, now],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(Material { id, name, unit, current_stock, low_stock_threshold, linked_tab, deduct_per_export: deduct, created_at: now.clone(), updated_at: now })
}

#[tauri::command]
fn update_material(
    app_handle: tauri::AppHandle,
    id: i64,
    name: String,
    unit: String,
    current_stock: f64,
    low_stock_threshold: f64,
    linked_tab: Option<String>,
    deduct_per_export: Option<f64>,
) -> Result<Material, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();
    let deduct = deduct_per_export.unwrap_or(1.0);
    conn.execute(
        "UPDATE materials SET name = ?1, unit = ?2, current_stock = ?3, low_stock_threshold = ?4, linked_tab = ?5, deduct_per_export = ?6, updated_at = ?7 WHERE id = ?8",
        rusqlite::params![name, unit, current_stock, low_stock_threshold, linked_tab, deduct, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(Material { id, name, unit, current_stock, low_stock_threshold, linked_tab, deduct_per_export: deduct, created_at: now.clone(), updated_at: now })
}

#[tauri::command]
fn delete_material(app_handle: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    conn.execute("DELETE FROM stock_adjustments WHERE material_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM materials WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn restock_material(app_handle: tauri::AppHandle, id: i64, amount: f64) -> Result<Material, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE materials SET current_stock = current_stock + ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![amount, now, id],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO stock_adjustments (material_id, change_amount, reason, created_at) VALUES (?1, ?2, 'Restock', ?3)",
        rusqlite::params![id, amount, now],
    ).map_err(|e| e.to_string())?;
    let mat = conn.query_row(
        "SELECT id, name, unit, current_stock, low_stock_threshold, linked_tab, deduct_per_export, created_at, updated_at FROM materials WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(Material {
            id: row.get(0)?,
            name: row.get(1)?,
            unit: row.get(2)?,
            current_stock: row.get(3)?,
            low_stock_threshold: row.get(4)?,
            linked_tab: row.get(5)?,
            deduct_per_export: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }),
    ).map_err(|e| e.to_string())?;
    Ok(mat)
}

#[tauri::command]
fn adjust_stock(app_handle: tauri::AppHandle, id: i64, amount: f64, reason: Option<String>) -> Result<Material, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE materials SET current_stock = current_stock + ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![amount, now, id],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO stock_adjustments (material_id, change_amount, reason, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, amount, reason, now],
    ).map_err(|e| e.to_string())?;
    let mat = conn.query_row(
        "SELECT id, name, unit, current_stock, low_stock_threshold, linked_tab, deduct_per_export, created_at, updated_at FROM materials WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(Material {
            id: row.get(0)?,
            name: row.get(1)?,
            unit: row.get(2)?,
            current_stock: row.get(3)?,
            low_stock_threshold: row.get(4)?,
            linked_tab: row.get(5)?,
            deduct_per_export: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        }),
    ).map_err(|e| e.to_string())?;
    Ok(mat)
}

#[tauri::command]
fn get_materials_summary(app_handle: tauri::AppHandle) -> Result<MaterialsSummary, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let total: i32 = conn.query_row("SELECT COUNT(*) FROM materials", [], |row| row.get(0)).unwrap_or(0);
    let low_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM materials WHERE current_stock <= low_stock_threshold", [], |row| row.get(0)
    ).unwrap_or(0);
    Ok(MaterialsSummary { total, low_count })
}

#[tauri::command]
fn get_sales(app_handle: tauri::AppHandle, filter: Option<String>) -> Result<Vec<Sale>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;

    let (where_clause, limit): (&str, i32) = match filter.as_deref() {
        Some("today") => ("WHERE created_at >= DATE('now')", 1000),
        Some("week") => ("WHERE created_at >= DATE('now', 'weekday 0', '-6 days')", 1000),
        Some("month") => ("WHERE created_at >= DATE('now', 'start of month')", 1000),
        _ => ("", 1000),
    };

    let sql = format!(
        "SELECT id, source, tab, template_key, amount, quantity, note, activity_log_id, created_at \
         FROM sales {} ORDER BY created_at DESC LIMIT {}",
        where_clause, limit
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let sales = stmt.query_map([], |row| {
        Ok(Sale {
            id: row.get(0)?,
            source: row.get(1)?,
            tab: row.get(2)?,
            template_key: row.get(3)?,
            amount: row.get(4)?,
            quantity: row.get(5)?,
            note: row.get(6)?,
            activity_log_id: row.get(7)?,
            created_at: row.get(8)?,
        })
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();
    Ok(sales)
}

#[tauri::command]
fn add_sale(app_handle: tauri::AppHandle, tab: Option<String>, template_key: Option<String>, amount: f64, quantity: i32, note: Option<String>) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO sales (source, tab, template_key, amount, quantity, note, activity_log_id, created_at) VALUES ('manual', ?1, ?2, ?3, ?4, ?5, NULL, ?6)",
        rusqlite::params![tab, template_key, amount, quantity, note, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_sale(app_handle: tauri::AppHandle, id: i64, tab: Option<String>, template_key: Option<String>, amount: f64, quantity: i32, note: Option<String>) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    conn.execute(
        "UPDATE sales SET tab = ?1, template_key = ?2, amount = ?3, quantity = ?4, note = ?5 WHERE id = ?6",
        rusqlite::params![tab, template_key, amount, quantity, note, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_sale(app_handle: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    conn.execute("DELETE FROM sales WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_sales_summary(app_handle: tauri::AppHandle) -> Result<SalesSummary, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let today_total: f64 = conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM sales WHERE date(created_at) = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).unwrap_or(0.0);
    let today_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sales WHERE date(created_at) = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).unwrap_or(0);
    Ok(SalesSummary { today_total, today_count })
}

#[tauri::command]
fn get_sales_trend(app_handle: tauri::AppHandle, days: u32) -> Result<Vec<SalesTrend>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let offset = format!("-{} days", days);
    let mut stmt = conn.prepare(
        "SELECT DATE(created_at, 'localtime') as date, SUM(amount) as total \
         FROM sales WHERE created_at >= DATE('now', ?1, 'localtime') \
         GROUP BY DATE(created_at, 'localtime') ORDER BY date ASC"
    ).map_err(|e| e.to_string())?;
    let trends = stmt.query_map(rusqlite::params![offset], |row| {
        Ok(SalesTrend {
            date: row.get(0)?,
            total: row.get(1)?,
        })
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();
    Ok(trends)
}

#[tauri::command]
fn get_template_breakdown(app_handle: tauri::AppHandle, days: u32) -> Result<Vec<TemplateBreakdown>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let offset = format!("-{} days", days);
    let mut stmt = conn.prepare(
        "SELECT template_key, amount, quantity \
         FROM sales WHERE created_at >= DATE('now', ?1, 'localtime') AND template_key IS NOT NULL"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<(String, f64, i32)> = stmt.query_map(rusqlite::params![offset], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?, row.get::<_, i32>(2)?))
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();

    use std::collections::HashMap;
    let mut groups: HashMap<&str, (f64, i32)> = HashMap::new();

    for (template_key, amount, quantity) in &rows {
        let revenue = *amount;
        let key = match template_key.to_lowercase().as_str() {
            "1x1" | "dev_1x1" | "multi_1x1" => "Rush ID 1x1",
            "2x2" | "dev_2x2" | "multi_2x2" => "Rush ID 2x2",
            "mixed" | "dev_mixed" | "multi_mixed" => "Rush ID Mixed",
            "passport1" => "Passport",
            "passport2" => "Passport",
            k if k.starts_with("polaroid") => "Polaroid",
            k if k.starts_with("wallet") => "Wallet",
            "3r" | "4r" | "5r" | "8r" => "Other",
            _ => continue,
        };
        let entry = groups.entry(key).or_insert((0.0, 0));
        if template_key.to_lowercase() == "passport2" {
            entry.0 += revenue;
            entry.1 += *quantity * 2;
        } else {
            entry.0 += revenue;
            entry.1 += *quantity;
        }
    }

    let mut breakdowns: Vec<TemplateBreakdown> = groups.into_iter()
        .map(|(key, (total, quantity))| TemplateBreakdown {
            template_key: key.to_string(),
            total,
            quantity,
        })
        .collect();
    breakdowns.sort_by(|a, b| b.total.partial_cmp(&a.total).unwrap_or(std::cmp::Ordering::Equal));
    Ok(breakdowns)
}

#[tauri::command]
fn get_template_hour_heatmap(app_handle: tauri::AppHandle, days: u32) -> Result<Vec<TemplateHourCell>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let offset = format!("-{} days", days);
    let mut stmt = conn.prepare(
        "SELECT s.template_key, COALESCE(sv.display_name, s.template_key) AS display_name, \
         CAST(strftime('%H', s.created_at, 'localtime') AS INTEGER) AS hour, SUM(s.quantity) AS count, \
         SUM(s.amount) AS total \
         FROM sales s \
         LEFT JOIN services sv ON sv.template_key = s.template_key \
         WHERE s.created_at >= DATE('now', ?1, 'localtime') \
         GROUP BY s.template_key, display_name, hour"
    ).map_err(|e| e.to_string())?;
    let cells = stmt.query_map(rusqlite::params![offset], |row| {
        Ok(TemplateHourCell {
            template_key: row.get(0)?,
            display_name: row.get(1)?,
            hour: row.get(2)?,
            count: row.get(3)?,
            total: row.get(4)?,
        })
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();
    Ok(cells)
}

#[tauri::command]
fn get_services(app_handle: tauri::AppHandle) -> Result<Vec<Service>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let mut stmt = conn.prepare(
        "SELECT id, template_key, display_name, price, tab, created_at, updated_at FROM services ORDER BY tab, display_name"
    ).map_err(|e| e.to_string())?;
    let services = stmt.query_map([], |row| {
        Ok(Service {
            id: row.get(0)?,
            template_key: row.get(1)?,
            display_name: row.get(2)?,
            price: row.get(3)?,
            tab: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();
    Ok(services)
}

#[tauri::command]
fn update_service_price(app_handle: tauri::AppHandle, id: i64, price: f64) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE services SET price = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![price, now, id],
    ).map_err(|e| e.to_string())?;
    let template_key: String = conn.query_row(
        "SELECT template_key FROM services WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    ).unwrap_or_default();
    let multi_key = match template_key.to_lowercase().as_str() {
        "1x1" => Some("multi_1x1"),
        "2x2" => Some("multi_2x2"),
        "mixed" => Some("multi_mixed"),
        _ => None,
    };
    if let Some(mk) = multi_key {
        let _ = conn.execute(
            "UPDATE services SET price = ?1, updated_at = ?2 WHERE template_key = ?3",
            rusqlite::params![price, now, mk],
        );
    }
    if template_key.to_lowercase() == "passport1" {
        let _ = conn.execute(
            "UPDATE services SET price = ?1 * 2, updated_at = ?2 WHERE template_key = 'passport2'",
            rusqlite::params![price, now],
        );
    }
    let dev_key = match template_key.to_lowercase().as_str() {
        "1x1" => Some("Dev 1x1"),
        "2x2" => Some("Dev 2x2"),
        "mixed" => Some("Dev Mixed"),
        _ => None,
    };
    if let Some(dk) = dev_key {
        let _ = conn.execute(
            "UPDATE services SET price = ?1, updated_at = ?2 WHERE template_key = ?3",
            rusqlite::params![price, now, dk],
        );
    }
    Ok(())
}

#[tauri::command]
fn export_pricing(app_handle: tauri::AppHandle) -> Result<String, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;

    let mut stmt = conn.prepare(
        "SELECT template_key, price FROM services WHERE price > 0"
    ).map_err(|e| e.to_string())?;
    let services: HashMap<String, f64> = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();

    let mut stmt = conn.prepare(
        "SELECT s.template_key, t.layout, t.price \
         FROM pricing_tiers t JOIN services s ON t.service_id = s.id \
         WHERE t.price > 0"
    ).map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, f64)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })
    .map(|r| r.filter_map(|x| x.ok()).collect())
    .unwrap_or_default();

    let mut tiers: HashMap<String, HashMap<String, f64>> = HashMap::new();
    for (template_key, layout, price) in rows {
        tiers.entry(template_key).or_default().insert(layout, price);
    }

    let export = PricingExport {
        exported_at: Utc::now().to_rfc3339(),
        services,
        tiers,
    };

    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_pricing(app_handle: tauri::AppHandle, json: String) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let now = Utc::now().to_rfc3339();

    let data: serde_json::Value = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    if let Some(services) = data.get("services").and_then(|v| v.as_object()) {
        for (template_key, price) in services {
            if let Some(p) = price.as_f64() {
                let _ = conn.execute(
                    "UPDATE services SET price = ?1, updated_at = ?2 WHERE LOWER(template_key) = LOWER(?3)",
                    rusqlite::params![p, now, template_key],
                );
            }
        }
    }

    if let Some(tiers) = data.get("tiers").and_then(|v| v.as_object()) {
        for (service_key, layouts) in tiers {
            if let Some(layouts_obj) = layouts.as_object() {
                for (layout, price) in layouts_obj {
                    if let Some(p) = price.as_f64() {
                        let _ = conn.execute(
                            "UPDATE pricing_tiers SET price = ?1, updated_at = ?2 WHERE service_id = (SELECT id FROM services WHERE LOWER(template_key) = LOWER(?3)) AND LOWER(layout) = LOWER(?4)",
                            rusqlite::params![p, now, service_key, layout],
                        );
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_services_summary(app_handle: tauri::AppHandle) -> Result<(i32, i32), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;
    let total: i32 = conn.query_row("SELECT COUNT(*) FROM services", [], |row| row.get(0)).unwrap_or(0);
    let priced: i32 = conn.query_row("SELECT COUNT(*) FROM services WHERE price > 0", [], |row| row.get(0)).unwrap_or(0);
    Ok((priced, total))
}

#[tauri::command]
fn get_pricing_tiers(app_handle: tauri::AppHandle, service_id: i64) -> Result<Vec<PricingTier>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, service_id, layout, price, created_at, updated_at
         FROM pricing_tiers
         WHERE service_id = ?1
         ORDER BY
           CAST(REPLACE(layout, 'pcs', '') AS INTEGER),
           layout"
    ).map_err(|e| e.to_string())?;

    let tiers = stmt.query_map(rusqlite::params![service_id], |row| {
        Ok(PricingTier {
            id: row.get(0)?,
            service_id: row.get(1)?,
            layout: row.get(2)?,
            price: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    Ok(tiers)
}

#[tauri::command]
fn update_pricing_tier(app_handle: tauri::AppHandle, id: i64, price: f64) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE pricing_tiers SET price = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![price, now, id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn add_pricing_tier(
    app_handle: tauri::AppHandle,
    service_id: i64,
    layout: String,
    price: f64
) -> Result<i64, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO pricing_tiers (service_id, layout, price, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        rusqlite::params![service_id, layout, price, now],
    ).map_err(|e| e.to_string())?;

    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn delete_pricing_tier(app_handle: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM pricing_tiers WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[derive(Debug, Serialize)]
struct Resume {
    id: i64,
    full_name: String,
    template_key: String,
    data_json: String,
    docx_path: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct ResumeSummary {
    id: i64,
    full_name: String,
    template_key: String,
    updated_at: String,
}

#[tauri::command]
fn create_resume(app_handle: tauri::AppHandle, data_json: String, template_key: String, full_name: String) -> Result<i64, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO resumes (full_name, template_key, data_json, docx_path, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
        rusqlite::params![full_name, template_key, data_json, now],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn update_resume(app_handle: tauri::AppHandle, id: i64, data_json: String, template_key: String, full_name: String) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE resumes SET full_name = ?1, template_key = ?2, data_json = ?3, updated_at = ?4 WHERE id = ?5",
        rusqlite::params![full_name, template_key, data_json, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_resume(app_handle: tauri::AppHandle, id: i64) -> Result<Resume, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT id, full_name, template_key, data_json, docx_path, created_at, updated_at FROM resumes WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(Resume {
            id: row.get(0)?,
            full_name: row.get(1)?,
            template_key: row.get(2)?,
            data_json: row.get(3)?,
            docx_path: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_resumes(app_handle: tauri::AppHandle) -> Result<Vec<ResumeSummary>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, full_name, template_key, updated_at FROM resumes ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(ResumeSummary {
        id: row.get(0)?,
        full_name: row.get(1)?,
        template_key: row.get(2)?,
        updated_at: row.get(3)?,
    })).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

#[tauri::command]
fn delete_resume(app_handle: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM resumes WHERE id = ?1", rusqlite::params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_key_count(app_handle: tauri::AppHandle) -> Result<usize, String> {
    let config = load_config(&app_handle)?;
    Ok(config.api_keys.poof.len() + config.api_keys.removebg.len())
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    } else {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn print_file(app_handle: tauri::AppHandle, svg_path: String, tab: String) -> Result<String, String> {
    let tmp_dir = data_dir(&app_handle).join("tmp");
    let patched_svg = patch_svg_path(&app_handle, &svg_path)?;
    let svg_content = fs::read_to_string(&patched_svg)
        .map_err(|e| format!("Failed to read SVG: {}", e))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let temp_pdf = std::env::temp_dir().join(format!("rush_id_print_{}.pdf", ts));

    let pdf_bytes = svg_to_pdf(&svg_content, &tmp_dir)?;
    fs::write(&temp_pdf, &pdf_bytes).map_err(|e| format!("Failed to write temp PDF: {}", e))?;

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", temp_pdf.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    } else {
        Command::new("xdg-open")
            .arg(&temp_pdf)
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    }

    let log_id = log_activity(&app_handle, "pdf_export", &tab, 1);
    deduct_materials_for_export(&app_handle, &tab, 1);
    let template_key = Path::new(&svg_path).file_stem().unwrap_or_default().to_string_lossy().to_string();
    auto_create_sale(&app_handle, &tab, &template_key, 1, log_id, None);
    Ok("PDF opened in viewer. Press Ctrl+P to print.".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientSlot {
    image_base64: String,
    svg_path: String,
}

fn merge_pdfs(pages: Vec<Vec<u8>>) -> Result<Vec<u8>, String> {
    use lopdf::{Document, Object, ObjectId, dictionary};
    use std::collections::BTreeMap;

    if pages.len() == 1 {
        return Ok(pages.into_iter().next().unwrap());
    }

    let documents: Vec<Document> = pages
        .into_iter()
        .map(|bytes| Document::load_mem(&bytes).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;

    let mut merged = Document::with_version("1.5");
    let pages_id = merged.new_object_id();

    let mut max_id = pages_id.0;
    let mut pages_kids: Vec<Object> = Vec::new();
    let mut all_page_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();
    let mut all_other_objects: BTreeMap<ObjectId, Object> = BTreeMap::new();

    for mut doc in documents {
        doc.renumber_objects_with(max_id + 1);
        max_id = doc.max_id + 1;

        let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();

        all_other_objects.extend(doc.objects);

        for id in page_ids {
            pages_kids.push(Object::Reference(id));
            if let Some(obj) = all_other_objects.remove(&id) {
                all_page_objects.insert(id, obj);
            }
        }
    }

    merged.max_id = max_id;

    for (id, mut obj) in all_page_objects {
        if let Ok(dict) = obj.as_dict_mut() {
            dict.set("Parent", Object::Reference(pages_id));
        }
        merged.objects.insert(id, obj);
    }

    for (id, obj) in all_other_objects {
        merged.objects.insert(id, obj);
    }

    let count = pages_kids.len() as i64;
    merged.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type"  => "Pages",
            "Kids"  => pages_kids,
            "Count" => count,
        }),
    );

    let catalog_id = merged.add_object(dictionary! {
        "Type"  => "Catalog",
        "Pages" => Object::Reference(pages_id),
    });
    merged.trailer.set("Root", Object::Reference(catalog_id));

    let mut out: Vec<u8> = Vec::new();
    merged.save_to(&mut out).map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
fn composite_multi_pdf(app_handle: tauri::AppHandle, clients: Vec<ClientSlot>, save_path: Option<String>, tab: String) -> Result<String, String> {
    let d = data_dir(&app_handle);
    let tmp_dir = d.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create tmp dir: {}", e))?;
    app_handle.emit("batch_progress", serde_json::json!({ "msg": format!("Starting export — {} client(s)", clients.len()) })).ok();

    let _ = fs::remove_file(tmp_dir.join("composite_multi.svg"));
    if let Ok(entries) = fs::read_dir(&tmp_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("client_") && name_str.ends_with(".svg") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
    if let Ok(entries) = fs::read_dir(&d) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("client_") && name_str.ends_with(".png") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    // Determine per-client slot heights from their individual template SVGs
    let slot_heights: Vec<f64> = clients.iter().map(|c| {
        let svg = fs::read_to_string(&c.svg_path).unwrap_or_default();
        parse_svg_height(&svg)
    }).collect();

    // Phase 1: Resize all client images and patch SVGs (unchanged, runs over ALL clients)
    for (i, client) in clients.iter().enumerate() {
        let pic_name = format!("client_{}.png", i);
        let pic_path = d.join(&pic_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&client.image_base64)
            .map_err(|e| format!("Base64 decode error for client {}: {}", i, e))?;
        let bytes = resize_if_needed(&bytes);
        fs::write(&pic_path, &bytes).map_err(|e| format!("Failed to write {}: {}", pic_name, e))?;

        let svg_raw = fs::read_to_string(&client.svg_path)
            .map_err(|e| format!("Failed to read SVG for client {}: {}", i, e))?;
        let patched = svg_raw.replace("../picture.png", &format!("../client_{}.png", i));

        let temp_svg = tmp_dir.join(format!("client_{}.svg", i));
        fs::write(&temp_svg, &patched).map_err(|e| format!("Failed to write client SVG {}: {}", i, e))?;
    }
    app_handle.emit("batch_progress", serde_json::json!({ "msg": format!("Resized {} image(s)", clients.len()) })).ok();

    // Phase 2: Dynamically chunk clients by A4 height, render each chunk as a separate PDF
    let mut page_bytes: Vec<Vec<u8>> = Vec::new();

    let mut chunk_indices: Vec<usize> = Vec::new();
    let mut chunk_height_mm = 0.0_f64;
    let mut all_chunks: Vec<(Vec<usize>, f64)> = Vec::new();

    for (i, &h) in slot_heights.iter().enumerate() {
        if !chunk_indices.is_empty() && chunk_height_mm + h > 297.0 {
            all_chunks.push((std::mem::take(&mut chunk_indices), chunk_height_mm));
            chunk_height_mm = 0.0;
        }
        chunk_indices.push(i);
        chunk_height_mm += h;
    }
    if !chunk_indices.is_empty() {
        all_chunks.push((chunk_indices, chunk_height_mm));
    }

    for (_chunk_idx, (chunk, chunk_h)) in all_chunks.iter().enumerate() {
        let mut inner = String::new();
        let mut y_mm = 0.0_f64;

        for &global_i in chunk {
            let temp_svg = tmp_dir.join(format!("client_{}.svg", global_i));
            let raw = fs::read_to_string(&temp_svg)
                .map_err(|e| format!("Failed to read patched SVG: {}", e))?;

            let mut slot = raw.trim().to_string();
            while let Some(cs) = slot.find("<!--") {
                if let Some(ce) = slot[cs..].find("-->") {
                    slot.drain(cs..=cs + ce + 2);
                } else {
                    break;
                }
            }
            if let Some(start) = slot.find("<?xml") {
                if let Some(end) = slot[start..].find("?>") {
                    slot.drain(start..=start + end + 2);
                }
            }

            let open_tag = slot.find("<svg").unwrap_or(0);
            let after_open = &slot[open_tag..];
            let close_angle = after_open.find('>').unwrap_or(0);
            let insert_at = open_tag + close_angle;
            let slot_with_y = format!("{} y=\"{:.1}mm\"{}", &slot[..insert_at], y_mm, &slot[insert_at..]);

            inner.push_str(&slot_with_y);
            y_mm += parse_svg_height(&raw);
        }

        let composite = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="210mm" height="{:.1}mm">{}</svg>"#, chunk_h,
            inner
        );

        let composite_path = tmp_dir.join("composite_multi.svg");
        fs::write(&composite_path, &composite).map_err(|e| format!("Failed to write composite SVG: {}", e))?;

        let pdf_bytes = svg_to_pdf(&composite, &tmp_dir)?;
        page_bytes.push(pdf_bytes);
    }

    // Phase 3: Merge pages and output
    let final_pdf = merge_pdfs(page_bytes)?;

    let pdf_path = match save_path {
        Some(ref path) => {
            let p = PathBuf::from(path);
            let with_ext = if p.extension().is_none_or(|e| e != "pdf") {
                p.with_extension("pdf")
            } else {
                p
            };
            with_ext
        }
        None => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            std::env::temp_dir().join(format!("rush_id_print_{}.pdf", ts))
        }
    };

    fs::write(&pdf_path, &final_pdf).map_err(|e| format!("Failed to write PDF: {}", e))?;
    app_handle.emit("batch_progress", serde_json::json!({ "msg": "PDF ready" })).ok();

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", pdf_path.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    } else {
        Command::new("xdg-open")
            .arg(&pdf_path)
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    }

    let log_id = log_activity(&app_handle, "pdf_export", &tab, all_chunks.len() as i32);
    deduct_materials_for_export(&app_handle, &tab, all_chunks.len() as i32);
    let mut template_groups: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    for client in &clients {
        let stem = Path::new(&client.svg_path).file_stem().unwrap_or_default().to_string_lossy().to_string();
        *template_groups.entry(stem).or_insert(0) += 1;
    }
    for (template_key, qty) in &template_groups {
        auto_create_sale(&app_handle, &tab, template_key, *qty, log_id, None);
    }
    let msg = if save_path.is_some() { "PDF saved" } else { "Composite PDF opened in viewer. Press Ctrl+P to print." };
    Ok(msg.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolaroidSlot {
    image_base64: String,
}

#[tauri::command]
fn composite_polaroid_pdf(
    app_handle: tauri::AppHandle,
    layout: String,
    slots: Vec<PolaroidSlot>,
    save_path: Option<String>,
    tab: String,
) -> Result<String, String> {
    let d = data_dir(&app_handle);
    let tmp_dir = d.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create tmp dir: {}", e))?;

    if let Ok(entries) = fs::read_dir(&d) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("polaroid_") && name_str.ends_with(".png") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    let res = resource_dir(&app_handle);
    let svg_name = match layout.as_str() {
        "2pcs" => "Polaroid 2pcs.svg",
        "3pcs" => "Polaroid 3pcs.svg",
        "10pcs" | "20pcs" | "30pcs" => "Polaroid 10pcs.svg",
        _ => "Polaroid 5pcs.svg",
    };
    let svg_path = res.join("SVGs").join(svg_name);
    let svg_raw = fs::read_to_string(&svg_path)
        .map_err(|e| format!("Failed to read SVG template: {}", e))?;

    let slot_height = parse_svg_height(&svg_raw);

    let images_per_svg = svg_raw.matches("xlink:href=\"").count();
    if images_per_svg == 0 {
        return Err("SVG template has no image references".to_string());
    }

    for (i, slot) in slots.iter().enumerate() {
        let pic_name = format!("polaroid_{}.png", i + 1);
        let pic_path = d.join(&pic_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&slot.image_base64)
            .map_err(|e| format!("Base64 decode error for slot {}: {}", i, e))?;
        fs::write(&pic_path, &bytes).map_err(|e| format!("Failed to write {}: {}", pic_name, e))?;
    }

    let mut all_svg_strings: Vec<String> = Vec::new();
    for batch_start in (0..slots.len()).step_by(images_per_svg) {
        let mut patched = svg_raw.clone();
        for j in 0..images_per_svg {
            let slot_idx = batch_start + j;
            if slot_idx >= slots.len() {
                break;
            }
            let svg_slot = j + 1;
            let bare_href = format!("polaroid{}.png", svg_slot);
            let rel_href = format!("../polaroid_{}.png", slot_idx + 1);
            patched = patched.replace(
                &format!("xlink:href=\"{}\"", bare_href),
                &format!("xlink:href=\"{}\"", rel_href),
            );
            patched = patched.replace(
                &format!("href=\"{}\"", bare_href),
                &format!("href=\"{}\"", rel_href),
            );
        }
        all_svg_strings.push(patched);
    }

    let mut page_bytes: Vec<Vec<u8>> = Vec::new();
    let mut chunk_indices: Vec<usize> = Vec::new();
    let mut chunk_height_mm = 0.0_f64;
    let mut all_chunks: Vec<(Vec<usize>, f64)> = Vec::new();

    for (i, _) in all_svg_strings.iter().enumerate() {
        if !chunk_indices.is_empty() && chunk_height_mm + slot_height > 297.0 {
            all_chunks.push((std::mem::take(&mut chunk_indices), chunk_height_mm));
            chunk_height_mm = 0.0;
        }
        chunk_indices.push(i);
        chunk_height_mm += slot_height;
    }
    if !chunk_indices.is_empty() {
        all_chunks.push((chunk_indices, chunk_height_mm));
    }

    for (_chunk_idx, (chunk, chunk_h)) in all_chunks.iter().enumerate() {
        let mut inner = String::new();
        let mut y_mm = 0.0_f64;

        for &global_i in chunk {
            let raw_svg = &all_svg_strings[global_i];
            let mut slot_svg = raw_svg.trim().to_string();

            while let Some(cs) = slot_svg.find("<!--") {
                if let Some(ce) = slot_svg[cs..].find("-->") {
                    slot_svg.drain(cs..=cs + ce + 2);
                } else {
                    break;
                }
            }
            if let Some(start) = slot_svg.find("<?xml") {
                if let Some(end) = slot_svg[start..].find("?>") {
                    slot_svg.drain(start..=start + end + 2);
                }
            }

            let open_tag = slot_svg.find("<svg").unwrap_or(0);
            let after_open = &slot_svg[open_tag..];
            let close_angle = after_open.find('>').unwrap_or(0);
            let insert_at = open_tag + close_angle;
            let slot_with_y = format!("{} y=\"{:.1}mm\"{}", &slot_svg[..insert_at], y_mm, &slot_svg[insert_at..]);

            inner.push_str(&slot_with_y);
            y_mm += slot_height;
        }

        let composite = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="210mm" height="{:.1}mm">{}</svg>"#, chunk_h,
            inner
        );

        let composite_path = tmp_dir.join("polaroid_composite.svg");
        fs::write(&composite_path, &composite).map_err(|e| format!("Failed to write composite SVG: {}", e))?;

        let pdf_bytes = svg_to_pdf(&composite, &tmp_dir)?;
        page_bytes.push(pdf_bytes);
    }

    let final_pdf = merge_pdfs(page_bytes)?;

    let pdf_path = match save_path {
        Some(ref path) => {
            let p = PathBuf::from(path);
            if p.extension().is_none_or(|e| e != "pdf") { p.with_extension("pdf") } else { p }
        }
        None => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            std::env::temp_dir().join(format!("rush_id_print_{}.pdf", ts))
        }
    };

    fs::write(&pdf_path, &final_pdf).map_err(|e| format!("Failed to write PDF: {}", e))?;

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", pdf_path.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    } else {
        Command::new("xdg-open")
            .arg(&pdf_path)
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    }

    let log_id = log_activity(&app_handle, "pdf_export", &tab, all_chunks.len() as i32);
    deduct_materials_for_export(&app_handle, &tab, all_chunks.len() as i32);
    let template_key = svg_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    auto_create_sale(&app_handle, &tab, &template_key, 1, log_id, None);
    let msg = if save_path.is_some() { "PDF saved" } else { "Polaroid PDF opened in viewer. Press Ctrl+P to print." };
    Ok(msg.to_string())
}

#[tauri::command]
fn composite_other_pdf(
    app_handle: tauri::AppHandle,
    size: String,
    layout: Option<String>,
    _slot_count: usize,
    slots: Vec<PolaroidSlot>,
    save_path: Option<String>,
    sources: Option<Vec<String>>,
    tab: String,
) -> Result<String, String> {
    let d = data_dir(&app_handle);
    let res = resource_dir(&app_handle);
    let tmp_dir = d.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create tmp dir: {}", e))?;

    if let Ok(entries) = fs::read_dir(&d) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("other_") && name_str.ends_with(".png") {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    for (i, slot) in slots.iter().enumerate() {
        let pic_name = format!("other_{}.png", i + 1);
        let pic_path = d.join(&pic_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&slot.image_base64)
            .map_err(|e| format!("Base64 decode error for slot {}: {}", i, e))?;
        fs::write(&pic_path, &bytes).map_err(|e| format!("Failed to write {}: {}", pic_name, e))?;
    }

    let mut all_svg_strings: Vec<String> = Vec::new();
    let mut slot_heights: Vec<f64> = Vec::new();

    if let Some(ref source_list) = sources {
        let mut slot_offset = 0;
        for source_name in source_list {
            let source_path = res.join("SVGs").join(source_name);
            if !source_path.exists() {
                return Err(format!("SVG template not found: {}", source_name));
            }
            let source_raw = fs::read_to_string(&source_path)
                .map_err(|e| format!("Failed to read SVG {}: {}", source_name, e))?;
            slot_heights.push(parse_svg_height(&source_raw));
            let images_in_source = source_raw.matches("xlink:href=\"").count();
            if images_in_source == 0 {
                return Err(format!("SVG template has no image references: {}", source_name));
            }
            let mut patched = source_raw.clone();
            for j in 0..images_in_source {
                let slot_idx = slot_offset + j;
                if slot_idx >= slots.len() {
                    break;
                }
                let bare_href = format!("{}{}.png", size, j + 1);
                let rel_href = format!("../other_{}.png", slot_idx + 1);
                patched = patched.replace(
                    &format!("xlink:href=\"{}\"", bare_href),
                    &format!("xlink:href=\"{}\"", rel_href),
                );
                patched = patched.replace(
                    &format!("href=\"{}\"", bare_href),
                    &format!("href=\"{}\"", rel_href),
                );
            }
            all_svg_strings.push(patched);
            slot_offset += images_in_source;
        }
    } else {
        let svg_name = match (size.as_str(), layout.as_deref()) {
            ("wallet", Some("18pcs" | "27pcs")) => "wallet9pcs.svg".to_string(),
            (_, Some(l)) => format!("{}{}.svg", size, l),
            _ => format!("{}.svg", size),
        };
        let svg_path = res.join("SVGs").join(&svg_name);
        if !svg_path.exists() {
            return Err(format!("SVG template not found: {}", svg_name));
        }
        let svg_raw = fs::read_to_string(&svg_path)
            .map_err(|e| format!("Failed to read SVG {}: {}", svg_name, e))?;
        let svg_height = parse_svg_height(&svg_raw);
        let images_per_svg = svg_raw.matches("xlink:href=\"").count();
        if images_per_svg == 0 {
            return Err("SVG template has no image references".to_string());
        }
        for batch_start in (0..slots.len()).step_by(images_per_svg) {
            let mut patched = svg_raw.clone();
            for j in 0..images_per_svg {
                let slot_idx = batch_start + j;
                if slot_idx >= slots.len() {
                    break;
                }
                let svg_slot = j + 1;
                let bare_href = format!("{}{}.png", size, svg_slot);
                let rel_href = format!("../other_{}.png", slot_idx + 1);
                patched = patched.replace(
                    &format!("xlink:href=\"{}\"", bare_href),
                    &format!("xlink:href=\"{}\"", rel_href),
                );
                patched = patched.replace(
                    &format!("href=\"{}\"", bare_href),
                    &format!("href=\"{}\"", rel_href),
                );
            }
            all_svg_strings.push(patched);
            slot_heights.push(svg_height);
        }
    }

    let mut page_bytes: Vec<Vec<u8>> = Vec::new();
    let mut chunk_indices: Vec<usize> = Vec::new();
    let mut chunk_height_mm = 0.0_f64;
    let mut all_chunks: Vec<(Vec<usize>, f64)> = Vec::new();

    for (i, _) in all_svg_strings.iter().enumerate() {
        let h = slot_heights[i];
        if !chunk_indices.is_empty() && chunk_height_mm + h > 297.0 {
            all_chunks.push((std::mem::take(&mut chunk_indices), chunk_height_mm));
            chunk_height_mm = 0.0;
        }
        chunk_indices.push(i);
        chunk_height_mm += h;
    }
    if !chunk_indices.is_empty() {
        all_chunks.push((chunk_indices, chunk_height_mm));
    }

    for (_chunk_idx, (chunk, chunk_h)) in all_chunks.iter().enumerate() {
        let mut inner = String::new();
        let mut y_mm = 0.0_f64;

        for &global_i in chunk {
            let raw_svg = &all_svg_strings[global_i];
            let mut slot_svg = raw_svg.trim().to_string();

            while let Some(cs) = slot_svg.find("<!--") {
                if let Some(ce) = slot_svg[cs..].find("-->") {
                    slot_svg.drain(cs..=cs + ce + 2);
                } else {
                    break;
                }
            }
            if let Some(start) = slot_svg.find("<?xml") {
                if let Some(end) = slot_svg[start..].find("?>") {
                    slot_svg.drain(start..=start + end + 2);
                }
            }

            let open_tag = slot_svg.find("<svg").unwrap_or(0);
            let after_open = &slot_svg[open_tag..];
            let close_angle = after_open.find('>').unwrap_or(0);
            let insert_at = open_tag + close_angle;
            let slot_with_y = format!("{} y=\"{:.1}mm\"{}", &slot_svg[..insert_at], y_mm, &slot_svg[insert_at..]);

            inner.push_str(&slot_with_y);
            y_mm += slot_heights[global_i];
        }

        let composite = format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="210mm" height="{:.1}mm">{}</svg>"#, chunk_h,
            inner
        );

        let composite_path = tmp_dir.join("composite_other.svg");
        fs::write(&composite_path, &composite).map_err(|e| format!("Failed to write composite SVG: {}", e))?;

        let pdf_bytes = svg_to_pdf(&composite, &tmp_dir)?;
        page_bytes.push(pdf_bytes);
    }

    let final_pdf = merge_pdfs(page_bytes)?;

    let pdf_path = match save_path {
        Some(ref path) => {
            let p = PathBuf::from(path);
            if p.extension().is_none_or(|e| e != "pdf") {
                p.with_extension("pdf")
            } else {
                p
            }
        }
        None => {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            std::env::temp_dir().join(format!("rush_id_print_{}.pdf", ts))
        }
    };

    fs::write(&pdf_path, &final_pdf).map_err(|e| format!("Failed to write PDF: {}", e))?;

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", pdf_path.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    } else {
        Command::new("xdg-open")
            .arg(&pdf_path)
            .spawn()
            .map_err(|e| format!("Failed to open PDF viewer: {}", e))?;
    }

    let log_id = log_activity(&app_handle, "pdf_export", &tab, all_chunks.len() as i32);
    deduct_materials_for_export(&app_handle, &tab, all_chunks.len() as i32);
    let template_key = if size == "4r" || size == "wallet" {
        size.to_string()
    } else {
        match &sources {
            Some(s) if !s.is_empty() => Path::new(&s[0]).file_stem().unwrap_or_default().to_string_lossy().to_string(),
            _ => format!("{}_{}", size, layout.as_deref().unwrap_or("default")),
        }
    };
    auto_create_sale(&app_handle, &tab, &template_key, 1, log_id, layout.as_deref());
    let msg = if save_path.is_some() { "PDF saved" } else { "Other PDF opened in viewer. Press Ctrl+P to print." };
    Ok(msg.to_string())
}

#[derive(Serialize)]
struct ActivityStats {
    pdf_exports: i32,
    print_reminders: i32,
    total_pages: i32,
    multi_page_batches: i32,
}

#[derive(Serialize)]
struct ActivityEntry {
    id: i32,
    event_type: String,
    tab: String,
    page_count: i32,
    created_at: String,
}

#[tauri::command]
fn get_activity_stats(app_handle: tauri::AppHandle) -> Result<ActivityStats, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;

    let today = Utc::now().format("%Y-%m-%d").to_string();

    let pdf_exports: i32 = conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE event_type = 'pdf_export' AND date(created_at) = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).unwrap_or(0);

    let print_reminders: i32 = conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE event_type = 'print_reminder_shown' AND date(created_at) = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).unwrap_or(0);

    let total_pages: i32 = conn.query_row(
        "SELECT COALESCE(SUM(page_count), 0) FROM activity_log WHERE event_type = 'pdf_export' AND date(created_at) = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).unwrap_or(0);

    let multi_page_batches: i32 = conn.query_row(
        "SELECT COUNT(*) FROM activity_log WHERE event_type = 'pdf_export' AND page_count > 1 AND date(created_at) = ?1",
        rusqlite::params![today],
        |row| row.get(0),
    ).unwrap_or(0);

    Ok(ActivityStats { pdf_exports, print_reminders, total_pages, multi_page_batches })
}

#[tauri::command]
fn get_recent_activity(app_handle: tauri::AppHandle, limit: Option<usize>) -> Result<Vec<ActivityEntry>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path)
        .map_err(|e| format!("Failed to open activity.db: {}", e))?;

    let limit = limit.unwrap_or(15) as i32;
    let mut stmt = conn.prepare(
        "SELECT id, event_type, tab, page_count, created_at FROM activity_log ORDER BY id DESC LIMIT ?1"
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt.query_map(rusqlite::params![limit], |row| {
        Ok(ActivityEntry {
            id: row.get(0)?,
            event_type: row.get(1)?,
            tab: row.get(2)?,
            page_count: row.get(3)?,
            created_at: row.get(4)?,
        })
    }).map_err(|e| format!("Failed to query activity: {}", e))?;

    let entries = rows.filter_map(|r| r.ok()).collect();
    Ok(entries)
}

#[derive(Debug, Serialize)]
struct ConvertFailed {
    file: String,
    reason: String,
}

#[derive(Debug, Serialize)]
struct BatchSummary {
    total: usize,
    succeeded: usize,
    failed: Vec<ConvertFailed>,
    batch_dir: String,
}

#[tauri::command]
fn convert_images_batch(
    app_handle: tauri::AppHandle,
    source_paths: Vec<String>,
    target_format: String,
    dest_parent: String,
) -> Result<BatchSummary, String> {
    if source_paths.is_empty() {
        return Err("No source files provided".to_string());
    }
    let fmt = target_format.to_lowercase();
    let (target_ext, target_label) = match fmt.as_str() {
        "png" => ("png", "png"),
        "jpeg" | "jpg" => ("jpg", "jpeg"),
        "webp" => ("webp", "webp"),
        _ => return Err(format!("Unsupported target format: {}", target_format)),
    };

    let dest_parent_path = PathBuf::from(&dest_parent);
    if !dest_parent_path.exists() {
        return Err(format!("Destination folder does not exist: {}", dest_parent));
    }
    if !dest_parent_path.is_dir() {
        return Err(format!("Destination is not a directory: {}", dest_parent));
    }

    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let batch_dir = dest_parent_path.join(format!("batch-convert-{}", ts));
    fs::create_dir_all(&batch_dir).map_err(|e| format!("Failed to create batch folder: {}", e))?;

    let total = source_paths.len();
    let mut succeeded = 0usize;
    let mut failed: Vec<ConvertFailed> = Vec::new();
    let mut used_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (idx, src) in source_paths.iter().enumerate() {
        let src_path = Path::new(src);
        let file_name = src_path.file_name().unwrap_or_default().to_string_lossy().to_string();

        let reason: Option<String>;
        let mut out_path: Option<PathBuf> = None;

        // Collision-safe output name
        let stem = src_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let base = if stem.is_empty() { "image".to_string() } else { stem };
        let mut candidate = format!("{}.{}", base, target_ext);
        let mut counter = 1;
        let candidate_lower = candidate.to_lowercase();
        if used_names.contains(&candidate_lower) {
            loop {
                let c = format!("{}-{}.{}", base, counter, target_ext);
                if !used_names.contains(&c.to_lowercase()) {
                    candidate = c;
                    break;
                }
                counter += 1;
                if counter > 1000 { break; }
            }
        }
        used_names.insert(candidate.to_lowercase());
        let dest_path = batch_dir.join(&candidate);

        // Decode + encode
        let result: Result<(), String> = (|| {
            let img = image::open(src_path).map_err(|e| e.to_string())?;
            let file = std::fs::File::create(&dest_path).map_err(|e| e.to_string())?;
            let mut writer = std::io::BufWriter::new(file);
            match target_label {
                "png" => {
                    let rgba = img.to_rgba8();
                    let (w, h) = (rgba.width(), rgba.height());
                    let encoder = image::codecs::png::PngEncoder::new(&mut writer);
                    encoder
                        .write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
                        .map_err(|e| e.to_string())?;
                }
                "jpeg" => {
                    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 90);
                    encoder.encode_image(&img).map_err(|e| e.to_string())?;
                }
                "webp" => {
                    // image 0.25 WebP encoder is lossless; quality param not exposed — best-effort lossless
                    let rgba = img.to_rgba8();
                    let (w, h) = (rgba.width(), rgba.height());
                    let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut writer);
                    encoder
                        .write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
                        .map_err(|e| e.to_string())?;
                }
                _ => unreachable!(),
            }
            Ok(())
        })();

        match result {
            Ok(_) => {
                succeeded += 1;
                out_path = Some(dest_path);
                reason = None;
            }
            Err(e) => {
                reason = Some(e);
                failed.push(ConvertFailed { file: file_name.clone(), reason: reason.clone().unwrap() });
                // Clean partial output if any
                if let Some(p) = &out_path {
                    let _ = fs::remove_file(p);
                } else {
                    let _ = fs::remove_file(&dest_path);
                }
            }
        }

        let done = idx + 1;
        let ok = reason.is_none();
        app_handle
            .emit(
                "convert_progress",
                serde_json::json!({
                    "done": done,
                    "total": total,
                    "current": src,
                    "file": file_name,
                    "ok": ok,
                    "error": reason,
                    "output": out_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                }),
            )
            .ok();
    }

    Ok(BatchSummary {
        total,
        succeeded,
        failed,
        batch_dir: batch_dir.to_string_lossy().to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    cleanup_temp_pdfs();
    tauri::Builder::default()
        .setup(|app| {
            init_activity_db(&app.handle())?;
            seed_services_from_svg(&app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_config,
            save_config,
            get_config,
            update_config,
            get_svg_templates,
            remove_bg,
            write_picture,
            export_pdf,
            print_file,
            composite_multi_pdf,
            composite_polaroid_pdf,
            composite_other_pdf,
             get_key_count,
              open_file,
              log_print_reminder,
              get_activity_stats,
              get_recent_activity,
              get_materials,
              add_material,
              update_material,
              delete_material,
              restock_material,
              adjust_stock,
               get_materials_summary,
               get_sales,
               add_sale,
               update_sale,
               delete_sale,
               get_sales_summary,
                get_sales_trend,
                get_template_breakdown,
                get_template_hour_heatmap,
                get_services,
                 update_service_price,
                 export_pricing,
                 write_file,
                 read_file,
                 import_pricing,
                 get_services_summary,
                get_pricing_tiers,
                update_pricing_tier,
                add_pricing_tier,
                delete_pricing_tier,
                convert_images_batch,
                create_resume,
                update_resume,
                get_resume,
                list_resumes,
                delete_resume,
         ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
