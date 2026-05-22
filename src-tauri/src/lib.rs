use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Deserialize)]
struct Config {
    input_folder_path: String,
    output_folder_path: String,
    api_keys: Vec<String>,
    printer_name: String,
    inkscape_path: String,
    svg_files: std::collections::HashMap<String, String>,
}

fn resource_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().resource_dir().unwrap_or_else(|_| {
        std::env::current_dir().unwrap_or_default()
    })
}

fn load_config(app: &tauri::AppHandle) -> Result<Config, String> {
    let base = resource_dir(app);
    let config_path = base.join("config.json");
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.json at {:?}: {}", config_path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid config.json: {}", e))
}

fn resolve(app: &tauri::AppHandle, path: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        p
    } else {
        resource_dir(app).join(&p)
    }
}

#[derive(Debug, Serialize)]
struct SvgTemplate {
    key: String,
    path: String,
    name: String,
}

#[tauri::command]
fn get_svg_templates(app_handle: tauri::AppHandle) -> Result<Vec<SvgTemplate>, String> {
    let config = load_config(&app_handle)?;
    let mut templates = Vec::new();
    for (key, rel_path) in &config.svg_files {
        let full_path = resolve(&app_handle, rel_path);
        let name = full_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        templates.push(SvgTemplate {
            key: key.clone(),
            path: full_path.to_string_lossy().to_string(),
            name,
        });
    }
    templates.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(templates)
}

#[derive(Debug, Serialize)]
struct RemoveBgResult {
    success: bool,
    output_path: String,
    message: String,
}

#[tauri::command]
async fn remove_bg(app_handle: tauri::AppHandle, image_base64: String) -> Result<RemoveBgResult, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let config = load_config(&app_handle)?;

    let input_dir = resolve(&app_handle, &config.input_folder_path);
    fs::create_dir_all(&input_dir).map_err(|e| format!("Failed to create input dir: {}", e))?;
    let input_path = input_dir.join("input.png");
    fs::write(&input_path, &bytes).map_err(|e| format!("Failed to write input file: {}", e))?;

    let output_dir = resolve(&app_handle, &config.output_folder_path);
    fs::create_dir_all(&output_dir).map_err(|e| format!("Failed to create output dir: {}", e))?;
    let output_path = output_dir.join("picture.png");

    let client = reqwest::Client::new();
    for api_key in &config.api_keys {
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
                fs::write(&output_path, &data)
                    .map_err(|e| format!("Failed to write output: {}", e))?;
                return Ok(RemoveBgResult {
                    success: true,
                    output_path: output_path.to_string_lossy().to_string(),
                    message: "Background removed successfully!".to_string(),
                });
            }
            Ok(resp) => {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                eprintln!("API key failed ({}): {}", status, body);
            }
            Err(e) => {
                eprintln!("Request error with key: {}", e);
            }
        }
    }

    Err("All API keys failed. Check your API keys and internet connection.".to_string())
}

#[tauri::command]
fn export_pdf(app_handle: tauri::AppHandle, svg_path: String, save_path: String) -> Result<String, String> {
    let config = load_config(&app_handle)?;
    let mut pdf_path = PathBuf::from(&save_path);
    if pdf_path.extension().map_or(true, |e| e != "pdf") {
        pdf_path.set_extension("pdf");
    }

    let output = Command::new(&config.inkscape_path)
        .arg("--export-filename")
        .arg(&pdf_path)
        .arg(&svg_path)
        .output()
        .map_err(|e| format!("Failed to run Inkscape: {}", e))?;

    if output.status.success() && pdf_path.exists() {
        Ok(pdf_path.to_string_lossy().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Inkscape error: {}", stderr))
    }
}

#[tauri::command]
fn print_file(app_handle: tauri::AppHandle, svg_path: String) -> Result<String, String> {
    let config = load_config(&app_handle)?;
    let base = resource_dir(&app_handle);
    let temp_pdf = base.join("temp_print.pdf");

    let output = Command::new(&config.inkscape_path)
        .arg("--export-filename")
        .arg(&temp_pdf)
        .arg(&svg_path)
        .output()
        .map_err(|e| format!("Failed to run Inkscape: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Inkscape error: {}", stderr));
    }

    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", &temp_pdf.to_string_lossy()])
            .output()
            .map_err(|e| format!("Failed to print: {}", e))?;
    } else {
        Command::new("lpr")
            .arg(&temp_pdf)
            .output()
            .map_err(|e| format!("Failed to run lpr: {}", e))?;
    }

    Ok("Print job sent successfully!".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_svg_templates,
            remove_bg,
            export_pdf,
            print_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
