import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Cropper, { Area } from "react-easy-crop";
import { Upload, Printer, Scissors, RotateCw, X } from "lucide-react";
import { cn, fmt, compositeOnColor } from "./lib/utils";
import { cropImage } from "./lib/cropImage";
import { readFileAsDataUrl } from "./lib/readFileAsDataUrl";
import { useKeyUsed } from "./lib/hooks/useKeyUsed";
import { useTemplates } from "./lib/hooks/useTemplates";
import { useTauriDragDrop } from "./lib/hooks/useTauriDragDrop";
import { useCropperWheel } from "./lib/hooks/useCropperWheel";
import { RotationSidebar } from "./components/RotationSidebar";
import { ColorPicker } from "./components/ColorPicker";
import { LogsPanel } from "./components/LogsPanel";
import { ErrorBanner } from "./components/ErrorBanner";

const ASPECT = 35 / 45;

interface SlotData {
  step: "empty" | "crop" | "done";
  originalImage: string | null;
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  croppedAreaPixels: Area | null;
  rawBase64: string | null;
  resultPath: string | null;
  bgColor: string;
  selectedTemplate: string;
  error: string | null;
  name: string;
  showLabel: boolean;
}

const SLOT_COUNT = 5;
const LABELS = ["Passport 1", "Passport 2", "Passport 3", "Passport 4", "Passport 5"];

function freshSlot(i: number): SlotData {
  return {
    step: "empty",
    originalImage: null,
    crop: { x: 0, y: 0 },
    zoom: 1,
    rotation: 0,
    croppedAreaPixels: null,
    rawBase64: null,
    resultPath: null,
    bgColor: "#ffffff",
    selectedTemplate: "",
    error: null,
    name: LABELS[i],
    showLabel: false,
  };
}

export default function PassportClient() {
  const [slots, setSlots] = useState<SlotData[]>(() =>
    Array.from({ length: SLOT_COUNT }, (_, i) => freshSlot(i)),
  );
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const cropperWrapRefs = [
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(0, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(1, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(2, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(3, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(4, delta) }),
  ];

  const { templates, keyCount } = useTemplates();
  const activeKeyIndex = useKeyUsed();
  const passportTemplates = templates.filter((t) => t.key.toLowerCase().includes("passport"));
  const displayTemplates = passportTemplates.length > 0 ? passportTemplates : templates;

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev, { time: fmt(), text }]);
  }, []);

  const slotsRef = useRef<SlotData[]>(slots);
  const logRef = useRef(log);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);
  useEffect(() => {
    logRef.current = log;
  }, [log]);

  useEffect(() => {
    const fallback = passportTemplates.length > 0 ? passportTemplates[0] : templates[0];
    if (!fallback) return;
    setSlots((prev) =>
      prev.map((s) => (s.selectedTemplate ? s : { ...s, selectedTemplate: fallback.path })),
    );
  }, [templates, passportTemplates]);

  useTauriDragDrop((paths) => {
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    const imagePaths = paths.filter((p) => {
      const ext = p.split(".").pop()?.toLowerCase();
      return validExts.includes(ext ?? "");
    });
    if (imagePaths.length === 0) {
      setError("No valid image files dropped");
      return;
    }
    const current = slotsRef.current;
    const emptyIndices = current
      .map((s, i) => (s.step === "empty" ? i : -1))
      .filter((i) => i !== -1);
    if (emptyIndices.length === 0) {
      setError("All slots are full");
      return;
    }
    const toFill = imagePaths.slice(0, emptyIndices.length);
    if (toFill.length < imagePaths.length) {
      setError(
        `${imagePaths.length - toFill.length} image(s) skipped — not enough empty slots`,
      );
    }
    Promise.all(toFill.map(readFileAsDataUrl))
      .then((results) => {
        setSlots((prev) => {
          const next = [...prev];
          results.forEach((r, idx) => {
            next[emptyIndices[idx]] = {
              ...next[emptyIndices[idx]],
              originalImage: r.dataUrl,
              step: "crop",
              crop: { x: 0, y: 0 },
              zoom: 1,
              rotation: 0,
              error: null,
            };
          });
          return next;
        });
        results.forEach((r, idx) =>
          logRef.current(`${LABELS[emptyIndices[idx]]}: ${r.fileName}`),
        );
      })
      .catch((e) => setError(`Read error: ${e}`));
  });

  function updateSlot(i: number, p: Partial<SlotData>) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...p };
      return next;
    });
  }

  function updateSlotRotation(i: number, delta: number) {
    const current = slotsRef.current[i].rotation;
    updateSlot(i, { rotation: Math.max(-90, Math.min(90, current + delta)) });
  }

  function handleSlotFile(i: number, file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      updateSlot(i, {
        originalImage: reader.result as string,
        step: "crop",
        crop: { x: 0, y: 0 },
        zoom: 1,
        rotation: 0,
        error: null,
      });
      log(`${LABELS[i]}: Loaded ${file.name}`);
    };
    reader.readAsDataURL(file);
  }

  async function handleProcessAll() {
    const current = slotsRef.current;
    const pending = current
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.step === "crop" && s.croppedAreaPixels);
    if (pending.length === 0) return;
    setBusy(true);
    log(`Processing ${pending.length} slot(s)${testMode ? " (test mode — no API calls)" : ""}...`);
    try {
    const bgColors = pending.map(({ i }) => current[i].bgColor);
    const labelNames = pending.map(({ s }) => (s.showLabel ? s.name : undefined));
    const crops = await Promise.all(
      pending.map(({ s }) => cropImage(s.originalImage!, s.croppedAreaPixels!, s.rotation || 0)),
    );
    const results = testMode
      ? crops
      : await Promise.all(crops.map((b64) => invoke<string>("remove_bg", { imageBase64: b64 })));
    const colorResults = await Promise.all(
      results.map((b64, j) => compositeOnColor(b64, bgColors[j], labelNames[j])),
    );
      setSlots((prev) => {
        const next = [...prev];
        for (let j = 0; j < pending.length; j++) {
          const idx = pending[j].i;
          next[idx] = {
            ...next[idx],
            rawBase64: results[j],
            resultPath: colorResults[j],
            step: "done",
          };
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
    if (missing) {
      log("✗ No template selected for one or more slots");
      setBusy(false);
      return;
    }
    setBusy(true);
    log("Compositing passport PDF...");
    try {
      const clients = done.map((s) => ({
        imageBase64: s.resultPath!.split(",")[1],
        svgPath: s.selectedTemplate,
      }));
      const msg = await invoke<string>("composite_multi_pdf", {
        clients,
        savePath: savePath ?? null,
      });
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
    const labelName = slot.showLabel ? slot.name : undefined;
    compositeOnColor(slot.rawBase64, color, labelName).then((url) => {
      updateSlot(i, { resultPath: url });
    });
  }

  function handleSlotLabelToggle(i: number, enabled: boolean) {
    const slot = slotsRef.current[i];
    updateSlot(i, { showLabel: enabled });
    if (!slot.rawBase64) return;
    const labelName = enabled ? slot.name : "";
    compositeOnColor(slot.rawBase64, slot.bgColor, labelName).then((url) => {
      updateSlot(i, { resultPath: url });
    });
  }

  function handleSlotNameChange(i: number, name: string) {
    const slot = slotsRef.current[i];
    updateSlot(i, { name });
    if (!slot.showLabel || !slot.rawBase64) return;
    compositeOnColor(slot.rawBase64, slot.bgColor, name).then((url) => {
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

  const statFooter =
    keyCount > 0 ? (
      <div className="border-t border-[#2a2a28] p-3 grid grid-cols-2 gap-2">
        {[
          { label: "API KEY", value: `Key ${activeKeyIndex + 1}/${keyCount}`, accent: true },
          { label: "SLOTS", value: `${slots.filter((s) => s.step !== "empty").length}/${SLOT_COUNT}`, accent: false },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-[#111110] border border-[#2a2a28] rounded-md p-2">
            <div className="text-[9px] text-[#444] font-mono tracking-widest uppercase mb-1">{label}</div>
            <div className={cn("text-sm font-mono font-semibold", accent ? "text-[#4caf78]" : "text-[#e8e4da]")}>{value}</div>
          </div>
        ))}
      </div>
    ) : undefined;

  return (
    <main className="max-w-6xl mx-auto p-6 grid grid-cols-[1fr_300px] gap-6">
      <div className="space-y-4">
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">
            Passport — {SLOT_COUNT} Slots
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <span className="text-[10px] font-mono text-[#555] tracking-wider uppercase">
                {testMode ? "Test" : "Live"}
              </span>
              <div
                onClick={() => setTestMode(!testMode)}
                className={cn(
                  "w-7 h-4 rounded-full transition-colors relative",
                  testMode ? "bg-[#c8881a]" : "bg-[#2a2a28]",
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                    testMode ? "translate-x-[14px]" : "translate-x-[2px]",
                  )}
                />
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
              <button
                onClick={handleResetAll}
                className="px-3 py-1.5 text-[#555] hover:text-[#888] text-xs font-mono transition-colors"
              >
                Reset All
              </button>
            </div>
          </div>
        </div>

        {slots.map((slot, i) => (
          <div key={i} className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[#2a2a28]">
              {slot.step === "done" ? (
                <input
                  type="text"
                  value={slot.name}
                  onChange={(e) => handleSlotNameChange(i, e.target.value)}
                  placeholder={LABELS[i]}
                  maxLength={60}
                  className={cn(
                    "flex-1 min-w-0 bg-transparent text-xs font-semibold font-mono tracking-widest uppercase",
                    "border-b focus:outline-none focus:border-[#c8881a] px-1 py-0.5",
                    slot.showLabel ? "border-[#c8881a] text-[#c8881a]" : "border-transparent text-[#888]",
                  )}
                />
              ) : (
                <span className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase">
                  {slot.name}
                </span>
              )}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {slot.step === "done" && (
                  <button
                    onClick={() => handleSlotLabelToggle(i, !slot.showLabel)}
                    title={slot.showLabel ? "Hide name label" : "Show name label"}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase border transition-colors",
                      slot.showLabel
                        ? "border-[#c8881a] text-[#c8881a] bg-[#c8881a]/10"
                        : "border-[#2a2a28] text-[#555] hover:text-[#888] hover:border-[#888]",
                    )}
                  >
                    Label
                  </button>
                )}
                {slot.step !== "empty" && (
                  <button
                    onClick={() => handleSlotReset(i)}
                    className="text-[#555] hover:text-red-400 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {slot.step === "empty" && (
              <div
                onClick={() => clickSlotUpload(i)}
                className="border-2 border-dashed border-[#2a2a28] rounded-lg m-3 p-6 text-center cursor-pointer hover:border-[#c8881a]/50 transition-all bg-[#1a1a18]"
              >
                <Upload className="w-6 h-6 mx-auto mb-2 text-[#444]" />
                <p className="text-xs text-[#555] font-mono">Drop image or click to browse</p>
                <input
                  ref={(el) => {
                    fileInputRefs.current[i] = el;
                  }}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleSlotFile(i, e.target.files[0])}
                />
              </div>
            )}

            {slot.step === "crop" && slot.originalImage && (
              <>
                <div className="flex min-h-[360px] bg-[#0c0c0b]">
                  <RotationSidebar
                    value={slot.rotation}
                    onChange={(r) => updateSlot(i, { rotation: r })}
                    size="sm"
                  />
                  <div ref={cropperWrapRefs[i]} className="flex-1 relative">
                    <Cropper
                      image={slot.originalImage}
                      crop={slot.crop}
                      zoom={slot.zoom}
                      rotation={slot.rotation}
                      aspect={ASPECT}
                      zoomSpeed={0.2}
                      onWheelRequest={(e) => e.ctrlKey || e.metaKey}
                      onCropChange={(c) => updateSlot(i, { crop: c })}
                      onZoomChange={(z) => updateSlot(i, { zoom: z })}
                      onCropComplete={(_: Area, pixels: Area) =>
                        updateSlot(i, { croppedAreaPixels: pixels })
                      }
                    />
                  </div>
                </div>
                <div className="p-3 flex items-center gap-3 border-t border-[#2a2a28]">
                  <label className="text-xs text-[#555] font-mono">Zoom</label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.1}
                    value={slot.zoom}
                    onChange={(e) => updateSlot(i, { zoom: Number(e.target.value) })}
                    className="flex-1 accent-[#c8881a]"
                  />
                  <span className="text-[10px] text-[#555] font-mono">Adjust crop, then Process All</span>
                </div>
              </>
            )}

            {slot.step === "done" && slot.resultPath && (
              <div className="p-3 space-y-3">
                <div
                  className="rounded-lg flex items-center justify-center p-3"
                  style={{
                    backgroundImage: "repeating-conic-gradient(#1e1e1c 0% 25%, #161614 0% 50%)",
                    backgroundSize: "12px 12px",
                  }}
                >
                  <img src={slot.resultPath} alt="Result" className="max-h-[120px] object-contain rounded shadow-lg" />
                </div>
                <div className="flex items-center gap-2">
                  <ColorPicker
                    value={slot.bgColor}
                    onChange={(c) => handleSlotColorChange(i, c)}
                    size="sm"
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
                      <option key={t.key} value={t.path}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
                {slot.error && (
                  <div className="bg-red-950 border border-red-800 rounded-lg p-2 text-red-400 text-xs font-mono">
                    {slot.error}
                  </div>
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
              {busy ? "Compositing..." : `Print All (${slots.filter((s) => s.step === "done").length} slots)`}
            </button>
          </div>
        )}
      </div>

      <LogsPanel title="Passport Logs" entries={logs} footer={statFooter} />
    </main>
  );
}
