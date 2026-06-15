export interface PatchNote {
  title: string;
  date: string;
  notes: string[];
}

export const PATCH_NOTES: Record<string, PatchNote> = {
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
