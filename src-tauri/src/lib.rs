use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};

#[derive(Debug, Deserialize, Serialize)]
struct Config {
    input_folder_path: String,
    output_folder_path: String,
    api_keys: Vec<String>,
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
    serde_json::from_str(&content).map_err(|e| format!("Invalid config.json: {}", e))
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

fn svg_to_pdf(svg_content: &str, pdf_path: &Path, tmp_dir: &Path) -> Result<(), String> {
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

    fs::write(pdf_path, &pdf_bytes).map_err(|e| format!("Failed to write PDF: {}", e))?;
    Ok(())
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
fn save_config(app_handle: tauri::AppHandle, api_keys: Vec<String>) -> Result<(), String> {
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
        api_keys,
        svg_files,
    };

    let d = data_dir(&app_handle);
    fs::create_dir_all(&d).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(d.join("config.json"), &json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_config(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    let config = load_config(&app_handle)?;
    Ok(config.api_keys)
}

#[tauri::command]
fn update_config(app_handle: tauri::AppHandle, api_keys: Vec<String>) -> Result<(), String> {
    let mut config = load_config(&app_handle)?;
    config.api_keys = api_keys;
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
    templates.sort_by(|a, b| a.key.cmp(&b.key));
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
    for (i, api_key) in config.api_keys.iter().enumerate() {
        let file_part = reqwest::multipart::Part::bytes(bytes.clone())
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| format!("Mime error: {}", e))?;
        let form = reqwest::multipart::Form::new()
            .part("image_file", file_part)
            .text("size", "auto");
        let response = client
            .post("https://api.remove.bg/v1.0/removebg")
            .multipart(form)
            .header("X-Api-Key", api_key)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await;

        match response {
            Ok(resp) if resp.status() == 200 => {
                let data = resp.bytes().await.map_err(|e| format!("Read response error: {}", e))?;
                fs::write(&output_path, &data).map_err(|e| format!("Failed to write output: {}", e))?;
                app_handle.emit("key_used", i).ok();
                return Ok(base64::engine::general_purpose::STANDARD.encode(&data));
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                eprintln!("API key failed ({}): {}", status, body);
            }
            Err(e) => eprintln!("Request error with key: {}", e),
        }
    }
    Err("All API keys failed. Check your API keys and internet connection.".to_string())
}

#[tauri::command]
fn write_picture(app_handle: tauri::AppHandle, image_base64: String) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    let output_path = data_dir(&app_handle).join("picture.png");
    fs::write(&output_path, &bytes).map_err(|e| format!("Failed to write picture.png: {}", e))?;
    Ok("ok".into())
}

#[tauri::command]
fn export_pdf(app_handle: tauri::AppHandle, svg_path: String, save_path: String) -> Result<String, String> {
    let tmp_dir = data_dir(&app_handle).join("tmp");
    let patched_svg = patch_svg_path(&app_handle, &svg_path)?;
    let svg_content = fs::read_to_string(&patched_svg)
        .map_err(|e| format!("Failed to read SVG: {}", e))?;

    let mut pdf_path = PathBuf::from(&save_path);
    if pdf_path.extension().is_none_or(|e| e != "pdf") {
        pdf_path.set_extension("pdf");
    }

    svg_to_pdf(&svg_content, &pdf_path, &tmp_dir)?;

    if pdf_path.exists() {
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

#[tauri::command]
fn get_key_count(app_handle: tauri::AppHandle) -> Result<usize, String> {
    let config = load_config(&app_handle)?;
    Ok(config.api_keys.len())
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
fn print_file(app_handle: tauri::AppHandle, svg_path: String) -> Result<String, String> {
    let tmp_dir = data_dir(&app_handle).join("tmp");
    let patched_svg = patch_svg_path(&app_handle, &svg_path)?;
    let svg_content = fs::read_to_string(&patched_svg)
        .map_err(|e| format!("Failed to read SVG: {}", e))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let temp_pdf = std::env::temp_dir().join(format!("rush_id_print_{}.pdf", ts));

    svg_to_pdf(&svg_content, &temp_pdf, &tmp_dir)?;

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

    Ok("PDF opened in viewer. Press Ctrl+P to print.".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClientSlot {
    image_base64: String,
    svg_path: String,
}

#[tauri::command]
fn composite_multi_pdf(app_handle: tauri::AppHandle, clients: Vec<ClientSlot>, save_path: Option<String>) -> Result<String, String> {
    let d = data_dir(&app_handle);
    let tmp_dir = d.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed to create tmp dir: {}", e))?;

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

    for (i, client) in clients.iter().enumerate() {
        let pic_name = format!("client_{}.png", i);
        let pic_path = d.join(&pic_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&client.image_base64)
            .map_err(|e| format!("Base64 decode error for client {}: {}", i, e))?;
        fs::write(&pic_path, &bytes).map_err(|e| format!("Failed to write {}: {}", pic_name, e))?;

        let svg_raw = fs::read_to_string(&client.svg_path)
            .map_err(|e| format!("Failed to read SVG for client {}: {}", i, e))?;
        let patched = svg_raw.replace("../picture.png", &format!("../client_{}.png", i));

        let temp_svg = tmp_dir.join(format!("client_{}.svg", i));
        fs::write(&temp_svg, &patched).map_err(|e| format!("Failed to write client SVG {}: {}", i, e))?;
    }

    let mut inner = String::new();
    let mut y_mm = 0.0_f64;

    for i in 0..clients.len() {
        let temp_svg = tmp_dir.join(format!("client_{}.svg", i));
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
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="210mm" height="{:.1}mm">{}</svg>"#, y_mm,
        inner
    );

    let composite_path = tmp_dir.join("composite_multi.svg");
    fs::write(&composite_path, &composite).map_err(|e| format!("Failed to write composite SVG: {}", e))?;

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

    svg_to_pdf(&composite, &pdf_path, &tmp_dir)?;

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

    let msg = if save_path.is_some() { "PDF saved" } else { "Composite PDF opened in viewer. Press Ctrl+P to print." };
    Ok(msg.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolaroidSlot {
    slot_index: usize,
    image_base64: String,
}

#[tauri::command]
fn composite_polaroid_pdf(
    app_handle: tauri::AppHandle,
    layout: String,
    slots: Vec<PolaroidSlot>,
    save_path: Option<String>,
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
        "10pcs" => "Polaroid 10pcs.svg",
        _ => "Polaroid 5pcs.svg",
    };
    let svg_path = res.join("SVGs").join(svg_name);
    let svg_raw = fs::read_to_string(&svg_path)
        .map_err(|e| format!("Failed to read SVG template: {}", e))?;

    let mut patched = svg_raw;
    for slot in &slots {
        let pic_name = format!("polaroid_{}.png", slot.slot_index);
        let pic_path = d.join(&pic_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&slot.image_base64)
            .map_err(|e| format!("Base64 decode error for slot {}: {}", slot.slot_index, e))?;
        fs::write(&pic_path, &bytes).map_err(|e| format!("Failed to write {}: {}", pic_name, e))?;

        let bare_href = format!("polaroid{}.png", slot.slot_index);
        let rel_href = format!("../{}", pic_name);
        patched = patched.replace(&format!("xlink:href=\"{}\"", bare_href), &format!("xlink:href=\"{}\"", rel_href));
        patched = patched.replace(&format!("href=\"{}\"", bare_href), &format!("href=\"{}\"", rel_href));
    }

    let composite_path = tmp_dir.join("polaroid_composite.svg");
    fs::write(&composite_path, &patched).map_err(|e| format!("Failed to write composite SVG: {}", e))?;

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

    svg_to_pdf(&patched, &pdf_path, &tmp_dir)?;

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

    let msg = if save_path.is_some() { "PDF saved" } else { "Polaroid PDF opened in viewer. Press Ctrl+P to print." };
    Ok(msg.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    cleanup_temp_pdfs();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
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
            get_key_count,
            open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
