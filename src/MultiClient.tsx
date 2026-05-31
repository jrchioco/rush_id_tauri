import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Cropper, { Area } from "react-easy-crop";
import { Upload, Printer, Scissors, RotateCw, X } from "lucide-react";
import type { SvgTemplate, LogEntry } from "./types";
import { cn, COLORS, fmt, compositeOnColor } from "./lib/utils";

interface SlotData {
  step: "empty" | "crop" | "done";
  originalImage: string | null;
  crop: { x: number; y: number };
  zoom: number;
  croppedAreaPixels: Area | null;
  rawBase64: string | null;
  resultPath: string | null;
  bgColor: string;
  selectedTemplate: string;
  error: string | null;
  name: string;
}

const SLOT_COUNT = 5;
const LABELS = ["Client A", "Client B", "Client C", "Client D", "Client E"];

function freshSlot(i: number): SlotData {
  return {
    step: "empty",
    originalImage: null,
    crop: { x: 0, y: 0 },
    zoom: 1,
    croppedAreaPixels: null,
    rawBase64: null,
    resultPath: null,
    bgColor: "#ffffff",
    selectedTemplate: "",
    error: null,
    name: LABELS[i],
  };
}

function readFileAsDataUrl(filePath: string): Promise<{ dataUrl: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    import("@tauri-apps/plugin-fs").then(({ readFile }) => {
      readFile(filePath).then((bytes) => {
        let binary = "";
        const chunk = 8192;
        for (let i = 0; i < bytes.length; i += chunk)
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        const base64 = btoa(binary);
        resolve({
          dataUrl: `data:${mimeType};base64,${base64}`,
          fileName: filePath.split("/").pop() ?? filePath,
        });
      }).catch(reject);
    }).catch(reject);
  });
}

function cropImage(imgSrc: string, area: Area): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = area.width;
      canvas.height = area.height;
      ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
      canvas.toBlob((b) => {
        if (!b) { reject(new Error("toBlob failed")); return; }
        const r = new FileReader();
        r.onload = () => resolve((r.result as string).split(",")[1]);
        r.readAsDataURL(b);
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imgSrc;
  });
}

export default function MultiClient() {
  const [slots, setSlots] = useState<SlotData[]>(() =>
    Array.from({ length: SLOT_COUNT }, (_, i) => freshSlot(i))
  );
  const [templates, setTemplates] = useState<SvgTemplate[]>([]);
  const multiTemplates = templates.filter((t) => t.key.startsWith("multi_"));
  const displayTemplates = multiTemplates.length > 0 ? multiTemplates : templates;
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeKeyIndex, setActiveKeyIndex] = useState(0);
  const [keyCount, setKeyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev, { time: fmt(), text }]);
  }, []);

  const slotsRef = useRef<SlotData[]>(slots);
  const logRef = useRef(log);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { logRef.current = log; }, [log]);

  useEffect(() => {
    invoke<SvgTemplate[]>("get_svg_templates").then((t) => {
      setTemplates(t);
      const multi = t.filter((x) => x.key.startsWith("multi_"));
      const fallback = multi.length > 0 ? multi[0] : t[0];
      if (fallback) {
        setSlots((prev) =>
          prev.map((s) => ({
            ...s,
            selectedTemplate: s.selectedTemplate || fallback.path,
          }))
        );
      }
    });
    invoke<number>("get_key_count").then(setKeyCount);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<number>("key_used", (e) => setActiveKeyIndex(e.payload))
        .then((fn) => (unlisten = fn));
    });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    let ud: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("tauri://drag-drop", (event: any) => {
        const paths: string[] = event.payload.paths;
        if (!paths?.length) return;
        const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
        const imagePaths = paths.filter((p) => {
          const ext = p.split(".").pop()?.toLowerCase();
          return validExts.includes(ext ?? "");
        });
        if (imagePaths.length === 0) { setError("No valid image files dropped"); return; }
        const current = slotsRef.current;
        const emptyIndices = current
          .map((s, i) => s.step === "empty" ? i : -1)
          .filter((i) => i !== -1);
        if (emptyIndices.length === 0) { setError("All slots are full"); return; }
        const toFill = imagePaths.slice(0, emptyIndices.length);
        if (toFill.length < imagePaths.length) {
          setError(`${imagePaths.length - toFill.length} image(s) skipped — not enough empty slots`);
        }
        Promise.all(toFill.map(readFileAsDataUrl)).then((results) => {
          setSlots((prev) => {
            const next = [...prev];
            results.forEach((r, idx) => {
              next[emptyIndices[idx]] = {
                ...next[emptyIndices[idx]],
                originalImage: r.dataUrl,
                step: "crop",
                crop: { x: 0, y: 0 },
                zoom: 1,
                error: null,
              };
            });
            return next;
          });
          results.forEach((r, idx) => logRef.current(`${LABELS[emptyIndices[idx]]}: ${r.fileName}`));
        }).catch((e) => setError(`Read error: ${e}`));
      }).then((fn) => (ud = fn));
    });
    return () => { ud?.(); };
  }, []);

  function updateSlot(i: number, p: Partial<SlotData>) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...p };
      return next;
    });
  }

  function handleSlotFile(i: number, file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateSlot(i, { originalImage: reader.result as string, step: "crop", crop: { x: 0, y: 0 }, zoom: 1, error: null });
      log(`${LABELS[i]}: Loaded ${file.name}`);
    };
    reader.readAsDataURL(file);
  }

  async function handleProcessAll() {
    const current = slotsRef.current;
    const pending = current.map((s, i) => ({ s, i })).filter(({ s }) => s.step === "crop" && s.croppedAreaPixels);
    if (pending.length === 0) return;
    setBusy(true);
    log(`Processing ${pending.length} slot(s)${testMode ? " (test mode — no API calls)" : ""}...`);
    try {
      const bgColors = pending.map(({ i }) => current[i].bgColor);
      const crops = await Promise.all(
        pending.map(({ s }) => cropImage(s.originalImage!, s.croppedAreaPixels!))
      );
      const results = testMode
        ? crops
        : await Promise.all(crops.map((b64) => invoke<string>("remove_bg", { imageBase64: b64 })));
      const colorResults = await Promise.all(
        results.map((b64, j) => compositeOnColor(b64, bgColors[j]))
      );
      setSlots((prev) => {
        const next = [...prev];
        for (let j = 0; j < pending.length; j++) {
          const idx = pending[j].i;
          next[idx] = { ...next[idx], rawBase64: results[j], resultPath: colorResults[j], step: "done" };
        }
        return next;
      });
      log(`✓ Batch ${testMode ? "cropped" : "processing complete"}`);
    } catch (e) {
      log(`Batch error: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleComposite(savePath?: string) {
    const done = slotsRef.current.filter((s) => s.step === "done");
    if (done.length === 0) return;
    const missing = done.find((s) => !s.selectedTemplate);
    if (missing) { log("✗ No template selected for one or more slots"); setBusy(false); return; }
    setBusy(true);
    log("Compositing multi-client PDF...");
    try {
      const clients = done.map((s) => ({
        imageBase64: s.resultPath!.split(",")[1],
        svgPath: s.selectedTemplate,
      }));
      const msg = await invoke<string>("composite_multi_pdf", { clients, savePath: savePath ?? null });
      log(`✓ ${msg}`);
    } catch (e) {
      log(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handlePrintAll() {
    await handleComposite();
  }

  async function handleSavePdf() {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const savePath = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (!savePath) return;
    await handleComposite(savePath);
  }

  function handleSlotColorChange(i: number, color: string) {
    const slot = slotsRef.current[i];
    if (!slot.rawBase64) return;
    if (color === slot.bgColor) return;
    updateSlot(i, { bgColor: color });
    compositeOnColor(slot.rawBase64, color).then((url) => {
      updateSlot(i, { resultPath: url });
    });
  }

  function handleSlotReset(i: number) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = freshSlot(i);
      return next;
    });
    setError(null);
  }

  function handleResetAll() {
    setSlots(Array.from({ length: SLOT_COUNT }, (_, i) => freshSlot(i)));
    setLogs([]);
    setError(null);
  }

  function clickSlotUpload(i: number) {
    fileInputRefs.current[i]?.click();
  }

  const anyDone = slots.some((s) => s.step === "done");
  const anyCrop = slots.some((s) => s.step === "crop" && s.croppedAreaPixels);

  return (
    <main className="max-w-6xl mx-auto p-6 grid grid-cols-[1fr_300px] gap-6">
      <div className="space-y-4">
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-400 text-xs flex items-center gap-2 font-mono">
            <X className="w-3 h-3 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">Dismiss</button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">Batch — {SLOT_COUNT} Slots</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[10px] font-mono text-[#555] tracking-wider uppercase">{testMode ? "Test" : "Live"}</span>
              <div
                onClick={() => setTestMode(!testMode)}
                className={cn(
                  "w-7 h-4 rounded-full transition-colors relative",
                  testMode ? "bg-[#c8881a]" : "bg-[#2a2a28]"
                )}
              >
                <div className={cn(
                  "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                  testMode ? "translate-x-[14px]" : "translate-x-[2px]"
                )} />
              </div>
            </label>
            <div className="flex gap-2">
              {anyCrop && (
                <button
                  onClick={handleProcessAll}
                  disabled={busy}
                  className="px-3 py-1.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-xs tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] flex items-center gap-1.5"
                >
                  {busy ? <RotateCw className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                  Process All
                </button>
              )}
              <button onClick={handleResetAll} className="px-3 py-1.5 text-[#555] hover:text-[#888] text-xs font-mono transition-colors">
                Reset All
              </button>
            </div>
          </div>
        </div>

        {slots.map((slot, i) => (
          <div
            key={i}
            className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-hidden"
          >
            {/* Slot header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#2a2a28]">
              <span className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase">{slot.name}</span>
              {slot.step !== "empty" && (
                <button onClick={() => handleSlotReset(i)} className="text-[#555] hover:text-red-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Empty state */}
            {slot.step === "empty" && (
              <div
                onClick={() => clickSlotUpload(i)}
                className="border-2 border-dashed border-[#2a2a28] rounded-lg m-3 p-6 text-center cursor-pointer hover:border-[#c8881a]/50 transition-all bg-[#1a1a18]"
              >
                <Upload className="w-6 h-6 mx-auto mb-2 text-[#444]" />
                <p className="text-xs text-[#555] font-mono">Drop image or click to browse</p>
                <input
                  ref={(el) => { fileInputRefs.current[i] = el; }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleSlotFile(i, e.target.files[0])}
                />
              </div>
            )}

            {/* Crop state — no per-slot Remove BG button */}
            {slot.step === "crop" && slot.originalImage && (
              <>
                <div className="relative h-[360px] bg-[#0c0c0b]">
                  <Cropper
                    image={slot.originalImage}
                    crop={slot.crop}
                    zoom={slot.zoom}
                    aspect={1}
                    onCropChange={(c) => updateSlot(i, { crop: c })}
                    onZoomChange={(z) => updateSlot(i, { zoom: z })}
                    onCropComplete={(_: Area, pixels: Area) => updateSlot(i, { croppedAreaPixels: pixels })}
                  />
                </div>
                <div className="p-3 flex items-center gap-3 border-t border-[#2a2a28]">
                  <label className="text-xs text-[#555] font-mono">Zoom</label>
                  <input
                    type="range" min={1} max={3} step={0.1}
                    value={slot.zoom}
                    onChange={(e) => updateSlot(i, { zoom: Number(e.target.value) })}
                    className="flex-1 accent-[#c8881a]"
                  />
                  <span className="text-[10px] text-[#555] font-mono">Adjust crop, then Process All</span>
                </div>
              </>
            )}

            {/* Done state */}
            {slot.step === "done" && slot.resultPath && (
              <div className="p-3 space-y-3">
                <div
                  className="rounded-lg flex items-center justify-center p-3"
                  style={{
                    backgroundImage: 'repeating-conic-gradient(#1e1e1c 0% 25%, #161614 0% 50%)',
                    backgroundSize: '12px 12px',
                  }}
                >
                  <img src={slot.resultPath} alt="Result" className="max-h-[120px] object-contain rounded shadow-lg" />
                </div>
                <div className="flex items-center gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => handleSlotColorChange(i, c.value)}
                      className={cn(
                        "w-5 h-5 rounded-full transition-all duration-150",
                        slot.bgColor === c.value
                          ? "ring-2 ring-[#c8881a] ring-offset-2 ring-offset-[#0c0c0b] scale-110"
                          : "hover:scale-110 opacity-80 hover:opacity-100"
                      )}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                  <input
                    type="color"
                    value={slot.bgColor}
                    onChange={(e) => handleSlotColorChange(i, e.target.value)}
                    className="w-5 h-5 rounded-full border border-[#2a2a28] overflow-hidden cursor-pointer bg-transparent"
                    title="Custom color"
                  />
                  <div className="flex-1" />
                  <span className="text-[10px] text-[#4caf78] font-mono">✓ Done</span>
                </div>
                <div>
                  <select
                    value={slot.selectedTemplate}
                    onChange={(e) => updateSlot(i, { selectedTemplate: e.target.value })}
                    className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-2 py-1 text-xs text-[#e8e4da] font-mono focus:outline-none focus:border-[#c8881a]"
                  >
                    {displayTemplates.map((t) => (
                      <option key={t.key} value={t.path}>{t.name}</option>
                    ))}
                  </select>
                </div>
                {slot.error && (
                  <div className="bg-red-950 border border-red-800 rounded-lg p-2 text-red-400 text-xs font-mono">{slot.error}</div>
                )}
              </div>
            )}
          </div>
        ))}

        {anyDone && (
          <div className="flex gap-3">
            <button
              onClick={handleSavePdf}
              disabled={busy}
              className="flex-1 px-4 py-2.5 bg-transparent text-[#c8881a] border border-[#c8881a] rounded-lg font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Save PDF
            </button>
            <button
              onClick={handlePrintAll}
              disabled={busy}
              className="flex-1 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] flex items-center justify-center gap-2"
            >
              {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              {busy ? "Compositing..." : `Print All (${slots.filter(s => s.step === "done").length} slots)`}
            </button>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <div className="bg-[#0c0c0b] rounded-xl border border-[#2a2a28] h-fit">
        <div className="p-3 border-b border-[#2a2a28] flex items-center gap-2">
          <div className={cn("w-1.5 h-1.5 rounded-full", logs.length > 0 ? "bg-[#4caf78]" : "bg-[#333]")} />
          <h3 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">Batch Logs</h3>
        </div>
        <div className="h-[420px] overflow-y-auto p-3 space-y-1.5 font-mono text-xs">
          {logs.length === 0 && <p className="text-[#333] italic">No activity yet</p>}
          {logs.map((entry, j) => (
            <div key={j} className="flex gap-2 leading-relaxed">
              <span className="text-[#444] flex-shrink-0">[{entry.time}]</span>
              <span className={cn(
                entry.text.startsWith("✓") ? "text-[#4caf78]" :
                entry.text.toLowerCase().includes("error") ? "text-red-400" :
                entry.text.endsWith("...") ? "text-[#c8881a]" :
                "text-[#888]"
              )}>{entry.text}</span>
            </div>
          ))}
        </div>
        {keyCount > 0 && (
          <div className="border-t border-[#2a2a28] p-3 grid grid-cols-2 gap-2">
            {[
              { label: "API KEY", value: `Key ${activeKeyIndex + 1}/${keyCount}`, accent: true },
              { label: "SLOTS", value: `${slots.filter(s => s.step !== "empty").length}/${SLOT_COUNT}`, accent: false },
            ].map(({ label, value, accent }) => (
              <div key={label} className="bg-[#111110] border border-[#2a2a28] rounded-md p-2">
                <div className="text-[9px] text-[#444] font-mono tracking-widest uppercase mb-1">{label}</div>
                <div className={cn("text-sm font-mono font-semibold", accent ? "text-[#4caf78]" : "text-[#e8e4da]")}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
