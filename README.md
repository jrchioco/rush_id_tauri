# Rush ID

This project is source-available, not open source. See the [LICENSE](LICENSE) file for details.

Crop ID photos, remove backgrounds via the RemoveBG API, overlay onto SVG templates, then print or export PDF.

Built with **Tauri v2 + React 19 + TypeScript + Tailwind CSS**.

## Screenshots

![Batch cropping with rotation and face guide](screenshots/multi-crop.webp)
![Background color selection](screenshots/multi-color.webp)
![Template selection and batch export](screenshots/multi-template.webp)
![PDF output](screenshots/pdf-output.webp)

## Features

- Drag-and-drop, file picker, or clipboard paste (Ctrl+V) for image input
- 1:1 crop with `react-easy-crop` (ID photos) and 35×45mm crop (passport photos)
- Face guide overlay for positioning
- Rotation control with slider, numeric input, and Alt+scroll wheel
- Background removal via RemoveBG API (with key rotation across multiple API keys)
- Background color picker (White, Blue, Red, Yellow, Gray, or custom hex)
- Name label and signature overlay with font selection (Arial Black, Narrow Bold, Arial Narrow, Impact)
- SVG template selection for ID photo layouts (1x1, 2x2, Mixed, passport)
- Batch processing — up to 5 clients simultaneously
- Print via OS dialog (opens PDF, user presses Ctrl+P)
- PDF export via svg2pdf (pure Rust, no external dependencies)
- Auto-updater with signed releases
- Settings modal to manage API keys

## Tabs

- **Single** — Process one photo at a time
- **Multi** — Batch workflow with up to 5 clients (1:1 ID photos)
- **Passport** — Batch workflow with up to 5 clients (35×45mm passport photos)
- **Gemini** — AI image generation (coming soon)

## Prerequisites

- Windows 10 or later (WebView2 pre-installed) or Linux (Debian/Ubuntu)
- A RemoveBG API key

## Installation

Download the latest installer from the [Releases](https://github.com/jrchioco/rush_id_tauri/releases) page.

- **Windows:** `.msi` installer
- **Linux:** `.deb` package

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

Produces `.msi` (Windows) and `.deb` (Linux) in `src-tauri/target/release/bundle/`.

For signed builds (required for auto-updater), set the signing key and password as env vars before building (ask the team for the password).

## Release

Tag a version to trigger the CI/CD pipeline:

```bash
git tag v1.9.0
git push origin v1.9.0
```

This builds, signs, creates a GitHub Release, and uploads the installers + update manifest.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS, Vite |
| Backend | Rust, Tauri v2 |
| Crop | react-easy-crop |
| Icons | lucide-react |
| Notifications | sonner |
| API | RemoveBG (multipart POST) |
| PDF / Print | svg2pdf (pure Rust) |
