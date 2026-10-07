import { useState, useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { invoke } from "./components/CompanionWidget/effieInvoke";
import { setEffieMood } from "./components/CompanionWidget/moodStore";
import Cropper, { Area } from "react-easy-crop";
import { Upload, X, TriangleAlert, Scissors, RotateCw, Printer } from "lucide-react";
import { toast } from "sonner";
import { cn, fmt, compositeOnColor } from "./lib/utils";
import { cropImage } from "./lib/cropImage";
import { loadCropperImage } from "./lib/loadCropperImage";
import { buildSavePath, setLastSaveDir } from "./lib/savePath";
import { beginBrowse } from "./components/CompanionWidget/browseStore";
import { useKeyUsed } from "./lib/hooks/useKeyUsed";
import { useTemplates } from "./lib/hooks/useTemplates";
import { useTauriDragDrop } from "./lib/hooks/useTauriDragDrop";
import { useIsMounted } from "./lib/hooks/useIsMounted";
import { useApiLogs } from "./lib/hooks/useApiLogs";
import { RotationSidebar } from "./components/RotationSidebar";
import { ColorPicker } from "./components/ColorPicker";
import { LogsPanel } from "./components/LogsPanel";
import { RetouchButton, RetouchWindow } from "./components/RetouchWindow";
import { Tooltip } from "./components/Tooltip";
import { TOOLTIPS } from "./lib/tooltips";
import type { LogEntry } from "./types";

interface StripSlotData {
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
}

function slotLabel(i: number) {
  return `Client ${i + 1}`;
}

function freshSlot(_i: number, defaultTemplate = ""): StripSlotData {
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
    selectedTemplate: defaultTemplate,
  };
}

interface StripBatchClientProps {
  sizeLabel: string;
  cropAspect: number;
  templateKey: string;
  onPrintReminder?: () => void;
}

const StripBatchClient = forwardRef<{ hasUnsavedWork: () => boolean }, StripBatchClientProps>(function StripBatchClient({ sizeLabel, cropAspect, templateKey, onPrintReminder }, ref) {
  const [slotCount, setSlotCount] = useState(5);
  const [slots, setSlots] = useState<StripSlotData[]>(() =>
    Array.from({ length: slotCount }, (_, i) => freshSlot(i)),
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [testMode, setTestMode] = useState(false);
  const [countDraft, setCountDraft] = useState("5");
  const [invalidCountDraft, setInvalidCountDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retouchOpen, setRetouchOpen] = useState(false);
  const [retouchSlotIndex, setRetouchSlotIndex] = useState(0);
  const [retouchImageData, setRetouchImageData] = useState("");

  const isMounted = useIsMounted();

  const fileInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const countInputRef = useRef<HTMLInputElement | null>(null);
  const pendingShrinkRef = useRef<number | null>(null);
  const compositeIdRefs = useRef<Map<number, number>>(new Map());
  const cropperWheelRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const handler = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      updateSlotRotation(Number(node.dataset.slotIndex), -Math.sign(e.deltaY));
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, []);

  const { templates, keyCount, loading: templatesLoading } = useTemplates();
  const activeKeyIndex = useKeyUsed();
  const stripTemplates = useMemo(() => templates.filter((t) => t.key === templateKey), [templates, templateKey]);
  const displayTemplates = stripTemplates.length > 0 ? stripTemplates : templates;

  const noApiKeys = keyCount === 0;
  const effectiveTestMode = testMode || noApiKeys;

  useImperativeHandle(ref, () => ({
    hasUnsavedWork: () => slots.some((s) => s.step !== "empty"),
  }), [slots]);

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev.slice(-199), { time: fmt(), text }]);
  }, []);

  useApiLogs(log);

  const slotsRef = useRef<StripSlotData[]>(slots);
  slotsRef.current = slots;
  const logRef = useRef(log);
  logRef.current = log;

  const stepCountRef = useRef<(dir: 1 | -1, shift: boolean) => void>(() => {});
  stepCountRef.current = stepCount;

  useEffect(() => {
    const node = countInputRef.current;
    if (!node) return;
    const listener = (e: WheelEvent) => {
      e.preventDefault();
      const dx = Math.abs(e.deltaX);
      const dy = Math.abs(e.deltaY);
      const dir = (dx > dy ? e.deltaX : e.deltaY) > 0 ? (-1 as const) : (1 as const);
      stepCountRef.current(dir, e.shiftKey);
    };
    node.addEventListener("wheel", listener, { passive: false });
    return () => node.removeEventListener("wheel", listener);
  }, []);

  useEffect(() => {
    const fallback = stripTemplates.length > 0 ? stripTemplates[0] : templates[0];
    if (!fallback) return;
    setSlots((prev) =>
      prev.map((s) => (s.selectedTemplate ? s : { ...s, selectedTemplate: fallback.path })),
    );
  }, [templates, stripTemplates]);

  useTauriDragDrop((paths) => {
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    const imagePaths = paths.filter((p) => {
      const ext = p.split(".").pop()?.toLowerCase();
      return validExts.includes(ext ?? "");
    });
    if (imagePaths.length === 0) {
      toast.error("No valid image files dropped");
      return;
    }
    const current = slotsRef.current;
    const emptyIndices = current
      .map((s, i) => (s.step === "empty" ? i : -1))
      .filter((i) => i !== -1);
    if (emptyIndices.length === 0) {
      toast.error("All slots are full");
      return;
    }
    const toFill = imagePaths.slice(0, emptyIndices.length);
    if (toFill.length < imagePaths.length) {
      toast.error(
        `${imagePaths.length - toFill.length} image(s) skipped — not enough empty slots`,
      );
    }
    Promise.all(toFill.map((p) => loadCropperImage(p)))
      .then((results) => {
        if (!isMounted()) return;
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
            };
          });
          return next;
        });
        results.forEach((r, idx) =>
          logRef.current(`${slotLabel(emptyIndices[idx])}: ${r.fileName}`),
        );
      })
      .catch((e) => toast.error(`Read error: ${e}`));
  });

  function updateSlot(i: number, p: Partial<StripSlotData>) {
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

  const handleSlotFile = useCallback(async (i: number, file: File) => {
    if (!file.type.startsWith("image/")) return;
    try {
      const result = await loadCropperImage(file);
      if (!isMounted()) return;
      updateSlot(i, {
        originalImage: result.dataUrl,
        step: "crop",
        crop: { x: 0, y: 0 },
        zoom: 1,
        rotation: 0,
      });
      log(`${slotLabel(i)}: Loaded ${result.fileName}`);
    } catch (e) {
      toast.error(`Failed to load image: ${e}`);
    }
  }, [log, isMounted]);

  const handleSlotFileRef = useRef(handleSlotFile);
  handleSlotFileRef.current = handleSlotFile;

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
              toast.error("All slots are full");
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
    setEffieMood("working");
    log(`Processing ${pending.length} slot(s)${effectiveTestMode ? " (test mode — no API calls)" : ""}...`);
    try {
      const bgColors = pending.map(({ i }) => current[i].bgColor);
      const crops = await Promise.all(
        pending.map(({ s }) => cropImage(s.originalImage!, s.croppedAreaPixels!, s.rotation || 0)),
      );
      const results = effectiveTestMode
        ? crops
        : await Promise.all(crops.map((b64) => invoke<string>("remove_bg", { imageBase64: b64 })));
      const colorResults = await Promise.all(
        results.map((b64, j) => compositeOnColor(b64, bgColors[j])),
      );
      if (!isMounted()) return;
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
      setEffieMood("success");
      log(`✓ Batch ${effectiveTestMode ? "cropped" : "processing complete"}`);
    } catch (e) {
      log(`Batch error: ${e}`);
      setEffieMood("error");
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  function bumpCompositeId(i: number): number {
    const next = (compositeIdRefs.current.get(i) ?? 0) + 1;
    compositeIdRefs.current.set(i, next);
    return next;
  }

  async function slotCompositeAndApply(i: number, base64: string, color: string) {
    const id = bumpCompositeId(i);
    const dataUrl = await compositeOnColor(base64, color);
    if (id !== compositeIdRefs.current.get(i)) return;
    updateSlot(i, { resultPath: dataUrl });
  }

  function handleSlotColorChange(i: number, color: string) {
    const slot = slotsRef.current[i];
    if (!slot.rawBase64) return;
    if (color === slot.bgColor) return;
    updateSlot(i, { bgColor: color });
    slotCompositeAndApply(i, slot.rawBase64, color).catch((e) => {
      log(`Error: ${e}`);
      toast.error(String(e));
    });
  }

  function handleRetouchOpen(i: number) {
    const slot = slotsRef.current[i];
    if (!slot.rawBase64) return;
    setRetouchSlotIndex(i);
    setRetouchImageData("data:image/png;base64," + slot.rawBase64);
    setRetouchOpen(true);
  }

  async function handleRetouchSave(newDataUrl: string) {
    const newRaw = newDataUrl.split(",")[1];
    if (!newRaw) return;
    const i = retouchSlotIndex;
    const slot = slotsRef.current[i];
    updateSlot(i, { rawBase64: newRaw });
    log(`Applying retouch to slot ${i + 1}...`);
    try {
      await slotCompositeAndApply(i, newRaw, slot.bgColor);
      if (!isMounted()) return;
      log(`Retouch applied to slot ${i + 1}`);
    } catch (e) {
      if (!isMounted()) return;
      log(`Error: ${e}`);
      toast.error(String(e));
    }
  }

  function handleSlotReset(i: number) {
    const fallback = displayTemplates.length > 0 ? displayTemplates[0] : null;
    setSlots((prev) => {
      const next = [...prev];
      next[i] = freshSlot(i, fallback?.path ?? "");
      return next;
    });
  }

  function applySlotCount(newCount: number) {
    if (newCount === slots.length) {
      setCountDraft(String(newCount));
      return;
    }
    const fallback = displayTemplates.length > 0 ? displayTemplates[0] : null;
    if (newCount > slots.length) {
      setSlots((prev) => [
        ...prev,
        ...Array.from({ length: newCount - prev.length }, (_, i) =>
          freshSlot(prev.length + i, fallback?.path ?? ""),
        ),
      ]);
      setSlotCount(newCount);
      setCountDraft(String(newCount));
      return;
    }
    const dropped = slots.slice(newCount);
    const hasContent = dropped.some((s) => s.step !== "empty");
    if (!hasContent) {
      setSlots((prev) => prev.slice(0, newCount));
      setSlotCount(newCount);
      setCountDraft(String(newCount));
      return;
    }
    pendingShrinkRef.current = newCount;
    setCountDraft(String(newCount));
    toast(
      `Reduce to ${newCount} slots? ${dropped.filter((s) => s.step !== "empty").length} filled slot(s) at slot ${newCount + 1}+ will be cleared.`,
      {
        action: {
          label: "Reduce",
          onClick: () => {
            pendingShrinkRef.current = null;
            setSlots((prev) => prev.slice(0, newCount));
            setSlotCount(newCount);
            setCountDraft(String(newCount));
          },
        },
        onDismiss: () => {
          if (pendingShrinkRef.current !== null) {
            pendingShrinkRef.current = null;
            setCountDraft(String(slotCount));
            setSlotCount(slotCount);
          }
        },
      },
    );
  }

  function stepCount(dir: 1 | -1, shift: boolean) {
    const step = (shift ? 5 : 1) * dir;
    const next = slotCount + step;
    if (next < 6 || next > 100) return;
    applySlotCount(next);
    setCountDraft(String(next));
  }

  function commitCount() {
    const val = parseInt(countDraft, 10);
    if (isNaN(val)) {
      setCountDraft(String(slotCount));
      return;
    }
    applySlotCount(Math.min(100, Math.max(6, val)));
  }

  function handleResetAll() {
    const fallback = displayTemplates.length > 0 ? displayTemplates[0] : null;
    setSlots(Array.from({ length: slotCount }, (_, i) => freshSlot(i, fallback?.path ?? "")));
    setLogs([]);
  }

  function clickSlotUpload(i: number) {
    beginBrowse();
    fileInputRefs.current[i]?.click();
  }

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<{ msg: string }>("batch_progress", (e) => {
        logRef.current(`[export] ${e.payload.msg}`);
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  async function handleComposite(savePath?: string) {
    const done = slotsRef.current.filter((s) => s.step === "done");
    if (done.length === 0) return;
    const missing = done.find((s) => !s.selectedTemplate);
    if (missing) {
      log("✗ No template selected for one or more slots");
      return;
    }
    onPrintReminder?.();
    setBusy(true);
    log("Compositing strip PDF...");
    try {
      const clients = done.map((s) => ({
        imageBase64: s.resultPath!.split(",")[1],
        svgPath: s.selectedTemplate,
      }));
      const msg = await invoke<string>("composite_multi_pdf", {
        clients,
        savePath: savePath ?? null,
        tab: "other",
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
  }

  async function handleSavePdf() {
    const done = slotsRef.current.filter((s) => s.step === "done");
    const { save } = await import("@tauri-apps/plugin-dialog");
    const savePath = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: buildSavePath(["strips", `${done.length}slots`]),
    });
    if (!savePath) return;
    setLastSaveDir(savePath);
    await handleComposite(savePath);
  }

  const anyCrop = slots.some((s) => s.step === "crop" && s.croppedAreaPixels);
  const anyDone = slots.some((s) => s.step === "done");

  const statFooter =
    keyCount > 0 ? (
      <div className="border-t border-[#2a2a28] p-3 grid grid-cols-2 gap-2">
        {[
          { label: "API KEY", value: `Key ${activeKeyIndex + 1}/${keyCount}`, accent: true },
          { label: "SLOTS", value: `${slots.filter((s) => s.step !== "empty").length}/${slotCount}`, accent: false },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-[#111110] border border-[#2a2a28] rounded-md p-2">
            <div className="text-[9px] text-[#444] font-mono tracking-widest uppercase mb-1">{label}</div>
            <div className={cn("text-sm font-mono font-semibold", accent ? "text-[#4caf78]" : "text-[#e8e4da]")}>{value}</div>
          </div>
        ))}
      </div>
    ) : (
      <div className="border-t border-[#2a2a28] p-3">
        <div className="bg-[#1a1508] border border-[#c8881a]/30 rounded-md p-2 flex items-center gap-2">
          <TriangleAlert className="w-3.5 h-3.5 text-[#c8881a] flex-shrink-0" />
          <span className="text-[10px] text-[#c8881a] font-mono">No API keys — TEST MODE ONLY. Add keys in Settings.</span>
        </div>
      </div>
    );

  return (
    <main className="max-w-6xl mx-auto p-6 grid grid-cols-[1fr_300px] gap-6">
      <div className="space-y-4">

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">
              {sizeLabel} — {slotCount} Slots
            </h2>
            <Tooltip content="Number of client slots (6–100)">
              <div className="flex items-center gap-1.5 bg-[#111110] border border-[#2a2a28] rounded-lg px-2 py-1">
                <span className="text-[10px] font-mono text-[#555] tracking-wider uppercase">Slots:</span>
                <input
                  ref={countInputRef}
                  type="number"
                  min="6"
                  max="100"
                  step="1"
                  value={countDraft}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCountDraft(val);
                    const num = parseInt(val, 10);
                    if (isNaN(num) || num < 6 || num > 100) {
                      setInvalidCountDraft(val);
                    } else {
                      setInvalidCountDraft(null);
                    }
                  }}
                  onBlur={commitCount}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitCount();
                    }
                  }}
                  className={cn(
                    "w-16 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-0.5 text-xs font-mono outline-none text-center",
                    invalidCountDraft !== null ? "text-red-400" : "text-[#e8e4da]",
                  )}
                />
              </div>
            </Tooltip>
          </div>
          <div className="flex items-center gap-3">
            <Tooltip
              content={testMode ? TOOLTIPS.testMode.on : TOOLTIPS.testMode.off}
            >
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <span className="text-[10px] font-mono text-[#555] tracking-wider uppercase">
                  {noApiKeys ? "No API" : testMode ? "Test" : "Live"}
                </span>
                <div
                  onClick={() => !noApiKeys && setTestMode(!testMode)}
                  className={cn(
                    "w-7 h-4 rounded-full transition-colors relative",
                    (testMode || noApiKeys) ? "bg-[#c8881a]" : "bg-[#2a2a28]",
                    noApiKeys && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                      (testMode || noApiKeys) ? "translate-x-[14px]" : "translate-x-[2px]",
                    )}
                  />
                </div>
              </label>
            </Tooltip>
            <div className="flex gap-2">
              {anyCrop && (
                <Tooltip content={TOOLTIPS.processAll}>
                  <button
                    onClick={handleProcessAll}
                    disabled={busy}
                    className="px-3 py-1.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-xs tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] flex items-center gap-1.5"
                  >
                    {busy ? <RotateCw className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />}
                    Process All
                  </button>
                </Tooltip>
              )}
              <Tooltip content={TOOLTIPS.resetAll}>
                <button
                  onClick={handleResetAll}
                  className="px-3 py-1.5 text-[#555] hover:text-[#888] text-xs font-mono transition-colors"
                >
                  Reset All
                </button>
              </Tooltip>
            </div>
          </div>
        </div>

        {slots.map((slot, i) => (
          <div key={i} className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-[#2a2a28]">
              <span className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase flex-1">
                {slotLabel(i)}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {slot.step !== "empty" && (
                  <Tooltip content={TOOLTIPS.removeSlot}>
                    <button
                      onClick={() => handleSlotReset(i)}
                      className="text-[#555] hover:text-red-400 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
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
                  <div ref={cropperWheelRef} data-slot-index={i} className="flex-1 relative">
                    <Cropper
                      image={slot.originalImage}
                      crop={slot.crop}
                      zoom={slot.zoom}
                      rotation={slot.rotation}
                      aspect={cropAspect}
                      zoomSpeed={0.1}
                      showGrid={false}
                      restrictPosition={false}
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
                    step={0.05}
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
                <div className="relative">
                  <div
                    className="rounded-lg flex items-center justify-center p-3"
                    style={{
                      backgroundImage: "repeating-conic-gradient(#1e1e1c 0% 25%, #161614 0% 50%)",
                      backgroundSize: "12px 12px",
                    }}
                  >
                    <img src={slot.resultPath} alt="Result" className="max-h-[120px] object-contain rounded shadow-lg" />
                  </div>
                  <RetouchButton onClick={() => handleRetouchOpen(i)} />
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
                  {templatesLoading ? (
                    <div className="w-full h-7 bg-[#1a1a18] border border-[#2a2a28] rounded-lg animate-pulse" />
                  ) : displayTemplates.length > 1 ? (
                    <Tooltip content={TOOLTIPS.selectTemplate} className="w-full">
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
                    </Tooltip>
                  ) : (
                    <div className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-2 py-1 text-xs text-[#888] font-mono truncate">
                      Template: {displayTemplates[0]?.name ?? "—"}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        {anyDone && (
          <div className="flex gap-3">
            <Tooltip content={TOOLTIPS.savePdf} className="flex-1">
              <button
                onClick={handleSavePdf}
                disabled={busy}
                className="flex-1 px-4 py-2.5 bg-transparent text-[#c8881a] border border-[#c8881a] rounded-lg font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Save PDF
              </button>
            </Tooltip>
            <Tooltip content={TOOLTIPS.printAll} className="flex-1">
              <button
                onClick={() => handleComposite()}
                disabled={busy}
                className="flex-1 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] flex items-center justify-center gap-2"
              >
                {busy ? <RotateCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                {busy ? "Compositing..." : `Print All (${slots.filter((s) => s.step === "done").length} slots)`}
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <LogsPanel title="Batch Logs" entries={logs} footer={statFooter} />

      <RetouchWindow
        isOpen={retouchOpen}
        imageDataUrl={retouchImageData}
        onClose={() => setRetouchOpen(false)}
        onSave={handleRetouchSave}
      />
    </main>
  );
});

export default StripBatchClient;
