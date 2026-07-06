export const TOOLTIPS = {
  testMode: {
    on: "Test: crop/zoom/rotate only, faster processing",
    off: "Live: full background removal (consumes credits)",
  },
  quality: {
    on: "High: 600DPI - better print quality, slower export",
    off: "Flash: 300 DPI - faster export, lower quality",
  },
  resetAll: "Clear all slots, Start Fresh",
  clearAll: "Clear all images: keeps layout and settings",
  removeImage: "Remove image from slot",
  rotate90: "Rotate 90 degrees",
  toggleFitCover: "Cover mode: drag to reposition",
  toggleFitStretch: "Stretch mode: fills entire frame",
} as const;

export type TooltipKey = keyof typeof TOOLTIPS;
