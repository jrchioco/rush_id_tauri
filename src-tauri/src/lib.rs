use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, Manager};

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
fn export_pdf(app_handle: tauri::AppHandle, svg_path: String, save_path: String) -> Result<String, String> {
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

    let slot_height = parse_svg_height(&svg_raw);

    let images_per_svg = svg_raw.matches("xlink:href=\"").count();
    if images_per_svg == 0 {
        return Err("SVG template has no image references".to_string());
    }

    for (i, slot) in slots.iter().enumerate() {
        let pic_name = format!("other_{}.png", i + 1);
        let pic_path = d.join(&pic_name);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&slot.image_base64)
            .map_err(|e| format!("Base64 decode error for slot {}: {}", i, e))?;
        let bytes = resize_if_needed(&bytes);
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

    let msg = if save_path.is_some() { "PDF saved" } else { "Other PDF opened in viewer. Press Ctrl+P to print." };
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
            composite_other_pdf,
            get_key_count,
            open_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
