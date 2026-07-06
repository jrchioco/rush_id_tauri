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
  cropAndProcess: "Crop the selected area and remove the background",
  cropTestMode: "Crop only: no API call (test mode)",
  cancel: "Discard current image and start over",
  print: "Send to printer",
  printAll: "Print all completed slots",
  savePdf: "Export to PDF file",
  startOver: "Clear result and return to image selection",
  processAll: "Crop and process all prepared slots",
} as const;

export type TooltipKey = keyof typeof TOOLTIPS;
