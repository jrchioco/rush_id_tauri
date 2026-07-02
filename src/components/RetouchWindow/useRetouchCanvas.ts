import { useRef, useState, useCallback, useEffect } from "react";

type Tool = "clone" | "eraser";

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

interface CanvasPair {
  base: ImageData;
  draw: ImageData;
}

function makeHardnessGradient(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hardness: number,
): CanvasGradient {
  const inner = hardness / 100;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, "rgba(0,0,0,1)");
  gradient.addColorStop(Math.min(inner, 0.99), "rgba(0,0,0,1)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  return gradient;
}

export function useRetouchCanvas() {
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cloneSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const undoStackRef = useRef<CanvasPair[]>([]);
  const postUndoLengthRef = useRef<number | null>(null);
  const isDrawingRef = useRef(false);
  const strokeStartRef = useRef<{ x: number; y: number } | null>(null);
  const cloneSourceRef = useRef<CloneSource | null>(null);
  const baseTransformRef = useRef<CanvasTransform>({ scale: 1, offsetX: 0, offsetY: 0, displayW: 0, displayH: 0 });
  const zoomOffsetRef = useRef({ dx: 0, dy: 0 });

  const [tool, setTool] = useState<Tool>("clone");
  const [brushSize, setBrushSize] = useState(30);
  const [opacity, setOpacity] = useState(1.0);
  const [hardness, setHardness] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [canUndo, setCanUndo] = useState(false);
  const [cloneSource, setCloneSource] = useState<CloneSource | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [viewVersion, setViewVersion] = useState(0);

  const toImageCoords = useCallback((displayX: number, displayY: number) => {
    const b = baseTransformRef.current;
    const zdx = zoomOffsetRef.current.dx;
    const zdy = zoomOffsetRef.current.dy;
    return {
      x: (displayX - b.offsetX - zdx) / (b.scale * zoom),
      y: (displayY - b.offsetY - zdy) / (b.scale * zoom),
    };
  }, [zoom]);

  const pushUndo = useCallback((pre: CanvasPair) => {
    const stack = undoStackRef.current;
    if (postUndoLengthRef.current !== null) {
      stack.length = postUndoLengthRef.current;
      postUndoLengthRef.current = null;
    }
    if (stack.length >= MAX_UNDO) stack.shift();
    stack.push(pre);
    setCanUndo(stack.length > 0);
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const baseCanvas = baseCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!baseCanvas || !drawCanvas) return;
    const baseCtx = baseCanvas.getContext("2d");
    const drawCtx = drawCanvas.getContext("2d");
    if (!baseCtx || !drawCtx) return;
    const pair = stack.pop()!;
    baseCtx.putImageData(pair.base, 0, 0);
    drawCtx.putImageData(pair.draw, 0, 0);
    postUndoLengthRef.current = stack.length;
    setCanUndo(stack.length > 0);
    updateCloneSource();
  }, []);

  const updateCloneSource = useCallback(() => {
    const baseCanvas = baseCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    const cloneCanvas = cloneSourceCanvasRef.current;
    if (!baseCanvas || !drawCanvas || !cloneCanvas) return;
    cloneCanvas.width = baseCanvas.width;
    cloneCanvas.height = baseCanvas.height;
    const ctx = cloneCanvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.drawImage(drawCanvas, 0, 0);
  }, []);

  const resetCanvas = useCallback(() => {
    const drawCanvas = drawCanvasRef.current;
    const baseCanvas = baseCanvasRef.current;
    if (!drawCanvas || !baseCanvas) return;
    const drawCtx = drawCanvas.getContext("2d");
    const baseCtx = baseCanvas.getContext("2d");
    if (!drawCtx || !baseCtx) return;
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    const img = originalImageRef.current;
    if (img) baseCtx.drawImage(img, 0, 0);
    undoStackRef.current = [];
    postUndoLengthRef.current = null;
    setCanUndo(false);
    setBrightness(100);
    setContrast(100);
    setBrushSize(30);
    setOpacity(1.0);
    setHardness(50);
    setZoom(1);
    zoomOffsetRef.current = { dx: 0, dy: 0 };
    setCloneSource(null);
    cloneSourceRef.current = null;
    baseCanvas.style.filter = "none";
    updateCloneSource();
  }, [updateCloneSource]);

  const loadSource = useCallback((src: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        originalImageRef.current = img;
        undoStackRef.current = [];
        postUndoLengthRef.current = null;
        setCanUndo(false);
        setCloneSource(null);
        cloneSourceRef.current = null;
        setBrightness(100);
        setContrast(100);
        setZoom(1);
        zoomOffsetRef.current = { dx: 0, dy: 0 };

        const baseCanvas = baseCanvasRef.current;
        const drawCanvas = drawCanvasRef.current;
        const cloneCanvas = cloneSourceCanvasRef.current;
        if (!baseCanvas || !drawCanvas) { resolve(); return; }

        baseCanvas.width = img.naturalWidth;
        baseCanvas.height = img.naturalHeight;
        drawCanvas.width = img.naturalWidth;
        drawCanvas.height = img.naturalHeight;
        if (cloneCanvas) {
          cloneCanvas.width = img.naturalWidth;
          cloneCanvas.height = img.naturalHeight;
        }

        const baseCtx = baseCanvas.getContext("2d")!;
        baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
        baseCtx.drawImage(img, 0, 0);
        baseCanvas.style.filter = "none";

        const drawCtx = drawCanvas.getContext("2d", { willReadFrequently: true })!;
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

        updateCloneSource();
        setViewVersion(v => v + 1);
        resolve();
      };
      img.onerror = () => reject(new Error("Failed to load retouch image"));
      img.src = src;
    });
  }, [updateCloneSource]);

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
    baseTransformRef.current = t;
    return t;
  }, []);

  const paintClone = useCallback((displayX: number, displayY: number) => {
    const drawCanvas = drawCanvasRef.current;
    const cloneCanvas = cloneSourceCanvasRef.current;
    const start = strokeStartRef.current;
    const source = cloneSourceRef.current;
    if (!drawCanvas || !cloneCanvas || !start || !source) return;
    const ctx = drawCanvas.getContext("2d");
    if (!ctx) return;

    const imgX = (displayX - baseTransformRef.current.offsetX - zoomOffsetRef.current.dx) / (baseTransformRef.current.scale * zoom);
    const imgY = (displayY - baseTransformRef.current.offsetY - zoomOffsetRef.current.dy) / (baseTransformRef.current.scale * zoom);
    const startImgX = (start.x - baseTransformRef.current.offsetX - zoomOffsetRef.current.dx) / (baseTransformRef.current.scale * zoom);
    const startImgY = (start.y - baseTransformRef.current.offsetY - zoomOffsetRef.current.dy) / (baseTransformRef.current.scale * zoom);
    const srcX = source.x + (imgX - startImgX);
    const srcY = source.y + (imgY - startImgY);
    const brushImgSize = brushSize / (baseTransformRef.current.scale * zoom);

    ctx.save();
    ctx.beginPath();
    ctx.arc(imgX, imgY, brushImgSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = opacity;
    ctx.drawImage(
      cloneCanvas,
      srcX - brushImgSize / 2, srcY - brushImgSize / 2, brushImgSize, brushImgSize,
      imgX - brushImgSize / 2, imgY - brushImgSize / 2, brushImgSize, brushImgSize,
    );

    if (hardness < 100) {
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-out";
      const grad = makeHardnessGradient(ctx, imgX, imgY, brushImgSize / 2, hardness);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(imgX, imgY, brushImgSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [brushSize, opacity, hardness, zoom]);

  const paintEraser = useCallback((displayX: number, displayY: number) => {
    const drawCanvas = drawCanvasRef.current;
    const baseCanvas = baseCanvasRef.current;
    if (!drawCanvas || !baseCanvas) return;
    const drawCtx = drawCanvas.getContext("2d");
    const baseCtx = baseCanvas.getContext("2d");
    if (!drawCtx || !baseCtx) return;

    const imgX = (displayX - baseTransformRef.current.offsetX - zoomOffsetRef.current.dx) / (baseTransformRef.current.scale * zoom);
    const imgY = (displayY - baseTransformRef.current.offsetY - zoomOffsetRef.current.dy) / (baseTransformRef.current.scale * zoom);
    const brushImgSize = brushSize / (baseTransformRef.current.scale * zoom);

    drawCtx.save();
    drawCtx.globalCompositeOperation = "destination-out";
    const drawGrad = makeHardnessGradient(drawCtx, imgX, imgY, brushImgSize / 2, hardness);
    drawCtx.fillStyle = drawGrad;
    drawCtx.beginPath();
    drawCtx.arc(imgX, imgY, brushImgSize / 2, 0, Math.PI * 2);
    drawCtx.fill();
    drawCtx.restore();

    baseCtx.save();
    baseCtx.globalCompositeOperation = "destination-out";
    const baseGrad = makeHardnessGradient(baseCtx, imgX, imgY, brushImgSize / 2, hardness);
    baseCtx.fillStyle = baseGrad;
    baseCtx.beginPath();
    baseCtx.arc(imgX, imgY, brushImgSize / 2, 0, Math.PI * 2);
    baseCtx.fill();
    baseCtx.restore();
  }, [brushSize, hardness, zoom]);

  const flattenAndSave = useCallback((): string | null => {
    const drawCanvas = drawCanvasRef.current;
    const baseCanvas = baseCanvasRef.current;
    if (!drawCanvas || !baseCanvas) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = baseCanvas.width;
    offscreen.height = baseCanvas.height;
    const ctx = offscreen.getContext("2d")!;
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    ctx.drawImage(baseCanvas, 0, 0);
    ctx.filter = "none";
    ctx.drawImage(drawCanvas, 0, 0);

    return offscreen.toDataURL("image/png");
  }, [brightness, contrast]);

  useEffect(() => {
    const baseCanvas = baseCanvasRef.current;
    if (!baseCanvas) return;
    baseCanvas.style.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
  }, [brightness, contrast]);

  const resetView = useCallback(() => {
    setZoom(1);
    zoomOffsetRef.current = { dx: 0, dy: 0 };
    setViewVersion(v => v + 1);
  }, []);

  const setAltHeldState = useCallback((held: boolean) => {
    setAltHeld(held);
  }, []);

  return {
    baseCanvasRef,
    drawCanvasRef,
    cloneSourceCanvasRef,
    tool,
    setTool,
    brushSize,
    setBrushSize,
    opacity,
    setOpacity,
    hardness,
    setHardness,
    brightness,
    setBrightness,
    contrast,
    setContrast,
    zoom,
    setZoom,
    canUndo,
    cloneSource,
    setCloneSource,
    cloneSourceRef,
    altHeld,
    setAltHeld: setAltHeldState,
    isDrawingRef,
    strokeStartRef,
    transformRef: baseTransformRef,
    zoomOffsetRef,
    loadSource,
    computeTransform,
    toImageCoords,
    paintClone,
    paintEraser,
    pushUndo,
    undo,
    resetCanvas,
    resetView,
    viewVersion,
    flattenAndSave,
    updateCloneSource,
  };
}
