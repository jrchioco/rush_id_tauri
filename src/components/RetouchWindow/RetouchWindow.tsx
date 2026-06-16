import { useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useRetouchCanvas } from "./useRetouchCanvas";
import { RetouchCanvas } from "./RetouchCanvas";
import { RetouchToolbar } from "./RetouchToolbar";

interface RetouchWindowProps {
  isOpen: boolean;
  imageDataUrl: string;
  onClose: () => void;
  onSave: (newDataUrl: string) => void;
}

export function RetouchWindow({ isOpen, imageDataUrl, onClose, onSave }: RetouchWindowProps) {
  const state = useRetouchCanvas(imageDataUrl);

  const handleSave = useCallback(() => {
    const dataUrl = state.flattenAndSave();
    if (!dataUrl) {
      toast.error("Failed to save retouch");
      return;
    }
    onSave(dataUrl);
    toast.success("Retouch saved!");
    onClose();
  }, [state, onSave, onClose]);

  const handleReset = useCallback(() => {
    state.resetCanvas();
    state.loadSource(imageDataUrl).catch(() => {});
  }, [state, imageDataUrl]);

  useEffect(() => {
    if (!isOpen || !imageDataUrl) return;
    state.loadSource(imageDataUrl).catch(() => {});
  }, [isOpen, imageDataUrl, state.loadSource]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        state.undo();
        return;
      }
      if (e.key === "[" && !e.ctrlKey && !e.metaKey) {
        state.setBrushSize(Math.max(10, state.brushSize - 5));
        return;
      }
      if (e.key === "]" && !e.ctrlKey && !e.metaKey) {
        state.setBrushSize(Math.min(100, state.brushSize + 5));
        return;
      }
      if (e.key === "s" && !e.ctrlKey && !e.metaKey) {
        state.setTool("clone");
        return;
      }
      if (e.key === "e" && !e.ctrlKey && !e.metaKey) {
        state.setTool("eraser");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        state.resetView();
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, state]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl shadow-2xl flex flex-col"
        style={{ width: "80vw", maxWidth: 1100, height: "85vh" }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28]">
          <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">Retouch Photo</h2>
          <button onClick={onClose} className="text-[#555] hover:text-[#888] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <RetouchToolbar state={state} onReset={handleReset} />
          <RetouchCanvas state={state} />
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#2a2a28]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg font-bold text-sm tracking-wide transition-colors
                       bg-[#c8881a] text-[#0c0c0b] hover:bg-[#e8a030]"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}
