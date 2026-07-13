import { useRef, useState, useCallback, useEffect } from "react";
import { Upload, X, RotateCw, StretchHorizontal } from "lucide-react";
import { cn } from "./lib/utils";
import { Tooltip } from "./components/Tooltip";
import { TOOLTIPS } from "./lib/tooltips";
import { beginBrowse } from "./components/CompanionWidget/browseStore";

export type FitMode = "cover" | "stretch";

export interface OtherSlotState {
  id: number;
  imageBase64: string | null;
  fitMode: FitMode;
  panX: number;
  panY: number;
  rotation: number;
}

interface OtherSlotCardProps {
  slot: OtherSlotState;
  aspectRatio: number;
  onUpdate: (updates: Partial<OtherSlotState>) => void;
  onClear: () => void;
  onFileSelect: (file: File) => void;
}

export function OtherSlotCard({ slot, aspectRatio, onUpdate, onClear, onFileSelect }: OtherSlotCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0, maxPanX: 0, maxPanY: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const isEmpty = slot.imageBase64 === null;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;

    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate((slot.rotation * Math.PI) / 180);

    const isRotated = slot.rotation === 90 || slot.rotation === 270;
    const effCanvasW = isRotated ? canvasH : canvasW;
    const effCanvasH = isRotated ? canvasW : canvasH;

    const imgAspect = img.naturalWidth / img.naturalHeight;
    const effCanvasAspect = effCanvasW / effCanvasH;

    let drawW: number, drawH: number;
    if (slot.fitMode === "stretch") {
      drawW = effCanvasW;
      drawH = effCanvasH;
    } else {
      if (imgAspect > effCanvasAspect) {
        drawH = effCanvasH;
        drawW = effCanvasH * imgAspect;
      } else {
        drawW = effCanvasW;
        drawH = effCanvasW / imgAspect;
      }
    }

    const maxPanX = imgAspect > effCanvasAspect ? (drawW - effCanvasW) / 2 : 0;
    const maxPanY = imgAspect <= effCanvasAspect ? (drawH - effCanvasH) / 2 : 0;

    ctx.drawImage(img, -drawW / 2 + slot.panX * maxPanX, -drawH / 2 + slot.panY * maxPanY, drawW, drawH);
    ctx.restore();
  }, [slot.fitMode, slot.panX, slot.panY, slot.rotation]);

  useEffect(() => {
    if (!slot.imageBase64) {
      imgRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const card = cardRef.current;
      const canvas = canvasRef.current;
      if (card && canvas && (canvas.width !== card.clientWidth || canvas.height !== card.clientHeight)) {
        canvas.width = card.clientWidth;
        canvas.height = card.clientHeight;
      }
      redraw();
    };
    img.src = "data:image/png;base64," + slot.imageBase64;
  }, [slot.imageBase64, redraw]);

  useEffect(() => {
    const card = cardRef.current;
    const canvas = canvasRef.current;
    if (!card || !canvas) return;

    const resize = () => {
      const w = card.clientWidth;
      const h = card.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        redraw();
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(card);
    return () => observer.disconnect();
  }, [redraw]);

  const handleClick = useCallback(() => {
    if (isEmpty) {
      beginBrowse();
      fileInputRef.current?.click();
    }
  }, [isEmpty]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
      e.target.value = "";
    },
    [onFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) onFileSelect(file);
    },
    [onFileSelect],
  );

  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      if (isEmpty || slot.fitMode === "stretch") return;
      const img = imgRef.current;
      if (!img) return;
      e.preventDefault();
      setIsPanning(true);

      let maxPanX = 0;
      let maxPanY = 0;
      const rect = cardRef.current?.getBoundingClientRect();
      if (rect) {
        const slotW = rect.width;
        const slotH = rect.height;
        const isRotated = slot.rotation === 90 || slot.rotation === 270;
        const effSlotW = isRotated ? slotH : slotW;
        const effSlotH = isRotated ? slotW : slotH;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const effSlotAspect = effSlotW / effSlotH;

        if (imgAspect > effSlotAspect) {
          const scaledW = effSlotH * imgAspect;
          maxPanX = (scaledW - effSlotW) / 2;
        } else {
          const scaledH = effSlotW / imgAspect;
          maxPanY = (scaledH - effSlotH) / 2;
        }
      }

      panStart.current = { x: e.clientX, y: e.clientY, panX: slot.panX, panY: slot.panY, maxPanX, maxPanY };

      const rad = (-slot.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - panStart.current.x;
        const dy = ev.clientY - panStart.current.y;
        const ldx = dx * cos - dy * sin;
        const ldy = dx * sin + dy * cos;

        let newPanX = panStart.current.panX;
        let newPanY = panStart.current.panY;

        if (panStart.current.maxPanX !== 0) newPanX = panStart.current.panX + ldx / panStart.current.maxPanX;
        if (panStart.current.maxPanY !== 0) newPanY = panStart.current.panY + ldy / panStart.current.maxPanY;

        newPanX = Math.max(-1, Math.min(1, newPanX));
        newPanY = Math.max(-1, Math.min(1, newPanY));

        onUpdate({ panX: newPanX, panY: newPanY });
      };

      const handleUp = () => {
        setIsPanning(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [isEmpty, slot.fitMode, slot.panX, slot.panY, slot.rotation, onUpdate],
  );

  const cycleRotation = useCallback(() => {
    onUpdate({ rotation: (slot.rotation + 90) % 360 });
  }, [slot.rotation, onUpdate]);

  const toggleFitMode = useCallback(() => {
    onUpdate({ fitMode: slot.fitMode === "cover" ? "stretch" : "cover", panX: 0, panY: 0 });
  }, [slot.fitMode, onUpdate]);

  const canvasCursor = isEmpty || slot.fitMode === "stretch" ? "default" : isPanning ? "grabbing" : "grab";

  return (
    <div
      ref={cardRef}
      style={{ aspectRatio: `${aspectRatio}` }}
      className={cn(
        "relative rounded-lg overflow-hidden transition-colors",
        "w-full",
        isEmpty
          ? "border-2 border-dashed border-[#c8881a]/40 bg-[#111110] hover:border-[#c8881a]/70 cursor-pointer"
          : "border border-[#2a2a28] bg-[#0c0c0b]",
        isDragOver && "border-[#c8881a] bg-[#c8881a]/5",
      )}
      onClick={isEmpty ? handleClick : undefined}
      onDragOver={!isEmpty ? undefined : handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={!isEmpty ? undefined : handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {isEmpty ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
          <Upload className="w-5 h-5 text-[#c8881a]/50" />
          <span className="text-[9px] text-[#555] font-mono text-center px-2">
            Click or drop photo
          </span>
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className={cn("absolute inset-0 w-full h-full", canvasCursor)}
            onMouseDown={handlePanStart}
          />

          <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 hover:opacity-100 transition-opacity">
            <Tooltip content={TOOLTIPS.removeImage}>
              <button
                onClick={(e) => { e.stopPropagation(); onClear(); }}
                className="w-5 h-5 rounded bg-[#0c0c0b]/80 border border-[#2a2a28] flex items-center justify-center text-[#888] hover:text-red-400 hover:border-red-400/50 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Tooltip>
            <Tooltip content={TOOLTIPS.rotate90}>
              <button
                onClick={(e) => { e.stopPropagation(); cycleRotation(); }}
                className="w-5 h-5 rounded bg-[#0c0c0b]/80 border border-[#2a2a28] flex items-center justify-center text-[#888] hover:text-[#c8881a] hover:border-[#c8881a]/50 transition-colors"
              >
                <RotateCw className="w-3 h-3" />
              </button>
            </Tooltip>
            <Tooltip content={slot.fitMode === "stretch" ? TOOLTIPS.toggleFitCover : TOOLTIPS.toggleFitStretch}>
              <button
                onClick={(e) => { e.stopPropagation(); toggleFitMode(); }}
                className={cn(
                  "w-5 h-5 rounded bg-[#0c0c0b]/80 border flex items-center justify-center transition-colors",
                  slot.fitMode === "stretch"
                    ? "border-[#c8881a]/50 text-[#c8881a]"
                    : "border-[#2a2a28] text-[#888] hover:text-[#c8881a] hover:border-[#c8881a]/50",
                )}
              >
                <StretchHorizontal className="w-3 h-3" />
              </button>
            </Tooltip>
          </div>

          <div className="absolute bottom-1 left-1 right-1 flex justify-center opacity-0 hover:opacity-100 transition-opacity">
            <span className="text-[8px] text-[#555] font-mono bg-[#0c0c0b]/80 px-1.5 py-0.5 rounded">
              {slot.rotation}° · {slot.fitMode}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
