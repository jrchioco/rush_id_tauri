import { useState, useCallback, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Printer, RotateCw, Trash2, ArrowLeft } from "lucide-react";
import { cn, fmt, loadImage } from "./lib/utils";
import { useTauriDragDrop } from "./lib/hooks/useTauriDragDrop";
import { useIsMounted } from "./lib/hooks/useIsMounted";
import type { LogEntry } from "./types";
import { OtherSlotCard, type FitMode, type OtherSlotState } from "./OtherSlotCard";

type OtherSize = "wallet" | "3r" | "4r" | "5r" | "6r" | "8r";
type OtherLayout = "2pcs" | "3pcs" | "4pcs" | "6pcs" | "8pcs" | "9pcs" | "10pcs" | "12pcs" | "18pcs" | "27pcs";

interface OtherSizeInfo {
  label: string;
  inches: string;
  widthMm: number;
  heightMm: number;
}

const OTHER_SIZES: Record<OtherSize, OtherSizeInfo> = {
  wallet: { label: "Wallet", inches: '2.5×3.5"', widthMm: 63.5, heightMm: 88.9 },
  "3r": { label: "3R", inches: '3.5×5"', widthMm: 89, heightMm: 127 },
  "4r": { label: "4R", inches: '4×6"', widthMm: 102, heightMm: 152 },
  "5r": { label: "5R", inches: '5×7"', widthMm: 127, heightMm: 178 },
  "6r": { label: "6R", inches: '6×8"', widthMm: 152, heightMm: 203 },
  "8r": { label: "8R", inches: '8×10"', widthMm: 203, heightMm: 254 },
};

const LAYOUTS: OtherLayout[] = ["2pcs", "4pcs", "6pcs", "8pcs", "10pcs", "12pcs"];
const WALLET_LAYOUTS: OtherLayout[] = ["2pcs", "3pcs", "9pcs", "18pcs", "27pcs"];
const FOUR_R_LAYOUTS: OtherLayout[] = ["2pcs", "3pcs"];
const LAYOUT_SLOTS: Record<OtherLayout, number> = { "2pcs": 2, "3pcs": 3, "4pcs": 4, "6pcs": 6, "8pcs": 8, "9pcs": 9, "10pcs": 10, "12pcs": 12, "18pcs": 18, "27pcs": 27 };

function getAspect(size: OtherSize): number {
  const info = OTHER_SIZES[size];
  return info.widthMm / info.heightMm;
}

function hasSvg(size: OtherSize): boolean {
  return size === "wallet" || size === "3r" || size === "4r" || size === "5r" || size === "8r";
}

function hasDropdown(size: OtherSize): boolean {
  return size === "5r" || size === "8r";
}

function freshSlot(id: number): OtherSlotState {
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

async function preprocessSlot(slot: OtherSlotState, slotAspect: number): Promise<string> {
  if (!slot.imageBase64) return "";
  const img = await loadImage(`data:image/png;base64,${slot.imageBase64}`);

  const canvasW = 400;
  const canvasH = Math.round(canvasW / slotAspect);

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

const OtherClient = forwardRef<{ hasUnsavedWork: () => boolean }>(function OtherClient(_, ref) {
  const [selectedSize, setSelectedSize] = useState<OtherSize | null>(null);
  const [layout, setLayout] = useState<OtherLayout | number>("2pcs");
  const [slots, setSlots] = useState<OtherSlotState[]>(() =>
    Array.from({ length: 2 }, (_, i) => freshSlot(i)),
  );
  const [globalStretch, setGlobalStretch] = useState(false);
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

  const slotAspect = selectedSize ? getAspect(selectedSize) : 0.737;

  const handleSizeSelect = useCallback((size: OtherSize) => {
    if (!hasSvg(size)) {
      toast.info(`No SVG template for ${OTHER_SIZES[size].label} yet`);
      return;
    }
    setSelectedSize(size);
    const defaultLayout: OtherLayout = size === "wallet" ? "2pcs" : hasDropdown(size) ? 2 as unknown as OtherLayout : "2pcs";
    setLayout(defaultLayout);
    const slotCount = LAYOUT_SLOTS[defaultLayout];
    setSlots(Array.from({ length: slotCount }, (_, i) => freshSlot(i)));
    setLogs([]);
  }, []);

  const handleBackToSizes = useCallback(() => {
    const hasImages = slotsRef.current.some((s) => s.imageBase64 !== null);
    if (hasImages) {
      toast("Go back will reset all slots. Continue?", {
        action: {
          label: "Reset",
          onClick: () => {
            setSelectedSize(null);
            setSlots(Array.from({ length: 2 }, (_, i) => freshSlot(i)));
            setLogs([]);
          },
        },
      });
    } else {
      setSelectedSize(null);
    }
  }, []);

  const handleLayoutSwitch = useCallback(
    (newLayout: OtherLayout | number) => {
      if (newLayout === layout) return;
      const newSlotCount = typeof newLayout === "number" ? newLayout : LAYOUT_SLOTS[newLayout];
      const hasImages = slotsRef.current.some((s) => s.imageBase64 !== null);
      if (hasImages) {
        toast("Switch layout will reset all slots. Continue?", {
          action: {
            label: "Reset",
            onClick: () => {
              setLayout(newLayout);
              setSlots(Array.from({ length: newSlotCount }, (_, i) => freshSlot(i)));
              setLogs([]);
            },
          },
        });
      } else {
        setLayout(newLayout);
        setSlots(Array.from({ length: newSlotCount }, (_, i) => freshSlot(i)));
      }
    },
    [layout, slots],
  );

  const updateSlot = useCallback((index: number, updates: Partial<OtherSlotState>) => {
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

  const handleClearAll = useCallback(() => {
    const hasImages = slotsRef.current.some((s) => s.imageBase64 !== null);
    if (!hasImages) return;
    toast("Clear all slots?", {
      action: {
        label: "Clear",
        onClick: () => {
          setSlots(Array.from({ length: typeof layout === "number" ? layout : LAYOUT_SLOTS[layout] }, (_, i) => freshSlot(i)));
          setLogs([]);
        },
      },
    });
  }, [layout]);

  const filledCount = slots.filter((s) => s.imageBase64 !== null).length;

  const handleExport = useCallback(
    async (savePath?: string) => {
      if (filledCount === 0 || !selectedSize) return;
      if (!hasSvg(selectedSize)) {
        toast.error(`No SVG template for ${OTHER_SIZES[selectedSize].label}`);
        return;
      }
      setBusy(true);
      log("Preprocessing images...");
      try {
        const processed = await Promise.all(
          slotsRef.current
            .filter((s) => s.imageBase64 !== null)
            .map(async (s) => ({
              slotIndex: s.id + 1,
              imageBase64: await preprocessSlot(s, slotAspect),
            })),
        );
        if (!isMounted()) return;

        log("Compositing PDF...");
        const layoutStr = typeof layout === "number" ? String(layout) : layout;
        const msg = await invoke<string>("composite_other_pdf", {
          size: selectedSize,
          layout: layoutStr,
          slotCount: typeof layout === "number" ? layout : LAYOUT_SLOTS[layout],
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
    [selectedSize, layout, filledCount, slotAspect, log],
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

  const sizeEntries = Object.entries(OTHER_SIZES) as [OtherSize, OtherSizeInfo][];

  if (!selectedSize) {
    return (
      <main className="max-w-6xl mx-auto p-6 flex flex-col items-center justify-center min-h-[calc(100vh-60px)]">
        <div className="space-y-6 w-full">
          <h2 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase text-center">
            Other Sizes
          </h2>
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            {sizeEntries.map(([key, info]) => (
              <button
                key={key}
                onClick={() => handleSizeSelect(key)}
                style={{ aspectRatio: `${info.widthMm} / ${info.heightMm}` }}
                className={cn(
                  "relative rounded-lg overflow-hidden transition-colors",
                  "w-full border-2 border-dashed bg-[#111110]",
                  hasSvg(key)
                    ? "border-[#c8881a]/40 hover:border-[#c8881a]/70 cursor-pointer"
                    : "border-[#2a2a28] opacity-40 cursor-not-allowed",
                )}
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <span className="text-lg font-mono font-bold text-[#c8881a]">{info.label}</span>
                  <span className="text-xs text-[#555] font-mono">{info.inches}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  const sizeInfo = OTHER_SIZES[selectedSize];

  const statFooter = (
    <div className="border-t border-[#2a2a28] p-3 grid grid-cols-3 gap-2">
      {[
        { label: "SIZE", value: sizeInfo.label, accent: false },
        { label: "LAYOUT", value: typeof layout === "number" ? `${layout}pcs` : layout, accent: false },
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

  const gridConfig = (() => {
    const n = typeof layout === "number" ? layout : LAYOUT_SLOTS[layout];
    if (n <= 2) return { itemWidth: "flex-[0_0_calc(50%-0.375rem)]" };
    if (n <= 6) return { itemWidth: "flex-[0_0_calc(33.333%-0.5rem)]" };
    if (n <= 8) return { itemWidth: "flex-[0_0_calc(25%-0.5625rem)]" };
    return { itemWidth: "flex-[0_0_calc(20%-0.6rem)]" };
  })();

  return (
    <main className="max-w-6xl mx-auto p-6 grid grid-cols-[1fr_300px] gap-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBackToSizes}
              className="w-7 h-7 rounded-lg bg-[#111110] border border-[#2a2a28] flex items-center justify-center text-[#555] hover:text-[#c8881a] hover:border-[#c8881a]/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h2 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">
              {sizeInfo.label} — {sizeInfo.inches}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {hasDropdown(selectedSize) ? (
              <select
                value={typeof layout === "number" ? layout : 2}
                onChange={(e) => handleLayoutSwitch(Number(e.target.value))}
                className="bg-[#111110] border border-[#2a2a28] rounded-lg px-3 py-1 text-xs font-mono font-bold text-[#c8881a] tracking-wide cursor-pointer appearance-auto"
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}pcs</option>
                ))}
              </select>
            ) : (
              <div className="flex gap-1 bg-[#111110] border border-[#2a2a28] rounded-lg p-0.5">
                {(selectedSize === "wallet" ? WALLET_LAYOUTS : selectedSize === "4r" ? FOUR_R_LAYOUTS : LAYOUTS).map((l) => (
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
            )}
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
          </div>
        </div>

        <div className="flex flex-wrap gap-3 justify-center">
          {slots.map((slot) => (
            <div key={slot.id} className={gridConfig.itemWidth}>
              <OtherSlotCard
                slot={slot}
                aspectRatio={slotAspect}
                onUpdate={(u) => updateSlot(slot.id, u)}
                onClear={() => handleClearSlot(slot.id)}
                onFileSelect={(f) => handleFileSelect(slot.id, f)}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleClearAll}
            disabled={filledCount === 0}
            className="px-4 py-2.5 bg-transparent text-[#555] border border-[#2a2a28] rounded-lg font-bold text-sm tracking-wide hover:text-[#888] hover:border-[#555] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Clear All
          </button>
          <button
            onClick={() => handleExport()}
            disabled={busy || filledCount === 0}
            className="flex-1 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] flex items-center justify-center gap-2"
          >
            {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            {busy ? "Compositing..." : "Print"}
          </button>
          <button
            onClick={handleSavePdf}
            disabled={busy || filledCount === 0}
            className="flex-1 px-4 py-2.5 bg-transparent text-[#c8881a] border border-[#c8881a] rounded-lg font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Save PDF
          </button>
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

export default OtherClient;
