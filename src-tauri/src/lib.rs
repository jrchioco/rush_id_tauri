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
            pdf_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_resumes_updated_at ON resumes(updated_at);",
    )
    .map_err(|e| format!("Failed to create activity_log table: {}", e))?;

    let _ = conn.execute("ALTER TABLE resumes ADD COLUMN pdf_path TEXT", []);

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
fn write_temp_photo(app_handle: tauri::AppHandle, base64: String, file_name: String) -> Result<String, String> {
    let dir = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = file_name.split('.').next().unwrap_or("photo");
    let safe: String = stem.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect();
    let ts = chrono::Utc::now().format("%Y%m%d%H%M%S").to_string();
    let path = dir.join(format!("resume_photo_{}_{}.png", safe, ts));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
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
    pdf_path: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
struct ResumeSummary {
    id: i64,
    full_name: String,
    template_key: String,
    updated_at: String,
    docx_path: Option<String>,
    pdf_path: Option<String>,
}

#[tauri::command]
fn create_resume(app_handle: tauri::AppHandle, data_json: String, template_key: String, full_name: String) -> Result<i64, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO resumes (full_name, template_key, data_json, docx_path, pdf_path, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?4)",
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
        "SELECT id, full_name, template_key, data_json, docx_path, pdf_path, created_at, updated_at FROM resumes WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok(Resume {
            id: row.get(0)?,
            full_name: row.get(1)?,
            template_key: row.get(2)?,
            data_json: row.get(3)?,
            docx_path: row.get(4)?,
            pdf_path: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        }),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_resumes(app_handle: tauri::AppHandle) -> Result<Vec<ResumeSummary>, String> {
    let path = activity_db_path(&app_handle);
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, full_name, template_key, updated_at, docx_path, pdf_path FROM resumes ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| Ok(ResumeSummary {
        id: row.get(0)?,
        full_name: row.get(1)?,
        template_key: row.get(2)?,
        updated_at: row.get(3)?,
        docx_path: row.get(4)?,
        pdf_path: row.get(5)?,
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

#[derive(Debug, Deserialize)]
struct ResumeGenerateRequest {
    full_name: String,
    contact: Option<ContactInfo>,
    summary: Option<String>,
    education: Option<Vec<EducationEntry>>,
    experience: Option<Vec<ExperienceEntry>>,
    skills: Option<Vec<String>>,
    certifications: Option<Vec<CertificationEntry>>,
    #[serde(alias = "photoPath")]
    photo_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ContactInfo {
    #[serde(default)]
    phone: Option<String>,
    #[serde(default)]
    phones: Option<Vec<String>>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    emails: Option<Vec<String>>,
    address: Option<String>,
    linkedin: Option<String>,
}
impl ContactInfo {
    fn all_phones(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        if let Some(p) = &self.phone { let t = p.trim().to_string(); if !t.is_empty() && seen.insert(t.clone()) { out.push(t); } }
        if let Some(ps) = &self.phones { for p in ps { let t = p.trim().to_string(); if !t.is_empty() && seen.insert(t.clone()) { out.push(t); } } }
        out
    }
    fn all_emails(&self) -> Vec<String> {
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        if let Some(e) = &self.email { let t = e.trim().to_string(); if !t.is_empty() && seen.insert(t.clone()) { out.push(t); } }
        if let Some(es) = &self.emails { for e in es { let t = e.trim().to_string(); if !t.is_empty() && seen.insert(t.clone()) { out.push(t); } } }
        out
    }
}

#[derive(Debug, Deserialize)]
struct EducationEntry {
    school: String,
    degree: String,
    year: String,
}

#[derive(Debug, Deserialize)]
struct ExperienceEntry {
    company: String,
    role: String,
    start_date: String,
    end_date: String,
    bullets: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CertificationEntry {
    name: String,
    issuer: String,
    year: String,
}

const INK: &str = "1F2937";
const ACCENT: &str = "2563EB";
const MUTED_META: &str = "444444";
const MUTED_SUBTITLE: &str = "666666";
fn mm_to_emu(mm: f32) -> u32 {
    (mm * 36000.0) as u32
}

fn section_heading(text: &str) -> docx_rs::Paragraph {
    use docx_rs::{Paragraph, Run, RunFonts, LineSpacing, ParagraphBorder, ParagraphBorderPosition, BorderType};
    let mut p = Paragraph::new().add_run(Run::new().add_text(text.to_uppercase()).bold().size(24).fonts(RunFonts::new().ascii("Calibri")).color(INK));
    let border = ParagraphBorder::new(ParagraphBorderPosition::Bottom).val(BorderType::Single).size(6).color(ACCENT);
    p.property = p.property.clear_all_borders();
    p.property = p.property.set_border(border);
    p.line_spacing(LineSpacing::new().before(220).after(100))
}

fn resume_heading(text: &str) -> docx_rs::Paragraph {
    section_heading(text)
}

fn resume_body(text: &str) -> docx_rs::Paragraph {
    use docx_rs::{Paragraph, Run, RunFonts};
    Paragraph::new().add_run(Run::new().add_text(text).size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222"))
}

fn resume_bullet(text: &str) -> docx_rs::Paragraph {
    use docx_rs::{Paragraph, Run, RunFonts, SpecialIndentType};
    Paragraph::new()
        .add_run(Run::new().add_text(format!("•\t{}", text)).size(21).fonts(RunFonts::new().ascii("Calibri")).color("222222"))
        .indent(Some(360), Some(SpecialIndentType::Hanging(360)), None, None)
}

fn last_bullet(mut p: docx_rs::Paragraph) -> docx_rs::Paragraph {
    use docx_rs::LineSpacing;
    p.property = p.property.line_spacing(LineSpacing::new().after(240));
    p
}

#[tauri::command]
fn generate_resume_docx(app_handle: tauri::AppHandle, data_json: String, template_key: String, save_path: String) -> Result<String, String> {
    let data: ResumeGenerateRequest = serde_json::from_str(&data_json).map_err(|e| format!("Invalid data_json: {}", e))?;
    let full_name = if data.full_name.trim().is_empty() { "Resume".to_string() } else { data.full_name.clone() };
    // 1-col generation (Phase 4a) — formalized from Mayari generate.js style
    use docx_rs::*;
    let margins = PageMargin::new().top(720).bottom(720).left(720).right(720);
    let mut doc = Docx::new().page_size(11906, 16838).page_margin(margins);

    let has_photo = template_key.ends_with("_photo") && data.photo_path.as_ref().map(|p| !p.is_empty() && Path::new(p).exists()).unwrap_or(false);
    let photo_buf: Option<Vec<u8>> = if has_photo { data.photo_path.as_ref().and_then(|p| fs::read(p).ok()) } else { None };

    if template_key == "col1_photo" && photo_buf.is_some() {
        let buf = photo_buf.clone().unwrap();
        let pic = Pic::new(&buf).size(mm_to_emu(35.0), mm_to_emu(45.0));
        let header_border = ParagraphBorder::new(ParagraphBorderPosition::Bottom).val(BorderType::Single).size(18).color(INK);
        let name_para = Paragraph::new().add_run(Run::new().add_text(full_name.to_uppercase()).bold().size(56).fonts(RunFonts::new().ascii("Calibri")).color(INK));
        let mut text_cell = TableCell::new().clear_all_border().add_paragraph(name_para);
        if let Some(contact) = &data.contact {
            if let Some(a) = &contact.address { if !a.trim().is_empty() {
                text_cell = text_cell.add_paragraph(Paragraph::new().add_run(Run::new().add_text(format!("📍  {}", a.trim())).size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)));
            } }
            let phones = contact.all_phones();
            if !phones.is_empty() {
                let mut para = Paragraph::new().add_run(Run::new().add_text("☎  ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE));
                for (idx, p) in phones.iter().enumerate() { if idx > 0 { para = para.add_run(Run::new().add_text(", ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)); } para = para.add_run(Run::new().add_text(p.clone()).size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)); }
                text_cell = text_cell.add_paragraph(para);
            }
            let emails = contact.all_emails();
            if !emails.is_empty() {
                let mut para = Paragraph::new().add_run(Run::new().add_text("✉  ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE));
                for (idx, e) in emails.iter().enumerate() { if idx > 0 { para = para.add_run(Run::new().add_text(", ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)); } para = para.add_hyperlink(Hyperlink::new(format!("mailto:{}", e), HyperlinkType::External).add_run(Run::new().add_text(e.clone()).size(21).fonts(RunFonts::new().ascii("Calibri")).color(ACCENT).underline("single"))); }
                text_cell = text_cell.add_paragraph(para);
            }
        }
        text_cell = text_cell.width(7000, WidthType::Dxa).vertical_align(VAlignType::Center);
        let mut photo_cell = TableCell::new().clear_all_border().add_paragraph(Paragraph::new().align(AlignmentType::Center).add_run(Run::new().add_image(pic)));
        photo_cell = photo_cell.width(3286, WidthType::Dxa).vertical_align(VAlignType::Center);
        let header_table = Table::new(vec![TableRow::new(vec![text_cell, photo_cell])]).set_grid(vec![7000, 3286]).clear_all_border().align(TableAlignmentType::Left).indent(0);
        doc = doc.add_table(header_table);
        let mut underline_para = Paragraph::new().add_run(Run::new().add_text("").size(2));
        underline_para.property = underline_para.property.clear_all_borders();
        underline_para.property = underline_para.property.set_border(header_border);
        doc = doc.add_paragraph(underline_para);
        doc = doc.add_paragraph(Paragraph::new());
    } else {
        let header_border = ParagraphBorder::new(ParagraphBorderPosition::Bottom).val(BorderType::Single).size(18).color(INK);
        if template_key.starts_with("col1") {
            let has_contact = data.contact.as_ref().map(|c| c.address.as_ref().map(|a| !a.trim().is_empty()).unwrap_or(false) || !c.all_phones().is_empty() || !c.all_emails().is_empty()).unwrap_or(false);
            if has_contact {
                let name_para = Paragraph::new().add_run(Run::new().add_text(full_name.to_uppercase()).bold().size(56).fonts(RunFonts::new().ascii("Calibri")).color(INK));
                doc = doc.add_paragraph(name_para);
                let mut contact_paras: Vec<Paragraph> = Vec::new();
                if let Some(contact) = &data.contact {
                    if let Some(a) = &contact.address { if !a.trim().is_empty() {
                        contact_paras.push(Paragraph::new().add_run(Run::new().add_text(format!("📍  {}", a.trim())).size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)));
                    } }
                    let phones = contact.all_phones();
                    if !phones.is_empty() {
                        let mut para = Paragraph::new().add_run(Run::new().add_text("☎  ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE));
                        for (idx, p) in phones.iter().enumerate() { if idx > 0 { para = para.add_run(Run::new().add_text(", ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)); } para = para.add_run(Run::new().add_text(p.clone()).size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)); }
                        contact_paras.push(para);
                    }
                    let emails = contact.all_emails();
                    if !emails.is_empty() {
                        let mut para = Paragraph::new().add_run(Run::new().add_text("✉  ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE));
                        for (idx, e) in emails.iter().enumerate() { if idx > 0 { para = para.add_run(Run::new().add_text(", ").size(21).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)); } para = para.add_hyperlink(Hyperlink::new(format!("mailto:{}", e), HyperlinkType::External).add_run(Run::new().add_text(e.clone()).size(21).fonts(RunFonts::new().ascii("Calibri")).color(ACCENT).underline("single"))); }
                        contact_paras.push(para);
                    }
                }
                let len = contact_paras.len();
                for (idx, mut para) in contact_paras.into_iter().enumerate() { if idx == len - 1 { para.property = para.property.clear_all_borders(); para.property = para.property.set_border(header_border.clone()); } doc = doc.add_paragraph(para); }
            } else {
                let mut name_para = Paragraph::new().add_run(Run::new().add_text(full_name.to_uppercase()).bold().size(56).fonts(RunFonts::new().ascii("Calibri")).color(INK));
                name_para.property = name_para.property.clear_all_borders();
                name_para.property = name_para.property.set_border(header_border);
                doc = doc.add_paragraph(name_para);
            }
        } else {
            let mut name_para = Paragraph::new().add_run(Run::new().add_text(full_name.to_uppercase()).bold().size(56).fonts(RunFonts::new().ascii("Calibri")).color(INK));
            name_para.property = name_para.property.clear_all_borders();
            name_para.property = name_para.property.set_border(header_border);
            doc = doc.add_paragraph(name_para);
        }
        doc = doc.add_paragraph(Paragraph::new());
    }

    if template_key.starts_with("col2") {
        let mut left_paras: Vec<docx_rs::Paragraph> = Vec::new();
        let mut right_paras: Vec<docx_rs::Paragraph> = Vec::new();
        // Photo at top of sidebar for col2_photo
        // Photo at top of sidebar for col2_photo — centered
        if template_key == "col2_photo" {
            if let Some(ref buf) = photo_buf {
                let pic = Pic::new(buf).size(mm_to_emu(35.0), mm_to_emu(45.0));
                left_paras.push(Paragraph::new().align(AlignmentType::Center).add_run(Run::new().add_image(pic)));
                left_paras.push(Paragraph::new());
            }
        }
        left_paras.push(resume_heading("Contact"));
        if let Some(contact) = &data.contact {
            if let Some(a) = &contact.address { if !a.trim().is_empty() {
                left_paras.push(Paragraph::new().add_run(Run::new().add_text(format!("📍  {}", a.trim())).size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222")));
            } }
            let phones = contact.all_phones();
            if !phones.is_empty() {
                let mut para = Paragraph::new().add_run(Run::new().add_text("☎  ").size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222"));
                for (idx, p) in phones.iter().enumerate() { if idx > 0 { para = para.add_run(Run::new().add_text(", ").size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222")); } para = para.add_run(Run::new().add_text(p.clone()).size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222")); }
                left_paras.push(para);
            }
            let emails = contact.all_emails();
            if !emails.is_empty() {
                let mut para = Paragraph::new().add_run(Run::new().add_text("✉  ").size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222"));
                for (idx, e) in emails.iter().enumerate() { if idx > 0 { para = para.add_run(Run::new().add_text(", ").size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222")); } para = para.add_hyperlink(Hyperlink::new(format!("mailto:{}", e), HyperlinkType::External).add_run(Run::new().add_text(e.clone()).size(22).fonts(RunFonts::new().ascii("Calibri")).color(ACCENT).underline("single"))); }
                left_paras.push(para);
            }
            if let Some(l) = &contact.linkedin { if !l.trim().is_empty() {
                left_paras.push(Paragraph::new().add_run(Run::new().add_text(format!("🔗  {}", l.trim())).size(22).fonts(RunFonts::new().ascii("Calibri")).color("222222")));
            } }
        }
        left_paras.push(Paragraph::new().add_run(Run::new().add_text("").size(2)));
        if let Some(edus) = &data.education {
            if !edus.is_empty() {
                left_paras.push(resume_heading("Education"));
                for e in edus { left_paras.push(resume_body(&format!("{} — {} ({})", e.school, e.degree, e.year))); }
            }
        }
        if let Some(skills) = &data.skills {
            if !skills.is_empty() {
                left_paras.push(resume_heading("Skills"));
                for s in skills { if !s.trim().is_empty() { left_paras.push(resume_bullet(s)); } }
            }
        }
        if let Some(certs) = &data.certifications {
            if !certs.is_empty() {
                left_paras.push(resume_heading("Certifications"));
                for c in certs { left_paras.push(resume_body(&format!("{} — {} ({})", c.name, c.issuer, c.year))); }
            }
        }
        // Main: Summary + Experience
        if let Some(summary) = &data.summary {
            if !summary.trim().is_empty() {
                right_paras.push(resume_heading("Summary"));
                right_paras.push(resume_body(summary));
            }
        }
        if let Some(exps) = &data.experience {
            if !exps.is_empty() {
                right_paras.push(resume_heading("Experience"));
                for ex in exps {
                    right_paras.push(Paragraph::new().add_run(Run::new().add_text(ex.role.clone()).bold().size(24).fonts(RunFonts::new().ascii("Calibri")).color(INK)));
                    let meta = format!("{}   |   {} – {}", ex.company, ex.start_date, ex.end_date);
                    right_paras.push(Paragraph::new().add_run(Run::new().add_text(meta).italic().color(MUTED_META).size(21).fonts(RunFonts::new().ascii("Calibri"))));
                    let bullets: Vec<&String> = ex.bullets.iter().filter(|b| !b.trim().is_empty()).collect();
                    for (idx, b) in bullets.iter().enumerate() {
                        let p = resume_bullet(b);
                        if idx == bullets.len() - 1 { right_paras.push(last_bullet(p)); } else { right_paras.push(p); }
                    }
                }
            }
        }
        if left_paras.is_empty() { left_paras.push(resume_body("")); }
        if right_paras.is_empty() { right_paras.push(resume_body("")); }
        let left_cell = {
            let mut c = TableCell::new()
                .clear_all_border()
                .set_border(TableCellBorder::new(TableCellBorderPosition::Right).border_type(BorderType::Single).size(4).color("E5E7EB"));
            for p in left_paras { c = c.add_paragraph(p); }
            c.width(3560, WidthType::Dxa).vertical_align(VAlignType::Top)
        };
        let spacer_cell = TableCell::new()
            .clear_all_border()
            .width(180, WidthType::Dxa)
            .vertical_align(VAlignType::Top);
        let right_cell = {
            let mut c = TableCell::new().clear_all_border();
            for p in right_paras { c = c.add_paragraph(p); }
            c.width(6546, WidthType::Dxa).vertical_align(VAlignType::Top)
        };
        let table = Table::new(vec![TableRow::new(vec![left_cell, spacer_cell, right_cell])])
            .set_grid(vec![3560, 180, 6546])
            .align(TableAlignmentType::Left)
            .clear_all_border()
            .indent(0);
        doc = doc.add_table(table);
    } else {
        if let Some(summary) = &data.summary {
            if !summary.trim().is_empty() {
                doc = doc.add_paragraph(resume_heading("Summary"));
                doc = doc.add_paragraph(resume_body(summary));
            }
        }
        if let Some(edus) = &data.education {
            if !edus.is_empty() {
                doc = doc.add_paragraph(resume_heading("Education"));
                for e in edus {
                    let line = format!("{} — {} ({})", e.school, e.degree, e.year);
                    doc = doc.add_paragraph(resume_body(&line));
                }
            }
        }
        if let Some(exps) = &data.experience {
            if !exps.is_empty() {
                doc = doc.add_paragraph(resume_heading("Experience"));
                for ex in exps {
                    doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(ex.role.clone()).bold().size(24).fonts(RunFonts::new().ascii("Calibri")).color(INK)));
                    let meta = format!("{}   |   {} – {}", ex.company, ex.start_date, ex.end_date);
                    doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text(meta).italic().color(MUTED_META).size(21).fonts(RunFonts::new().ascii("Calibri"))));
                    let bullets: Vec<&String> = ex.bullets.iter().filter(|b| !b.trim().is_empty()).collect();
                    for (idx, b) in bullets.iter().enumerate() {
                        let p = resume_bullet(b);
                        if idx == bullets.len() - 1 { doc = doc.add_paragraph(last_bullet(p)); } else { doc = doc.add_paragraph(p); }
                    }
                }
            }
        }
        if let Some(skills) = &data.skills {
            if !skills.is_empty() {
                doc = doc.add_paragraph(resume_heading("Skills"));
                for s in skills {
                    if !s.trim().is_empty() {
                        doc = doc.add_paragraph(resume_bullet(s));
                    }
                }
            }
        }
        if let Some(certs) = &data.certifications {
            if !certs.is_empty() {
                doc = doc.add_paragraph(resume_heading("Certifications"));
                for c in certs {
                    let line = format!("{} — {} ({})", c.name, c.issuer, c.year);
                    doc = doc.add_paragraph(resume_body(&line));
                }
            }
        }
    }

    // Certification + signature block (both templates, bottom of page)
    doc = doc.add_paragraph(Paragraph::new().add_run(Run::new().add_text("I hereby certify that the above information is true and correct to the best of my knowledge and belief.").size(20).italic().fonts(RunFonts::new().ascii("Calibri")).color("222222")));
    doc = doc.add_paragraph(Paragraph::new());
    doc = doc.add_paragraph(Paragraph::new());
    doc = doc.add_paragraph(Paragraph::new().align(AlignmentType::Right).add_run(Run::new().add_text("_____________________________").size(21).fonts(RunFonts::new().ascii("Calibri"))));
    doc = doc.add_paragraph(Paragraph::new().align(AlignmentType::Right).add_run(Run::new().add_text("Signature over Printed Name").size(18).fonts(RunFonts::new().ascii("Calibri")).color(MUTED_SUBTITLE)));

    let mut out_path = PathBuf::from(&save_path);
    if out_path.extension().is_none_or(|e| e != "docx") {
        out_path.set_extension("docx");
    }
    if let Some(parent) = out_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create output dir: {}", e))?;
    }
    let file = std::fs::File::create(&out_path).map_err(|e| format!("Failed to create file: {}", e))?;
    doc.build().pack(file).map_err(|e| format!("Docx build error: {}", e))?;

    // Auto-save to DB (insert or update by full_name + template_key)
    let db_path = activity_db_path(&app_handle);
    if let Ok(conn) = Connection::open(&db_path) {
        let now = Utc::now().to_rfc3339();
        let docx_str = out_path.to_string_lossy().to_string();
        let existing: Option<i64> = conn.query_row("SELECT id FROM resumes WHERE full_name = ?1 AND template_key = ?2", rusqlite::params![full_name, template_key], |r| r.get(0)).ok();
        if let Some(id) = existing {
            let _ = conn.execute("UPDATE resumes SET data_json = ?1, docx_path = ?2, updated_at = ?3 WHERE id = ?4", rusqlite::params![data_json, docx_str, now, id]);
        } else {
            let _ = conn.execute("INSERT INTO resumes (full_name, template_key, data_json, docx_path, pdf_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?5)", rusqlite::params![full_name, template_key, data_json, docx_str, now]);
        }
    }

    Ok(out_path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize)]
struct GenerateResumeResult {
    docx_path: String,
    pdf_path: Option<String>,
}

#[tauri::command]
fn generate_resume(app_handle: tauri::AppHandle, data_json: String, template_key: String, save_stem_path: String) -> Result<GenerateResumeResult, String> {
    // Generate docx via existing logic, then try soffice for pdf
    let docx_path_str = generate_resume_docx(app_handle.clone(), data_json.clone(), template_key.clone(), save_stem_path.clone())?;
    let docx_path = PathBuf::from(&docx_path_str);
    let pdf_path = docx_path.with_extension("pdf");
    // Try soffice variants
    let soffice_bins = ["soffice", "libreoffice", "soffice.bin"];
    let mut pdf_ok = false;
    if let Some(parent) = docx_path.parent() {
        for bin in &soffice_bins {
            let out = Command::new(bin)
                .args(["--headless", "--convert-to", "pdf", "--outdir", &parent.to_string_lossy().to_string(), &docx_path.to_string_lossy().to_string()])
                .output();
            if let Ok(o) = out {
                if o.status.success() && pdf_path.exists() {
                    pdf_ok = true;
                    break;
                }
            }
        }
    }
    let pdf_opt = if pdf_ok { Some(pdf_path.to_string_lossy().to_string()) } else { None };
    // Update DB with pdf_path if generated
    if let Some(ref pdf) = pdf_opt {
        let db_path = activity_db_path(&app_handle);
        if let Ok(conn) = Connection::open(&db_path) {
            let now = Utc::now().to_rfc3339();
            let data: ResumeGenerateRequest = serde_json::from_str(&data_json).unwrap_or(ResumeGenerateRequest { full_name: "Resume".to_string(), contact: None, summary: None, education: None, experience: None, skills: None, certifications: None, photo_path: None });
            let full_name = if data.full_name.trim().is_empty() { "Resume".to_string() } else { data.full_name.clone() };
            let _ = conn.execute("UPDATE resumes SET pdf_path = ?1, updated_at = ?2 WHERE full_name = ?3 AND template_key = ?4", rusqlite::params![pdf, now, full_name, template_key]);
        }
    }
    Ok(GenerateResumeResult { docx_path: docx_path_str, pdf_path: pdf_opt })
}

fn read_resume_template(app_handle: &tauri::AppHandle) -> Result<String, String> {
    let res = resource_dir(app_handle);
    let candidates = [
        res.join("resources").join("resume-template.json"),
        res.join("resume-template.json"),
        PathBuf::from("src-tauri/resources/resume-template.json"),
        PathBuf::from("resources/resume-template.json"),
    ];
    for c in &candidates {
        if c.exists() {
            return fs::read_to_string(c).map_err(|e| format!("Failed to read template: {}", e));
        }
    }
    Err("Template not found in bundle".to_string())
}

#[tauri::command]
fn export_resume_template(app_handle: tauri::AppHandle, dest_path: String) -> Result<String, String> {
    let content = read_resume_template(&app_handle)?;
    let dest = PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    fs::write(&dest, content).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
fn get_resume_template(app_handle: tauri::AppHandle) -> Result<String, String> {
    read_resume_template(&app_handle)
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

// ---- PDF → image rendering (PDFium, Phase 1 bare harness) ----

/// Candidate directories holding the bundled PDFium shared library.
/// In dev, `resource_dir()` already resolves to `src-tauri/`, so the first
/// candidate covers both dev and production bundle layouts.
fn pdfium_lib_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let res = resource_dir(app);
    #[cfg(target_os = "windows")]
    dirs.push(res.join("binaries/pdfium-win-x64"));
    #[cfg(target_os = "linux")]
    dirs.push(res.join("binaries/pdfium-linux-x64"));
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    dirs.push(res.join("binaries"));
    // Fallback: library sitting next to the executable.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            #[cfg(target_os = "windows")]
            dirs.push(parent.join("binaries/pdfium-win-x64"));
            #[cfg(target_os = "linux")]
            dirs.push(parent.join("binaries/pdfium-linux-x64"));
            dirs.push(parent.to_path_buf());
        }
    }
    dirs
}

fn load_pdfium(app: &tauri::AppHandle) -> Result<pdfium_render::prelude::Pdfium, String> {
    use pdfium_render::prelude::*;
    let mut last_err = String::from("no candidate directories");
    for dir in pdfium_lib_dirs(app) {
        let lib_path = Pdfium::pdfium_platform_library_name_at_path(&dir);
        match Pdfium::bind_to_library(&lib_path) {
            Ok(bindings) => return Ok(Pdfium::new(bindings)),
            Err(e) => {
                last_err = format!("{}: {:?}", lib_path.to_string_lossy(), e);
            }
        }
    }
    // Final fallback: system-provided library, if any.
    match Pdfium::bind_to_system_library() {
        Ok(bindings) => Ok(Pdfium::new(bindings)),
        Err(e) => Err(format!(
            "Could not load bundled PDFium ({}) nor system library ({:?})",
            last_err, e
        )),
    }
}

#[derive(Debug, Serialize)]
struct RenderedPdfPage {
    path: String,
    page: usize,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
struct RenderedPdf {
    pages: Vec<RenderedPdfPage>,
    total: usize,
}

/// Render every page of a PDF to PNG at the requested DPI (default 200) and
/// dump them under `data_dir/tmp/pdf-<stem>-<ts>/`. Each page becomes one
/// Batch Converter tile downstream. Password-protected files without a
/// (correct) password fail with a `PDF_PASSWORD_REQUIRED` /
/// `PDF_PASSWORD_INCORRECT` sentinel so the frontend can prompt.
#[tauri::command]
fn render_pdf_pages(
    app_handle: tauri::AppHandle,
    pdf_path: String,
    dpi: Option<u32>,
    password: Option<String>,
) -> Result<RenderedPdf, String> {
    use pdfium_render::prelude::*;
    let dpi = dpi.unwrap_or(200).clamp(72, 600);
    let scale = dpi as f32 / 72.0;

    if !Path::new(&pdf_path).exists() {
        return Err(format!("PDF not found: {}", pdf_path));
    }

    let pdfium = load_pdfium(&app_handle)?;
    let document = pdfium
        .load_pdf_from_file(&pdf_path, password.as_deref())
        .map_err(|e| {
            let dbg = format!("{:?}", e);
            if dbg.contains("Password") {
                if password.is_some() {
                    format!("PDF_PASSWORD_INCORRECT: wrong password for {}", pdf_path)
                } else {
                    format!("PDF_PASSWORD_REQUIRED: {} is password-protected", pdf_path)
                }
            } else {
                format!("Failed to open PDF (corrupt or unsupported?): {}", dbg)
            }
        })?;
    let page_count = document.pages().len() as usize;
    if page_count == 0 {
        return Err("PDF has no pages".to_string());
    }

    let stem = Path::new(&pdf_path)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let stem = if stem.is_empty() { "doc".to_string() } else { stem };
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let out_dir = data_dir(&app_handle)
        .join("tmp")
        .join(format!("pdf-{}-{}", stem, ts));
    fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output dir: {}", e))?;

    let mut pages = Vec::with_capacity(page_count);
    for i in 0..page_count {
        let page = document
            .pages()
            .get(i as u16)
            .map_err(|e| format!("Failed to load page {}: {:?}", i + 1, e))?;
        let config = PdfRenderConfig::new().scale_page_by_factor(scale);
        let bitmap = page
            .render_with_config(&config)
            .map_err(|e| format!("Failed to render page {}: {:?}", i + 1, e))?;
        let image = bitmap.as_image();
        let (width, height) = (image.width(), image.height());
        let out_path = out_dir.join(format!("page-{:03}.png", i + 1));
        image
            .save(&out_path)
            .map_err(|e| format!("Failed to save page {}: {}", i + 1, e))?;
        pages.push(RenderedPdfPage {
            path: out_path.to_string_lossy().to_string(),
            page: i + 1,
            width,
            height,
        });
    }
    Ok(RenderedPdf {
        total: page_count,
        pages,
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
        .plugin(tauri_plugin_clipboard_manager::init())
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
                 write_temp_photo,
                 read_file,
                 import_pricing,
                 get_services_summary,
                get_pricing_tiers,
                update_pricing_tier,
                add_pricing_tier,
                delete_pricing_tier,
                convert_images_batch,
                render_pdf_pages,
                create_resume,
                update_resume,
                get_resume,
                list_resumes,
                delete_resume,
                generate_resume_docx,
                generate_resume,
                export_resume_template,
                get_resume_template,
         ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
