export const TOOLTIPS = {
  testMode: {
    on: "Test — crop/zoom/rotate only, faster processing",
    off: "Live — full background removal (consumes credits)",
  },
  quality: {
    on: "High: 600DPI - better print quality, slower export",
    off: "Flash: 300 DPI - faster export, lower quality",
  },
} as const;

export type TooltipKey = keyof typeof TOOLTIPS;
