interface PatchNote {
  title: string;
  date: string;
  notes: string[];
}

export const PATCH_NOTES: Record<string, PatchNote> = {
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
