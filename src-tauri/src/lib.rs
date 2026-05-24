use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};

#[derive(Debug, Deserialize, Serialize)]
struct Config {
    input_folder_path: String,
    output_folder_path: String,
    api_keys: Vec<String>,
    inkscape_path: String,
    svg_files: HashMap<String, String>,
}

fn resource_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().resource_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default()
    })
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

fn normalize_path(path: &PathBuf) -> PathBuf {
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

fn patch_svg_path(app: &tauri::AppHandle, svg_path: &str) -> Result<PathBuf, String> {
    let content = fs::read_to_string(svg_path)
        .map_err(|e| format!("Failed to read SVG: {}", e))?;
    let picture_path = data_dir(app).join("picture.png");
    let patched = content.replace("../picture.png", &picture_path.to_string_lossy().to_string());

    let temp_svg = data_dir(app).join("tmp").join("template.svg");
    fs::create_dir_all(temp_svg.parent().unwrap())
        .map_err(|e| format!("Failed to create tmp dir: {}", e))?;
    fs::write(&temp_svg, &patched)
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
            if path.extension().map_or(false, |e| e == "svg") {
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
        inkscape_path: "inkscape".into(),
        svg_files,
    };

    let d = data_dir(&app_handle);
    fs::create_dir_all(&d).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let json = serde_json::to_string_pretty(&config).map_err(|e| format!("Serialize error: {}", e))?;
    fs::write(d.join("config.json"), &json).map_err(|e| format!("Failed to write config: {}", e))?;
    Ok(())
}

#[tauri::command]
fn get_svg_templates(app_handle: tauri::AppHandle) -> Result<Vec<SvgTemplate>, String> {
    let config = load_config(&app_handle)?;
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
    let config = load_config(&app_handle)?;
    let patched_svg = patch_svg_path(&app_handle, &svg_path)?;

    let mut pdf_path = PathBuf::from(&save_path);
    if pdf_path.extension().map_or(true, |e| e != "pdf") {
        pdf_path.set_extension("pdf");
    }

    let output = Command::new(&config.inkscape_path)
        .arg("--export-filename")
        .arg(&pdf_path)
        .arg(&patched_svg)
        .output()
        .map_err(|e| format!("Failed to run Inkscape: {}", e))?;

    if output.status.success() && pdf_path.exists() {
        Ok(pdf_path.to_string_lossy().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Inkscape error: {}", stderr))
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
fn print_file(app_handle: tauri::AppHandle, svg_path: String) -> Result<String, String> {
    let config = load_config(&app_handle)?;
    let patched_svg = patch_svg_path(&app_handle, &svg_path)?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let temp_pdf = std::env::temp_dir().join(format!("rush_id_print_{}.pdf", ts));

    let output = Command::new(&config.inkscape_path)
        .arg("--export-filename")
        .arg(&temp_pdf)
        .arg(&patched_svg)
        .output()
        .map_err(|e| format!("Failed to run Inkscape: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Inkscape error: {}", stderr));
    }

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &temp_pdf.to_string_lossy().to_string()])
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    cleanup_temp_pdfs();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            check_config,
            save_config,
            get_svg_templates,
            remove_bg,
            write_picture,
            export_pdf,
            print_file,
            get_key_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
