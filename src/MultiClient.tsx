import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Cropper, { Area } from "react-easy-crop";
import { Upload, Printer, Scissors, RotateCw, X } from "lucide-react";
import { cn, fmt, compositeOnColor, getFontOption, getNextFontChoice } from "./lib/utils";
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
import type { LabelMode, FontChoice } from "./types";

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
  labelMode: LabelMode;
  signatureDataUrl: string | null;
  fontChoice: FontChoice;
}

function labelArgsFor(
  mode: LabelMode,
  name: string,
  signature: string | null,
  fontChoice: FontChoice,
): { name: string | undefined; signature: string | null; fontStack: string } {
  const fontStack = getFontOption(fontChoice).stack;
  if (mode === "off") return { name: undefined, signature: null, fontStack };
  if (mode === "name") return { name, signature: null, fontStack };
  return { name, signature, fontStack };
}

const SLOT_COUNT = 5;
const LABELS = ["Client A", "Client B", "Client C", "Client D", "Client E"];

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
    labelMode: "off",
    signatureDataUrl: null,
    fontChoice: "black",
  };
}

export default function MultiClient() {
  const [slots, setSlots] = useState<SlotData[]>(() =>
    Array.from({ length: SLOT_COUNT }, (_, i) => freshSlot(i)),
  );
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testMode, setTestMode] = useState(false);

  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sigFileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const compositeIdRefs = useRef<Map<number, number>>(new Map());
  const cropperWrapRefs = [
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(0, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(1, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(2, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(3, delta) }),
    useCropperWheel({ onRotate: (delta) => updateSlotRotation(4, delta) }),
  ];

  const { templates, keyCount } = useTemplates();
  const activeKeyIndex = useKeyUsed();
  const multiTemplates = templates.filter((t) => t.key.startsWith("multi_"));
  const displayTemplates = multiTemplates.length > 0 ? multiTemplates : templates;

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
    const fallback = multiTemplates.length > 0 ? multiTemplates[0] : templates[0];
    if (!fallback) return;
    setSlots((prev) =>
      prev.map((s) => (s.selectedTemplate ? s : { ...s, selectedTemplate: fallback.path })),
    );
  }, [templates, multiTemplates]);

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

  const handleSlotFile = useCallback((i: number, file: File) => {
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
  }, [log]);

  const handleSlotFileRef = useRef(handleSlotFile);
  useEffect(() => { handleSlotFileRef.current = handleSlotFile; }, [handleSlotFile]);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile() ?? e.clipboardData?.files?.[0];
          if (file) {
            const current = slotsRef.current;
            const emptyIdx = current.findIndex((s) => s.step === "empty");
            if (emptyIdx === -1) {
              setError("All slots are full");
              return;
            }
            handleSlotFileRef.current(emptyIdx, file);
            break;
          }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

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
    const labelArgs = pending.map(({ s }) => labelArgsFor(s.labelMode, s.name, s.signatureDataUrl, s.fontChoice));
    const crops = await Promise.all(
      pending.map(({ s }) => cropImage(s.originalImage!, s.croppedAreaPixels!, s.rotation || 0)),
    );
    const results = testMode
      ? crops
      : await Promise.all(crops.map((b64) => invoke<string>("remove_bg", { imageBase64: b64 })));
    const colorResults = await Promise.all(
      results.map((b64, j) => compositeOnColor(b64, bgColors[j], labelArgs[j].name, labelArgs[j].signature, labelArgs[j].fontStack)),
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
    log("Compositing multi-client PDF...");
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

  function bumpCompositeId(i: number): number {
    const next = (compositeIdRefs.current.get(i) ?? 0) + 1;
    compositeIdRefs.current.set(i, next);
    return next;
  }

  async function slotCompositeAndApply(
    i: number,
    base64: string,
    color: string,
    name: string | undefined,
    signature: string | null,
    fontStack: string,
  ) {
    const id = bumpCompositeId(i);
    const dataUrl = await compositeOnColor(base64, color, name, signature, fontStack);
    if (id !== compositeIdRefs.current.get(i)) return;
    updateSlot(i, { resultPath: dataUrl });
  }

  function handleSlotColorChange(i: number, color: string) {
    const slot = slotsRef.current[i];
    if (!slot.rawBase64) return;
    if (color === slot.bgColor) return;
    updateSlot(i, { bgColor: color });
    const { name, signature, fontStack } = labelArgsFor(slot.labelMode, slot.name, slot.signatureDataUrl, slot.fontChoice);
    slotCompositeAndApply(i, slot.rawBase64, color, name, signature, fontStack).catch((e) =>
      log(`Error: ${e}`),
    );
  }

  function handleSlotLabelCycle(i: number) {
    const slot = slotsRef.current[i];
    const next: LabelMode = slot.labelMode === "off" ? "name" : slot.labelMode === "name" ? "name-sig" : "off";
    updateSlot(i, { labelMode: next });
    if (!slot.rawBase64) return;
    const { name, signature, fontStack } = labelArgsFor(next, slot.name, slot.signatureDataUrl, slot.fontChoice);
    slotCompositeAndApply(i, slot.rawBase64, slot.bgColor, name, signature, fontStack).catch((e) =>
      log(`Error: ${e}`),
    );
  }

  function handleSlotFontCycle(i: number) {
    const slot = slotsRef.current[i];
    const next = getNextFontChoice(slot.fontChoice);
    updateSlot(i, { fontChoice: next });
    if (!slot.rawBase64) return;
    const { name, signature, fontStack } = labelArgsFor(slot.labelMode, slot.name, slot.signatureDataUrl, next);
    slotCompositeAndApply(i, slot.rawBase64, slot.bgColor, name, signature, fontStack).catch((e) =>
      log(`Error: ${e}`),
    );
  }

  function handleSlotNameChange(i: number, name: string) {
    const slot = slotsRef.current[i];
    updateSlot(i, { name });
    if (slot.labelMode === "off" || !slot.rawBase64) return;
    const sig = slot.labelMode === "name-sig" ? slot.signatureDataUrl : null;
    const { fontStack } = labelArgsFor(slot.labelMode, slot.name, slot.signatureDataUrl, slot.fontChoice);
    slotCompositeAndApply(i, slot.rawBase64, slot.bgColor, name, sig, fontStack).catch((e) =>
      log(`Error: ${e}`),
    );
  }

  function handleSlotSignatureFile(i: number, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    const slot = slotsRef.current[i];
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const nextMode: LabelMode = slot.labelMode === "name-sig" ? "name-sig" : "name-sig";
      updateSlot(i, { signatureDataUrl: dataUrl, labelMode: nextMode });
      if (slot.rawBase64) {
        try {
          const { fontStack } = labelArgsFor(nextMode, slot.name, dataUrl, slot.fontChoice);
          await slotCompositeAndApply(i, slot.rawBase64, slot.bgColor, slot.name, dataUrl, fontStack);
        } catch (e) {
          log(`Error: ${e}`);
        }
      }
    };
    reader.readAsDataURL(file);
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
            Batch — {SLOT_COUNT} Slots
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
              {slot.step === "done" && (
                <button
                  onClick={() => handleSlotFontCycle(i)}
                  title={`Font: ${getFontOption(slot.fontChoice).label.join(" ")} — click to cycle`}
                  className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase border border-[#c8881a] text-[#c8881a] bg-[#c8881a]/10 flex flex-col items-center leading-tight"
                >
                  <span>{getFontOption(slot.fontChoice).label[0]}</span>
                  {getFontOption(slot.fontChoice).label[1] && <span>{getFontOption(slot.fontChoice).label[1]}</span>}
                </button>
              )}
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
                    slot.labelMode !== "off" ? "border-[#c8881a] text-[#c8881a]" : "border-transparent text-[#888]",
                  )}
                />
              ) : (
                <span className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase flex-1">
                  {slot.name}
                </span>
              )}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {slot.step === "done" && (
                  <button
                    onClick={() => handleSlotLabelCycle(i)}
                    title={
                      slot.labelMode === "off" ? "Off — click to enable name only" :
                      slot.labelMode === "name" ? "Name only — click to add signature" :
                      "Name + signature — click to turn off"
                    }
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase border transition-colors",
                      slot.labelMode === "off"
                        ? "border-[#2a2a28] text-[#555] hover:text-[#888] hover:border-[#888]"
                        : "border-[#c8881a] text-[#c8881a] bg-[#c8881a]/10",
                    )}
                  >
                    {slot.labelMode === "off" ? "Label" : slot.labelMode === "name" ? "Name" : "Name+Sig"}
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
                      aspect={1}
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
                {slot.labelMode === "name-sig" && (
                  <div className="flex items-center gap-2">
                    {slot.signatureDataUrl ? (
                      <img
                        src={slot.signatureDataUrl}
                        alt="Signature"
                        className="h-8 max-w-[80px] object-contain bg-white rounded border border-[#2a2a28]"
                      />
                    ) : (
                      <span className="text-[9px] text-[#555] font-mono">no signature</span>
                    )}
                    <button
                      onClick={() => sigFileInputRefs.current[i]?.click()}
                      className="flex-1 px-2 py-1 bg-[#1a1a18] border border-[#2a2a28] rounded text-[10px] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a] font-mono transition-colors"
                    >
                      {slot.signatureDataUrl ? "Change" : "Browse for signature"}
                    </button>
                    <input
                      ref={(el) => {
                        sigFileInputRefs.current[i] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleSlotSignatureFile(i, e.target.files?.[0])}
                    />
                  </div>
                )}
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

      <LogsPanel title="Batch Logs" entries={logs} footer={statFooter} />
    </main>
  );
}
