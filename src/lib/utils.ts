import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Blue", value: "#2563eb" },
  { label: "Red", value: "#dc2626" },
  { label: "Yellow", value: "#eab308" },
  { label: "Gray", value: "#6b7280" },
];

export function fmt() {
  return new Date().toLocaleTimeString();
}

export const LABEL_FONT = '"Arial Narrow", "Arial Narrow Bold", "Arial Black", "Open Sans Condensed", "Liberation Sans Narrow", "Open Sans ExtraBold", "Arial", sans-serif';

const LABEL_MIN_FONT_RATIO = 0.20;
const LABEL_MAX_FONT_RATIO = 0.45;
const LABEL_FONT_STEP_PX = 1;
const LABEL_ELLIPSIS = "…";

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  labelH: number,
): { fontSize: number; text: string } {
  const minFontSize = Math.round(labelH * LABEL_MIN_FONT_RATIO);
  let fontSize = Math.round(labelH * LABEL_MAX_FONT_RATIO);

  while (fontSize > minFontSize) {
    ctx.font = `bold ${fontSize}px ${LABEL_FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return { fontSize, text };
    fontSize -= LABEL_FONT_STEP_PX;
  }

  ctx.font = `bold ${minFontSize}px ${LABEL_FONT}`;
  if (ctx.measureText(text).width <= maxWidth) return { fontSize: minFontSize, text };

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = text.slice(0, mid).trimEnd() + LABEL_ELLIPSIS;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return { fontSize: minFontSize, text: text.slice(0, lo).trimEnd() + LABEL_ELLIPSIS };
}

export function applyNameLabel(canvas: HTMLCanvasElement, rawName: string): void {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const labelH = Math.max(40, Math.round(h * 0.15));
  const labelY = h - labelH;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, labelY, w, labelH);
  const text = rawName.trim().toUpperCase();
  if (!text) return;
  const { fontSize, text: fitted } = fitText(ctx, text, w * 0.9, labelH);
  ctx.font = `bold ${fontSize}px ${LABEL_FONT}`;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(fitted, w / 2, labelY + labelH / 2);
}

export function compositeOnColor(base64: string, color: string, name?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      if (name && name.trim()) {
        applyNameLabel(canvas, name);
      }
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = "data:image/png;base64," + base64;
  });
}
