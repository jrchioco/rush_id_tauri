# Rush ID

This project is source-available, not open source. See the [LICENSE](LICENSE) file for details.

Crop ID photos, remove backgrounds via the RemoveBG API, overlay onto SVG templates, then print or export PDF.

Built with **Tauri v2 + React 19 + TypeScript + Tailwind CSS**.

## Features

- Drag-and-drop or file picker for image input
- Paste from clipboard (Ctrl+V)
- 1:1 crop with `react-easy-crop`
- Background removal via RemoveBG API (with key rotation)
- Background color picker (White, Blue, Red, Yellow, Gray, or custom hex)
- SVG template selection for ID photo layouts
- Print via OS dialog (opens PDF, user presses Ctrl+P)
- PDF export via Inkscape CLI

## Prerequisites

- Windows 10 or later (WebView2 pre-installed)
- [Inkscape](https://inkscape.org/) installed (for PDF export and printing). If not in PATH, you can browse for it in the setup screen.
- A RemoveBG API key

## Installation

Download the latest `.exe` installer from the [Releases](https://github.com/jrchioco/rush_id_tauri/releases) page.

On first launch, you'll be prompted to enter your RemoveBG API key(s). Everything else is auto-configured.

## Development

```bash
git clone https://github.com/jrchioco/rush_id_tauri.git
cd rush_id_tauri
npm install
npm run tauri dev
```

## Production Build

```bash
npm run tauri build
```

Produces MSI and NSIS installers in `src-tauri/target/release/bundle/`.

For signed builds (required for auto-updater), set the signing key and password as env vars before building (ask the team for the password).

## Release

Tag a version to trigger the CI/CD pipeline:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This builds, signs, creates a GitHub Release, and uploads the installers + update manifest.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS, Vite |
| Backend | Rust, Tauri v2 |
| Crop | react-easy-crop |
| Icons | lucide-react |
| API | RemoveBG (multipart POST) |
| PDF / Print | Inkscape CLI |
