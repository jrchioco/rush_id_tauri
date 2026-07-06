import { Undo2, RotateCcw, Stamp, Eraser } from "lucide-react";
import { cn } from "../../lib/utils";
import { Tooltip } from "../Tooltip";
import { TOOLTIPS } from "../../lib/tooltips";
import type { useRetouchCanvas } from "./useRetouchCanvas";

interface RetouchToolbarProps {
  state: ReturnType<typeof useRetouchCanvas>;
  onReset: () => void;
}

export function RetouchToolbar({ state, onReset }: RetouchToolbarProps) {
  const {
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
    canUndo,
    undo,
    resetView,
  } = state;

  return (
    <div className="w-48 flex-shrink-0 bg-[#0c0c0b] border-r border-[#2a2a28] flex flex-col overflow-y-auto">
      <div className="p-3 space-y-4">
        <div>
          <h3 className="text-[10px] text-[#555] font-mono uppercase tracking-wider mb-2">Tools</h3>
          <div className="space-y-1">
            <Tooltip content={TOOLTIPS.cloneStamp}>
              <button
                onClick={() => setTool("clone")}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors",
                  tool === "clone"
                    ? "bg-[rgba(200,136,26,0.15)] border border-[#c8881a] text-[#c8881a]"
                    : "text-[#888] hover:text-[#e8e4da] border border-transparent"
                )}
              >
                <Stamp size={14} />
                Clone Stamp
              </button>
            </Tooltip>
            <Tooltip content={TOOLTIPS.eraser}>
              <button
                onClick={() => setTool("eraser")}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors",
                  tool === "eraser"
                    ? "bg-[rgba(200,136,26,0.15)] border border-[#c8881a] text-[#c8881a]"
                    : "text-[#888] hover:text-[#e8e4da] border border-transparent"
                )}
              >
                <Eraser size={14} />
                Eraser
              </button>
            </Tooltip>
          </div>
        </div>

        <div>
          <h3 className="text-[10px] text-[#555] font-mono uppercase tracking-wider mb-2">Brush</h3>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[10px] text-[#888] font-mono mb-1">
                <span>Size</span>
                <span>{brushSize}px</span>
              </div>
              <Tooltip content={TOOLTIPS.brushSize} className="w-full">
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-full h-1 bg-[#2a2a28] rounded-lg appearance-none cursor-pointer accent-[#c8881a]"
                />
              </Tooltip>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-[#888] font-mono mb-1">
                <span>Hardness</span>
                <span>{hardness}%</span>
              </div>
              <Tooltip content={TOOLTIPS.brushHardness} className="w-full">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={hardness}
                  onChange={(e) => setHardness(Number(e.target.value))}
                  className="w-full h-1 bg-[#2a2a28] rounded-lg appearance-none cursor-pointer accent-[#c8881a]"
                />
              </Tooltip>
            </div>
            {tool === "clone" && (
              <div>
                <div className="flex justify-between text-[10px] text-[#888] font-mono mb-1">
                  <span>Opacity</span>
                  <span>{Math.round(opacity * 100)}%</span>
                </div>
                <Tooltip content={TOOLTIPS.brushOpacity} className="w-full">
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={Math.round(opacity * 100)}
                    onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                    className="w-full h-1 bg-[#2a2a28] rounded-lg appearance-none cursor-pointer accent-[#c8881a]"
                  />
                </Tooltip>
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-[10px] text-[#555] font-mono uppercase tracking-wider mb-2">Adjustments</h3>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[10px] text-[#888] font-mono mb-1">
                <span>Brightness</span>
                <span>{brightness}</span>
              </div>
              <Tooltip content={TOOLTIPS.brightness} className="w-full">
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                  className="w-full h-1 bg-[#2a2a28] rounded-lg appearance-none cursor-pointer accent-[#c8881a]"
                />
              </Tooltip>
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-[#888] font-mono mb-1">
                <span>Contrast</span>
                <span>{contrast}</span>
              </div>
              <Tooltip content={TOOLTIPS.contrast} className="w-full">
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                  className="w-full h-1 bg-[#2a2a28] rounded-lg appearance-none cursor-pointer accent-[#c8881a]"
                />
              </Tooltip>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-[10px] text-[#555] font-mono uppercase tracking-wider mb-2">Zoom</h3>
          <div className="flex items-center gap-2">
            <Tooltip content={TOOLTIPS.zoomReset}>
              <button
                onClick={() => resetView()}
                className="px-2 py-1 text-[10px] text-[#888] hover:text-[#e8e4da] font-mono border border-[#2a2a28] rounded transition-colors"
              >
                Reset
              </button>
            </Tooltip>
            <span className="text-[10px] text-[#555] font-mono">{Math.round(zoom * 100)}%</span>
          </div>
        </div>

        <div>
          <h3 className="text-[10px] text-[#555] font-mono uppercase tracking-wider mb-2">Actions</h3>
          <div className="space-y-1">
            <Tooltip content={TOOLTIPS.undo}>
              <button
                onClick={undo}
                disabled={!canUndo}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors",
                  canUndo
                    ? "text-[#888] hover:text-[#e8e4da]"
                    : "text-[#333] cursor-not-allowed"
                )}
              >
                <Undo2 size={14} />
                Undo
              </button>
            </Tooltip>
            <Tooltip content={TOOLTIPS.retouchReset}>
              <button
                onClick={onReset}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono text-[#888] hover:text-[#e8e4da] transition-colors"
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="pt-2 border-t border-[#2a2a28]">
          <p className="text-[9px] text-[#444] font-mono leading-relaxed">
            Alt+Click = set clone source{"\n"}
            [ / ] = brush size{"\n"}
            S / E = switch tool{"\n"}
            Ctrl+Z = undo{"\n"}
            Ctrl+Wheel = zoom{"\n"}
            Ctrl+0 = reset zoom
          </p>
        </div>
      </div>
    </div>
  );
}
