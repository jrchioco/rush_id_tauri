//! Phase 1 test harness: render every page of a PDF to PNG via bundled PDFium.
//!
//! Usage (from repo root):
//!   cargo run --example pdf_render -- /path/to/file.pdf [dpi]
//!
//! Binds to the vendored `src-tauri/binaries/pdfium-linux-x64/libpdfium.so`
//! (or `pdfium-win-x64/pdfium.dll` on Windows) — the same binaries the
//! Tauri command `pdf_test_render` loads from the bundle at runtime.

use pdfium_render::prelude::*;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pdf_path = std::env::args()
        .nth(1)
        .expect("usage: pdf_render <pdf-path> [dpi]");
    let dpi: u32 = std::env::args()
        .nth(2)
        .map(|s| s.parse().expect("dpi must be a number"))
        .unwrap_or(200)
        .clamp(72, 600);
    let scale = dpi as f32 / 72.0;

    #[cfg(target_os = "windows")]
    let lib_dir = format!("{}/binaries/pdfium-win-x64", env!("CARGO_MANIFEST_DIR"));
    #[cfg(not(target_os = "windows"))]
    let lib_dir = format!("{}/binaries/pdfium-linux-x64", env!("CARGO_MANIFEST_DIR"));

    let bindings = Pdfium::bind_to_library(Pdfium::pdfium_platform_library_name_at_path(
        lib_dir.as_str(),
    ))?;
    let pdfium = Pdfium::new(bindings);

    let document = pdfium.load_pdf_from_file(&pdf_path, None)?;
    let page_count = document.pages().len();
    println!("pages: {} @ {} dpi", page_count, dpi);

    let out_dir = std::path::PathBuf::from("/tmp/pdf-phase1-test");
    std::fs::create_dir_all(&out_dir)?;
    for i in 0..page_count {
        let page = document.pages().get(i)?;
        let bitmap = page.render_with_config(
            &PdfRenderConfig::new().scale_page_by_factor(scale),
        )?;
        let image = bitmap.as_image();
        let out = out_dir.join(format!("page-{:03}.png", i + 1));
        println!(
            "page {}: {}x{} -> {}",
            i + 1,
            image.width(),
            image.height(),
            out.display()
        );
        image.save(&out)?;
    }
    println!("done: {}", out_dir.display());
    Ok(())
}
