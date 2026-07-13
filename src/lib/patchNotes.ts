interface PatchNote {
  title: string;
  date: string;
  notes: string[];
}

export const PATCH_NOTES: Record<string, PatchNote> = {
  "1.19.1": {
    title: "What's New in v1.19.1",
    date: "2026-07-14",
    notes: [
      "Effie now gets excited the moment you click to browse for a file — not just when you drag images in.",
      "Fixed: Effie's excited reaction only fired on the first task, then went quiet until you restarted the app. She now reacts on every drag and every browse, even after finishing work.",
      "Effie's lines got a refresh — new and updated chatter for drag-over, working (including background removal), and idle so she feels more alive while you work.",
      "Added a safety fallback so Effie can't get stuck in her excited state if a file dialog closes unexpectedly (e.g. on some Linux setups).",
    ],
  },
  "1.19.0": {
    title: "What's New in v1.19.0",
    date: "2026-07-11",
    notes: [
      "Welcome Effie, the newest member of our team! She's an assistant who hangs out in the corner and reacts to everything you do.",
      "She greets you on launch, looks busy while processing, cheers on success, and frowns on errors. Drop an image in and she perks up.",
      "Customize Effie: a new \"Effie\" tab in Settings lets you set her quality (Low / Med / High / Ultra) and show or hide her. Your choice is saved automatically.",
      "Hover your cursor around her head and Effie loves a good head-pat",
    ],
  },
  "1.18.2": {
    title: "What's New in v1.18.2",
    date: "2026-07-09",
    notes: [
      "Save PDF remembers last folder — dialog opens to your last save location",
      "Auto-generated filenames — exports now include timestamp (e.g., 1x1-photo-20260709-143022.pdf)",
      "Export tooltip clarity — Print tooltips now explain the file is temporary and auto-deleted on restart",
      "Tab renamed — Gemini tab is now AI Studio (powered by Gemini)",
    ],
  },
  "1.18.1": {
    title: "What's New in v1.18.1",
    date: "2026-07-07",
    notes: [
      "Tooltips on all buttons — every icon-only and action button now shows contextual help on hover",
      "Retouch window tooltips — all tools, sliders, and actions in the retouch editor now have descriptive tooltips",
      "Fixed-position tooltips — tooltips now escape overflow containers, no more clipping issues",
    ],
  },
  "1.18.0": {
    title: "What's New in v1.18.0",
    date: "2026-07-06",
    notes: [
      "New tooltip system — hover any toggle or button for contextual help",
      "New Quality toggle in Other and Polaroid tabs — High (600DPI) for best print quality, Flash (300DPI) for faster export",
      "3R/5R/8R Other tab fix — stitching and slot count now correct for all layouts",
      "5R/8R cropper fix — dropdown now shows correct default slots on first selection",
    ],
  },
  "1.17.1": {
    title: "What's New in v1.17.1",
    date: "2026-07-03",
    notes: [
      "Retouch window — first-open bug fixed (canvas now sizes correctly on initial open)",
      "Clone stamp — pixel-perfect rendering (imageSmoothing disabled on composite)",
      "Clone stamp — per-stroke buffer eliminates dab stacking and opacity compounding",
      "Eraser — per-stroke buffer prevents over-erasure from overlapping dabs",
      "Brush cursor — now matches actual brush size (was incorrectly scaled)",
      "Default hardness raised to 100% (was 50%)",
      "Single tab — fixed SVG template filter (multi/wallet/passport/4R/8R no longer leak into Single)",
      "Stroke interpolation — smooth transitions between pointer events (75% overlap)",
    ],
  },
  "1.17.0": {
    title: "What's New in v1.17.0",
    date: "2026-07-02",
    notes: [
      "New Other tab — size picker, layout picker, and stitching-based PDF export",
      "Wallet size support — 2pcs, 3pcs, 9pcs, 18pcs, 27pcs layouts",
      "3R size support — 2pcs, 4pcs, 6pcs, 8pcs, 10pcs, 12pcs layouts",
      "4R size support — 2pcs, 3pcs, 5pcs, 6pcs layouts",
      "5R size support — 1 to 10pcs",
      "8R size support — 1 to 10pcs",
      "Polaroid 20pcs and 30pcs layouts",
      "Multi-source stitching — composite different SVGs onto separate pages (e.g. 4R 5pcs = 3pcs + 2pcs)",
    ],
  },
  "1.16.0": {
    title: "What's New in v1.16.0",
    date: "2026-06-29",
    notes: [
      "Multi-page PDF overflow — composite output now splits across multiple A4 pages when content exceeds page height",
      "PDF merging via lopdf — new dependency for combining single-page renders into multi-page documents",
      "Dynamic page chunking — slots grouped by actual template heights instead of fixed counts",
    ],
  },
  "1.15.0": {
    title: "What's New in v1.15.0",
    date: "2026-06-28",
    notes: [
      "Multi-provider background removal — remove.bg (primary) + poof.bg (fallback)",
      "API keys refactored to provider-keyed dictionary — eliminates ordering bugs",
      "Settings UI split into two sections — remove.bg and poof.bg managed independently",
      "Auto-migration — old flat api_keys config converted automatically on first launch",
      "Detailed API timing logs — breakdown shows send, download, and write times per request",
    ],
  },
  "1.14.1": {
    title: "What's New in v1.14.1",
    date: "2026-06-26",
    notes: [
      "Dev SVG templates — 3 new layouts (Dev 1x1, Dev 2x2, Dev Mixed) added to Single tab",
      "API key logging — LogsPanel now shows which key was used, HTTP status, response time, and errors",
      "Code cleanup — extracted shared functions, consistent types across all tabs",
    ],
  },
  "1.14.0": {
    title: "What's New in v1.14.0",
    date: "2026-06-24",
    notes: [
      "Tab switch confirmation — switching tabs now warns if you have unsaved work",
      "Single tab template filter — only shows 1x1, 2x2, and Mixed templates",
      "Memory leak fixes — stale state updates no longer crash after navigating away",
      "Image resize for PDF export — oversized images capped to 600×600px, reducing PDF file sizes by up to 10x",
    ],
  },
  "1.13.6": {
    title: "What's New in v1.13.6",
    date: "2026-06-23",
    notes: [
      "Setup screen is now skippable — \"Skip for now\" button lets you start using the app without API keys",
      "Live/Test mode toggle added to Single tab — switch between live API calls and test mode",
      "All tabs now show a \"No API keys — TEST MODE ONLY\" warning when no keys are configured",
      "Multi and Passport tabs auto-enable test mode when no API keys are present",
    ],
  },
  "1.13.5": {
    title: "What's New in v1.13.5",
    date: "2026-06-23",
    notes: [
      "Added 2pcs Polaroid layout (2 landscape slots, 210×60mm strip)",
      "Added 3pcs Polaroid layout (3 portrait slots, 210×94mm strip)",
    ],
  },
  "1.13.4": {
    title: "What's New in v1.13.4",
    date: "2026-06-19",
    notes: [
      "Fixed Polaroid preview aspect ratio not matching the actual SVG template slot dimensions",
      "Fixed export zoomed in when rotation applied — preprocessSlot now matches preview rendering",
      "Fixed pan offset mismatch between preview and export — pan is now resolution-independent",
    ],
  },
  "1.13.3": {
    title: "What's New in v1.13.3",
    date: "2026-06-19",
    notes: [
      "Fixed pan direction inverted at 90°/270° rotation in Polaroid slots",
      "Fixed cover/stretch sizing ignoring rotation angle",
      "Fixed over-panning that allowed dragging images past slot edges",
    ],
  },
  "1.13.2": {
    title: "What's New in v1.13.2",
    date: "2026-06-19",
    notes: [
      "Polaroid preview rewritten — replaced CSS object-fit with canvas rendering for accurate preview",
      "Preview now matches export exactly (uses same math as preprocessSlot)",
      "Fixed images not center-fitting on initial drag-drop",
    ],
  },
  "1.13.1": {
    title: "What's New in v1.13.1",
    date: "2026-06-17",
    notes: [
      "Fixed landscape image preview clipping in Polaroid slots",
      "Added experimental feature warning banner to Polaroid tab",
    ],
  },
  "1.13.0": {
    title: "What's New in v1.13.0",
    date: "2026-06-17",
    notes: [
      "Polaroid tab — load photos into Polaroid-frame slots, reposition/rotate, export to PDF",
      "Two layouts: 5pcs (A5 landscape) and 10pcs (A4 portrait)",
      "Drag-to-pan, per-slot rotation (0/90/180/270), cover/stretch fit modes",
      "Global stretch toggle — apply stretch to all slots at once",
      "Batch import — drop or paste multiple images to fill sequential slots",
    ],
  },
  "1.12.1": {
    title: "What's New in v1.12.1",
    date: "2026-06-17",
    notes: [
      "Fixed retouch eraser progress not saving after Save & Close",
      "Fixed zoom-to-cursor scroll rubber-banding in retouch window",
      "Removed dead exports, unused props, and stale code",
    ],
  },
  "1.12.0": {
    title: "What's New in v1.12.0",
    date: "2026-06-16",
    notes: [
      "Retouch window — clone stamp and eraser tools for editing ID photos",
      "Clone stamp with Alt+click source selection",
      "Eraser with adjustable hardness",
      "Brush size, hardness, and opacity sliders for both tools",
      "Brightness and contrast adjustments",
      "Undo support (Ctrl+Z)",
      "Zoom controls — Ctrl+wheel, Ctrl+0 reset, scroll to pan",
    ],
  },
  "1.11.1": {
    title: "What's New in v1.11.1",
    date: "2026-06-15",
    notes: [
      "Fixed stale template selection after Reset All in Multi and Passport tabs",
    ],
  },
  "1.11.0": {
    title: "What's New in v1.11.0",
    date: "2026-06-15",
    notes: [
      "About tab in Settings — view version, Tauri, React, svg2pdf, and OS info",
      "Patch Notes viewer — scrollable modal with all release history",
      "License viewer — read the J3FF Printing Services license in-app",
      "What's New screen — shows patch notes automatically after each update",
      "View on GitHub link now opens in system browser",
    ],
  },
  "1.10.4": {
    title: "What's New in v1.10.4",
    date: "2026-06-14",
    notes: [
      "Fixed auto-updater installer filename (Windows downloads now work)",
      "Fixed stale template selection bug in Live mode",
    ],
  },
  "1.10.0": {
    title: "What's New in v1.10.0",
    date: "2026-06-11",
    notes: [
      "In-app auto-updater with silent install",
      "Linux auto-update support",
      "Settings modal for managing API keys",
    ],
  },
  "1.9.0": {
    title: "What's New in v1.9.0",
    date: "2026-06-10",
    notes: [
      "Settings modal — edit API keys from within the app",
      "Face overlay guide in cropper for better alignment",
      "Out-of-bounds cropping support",
    ],
  },
  "1.8.0": {
    title: "What's New in v1.8.0",
    date: "2026-06-10",
    notes: [
      "Toast notifications (sonner) for all errors and confirmations",
      "React error boundaries for crash recovery",
      "16 log-only catches now surface errors via toast",
    ],
  },
  "1.7.0": {
    title: "What's New in v1.7.0",
    date: "2026-06-09",
    notes: [
      "Replaced Inkscape with svg2pdf — pure Rust SVG→PDF rendering, no external dependencies",
      "Simplified setup — only API keys needed, no Inkscape path",
    ],
  },
  "1.6.0": {
    title: "What's New in v1.6.0",
    date: "2026-06-05",
    notes: [
      "Font picker — 4 fonts: Arial Black, Narrow Bold, Arial Narrow, Impact",
      "Name + Signature mode — 3-state label cycle (Off → Name → Name+Sig)",
      "Paste support for Multi and Passport tabs",
    ],
  },
  "1.5.0": {
    title: "What's New in v1.5.0",
    date: "2026-06-03",
    notes: [
      "Passport tab — 35×45mm batch workflow for Schengen/standard passport photos",
      "5 slots for 5 different people, each rendered 5× or 10× per page",
      "Test mode toggle for pre-cleared photos",
    ],
  },
  "1.4.0": {
    title: "What's New in v1.4.0",
    date: "2026-06-02",
    notes: [
      "Alt+scroll wheel rotation in cropper (±1° per tick)",
      "Halved zoom/rotation precision for more accurate crop control",
    ],
  },
};

export const GITHUB_RELEASES_URL = "https://github.com/jrchioco/rush_id_tauri/releases";
