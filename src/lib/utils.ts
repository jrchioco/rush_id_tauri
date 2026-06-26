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

const LABEL_FONT = '"Arial Black", "Arial Narrow Bold", "Arial Narrow", "Open Sans ExtraBold", "Open Sans Condensed", "Liberation Sans Narrow", "Arial", sans-serif';

export type FontChoice = "black" | "narrow-bold" | "narrow" | "impact";

export type LabelMode = "off" | "name" | "name-sig";

interface FontOption {
  id: FontChoice;
  label: [string] | [string, string];
  stack: string;
}

const FONT_OPTIONS: FontOption[] = [
  { id: "black",       label: ["ARIAL", "BLACK"], stack: '"Arial Black", "Open Sans ExtraBold", "Liberation Sans Bold", sans-serif' },
  { id: "narrow-bold", label: ["NARROW", "BOLD"], stack: '"Arial Narrow Bold", "Arial Narrow", "Open Sans Condensed Bold", "Liberation Sans Narrow", sans-serif' },
  { id: "narrow",      label: ["ARIAL", "NARROW"], stack: '"Arial Narrow", "Open Sans Condensed", "Liberation Sans Narrow", sans-serif' },
  { id: "impact",      label: ["IMPACT"],            stack: 'Impact, "Arial Black", "Open Sans ExtraBold", sans-serif' },
];

export function getFontOption(id: FontChoice): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0];
}

export function getNextFontChoice(id: FontChoice): FontChoice {
  const idx = FONT_OPTIONS.findIndex((f) => f.id === id);
  return FONT_OPTIONS[(idx + 1) % FONT_OPTIONS.length].id;
}

export function labelArgsFor(
  mode: LabelMode,
  name: string,
  signature: string | null,
  fontChoice: FontChoice,
): { name: string | undefined; signature: string | null; fontStack: string } {
  const fontStack = getFontOption(fontChoice).stack;
  if (mode === "off") return { name: undefined, signature: null, fontStack };
  if (mode === "name") return { name, signature: null, fontStack };
  return { name, signature, fontStack };
}

const LABEL_MIN_FONT_RATIO = 0.20;
const LABEL_MAX_FONT_RATIO = 0.55;
const LABEL_NAME_CEILING_PX = 2;
const LABEL_NAME_FLOORING_PX = 5;
const LABEL_FONT_STEP_PX = 1;
const LABEL_ELLIPSIS = "…";
const LABEL_BAR_RATIO_NAME = 0.15;
const LABEL_BAR_RATIO_SIG = 0.20;
const LABEL_BAR_MIN_NAME = 40;
const LABEL_BAR_MIN_SIG = 60;
const LABEL_SIG_REGION_RATIO = 0.50;

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  labelH: number,
  fontStack: string = LABEL_FONT,
  maxFontSize?: number,
): { fontSize: number; text: string } {
  const minFontSize = Math.round(labelH * LABEL_MIN_FONT_RATIO);
  let fontSize = maxFontSize ?? Math.round(labelH * LABEL_MAX_FONT_RATIO);

  while (fontSize > minFontSize) {
    ctx.font = `bold ${fontSize}px ${fontStack}`;
    if (ctx.measureText(text).width <= maxWidth) return { fontSize, text };
    fontSize -= LABEL_FONT_STEP_PX;
  }

  ctx.font = `bold ${minFontSize}px ${fontStack}`;
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

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const imgAR = img.naturalWidth / img.naturalHeight;
  const regionAR = w / h;
  let dw: number;
  let dh: number;
  if (imgAR > regionAR) {
    dw = w;
    dh = w / imgAR;
  } else {
    dh = h;
    dw = h * imgAR;
  }
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

async function applyNameLabel(
  canvas: HTMLCanvasElement,
  rawName?: string,
  signatureDataUrl?: string | null,
  fontStack: string = LABEL_FONT,
): Promise<void> {
  const ctx = canvas.getContext("2d")!;
  const w = canvas.width;
  const h = canvas.height;
  const hasSignature = !!signatureDataUrl;
  const labelH = hasSignature
    ? Math.max(LABEL_BAR_MIN_SIG, Math.round(h * LABEL_BAR_RATIO_SIG))
    : Math.max(LABEL_BAR_MIN_NAME, Math.round(h * LABEL_BAR_RATIO_NAME));
  const labelY = h - labelH;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, labelY, w, labelH);
  const text = (rawName ?? "").trim().toUpperCase();
  if (!text && !hasSignature) return;

  if (hasSignature) {
    const sigRegionH = Math.round(labelH * LABEL_SIG_REGION_RATIO);
    const nameRegionH = labelH - sigRegionH;
    const sigImg = await loadImage(signatureDataUrl);
    drawContainedImage(ctx, sigImg, 0, labelY, w, sigRegionH);
    if (text) {
      const maxFont = nameRegionH - LABEL_NAME_CEILING_PX - LABEL_NAME_FLOORING_PX;
      const { fontSize, text: fitted } = fitText(ctx, text, w * 0.95, nameRegionH, fontStack, maxFont);
      const textTop = labelY + sigRegionH + LABEL_NAME_CEILING_PX;
      const textBottom = labelY + labelH - LABEL_NAME_FLOORING_PX;
      const textY = textTop + (textBottom - textTop - fontSize) / 2 + fontSize;
      ctx.font = `bold ${fontSize}px ${fontStack}`;
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(fitted, w / 2, textY);
    }
  } else if (text) {
    const { fontSize, text: fitted } = fitText(ctx, text, w * 0.95, labelH, fontStack);
    ctx.font = `bold ${fontSize}px ${fontStack}`;
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitted, w / 2, labelY + labelH / 2);
  }
}

export async function compositeOnColor(
  base64: string,
  color: string,
  name?: string,
  signatureDataUrl?: string | null,
  fontStack: string = LABEL_FONT,
): Promise<string> {
  const img = await loadImage("data:image/png;base64," + base64);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  if ((name && name.trim()) || signatureDataUrl) {
    await applyNameLabel(canvas, name, signatureDataUrl, fontStack);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}
