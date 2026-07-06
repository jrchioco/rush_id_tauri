import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Printer, RotateCw, Trash2, TriangleAlert } from "lucide-react";
import { cn, fmt, loadImage } from "./lib/utils";
import { useTauriDragDrop } from "./lib/hooks/useTauriDragDrop";
import { useIsMounted } from "./lib/hooks/useIsMounted";
import type { LogEntry } from "./types";
import { PolaroidSlotCard, type FitMode, type PolaroidSlotState } from "./PolaroidSlotCard";
import { Tooltip } from "./components/Tooltip";
import { TOOLTIPS } from "./lib/tooltips";

type Layout = "2pcs" | "3pcs" | "5pcs" | "10pcs" | "20pcs" | "30pcs";

const SLOT_COUNTS: Record<Layout, number> = { "2pcs": 2, "3pcs": 3, "5pcs": 5, "10pcs": 10, "20pcs": 20, "30pcs": 30 };
const SLOT_ASPECT = 45.693394 / 61.973392;

function freshSlot(id: number): PolaroidSlotState {
  return { id, imageBase64: null, fitMode: "cover", panX: 0, panY: 0, rotation: 0 };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (base64) resolve(base64);
      else reject(new Error("Failed to read file"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function preprocessSlot(slot: PolaroidSlotState, quality: "high" | "flash"): Promise<string> {
  if (!slot.imageBase64) return "";
  const img = await loadImage(`data:image/png;base64,${slot.imageBase64}`);

  const canvasW = quality === "high" ? 630 : 400;
  const canvasH = Math.round(canvasW / SLOT_ASPECT);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

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

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

const PolaroidClient = forwardRef<{ hasUnsavedWork: () => boolean }>(function PolaroidClient(_, ref) {
  const [layout, setLayout] = useState<Layout>("5pcs");
  const [slots, setSlots] = useState<PolaroidSlotState[]>(() =>
    Array.from({ length: 5 }, (_, i) => freshSlot(i)),
  );
  const [globalStretch, setGlobalStretch] = useState(false);
  const [quality, setQuality] = useState<"high" | "flash">(() => {
    return (localStorage.getItem("polaroidQuality") as "high" | "flash") || "flash";
  });
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const isMounted = useIsMounted();

  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  useImperativeHandle(ref, () => ({
    hasUnsavedWork: () => slots.some((s) => s.imageBase64 !== null),
  }), [slots]);

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev.slice(-199), { time: fmt(), text }]);
  }, []);

  const handleLayoutSwitch = useCallback(
    (newLayout: Layout) => {
      if (newLayout === layout) return;
      const hasImages = slotsRef.current.some((s) => s.imageBase64 !== null);
      if (hasImages) {
        toast("Switch layout will reset all slots. Continue?", {
          action: {
            label: "Reset",
            onClick: () => {
              setLayout(newLayout);
              setSlots(Array.from({ length: SLOT_COUNTS[newLayout] }, (_, i) => freshSlot(i)));
              setLogs([]);
            },
          },
        });
      } else {
        setLayout(newLayout);
        setSlots(Array.from({ length: SLOT_COUNTS[newLayout] }, (_, i) => freshSlot(i)));
      }
    },
    [layout, slots],
  );

  const updateSlot = useCallback((index: number, updates: Partial<PolaroidSlotState>) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  }, []);

  const handleClearSlot = useCallback((index: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = freshSlot(index);
      return next;
    });
  }, []);

  const handleFileSelect = useCallback(
    async (index: number, file: File) => {
      try {
        const base64 = await readFileAsBase64(file);
        updateSlot(index, { imageBase64: base64, panX: 0, panY: 0 });
      } catch (e) {
        toast.error(String(e));
      }
    },
    [updateSlot],
  );

  const handleGlobalStretchToggle = useCallback(() => {
    const next = !globalStretch;
    setGlobalStretch(next);
    setSlots((prev) =>
      prev.map((s) =>
        s.imageBase64 ? { ...s, fitMode: (next ? "stretch" : "cover") as FitMode, panX: 0, panY: 0 } : s,
      ),
    );
  }, [globalStretch]);

  const handleQualityToggle = useCallback(() => {
    const next = quality === "high" ? "flash" : "high";
    setQuality(next);
    localStorage.setItem("polaroidQuality", next);
  }, [quality]);

  const handleClearAll = useCallback(() => {
    const hasImages = slotsRef.current.some((s) => s.imageBase64 !== null);
    if (!hasImages) return;
    toast("Clear all slots?", {
      action: {
        label: "Clear",
        onClick: () => {
          setSlots(Array.from({ length: SLOT_COUNTS[layout] }, (_, i) => freshSlot(i)));
          setLogs([]);
        },
      },
    });
  }, [layout]);

  const filledCount = slots.filter((s) => s.imageBase64 !== null).length;

  const handleExport = useCallback(
    async (savePath?: string) => {
      if (filledCount === 0) return;
      setBusy(true);
      log("Preprocessing images...");
      try {
        const processed = await Promise.all(
          slotsRef.current
            .filter((s) => s.imageBase64 !== null)
            .map(async (s) => ({
              slotIndex: s.id + 1,
              imageBase64: await preprocessSlot(s, quality),
            })),
        );
        if (!isMounted()) return;

        log("Compositing Polaroid PDF...");
        const msg = await invoke<string>("composite_polaroid_pdf", {
          layout,
          slots: processed,
          savePath: savePath ?? null,
        });
        if (!isMounted()) return;
        log(`✓ ${msg}`);
      } catch (e) {
        if (!isMounted()) return;
        log(`Error: ${e}`);
        toast.error(String(e));
      } finally {
        if (isMounted()) setBusy(false);
      }
    },
    [layout, filledCount, quality, log],
  );

  const handleSavePdf = useCallback(async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const savePath = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!savePath) return;
    await handleExport(savePath);
  }, [handleExport]);

  useTauriDragDrop((paths) => {
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    const imagePaths = paths.filter((p) => {
      const ext = p.split(".").pop()?.toLowerCase();
      return validExts.includes(ext ?? "");
    });
    if (imagePaths.length === 0) return;

    const emptySlots = slotsRef.current
      .map((s, i) => (s.imageBase64 === null ? i : -1))
      .filter((i) => i >= 0);

    const toFill = Math.min(imagePaths.length, emptySlots.length);
    if (toFill === 0) {
      toast.error("All slots are full");
      return;
    }
    if (imagePaths.length > emptySlots.length) {
      toast.warning(`${imagePaths.length - emptySlots.length} image(s) ignored — not enough empty slots`);
    }

    const nextSlots = [...slotsRef.current];
    const readFilePromises = imagePaths.slice(0, toFill).map((path, idx) =>
      readFileAsDataUrlFromPath(path).then((base64) => {
        nextSlots[emptySlots[idx]] = { ...nextSlots[emptySlots[idx]], imageBase64: base64, panX: 0, panY: 0 };
      }),
    );

    Promise.all(readFilePromises).then(() => {
      setSlots(nextSlots);
    });
  });

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      const emptyIdx = slotsRef.current.findIndex((s) => s.imageBase64 === null);
      if (emptyIdx === -1) {
        toast.error("All slots are full");
        return;
      }

      handleFileSelect(emptyIdx, file);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFileSelect]);

  const statFooter = (
    <div className="border-t border-[#2a2a28] p-3 grid grid-cols-2 gap-2">
      {[
        {
          label: "LAYOUT",
          value: layout === "2pcs" ? "2pcs Strip" : layout === "3pcs" ? "3pcs Strip" : layout === "5pcs" ? "A5 Landscape" : layout === "10pcs" ? "A4 Portrait" : layout === "20pcs" ? "A4 Portrait ×2" : "A4 Portrait ×3",
          accent: false,
        },
        { label: "SLOTS", value: `${filledCount}/${slots.length}`, accent: filledCount > 0 },
      ].map(({ label, value, accent }) => (
        <div key={label} className="bg-[#111110] border border-[#2a2a28] rounded-md p-2">
          <div className="text-[9px] text-[#444] font-mono tracking-widest uppercase mb-1">{label}</div>
          <div className={cn("text-sm font-mono font-semibold", accent ? "text-[#4caf78]" : "text-[#e8e4da]")}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <main className="max-w-6xl mx-auto p-6 grid grid-cols-[1fr_300px] gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">
            Polaroid
          </h2>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 bg-[#111110] border border-[#2a2a28] rounded-lg p-0.5">
              {(["2pcs", "3pcs", "5pcs", "10pcs", "20pcs", "30pcs"] as Layout[]).map((l) => (
                <button
                  key={l}
                  onClick={() => handleLayoutSwitch(l)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-mono font-bold tracking-wide transition-colors",
                    layout === l
                      ? "bg-[#c8881a] text-[#0c0c0b]"
                      : "text-[#555] hover:text-[#888]",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[10px] font-mono text-[#555] tracking-wider uppercase">Stretch all</span>
              <div
                onClick={handleGlobalStretchToggle}
                className={cn(
                  "w-7 h-4 rounded-full transition-colors relative",
                  globalStretch ? "bg-[#c8881a]" : "bg-[#2a2a28]",
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                    globalStretch ? "translate-x-[14px]" : "translate-x-[2px]",
                  )}
                />
              </div>
            </label>
            <Tooltip
              content={quality === "high" ? TOOLTIPS.quality.on : TOOLTIPS.quality.off}
            >
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <span className="text-[10px] font-mono text-[#555] tracking-wider uppercase">
                  {quality === "high" ? "High" : "Flash"}
                </span>
                <div
                  onClick={handleQualityToggle}
                  className={cn(
                    "w-7 h-4 rounded-full transition-colors relative",
                    quality === "high" ? "bg-[#c8881a]" : "bg-[#2a2a28]",
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                      quality === "high" ? "translate-x-[14px]" : "translate-x-[2px]",
                    )}
                  />
                </div>
              </label>
            </Tooltip>
          </div>
        </div>

        <div className="bg-[#1a1508] border border-[#c8881a]/30 rounded-lg px-4 py-2.5 flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 text-[#c8881a] shrink-0" />
          <div className="text-xs font-mono text-[#c8881a] leading-relaxed">
            <p>This feature is experimental. Results may vary.</p>
            <p>Rotation and preview rendering are still being refined.</p>
          </div>
        </div>

        <div
          className={cn(
            "grid gap-3",
            layout === "2pcs"
              ? "grid-cols-2"
              : layout === "3pcs"
                ? "grid-cols-3"
                : layout === "5pcs"
                  ? "grid-cols-3"
                  : "grid-cols-5",
          )}
        >
          {layout === "2pcs" &&
            slots.map((slot) => (
              <PolaroidSlotCard
                key={slot.id}
                slot={slot}
                onUpdate={(u) => updateSlot(slot.id, u)}
                onClear={() => handleClearSlot(slot.id)}
                onFileSelect={(f) => handleFileSelect(slot.id, f)}
              />
            ))}
          {layout === "3pcs" &&
            slots.map((slot) => (
              <PolaroidSlotCard
                key={slot.id}
                slot={slot}
                onUpdate={(u) => updateSlot(slot.id, u)}
                onClear={() => handleClearSlot(slot.id)}
                onFileSelect={(f) => handleFileSelect(slot.id, f)}
              />
            ))}
          {layout === "5pcs" && (
            <>
              {slots.slice(0, 3).map((slot) => (
                <PolaroidSlotCard
                  key={slot.id}
                  slot={slot}
                  onUpdate={(u) => updateSlot(slot.id, u)}
                  onClear={() => handleClearSlot(slot.id)}
                  onFileSelect={(f) => handleFileSelect(slot.id, f)}
                />
              ))}
            </>
          )}
          {layout === "5pcs" && (
            <div className="col-span-3 flex justify-center gap-3">
              {slots.slice(3, 5).map((slot) => (
                <div key={slot.id} className="w-1/3">
                  <PolaroidSlotCard
                    slot={slot}
                    onUpdate={(u) => updateSlot(slot.id, u)}
                    onClear={() => handleClearSlot(slot.id)}
                    onFileSelect={(f) => handleFileSelect(slot.id, f)}
                  />
                </div>
              ))}
            </div>
          )}
          {(layout === "10pcs" || layout === "20pcs" || layout === "30pcs") &&
            slots.map((slot) => (
              <PolaroidSlotCard
                key={slot.id}
                slot={slot}
                onUpdate={(u) => updateSlot(slot.id, u)}
                onClear={() => handleClearSlot(slot.id)}
                onFileSelect={(f) => handleFileSelect(slot.id, f)}
              />
            ))}
        </div>

        <div className="flex gap-3">
          <Tooltip content={TOOLTIPS.clearAll}>
            <button
              onClick={handleClearAll}
              disabled={filledCount === 0}
              className="px-4 py-2.5 bg-transparent text-[#555] border border-[#2a2a28] rounded-lg font-bold text-sm tracking-wide hover:text-[#888] hover:border-[#555] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          </Tooltip>
          <Tooltip content={TOOLTIPS.print} className="flex-1">
            <button
              onClick={() => handleExport()}
              disabled={busy || filledCount === 0}
              className="flex-1 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] flex items-center justify-center gap-2"
            >
              {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {busy ? "Compositing..." : "Print"}
            </button>
          </Tooltip>
          <Tooltip content={TOOLTIPS.savePdf} className="flex-1">
            <button
              onClick={handleSavePdf}
              disabled={busy || filledCount === 0}
              className="flex-1 px-4 py-2.5 bg-transparent text-[#c8881a] border border-[#c8881a] rounded-lg font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Save PDF
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-[#111110] border border-[#2a2a28] rounded-lg">
          <div className="border-b border-[#2a2a28] px-3 py-2 flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", busy ? "bg-[#c8881a] animate-pulse" : filledCount > 0 ? "bg-[#4caf78]" : "bg-[#555]")} />
            <span className="text-[10px] font-mono text-[#888] tracking-widest uppercase">Logs</span>
          </div>
          <div className="h-[420px] overflow-y-auto p-3 space-y-1 font-mono text-[10px]">
            {logs.length === 0 ? (
              <div className="text-[#444]">No activity yet</div>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-[#444] shrink-0">{entry.time}</span>
                  <span className={cn(
                    entry.text.startsWith("✓") ? "text-[#4caf78]" :
                    entry.text.startsWith("Error") ? "text-red-400" :
                    entry.text.includes("...") ? "text-[#c8881a]" :
                    "text-[#666]",
                  )}>
                    {entry.text}
                  </span>
                </div>
              ))
            )}
          </div>
          {statFooter}
        </div>
      </div>
    </main>
  );
});

export default PolaroidClient;

async function readFileAsDataUrlFromPath(path: string): Promise<string> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
