import { useRef, useEffect, useCallback } from "react";
import type { useRetouchCanvas } from "./useRetouchCanvas";

interface RetouchCanvasProps {
  state: ReturnType<typeof useRetouchCanvas>;
}

export function RetouchCanvas({ state }: RetouchCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const preStrokePairRef = useRef<{ base: ImageData; draw: ImageData } | null>(null);

  const {
    baseCanvasRef,
    drawCanvasRef,
    cloneSourceCanvasRef,
    tool,
    zoom,
    setZoom,
    cloneSource,
    altHeld,
    isDrawingRef,
    strokeStartRef,
    cloneSourceRef,
    transformRef,
    zoomOffsetRef,
    computeTransform,
    paintClone,
    paintEraser,
    pushUndo,
    setCloneSource,
    updateCloneSource,
  } = state;

  const resize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const t = computeTransform(rect.width, rect.height);
    const z = zoom;
    const zdx = zoomOffsetRef.current.dx;
    const zdy = zoomOffsetRef.current.dy;

    const baseCanvas = baseCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!baseCanvas || !drawCanvas) return;

    const scaledW = t.displayW * z;
    const scaledH = t.displayH * z;

    baseCanvas.style.width = `${scaledW}px`;
    baseCanvas.style.height = `${scaledH}px`;
    baseCanvas.style.left = `${t.offsetX + zdx}px`;
    baseCanvas.style.top = `${t.offsetY + zdy}px`;

    drawCanvas.style.width = `${scaledW}px`;
    drawCanvas.style.height = `${scaledH}px`;
    drawCanvas.style.left = `${t.offsetX + zdx}px`;
    drawCanvas.style.top = `${t.offsetY + zdy}px`;

    const cursorCanvas = cursorCanvasRef.current;
    if (cursorCanvas) {
      cursorCanvas.width = rect.width;
      cursorCanvas.height = rect.height;
      cursorCanvas.style.width = `${rect.width}px`;
      cursorCanvas.style.height = `${rect.height}px`;
    }
  }, [baseCanvasRef, drawCanvasRef, computeTransform, zoom, zoomOffsetRef]);

  useEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault();
        state.setAltHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        state.setAltHeld(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [state.setAltHeld]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;

      const b = transformRef.current;
      const z = zoom;
      const newZoom = Math.min(5, Math.max(1, z + (e.deltaY > 0 ? -0.25 : 0.25)));
      const newScale = b.scale * newZoom;

      const canvasX = (cursorX - b.offsetX - zoomOffsetRef.current.dx) / (b.scale * z);
      const canvasY = (cursorY - b.offsetY - zoomOffsetRef.current.dy) / (b.scale * z);

      const newDx = cursorX - b.offsetX - canvasX * newScale;
      const newDy = cursorY - b.offsetY - canvasY * newScale;

      zoomOffsetRef.current = { dx: newDx, dy: newDy };
      setZoom(newZoom);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [setZoom, zoom, transformRef, zoomOffsetRef]);

  const getDisplayCoords = useCallback((e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const drawCursor = useCallback((displayX: number, displayY: number) => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const b = transformRef.current;
    const z = zoom;
    const radius = (state.brushSize / 2) * b.scale * z;

    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(displayX, displayY, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(displayX, displayY, radius + 1, 0, Math.PI * 2);
    ctx.stroke();
  }, [transformRef, state.brushSize, zoom]);

  const drawCloneCrosshair = useCallback((displayX: number, displayY: number) => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 8;
    ctx.strokeStyle = "#c8881a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(displayX - size, displayY);
    ctx.lineTo(displayX + size, displayY);
    ctx.moveTo(displayX, displayY - size);
    ctx.lineTo(displayX, displayY + size);
    ctx.stroke();
  }, []);

  const canvasToDisplay = useCallback((imgX: number, imgY: number) => {
    const b = transformRef.current;
    const z = zoom;
    return {
      x: imgX * b.scale * z + b.offsetX + zoomOffsetRef.current.dx,
      y: imgY * b.scale * z + b.offsetY + zoomOffsetRef.current.dy,
    };
  }, [transformRef, zoom, zoomOffsetRef]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const display = getDisplayCoords(e);

    if (tool === "clone" && e.altKey) {
      const imgCoords = state.toImageCoords(display.x, display.y);
      cloneSourceRef.current = imgCoords;
      setCloneSource(imgCoords);
      const d = canvasToDisplay(imgCoords.x, imgCoords.y);
      drawCloneCrosshair(d.x, d.y);
      return;
    }

    if (tool === "clone" && !cloneSourceRef.current) return;

    isDrawingRef.current = true;
    strokeStartRef.current = display;

    const baseCanvas = baseCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (baseCanvas && drawCanvas) {
      const baseCtx = baseCanvas.getContext("2d");
      const drawCtx = drawCanvas.getContext("2d");
      if (baseCtx && drawCtx) {
        preStrokePairRef.current = {
          base: baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height),
          draw: drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height),
        };
      }
    }

    const canvas = drawCanvasRef.current;
    if (canvas) {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    if (tool === "clone") {
      paintClone(display.x, display.y);
    } else {
      paintEraser(display.x, display.y);
    }
  }, [tool, getDisplayCoords, paintClone, paintEraser, state.toImageCoords, cloneSourceRef, setCloneSource, isDrawingRef, strokeStartRef, drawCanvasRef, canvasToDisplay, drawCloneCrosshair]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const display = getDisplayCoords(e);

    const cursorCanvas = cursorCanvasRef.current;
    if (cursorCanvas) {
      const ctx = cursorCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    }

    if (tool === "clone" && cloneSource) {
      const d = canvasToDisplay(cloneSource.x, cloneSource.y);
      drawCloneCrosshair(d.x, d.y);
    }

    if (!altHeld) {
      drawCursor(display.x, display.y);
    }

    if (!isDrawingRef.current) return;

    if (tool === "clone") {
      paintClone(display.x, display.y);
    } else {
      paintEraser(display.x, display.y);
    }
  }, [tool, altHeld, cloneSource, getDisplayCoords, paintClone, paintEraser, drawCursor, drawCloneCrosshair, canvasToDisplay, isDrawingRef]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (preStrokePairRef.current) {
      pushUndo(preStrokePairRef.current);
      preStrokePairRef.current = null;
    }
    updateCloneSource();
  }, [pushUndo, updateCloneSource]);

  const cursorClass = tool === "clone" && !altHeld && cloneSource
    ? "cursor-none"
    : tool === "eraser"
      ? "cursor-none"
      : altHeld
        ? "cursor-cell"
        : "cursor-crosshair";

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-[#1a1a18]"
    >
      <canvas
        ref={baseCanvasRef}
        className="absolute"
        style={{ imageRendering: "auto" }}
      />
      <canvas
        ref={drawCanvasRef}
        className={`absolute ${cursorClass}`}
        style={{ imageRendering: "auto", pointerEvents: "all" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <canvas
        ref={cursorCanvasRef}
        className="absolute pointer-events-none"
      />
      <canvas
        ref={cloneSourceCanvasRef}
        className="hidden"
      />
    </div>
  );
}
