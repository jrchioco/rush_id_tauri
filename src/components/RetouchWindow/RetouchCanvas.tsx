import { useRef, useEffect, useCallback } from "react";
import type { useRetouchCanvas } from "./useRetouchCanvas";

interface RetouchCanvasProps {
  state: ReturnType<typeof useRetouchCanvas>;
}

export function RetouchCanvas({ state }: RetouchCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    baseCanvasRef,
    drawCanvasRef,
    tool,
    cloneSource,
    altHeld,
    isDrawingRef,
    strokeStartRef,
    cloneSourceRef,
    transformRef,
    computeTransform,
    paintClone,
    paintEraser,
    pushUndo,
    setCloneSource,
  } = state;

  const resize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const t = computeTransform(rect.width, rect.height);

    const baseCanvas = baseCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!baseCanvas || !drawCanvas) return;

    baseCanvas.style.width = `${t.displayW}px`;
    baseCanvas.style.height = `${t.displayH}px`;
    baseCanvas.style.left = `${t.offsetX}px`;
    baseCanvas.style.top = `${t.offsetY}px`;

    drawCanvas.style.width = `${t.displayW}px`;
    drawCanvas.style.height = `${t.displayH}px`;
    drawCanvas.style.left = `${t.offsetX}px`;
    drawCanvas.style.top = `${t.offsetY}px`;

    const cursorCanvas = cursorCanvasRef.current;
    if (cursorCanvas) {
      cursorCanvas.width = rect.width;
      cursorCanvas.height = rect.height;
      cursorCanvas.style.width = `${rect.width}px`;
      cursorCanvas.style.height = `${rect.height}px`;
    }
  }, [baseCanvasRef, drawCanvasRef, computeTransform]);

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

    const t = transformRef.current;
    const radius = (state.brushSize / 2) * t.scale;

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
  }, [transformRef, state.brushSize]);

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

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const display = getDisplayCoords(e);

    if (tool === "clone" && e.altKey) {
      const imgCoords = state.toImageCoords(display.x, display.y);
      cloneSourceRef.current = imgCoords;
      setCloneSource(imgCoords);
      const t = transformRef.current;
      drawCloneCrosshair(
        imgCoords.x * t.scale + t.offsetX,
        imgCoords.y * t.scale + t.offsetY,
      );
      return;
    }

    if (tool === "clone" && !cloneSourceRef.current) return;

    isDrawingRef.current = true;
    strokeStartRef.current = display;
    const canvas = drawCanvasRef.current;
    if (canvas) {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    if (tool === "clone") {
      paintClone(display.x, display.y);
    } else {
      paintEraser(display.x, display.y);
    }
  }, [tool, getDisplayCoords, paintClone, paintEraser, state.toImageCoords, cloneSourceRef, setCloneSource, isDrawingRef, strokeStartRef, drawCanvasRef, transformRef, drawCloneCrosshair]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const display = getDisplayCoords(e);

    const cursorCanvas = cursorCanvasRef.current;
    if (cursorCanvas) {
      const ctx = cursorCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, cursorCanvas.width, cursorCanvas.height);
    }

    if (tool === "clone" && cloneSource) {
      const t = transformRef.current;
      drawCloneCrosshair(
        cloneSource.x * t.scale + t.offsetX,
        cloneSource.y * t.scale + t.offsetY,
      );
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
  }, [tool, altHeld, cloneSource, getDisplayCoords, paintClone, paintEraser, drawCursor, drawCloneCrosshair, transformRef, isDrawingRef]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    pushUndo();
  }, [pushUndo]);

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
    </div>
  );
}
