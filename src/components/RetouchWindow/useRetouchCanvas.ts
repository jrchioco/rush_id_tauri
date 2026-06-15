import { useRef, useState, useCallback, useEffect } from "react";

export type Tool = "clone" | "eraser";

const MAX_UNDO = 20;

interface CloneSource {
  x: number;
  y: number;
}

interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  displayW: number;
  displayH: number;
}

export function useRetouchCanvas(_imageDataUrl: string) {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const isDrawingRef = useRef(false);
  const strokeStartRef = useRef<{ x: number; y: number } | null>(null);
  const cloneSourceRef = useRef<CloneSource | null>(null);
  const altHeldRef = useRef(false);
  const transformRef = useRef<CanvasTransform>({ scale: 1, offsetX: 0, offsetY: 0, displayW: 0, displayH: 0 });

  const [tool, setTool] = useState<Tool>("clone");
  const [brushSize, setBrushSize] = useState(30);
  const [opacity, setOpacity] = useState(1.0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [canUndo, setCanUndo] = useState(false);
  const [cloneSource, setCloneSource] = useState<CloneSource | null>(null);
  const [altHeld, setAltHeld] = useState(false);

  const toImageCoords = useCallback((displayX: number, displayY: number) => {
    const t = transformRef.current;
    return {
      x: (displayX - t.offsetX) / t.scale,
      y: (displayY - t.offsetY) / t.scale,
    };
  }, []);

  const pushUndo = useCallback(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const stack = undoStackRef.current;
    if (stack.length >= MAX_UNDO) stack.shift();
    stack.push(data);
    setCanUndo(stack.length > 0);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const data = stack.pop()!;
    ctx.putImageData(data, 0, 0);
    setCanUndo(stack.length > 0);
  }, []);

  const resetCanvas = useCallback(() => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    undoStackRef.current = [];
    setCanUndo(false);
    setBrightness(100);
    setContrast(100);
    setBrushSize(30);
    setOpacity(1.0);
    setCloneSource(null);
    cloneSourceRef.current = null;
  }, []);

  const renderBaseCanvas = useCallback(() => {
    const canvas = baseCanvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    ctx.drawImage(img, 0, 0);
    ctx.filter = "none";
  }, [brightness, contrast]);

  const loadSource = useCallback((src: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        originalImageRef.current = img;
        undoStackRef.current = [];
        setCanUndo(false);
        setCloneSource(null);
        cloneSourceRef.current = null;

        const baseCanvas = baseCanvasRef.current;
        const drawCanvas = drawCanvasRef.current;
        if (!baseCanvas || !drawCanvas) { resolve(); return; }

        baseCanvas.width = img.naturalWidth;
        baseCanvas.height = img.naturalHeight;
        drawCanvas.width = img.naturalWidth;
        drawCanvas.height = img.naturalHeight;

        const baseCtx = baseCanvas.getContext("2d")!;
        baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
        baseCtx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
        baseCtx.drawImage(img, 0, 0);
        baseCtx.filter = "none";

        const drawCtx = drawCanvas.getContext("2d", { willReadFrequently: true })!;
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

        resolve();
      };
      img.onerror = () => reject(new Error("Failed to load retouch image"));
      img.src = src;
    });
  }, [brightness, contrast]);

  const computeTransform = useCallback((containerW: number, containerH: number) => {
    const img = originalImageRef.current;
    if (!img) return { scale: 1, offsetX: 0, offsetY: 0, displayW: 0, displayH: 0 };
    const imgAR = img.naturalWidth / img.naturalHeight;
    const regionAR = containerW / containerH;
    let dw: number;
    let dh: number;
    if (imgAR > regionAR) {
      dw = containerW;
      dh = containerW / imgAR;
    } else {
      dh = containerH;
      dw = containerH * imgAR;
    }
    const ox = (containerW - dw) / 2;
    const oy = (containerH - dh) / 2;
    const scale = dw / img.naturalWidth;
    const t = { scale, offsetX: ox, offsetY: oy, displayW: dw, displayH: dh };
    transformRef.current = t;
    return t;
  }, []);

  const paintClone = useCallback((displayX: number, displayY: number) => {
    const drawCanvas = drawCanvasRef.current;
    const baseCanvas = baseCanvasRef.current;
    const start = strokeStartRef.current;
    const source = cloneSourceRef.current;
    if (!drawCanvas || !baseCanvas || !start || !source) return;
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;

    const t = transformRef.current;
    const imgX = (displayX - t.offsetX) / t.scale;
    const imgY = (displayY - t.offsetY) / t.scale;
    const startImgX = (start.x - t.offsetX) / t.scale;
    const startImgY = (start.y - t.offsetY) / t.scale;
    const srcX = source.x + (imgX - startImgX);
    const srcY = source.y + (imgY - startImgY);
    const brushImgSize = brushSize / t.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(imgX, imgY, brushImgSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = opacity;
    ctx.drawImage(
      baseCanvas,
      srcX - brushImgSize / 2, srcY - brushImgSize / 2, brushImgSize, brushImgSize,
      imgX - brushImgSize / 2, imgY - brushImgSize / 2, brushImgSize, brushImgSize,
    );
    ctx.restore();
  }, [brushSize, opacity]);

  const paintEraser = useCallback((displayX: number, displayY: number) => {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas) return;
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;

    const t = transformRef.current;
    const imgX = (displayX - t.offsetX) / t.scale;
    const imgY = (displayY - t.offsetY) / t.scale;
    const brushImgSize = brushSize / t.scale;

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const gradient = ctx.createRadialGradient(imgX, imgY, 0, imgX, imgY, brushImgSize / 2);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(imgX, imgY, brushImgSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [brushSize]);

  const flattenAndSave = useCallback((): string | null => {
    const baseCanvas = baseCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    const img = originalImageRef.current;
    if (!baseCanvas || !drawCanvas || !img) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext("2d")!;
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    ctx.drawImage(img, 0, 0);
    ctx.filter = "none";
    ctx.drawImage(drawCanvas, 0, 0);

    return offscreen.toDataURL("image/png");
  }, [brightness, contrast]);

  useEffect(() => {
    renderBaseCanvas();
  }, [brightness, contrast, renderBaseCanvas]);

  const setAltHeldState = useCallback((held: boolean) => {
    altHeldRef.current = held;
    setAltHeld(held);
  }, []);

  return {
    baseCanvasRef,
    drawCanvasRef,
    tool,
    setTool,
    brushSize,
    setBrushSize,
    opacity,
    setOpacity,
    brightness,
    setBrightness,
    contrast,
    setContrast,
    canUndo,
    cloneSource,
    setCloneSource,
    cloneSourceRef,
    altHeld,
    setAltHeld: setAltHeldState,
    altHeldRef,
    isDrawingRef,
    strokeStartRef,
    transformRef,
    loadSource,
    computeTransform,
    toImageCoords,
    paintClone,
    paintEraser,
    pushUndo,
    undo,
    resetCanvas,
    flattenAndSave,
  };
}
