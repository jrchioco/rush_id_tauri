import { readFile } from "@tauri-apps/plugin-fs";

// Flag a source as oversized once its long edge exceeds this (px).
const OVERSIZED_THRESHOLD_PX = 4000;

// Cap the cropper's working image to this on the long edge for oversized sources.
// Backend resize_if_needed caps final output at NO_API_MAX_PX = 600, so ~1400 gives
// ~2x headroom — a reasonably tight crop still lands at 600px+ without carrying
// 50MP of dead weight through crop, background-removal upload, and export.
const CROPPER_WORK_MAX_PX = 1400;

export interface CropperImageLoad {
  dataUrl: string;
  width: number;
  height: number;
  oversized: boolean;
  fileName: string;
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image as data URL"));
    reader.readAsDataURL(blob);
  });
}

// Cheap header-only dimension check — browsers resolve naturalWidth/Height from the
// file header without a full pixel decode. Do NOT use createImageBitmap here (that
// forces a full decode, defeating the purpose of the cheap check).
function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image dimensions"));
    };
    img.src = url;
  });
}

function bitmapToDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");
  ctx.drawImage(bitmap, 0, 0);
  return canvas.toDataURL("image/png");
}

// Loads an image for the cropper, downscaling oversized sources ONCE (the resize is
// the cropper's decode — never decode twice). Accepts a File (input/paste) or a
// Tauri file path (drag-drop).
export async function loadCropperImage(source: File | string): Promise<CropperImageLoad> {
  let blob: Blob;
  let fileName: string;

  if (source instanceof File) {
    blob = source;
    fileName = source.name;
  } else {
    const bytes = await readFile(source);
    blob = new Blob([bytes], { type: mimeFromPath(source) });
    fileName = source.split(/[\\/]/).pop() ?? source;
  }

  const { width, height } = await getImageDimensions(blob);
  const longEdge = Math.max(width, height);

  if (longEdge <= OVERSIZED_THRESHOLD_PX) {
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl, width, height, oversized: false, fileName };
  }

  const scale = CROPPER_WORK_MAX_PX / longEdge;
  const resizeWidth = Math.max(1, Math.round(width * scale));
  const resizeHeight = Math.max(1, Math.round(height * scale));
  const bitmap = await createImageBitmap(blob, {
    resizeWidth,
    resizeHeight,
    resizeQuality: "medium",
  });
  try {
    const dataUrl = bitmapToDataUrl(bitmap);
    return { dataUrl, width, height, oversized: true, fileName };
  } finally {
    bitmap.close();
  }
}
