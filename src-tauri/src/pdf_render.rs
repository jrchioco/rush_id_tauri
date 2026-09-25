//! PDF → image rendering via bundled PDFium.
//!
//! Phase 3: pages render on a capped, auto-scaling rayon pool
//! (`num_cpus - 2`, min 1) so branch tills running POS software aren't
//! starved. `Pdfium`/`PdfDocument` are `Send + Sync` (crate guarantees +
//! `thread_safe` bindings), so sharing `&PdfDocument` across threads is safe.
//! Oversized pages are fitted to `MAX_RENDER_EDGE_PX` to avoid OOM on huge
//! formats at high DPI.

use pdfium_render::prelude::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use super::{data_dir, resource_dir};

/// Longest rendered edge, in pixels. Pages that would exceed this (e.g. A0
/// at 600 DPI) are scaled down to fit instead of allocating gigantic bitmaps.
pub const MAX_RENDER_EDGE_PX: f32 = 10_000.0;

#[derive(Debug)]
pub struct RenderedPageImage {
    pub index: usize,
    pub image: image::DynamicImage,
    pub width: u32,
    pub height: u32,
    pub capped: bool,
}

fn pool() -> &'static rayon::ThreadPool {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        let threads = num_cpus::get().saturating_sub(2).max(1);
        rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|i| format!("pdf-render-{}", i))
            .build()
            .expect("failed to build pdf render pool")
    })
}

/// Candidate directories holding the bundled PDFium shared library.
/// In dev, `resource_dir()` already resolves to `src-tauri/`, so the first
/// candidate covers both dev and production bundle layouts.
fn lib_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
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

pub fn load(app: &tauri::AppHandle) -> Result<Pdfium, String> {
    let mut last_err = String::from("no candidate directories");
    for dir in lib_dirs(app) {
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

/// Map a Pdfium open error to a user-facing message. Password failures use
/// stable sentinels so the frontend can prompt (`REQUIRED`) or re-prompt
/// (`INCORRECT`).
fn map_open_error(e: pdfium_render::prelude::PdfiumError, pdf_desc: &str, had_password: bool) -> String {
    let dbg = format!("{:?}", e);
    if dbg.contains("Password") {
        if had_password {
            format!("PDF_PASSWORD_INCORRECT: wrong password for {}", pdf_desc)
        } else {
            format!("PDF_PASSWORD_REQUIRED: {} is password-protected", pdf_desc)
        }
    } else {
        format!("Failed to open PDF (corrupt or unsupported?): {}", dbg)
    }
}

/// Render every page in parallel. Each thread opens its own document from the
/// shared bytes (page handles can't cross threads), so only `&Pdfium`,
/// `&[u8]` and the password — all `Sync` — are shared. `progress(done,
/// total)` fires once per finished page (order not guaranteed); the returned
/// vec is always sorted by page index.
pub fn render_pages(
    pdfium: &Pdfium,
    pdf_bytes: &[u8],
    password: Option<&str>,
    pdf_desc: &str,
    base_scale: f32,
    progress: &(dyn Fn(usize, usize) + Sync),
) -> Result<Vec<RenderedPageImage>, String> {
    use rayon::prelude::*;
    let total = pdfium
        .load_pdf_from_byte_slice(pdf_bytes, password)
        .map_err(|e| map_open_error(e, pdf_desc, password.is_some()))
        .and_then(|doc| {
            let n = doc.pages().len() as usize;
            if n == 0 {
                Err("PDF has no pages".to_string())
            } else {
                Ok(n)
            }
        })?;
    let done = AtomicUsize::new(0);
    let mut pages: Vec<RenderedPageImage> = pool().install(|| {
        let out: Result<Vec<RenderedPageImage>, String> = (0..total)
            .into_par_iter()
            .map(|i| {
                // Per-thread document: cheap xref parse, no shared page state.
                let doc = pdfium
                    .load_pdf_from_byte_slice(pdf_bytes, password)
                    .map_err(|e| format!("Failed to open PDF in worker: {:?}", e))?;
                let page = doc
                    .pages()
                    .get(i as u16)
                    .map_err(|e| format!("Failed to load page {}: {:?}", i + 1, e))?;
                let longest_pt = page.width().value.max(page.height().value);
                let scale = (MAX_RENDER_EDGE_PX / longest_pt).min(base_scale);
                let capped = scale < base_scale;
                let config = PdfRenderConfig::new().scale_page_by_factor(scale);
                let bitmap = page
                    .render_with_config(&config)
                    .map_err(|e| format!("Failed to render page {}: {:?}", i + 1, e))?;
                let image = bitmap.as_image();
                let (width, height) = (image.width(), image.height());
                let n = done.fetch_add(1, Ordering::SeqCst) + 1;
                progress(n, total);
                Ok(RenderedPageImage {
                    index: i,
                    image,
                    width,
                    height,
                    capped,
                })
            })
            .collect();
        out
    })?;
    pages.sort_by_key(|p| p.index);
    Ok(pages)
}

/// Remove stale `tmp/pdf-*` render dirs left by previous sessions.
pub fn cleanup_tmps(app: &tauri::AppHandle) {
    let tmp = data_dir(app).join("tmp");
    if let Ok(entries) = std::fs::read_dir(&tmp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("pdf-") || name.starts_with("pdf-test-") {
                let p = entry.path();
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(&p);
                } else {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn test_pdfium() -> Pdfium {
        let dir = format!("{}/binaries/pdfium-linux-x64", env!("CARGO_MANIFEST_DIR"));
        let bindings =
            Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(dir.as_str()))
                .expect("bind vendored pdfium");
        Pdfium::new(bindings)
    }

    /// Build a minimal valid PDF with `n` blank Letter pages (no writer dep needed).
    fn minimal_pdf(n: usize) -> Vec<u8> {
        let mut out = Vec::new();
        let mut offsets = Vec::new();
        out.extend_from_slice(b"%PDF-1.4\n");
        // 1: Catalog
        offsets.push(out.len());
        out.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
        // 2: Pages
        let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 3 + i)).collect();
        offsets.push(out.len());
        out.extend_from_slice(
            format!(
                "2 0 obj\n<< /Type /Pages /Kids [{}] /Count {} >>\nendobj\n",
                kids.join(" "),
                n
            )
            .as_bytes(),
        );
        // 3..: Page objects (offsets[i] belongs to object i+1)
        for _ in 0..n {
            offsets.push(out.len());
            let obj_no = offsets.len(); // len 3 after push => object 3
            out.extend_from_slice(
                format!(
                    "{} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
                    obj_no
                )
                .as_bytes(),
            );
        }
        let xref_at = out.len();
        let size = offsets.len() + 1;
        out.extend_from_slice(format!("xref\n0 {}\n", size).as_bytes());
        out.extend_from_slice(b"0000000000 65535 f \n");
        for off in &offsets {
            out.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
                size, xref_at
            )
            .as_bytes(),
        );
        out
    }

    #[test]
    fn renders_pages_in_order_with_progress() {
        let pdfium = test_pdfium();
        let bytes = minimal_pdf(3);
        let calls = Mutex::new(Vec::new());
        let pages = render_pages(&pdfium, &bytes, None, "test.pdf", 150.0 / 72.0, &|done, total| {
            calls.lock().unwrap().push((done, total));
        })
        .expect("render pages");
        assert_eq!(pages.len(), 3);
        assert_eq!(
            pages.iter().map(|p| p.index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        for p in &pages {
            // Letter 8.5x11in @150dpi
            assert_eq!((p.width, p.height), (1275, 1650));
            assert!(!p.capped);
        }
        let mut calls = calls.lock().unwrap().clone();
        calls.sort_unstable();
        assert_eq!(calls, vec![(1, 3), (2, 3), (3, 3)]);
    }

    #[test]
    fn caps_oversized_pages() {
        let pdfium = test_pdfium();
        let bytes = minimal_pdf(1);
        let pages = render_pages(&pdfium, &bytes, None, "test.pdf", 100.0, &|_, _| {})
            .expect("render pages");
        assert_eq!(pages.len(), 1);
        let p = &pages[0];
        assert!(p.capped);
        assert!(p.width.max(p.height) <= MAX_RENDER_EDGE_PX as u32);
    }

    #[test]
    fn corrupt_input_fails_cleanly_without_poisoning() {
        let pdfium = test_pdfium();
        let garbage = vec![0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xfe, 0x41, 0x42];
        let err = render_pages(&pdfium, &garbage, None, "garbage.pdf", 150.0 / 72.0, &|_, _| {})
            .expect_err("garbage must fail");
        assert!(
            err.contains("corrupt") || err.contains("Failed to open"),
            "unexpected error: {}",
            err
        );
        // The process-global Pdfium lock must still work afterwards.
        let bytes = minimal_pdf(2);
        let pages = render_pages(&pdfium, &bytes, None, "test.pdf", 150.0 / 72.0, &|_, _| {})
            .expect("render after corrupt input must succeed");
        assert_eq!(pages.len(), 2);
    }

    #[test]
    fn pool_scales_with_cpu_count() {
        let expect = num_cpus::get().saturating_sub(2).max(1);
        assert_eq!(pool().current_num_threads(), expect);
    }
}
