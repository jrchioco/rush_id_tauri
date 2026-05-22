# Rush ID

Crop ID photos, remove backgrounds via the RemoveBG API, overlay onto SVG templates, then print or export PDF.

Built with **Tauri v2 + React 19 + TypeScript + Tailwind CSS**.

## Features

- Drag-and-drop or file picker for image input
- 1:1 crop with `react-easy-crop`
- Background removal via RemoveBG API (with key rotation)
- Background color picker (White, Blue, Red, Yellow, Gray, or custom hex)
- SVG template selection for ID photo layouts
- Direct printing via CUPS (Linux) or open PDF (Windows)
- PDF export via Inkscape CLI

## Prerequisites

- [Inkscape](https://inkscape.org/) installed and in PATH
- CUPS with a configured printer (for Linux printing)
- A RemoveBG API key

## Setup

```bash
git clone https://github.com/jrchioco/rush_id_tauri.git
cd rush_id_tauri
npm install
```

Create `src-tauri/config.json`:

```json
{
  "input_folder_path": "input",
  "output_folder_path": ".",
  "api_keys": ["your-removebg-api-key"],
  "inkscape_path": "inkscape",
  "svg_files": {
    "1": "SVGs/1x1.svg",
    "2": "SVGs/2x2.svg",
    "3": "SVGs/Mixed.svg"
  }
}
```

## Development

```bash
npm run tauri dev
```

## Production Build

```bash
npm run tauri build
```

Produces a binary in `src-tauri/target/release/` and `.deb`/`.rpm` packages.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Tailwind CSS, Vite |
| Backend | Rust, Tauri v2 |
| Crop | react-easy-crop |
| Icons | lucide-react |
| API | RemoveBG (multipart POST) |
| PDF | Inkscape CLI |
| Printing | CUPS (lpr) / Windows `start` |
