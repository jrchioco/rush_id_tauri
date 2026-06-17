import { useRef, useState, useCallback } from "react";
import { Upload, X, RotateCw, StretchHorizontal } from "lucide-react";
import { cn } from "./lib/utils";

export type FitMode = "cover" | "stretch";

export interface PolaroidSlotState {
  id: number;
  imageBase64: string | null;
  fitMode: FitMode;
  panX: number;
  panY: number;
  rotation: number;
}

interface PolaroidSlotCardProps {
  slot: PolaroidSlotState;
  onUpdate: (updates: Partial<PolaroidSlotState>) => void;
  onClear: () => void;
  onFileSelect: (file: File) => void;
}

export function PolaroidSlotCard({ slot, onUpdate, onClear, onFileSelect }: PolaroidSlotCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const isEmpty = slot.imageBase64 === null;

  const handleClick = useCallback(() => {
    if (isEmpty) fileInputRef.current?.click();
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
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, panX: slot.panX, panY: slot.panY };

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - panStart.current.x;
        const dy = ev.clientY - panStart.current.y;
        onUpdate({ panX: panStart.current.panX + dx, panY: panStart.current.panY + dy });
      };

      const handleUp = () => {
        setIsPanning(false);
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };

      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [isEmpty, slot.fitMode, slot.panX, slot.panY, onUpdate],
  );

  const cycleRotation = useCallback(() => {
    onUpdate({ rotation: (slot.rotation + 90) % 360 });
  }, [slot.rotation, onUpdate]);

  const toggleFitMode = useCallback(() => {
    onUpdate({ fitMode: slot.fitMode === "cover" ? "stretch" : "cover", panX: 0, panY: 0 });
  }, [slot.fitMode, onUpdate]);

  const dataUrl = slot.imageBase64 ? `data:image/png;base64,${slot.imageBase64}` : null;

  const imageStyle: React.CSSProperties = {
    transform: `rotate(${slot.rotation}deg) translate(${slot.panX}px, ${slot.panY}px)`,
    objectFit: slot.fitMode === "cover" ? "cover" : "fill",
    cursor: isEmpty || slot.fitMode === "stretch" ? "default" : isPanning ? "grabbing" : "grab",
  };

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative rounded-lg overflow-hidden transition-colors",
        "w-full aspect-[54/86]",
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
          <div
            className="absolute inset-0 overflow-hidden"
            onMouseDown={handlePanStart}
          >
            {dataUrl && (
              <img
                src={dataUrl}
                alt={`Slot ${slot.id}`}
                className="w-full h-full"
                style={imageStyle}
                draggable={false}
              />
            )}
          </div>

          <div className="absolute top-1 right-1 flex flex-col gap-1 opacity-0 hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onClear(); }}
              className="w-5 h-5 rounded bg-[#0c0c0b]/80 border border-[#2a2a28] flex items-center justify-center text-[#888] hover:text-red-400 hover:border-red-400/50 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); cycleRotation(); }}
              className="w-5 h-5 rounded bg-[#0c0c0b]/80 border border-[#2a2a28] flex items-center justify-center text-[#888] hover:text-[#c8881a] hover:border-[#c8881a]/50 transition-colors"
            >
              <RotateCw className="w-3 h-3" />
            </button>
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
