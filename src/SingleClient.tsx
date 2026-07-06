import { useState, useCallback, useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from "react";
import { invoke } from "@tauri-apps/api/core";
import Cropper, { Area } from "react-easy-crop";
import { Upload, Printer, FileDown, Scissors, RotateCw, ChevronDown, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn, fmt, compositeOnColor, getFontOption, getNextFontChoice, labelArgsFor } from "./lib/utils";
import { cropImage } from "./lib/cropImage";
import { readFileAsDataUrl } from "./lib/readFileAsDataUrl";
import { useKeyUsed } from "./lib/hooks/useKeyUsed";
import { useTemplates } from "./lib/hooks/useTemplates";
import { useTauriDragDrop } from "./lib/hooks/useTauriDragDrop";
import { useCropperWheel } from "./lib/hooks/useCropperWheel";
import { useIsMounted } from "./lib/hooks/useIsMounted";
import { useApiLogs } from "./lib/hooks/useApiLogs";
import { RotationSidebar } from "./components/RotationSidebar";
import { ColorPicker } from "./components/ColorPicker";
import { LogsPanel } from "./components/LogsPanel";
import { RetouchButton, RetouchWindow } from "./components/RetouchWindow";
import { Tooltip } from "./components/Tooltip";
import { TOOLTIPS } from "./lib/tooltips";
import type { LogEntry, LabelMode, FontChoice } from "./types";

type Step = "select" | "crop" | "done";

const SingleClient = forwardRef<{ hasUnsavedWork: () => boolean }>(function SingleClient(_, ref) {
  const [step, setStep] = useState<Step>("select");
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [rawBase64, setRawBase64] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState("#ffffff");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [rotation, setRotation] = useState(0);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [labelMode, setLabelMode] = useState<LabelMode>("off");
  const [nameLabel, setNameLabel] = useState("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [fontChoice, setFontChoice] = useState<FontChoice>("black");
  const [testMode, setTestMode] = useState(false);

  const [retouchOpen, setRetouchOpen] = useState(false);
  const [retouchImageData, setRetouchImageData] = useState("");

  const isMounted = useIsMounted();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const sigFileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const compositeIdRef = useRef(0);

  const { templates, keyCount, loading: templatesLoading } = useTemplates();
  const singleTemplates = useMemo(() => {
    const allowed = new Set(["1x1", "2x2", "Mixed", "Dev 1x1", "Dev 2x2", "Dev Mixed"]);
    return templates.filter((t) => allowed.has(t.key));
  }, [templates]);
  const displayTemplates = singleTemplates.length > 0 ? singleTemplates : templates;
  const noApiKeys = keyCount === 0;
  const effectiveTestMode = testMode || noApiKeys;
  const cropperWrapRef = useCropperWheel({
    onRotate: (delta) => setRotation((r) => Math.max(-90, Math.min(90, r + delta))),
  });
  const activeKeyIndex = useKeyUsed();

  useImperativeHandle(ref, () => ({
    hasUnsavedWork: () => originalImage !== null,
  }), [originalImage]);

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev.slice(-199), { time: fmt(), text }]);
  }, []);

  useApiLogs(log);

  useEffect(() => {
    if (displayTemplates.length > 0 && !selectedTemplate) {
      setSelectedTemplate(displayTemplates[0].path);
    }
  }, [displayTemplates, selectedTemplate]);

  const { isDragging } = useTauriDragDrop(async (paths) => {
    const filePath = paths[0];
    const ext = filePath.split(".").pop()?.toLowerCase();
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    if (!validExts.includes(ext ?? "")) {
      toast.error("Please drop an image file");
      return;
    }
    try {
      const { dataUrl, fileName } = await readFileAsDataUrl(filePath);
      setOriginalImage(dataUrl);
      setStep("crop");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      log(`Loaded: ${fileName}`);
    } catch (e) {
      toast.error(`Failed to read file: ${e}`);
      log(`Error reading file: ${e}`);
    }
  });

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setOriginalImage(reader.result as string);
      setStep("crop");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      log(`Loaded: ${file.name}`);
    };
    reader.readAsDataURL(file);
  }, [log]);

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile() ?? e.clipboardData?.files?.[0];
          if (file) {
            handleFile(file);
            break;
          }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTemplateOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function labelArgs(): { name: string | undefined; signature: string | null; fontStack: string } {
    const fontStack = getFontOption(fontChoice).stack;
    if (labelMode === "off") return { name: undefined, signature: null, fontStack };
    if (labelMode === "name") return { name: nameLabel, signature: null, fontStack };
    return { name: nameLabel, signature: signatureDataUrl, fontStack };
  }

  async function compositeAndApply(
    base64: string,
    color: string,
    name: string | undefined,
    signature: string | null,
    fontStack: string = getFontOption(fontChoice).stack,
  ) {
    const id = ++compositeIdRef.current;
    const dataUrl = await compositeOnColor(base64, color, name, signature, fontStack);
    if (id !== compositeIdRef.current) return;
    setResultPath(dataUrl);
    try {
      await invoke("write_picture", { imageBase64: dataUrl.split(",")[1] });
    } catch (e) {
      log(`Error: ${e}`);
    }
  }

  async function handleColorChange(color: string) {
    if (!rawBase64) return;
    if (color === bgColor) return;
    setBgColor(color);
    log(`Applying background: ${color}`);
    const { name, signature, fontStack } = labelArgs();
    try {
      await compositeAndApply(rawBase64, color, name, signature, fontStack);
    } catch (e) {
      if (!isMounted()) return;
      log(`Error: ${e}`);
    }
  }

  function handleLabelModeCycle() {
    const next: LabelMode = labelMode === "off" ? "name" : labelMode === "name" ? "name-sig" : "off";
    setLabelMode(next);
    if (!rawBase64) return;
    log(
      next === "off" ? "Hiding name label" :
      next === "name" ? "Showing name label" :
      "Showing name + signature label",
    );
    const { name, signature, fontStack } = labelArgsFor(next, nameLabel, signatureDataUrl, fontChoice);
    compositeAndApply(rawBase64, bgColor, name, signature, fontStack).catch((e) => {
      log(`Error: ${e}`);
      toast.error(String(e));
    });
  }

  function handleFontCycle() {
    const next = getNextFontChoice(fontChoice);
    setFontChoice(next);
    if (!rawBase64) return;
    const { name, signature, fontStack } = labelArgsFor(labelMode, nameLabel, signatureDataUrl, next);
    log(`Font: ${getFontOption(next).label.join(" ")}`);
    compositeAndApply(rawBase64, bgColor, name, signature, fontStack).catch((e) => {
      log(`Error: ${e}`);
      toast.error(String(e));
    });
  }

  async function handleNameChange(name: string) {
    setNameLabel(name);
    if (labelMode === "off" || !rawBase64) return;
    const sig = labelMode === "name-sig" ? signatureDataUrl : null;
    try {
      await compositeAndApply(rawBase64, bgColor, name, sig);
    } catch (e) {
      if (!isMounted()) return;
      log(`Error: ${e}`);
    }
  }

  function handleSignatureFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setSignatureDataUrl(dataUrl);
      if (labelMode !== "name-sig") setLabelMode("name-sig");
      log("Signature loaded");
      if (rawBase64) {
        try {
          await compositeAndApply(rawBase64, bgColor, nameLabel, dataUrl);
        } catch (e) {
          log(`Error: ${e}`);
        }
      }
    };
    reader.readAsDataURL(file);
  }

  function handleRetouchOpen() {
    if (!rawBase64) return;
    setRetouchImageData("data:image/png;base64," + rawBase64);
    setRetouchOpen(true);
  }

  async function handleRetouchSave(newDataUrl: string) {
    const newRaw = newDataUrl.split(",")[1];
    if (!newRaw) return;
    setRawBase64(newRaw);
    log("Applying retouch...");
    const { name, signature, fontStack } = labelArgs();
    try {
      await compositeAndApply(newRaw, bgColor, name, signature, fontStack);
      if (!isMounted()) return;
      log("Retouch applied");
    } catch (e) {
      if (!isMounted()) return;
      log(`Error: ${e}`);
    }
  }

  async function handleProcess() {
    if (!originalImage || !croppedAreaPixels) return;
    setLoading(true);
    log("Cropping image...");

    try {
      const base64 = await cropImage(originalImage, croppedAreaPixels, rotation);
      if (!isMounted()) return;
      let b64: string;
      if (effectiveTestMode) {
        log("Test mode — using cropped image (no API call)");
        b64 = base64;
      } else {
        log("Removing background...");
        b64 = await invoke<string>("remove_bg", { imageBase64: base64 });
        if (!isMounted()) return;
      }

      setRawBase64(b64);
      setBgColor("#ffffff");
      const { name, signature, fontStack } = labelArgs();
      const procId = ++compositeIdRef.current;
      const dataUrl = await compositeOnColor(b64, "#ffffff", name, signature, fontStack);
      if (!isMounted() || procId !== compositeIdRef.current) {
        setLoading(false);
        return;
      }
      setResultPath(dataUrl);
      await invoke("write_picture", { imageBase64: dataUrl.split(",")[1] });
      if (!isMounted()) return;
      setStep("done");
      log(effectiveTestMode ? "✓ Cropped (test mode)" : "✓ Background removed");
    } catch (e) {
      toast.error(String(e));
      log(`Error: ${e}`);
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  async function handlePrint() {
    if (!selectedTemplate) return;
    try {
      log("Opening print dialog...");
      const msg = await invoke<string>("print_file", { svgPath: selectedTemplate });
      if (!isMounted()) return;
      log(`✓ ${msg}`);
    } catch (e) {
      toast.error(String(e));
      log(`Error: ${e}`);
    }
  }

  async function handleSavePdf() {
    if (!selectedTemplate) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const savePath = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!savePath || !isMounted()) return;
      log("Exporting PDF...");
      const pdfPath = await invoke<string>("export_pdf", { svgPath: selectedTemplate, savePath });
      if (!isMounted()) return;
      await invoke("open_file", { path: pdfPath });
      if (!isMounted()) return;
      log("✓ PDF saved — press Ctrl+P to print");
    } catch (e) {
      toast.error(String(e));
      log(`Error: ${e}`);
    }
  }

  function handleReset() {
    setStep("select");
    setOriginalImage(null);
    setResultPath(null);
    setRawBase64(null);
    setBgColor("#ffffff");
    setRotation(0);
    setLabelMode("off");
    setNameLabel("");
    setSignatureDataUrl(null);
    setFontChoice("black");
  }

  const statFooter =
    keyCount > 0 ? (
      <div className="border-t border-[#2a2a28] p-3 grid grid-cols-2 gap-2">
        {[
          { label: "API KEY", value: `Key ${activeKeyIndex + 1}/${keyCount}`, accent: true },
          { label: "TEMPLATE", value: displayTemplates.find((t) => t.path === selectedTemplate)?.name ?? "—", accent: false },
          { label: "SIZE", value: "2×2 in", accent: false },
          { label: "DPI", value: "300", accent: false },
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

        <div className="flex items-center justify-end">
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
                effectiveTestMode ? "bg-[#c8881a]" : "bg-[#2a2a28]",
                noApiKeys && "opacity-50 cursor-not-allowed",
              )}
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                  effectiveTestMode ? "translate-x-[14px]" : "translate-x-[2px]",
                )}
              />
            </div>
          </label>
          </Tooltip>
        </div>

        {step === "select" && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all duration-200 bg-[#1a1a18]",
              isDragging
                ? "border-[#c8881a] bg-[#1a1508] scale-[1.01]"
                : "border-[#2a2a28] hover:border-[#c8881a]/50",
            )}
          >
            <Upload
              className={cn(
                "w-10 h-10 mx-auto mb-4",
                isDragging ? "text-[#c8881a]" : "text-[#444]",
              )}
            />
            <p
              className={cn(
                "text-base font-semibold mb-1 tracking-wide",
                isDragging ? "text-[#c8881a]" : "text-[#888]",
              )}
            >
              {isDragging ? "Release to upload" : "Drop an image here"}
            </p>
            <p className="text-xs text-[#444] font-mono">or click to browse · paste works too</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </div>
        )}

        {step === "crop" && originalImage && (
          <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-visible">
            <div className="flex min-h-[500px] bg-[#0c0c0b]">
              <RotationSidebar value={rotation} onChange={setRotation} size="lg" />
              <div ref={cropperWrapRef} className="flex-1 relative [clip-path:inset(0_round_0.75rem)]">
                <Cropper
                  image={originalImage}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  aspect={1}
                  zoomSpeed={0.1}
                  showGrid={false}
                  restrictPosition={false}
                  classes={{ cropAreaClassName: "cropper-face-guide-1x1" }}
                  onWheelRequest={(e) => e.ctrlKey || e.metaKey}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
                />
              </div>
            </div>
            <div className="p-4 flex items-center gap-4 border-t border-[#2a2a28]">
              <label className="text-xs text-[#555] font-mono">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-[#c8881a]"
              />
              <Tooltip content={effectiveTestMode ? TOOLTIPS.cropTestMode : TOOLTIPS.cropAndProcess}>
                <button
                  onClick={handleProcess}
                  disabled={loading}
                  className={cn(
                    "px-5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 tracking-wide transition-colors",
                    loading
                      ? "bg-[#2a2a28] text-[#555] cursor-not-allowed"
                      : "bg-[#c8881a] text-[#0c0c0b] hover:bg-[#e8a030]",
                  )}
                >
                  {loading ? <RotateCw className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                  {loading ? "Processing..." : effectiveTestMode ? "Crop (Test Mode)" : "Crop & Remove BG"}
                </button>
              </Tooltip>
              <Tooltip content={TOOLTIPS.cancel}>
                <button
                  onClick={handleReset}
                  className="px-3 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
                >
                  Cancel
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {step === "done" && resultPath && (
          <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase">Result</h2>
              <span className="text-xs bg-[#0a1f12] text-[#4caf78] font-mono px-2 py-0.5 rounded border border-[#4caf78]/20">
                {effectiveTestMode ? "✓ Cropped (Test)" : "✓ BG Removed"}
              </span>
            </div>

            <div
              className="relative rounded-lg flex items-center justify-center p-6 min-h-[300px]"
              style={{
                backgroundImage: "repeating-conic-gradient(#1e1e1c 0% 25%, #161614 0% 50%)",
                backgroundSize: "16px 16px",
              }}
            >
              <img src={resultPath} alt="Result" className="max-h-[360px] object-contain rounded shadow-2xl" />
              <RetouchButton onClick={handleRetouchOpen} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#555] font-mono tracking-widest uppercase">Background Color</label>
              <ColorPicker value={bgColor} onChange={handleColorChange} size="lg" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#555] font-mono tracking-widest uppercase">Name Label</label>
                <Tooltip content={TOOLTIPS.labelCycle}>
                  <button
                    onClick={handleLabelModeCycle}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-mono tracking-wider uppercase border transition-colors",
                      labelMode === "off"
                        ? "border-[#2a2a28] text-[#555] hover:text-[#888] hover:border-[#888]"
                        : "border-[#c8881a] text-[#c8881a] bg-[#c8881a]/10",
                    )}
                  >
                    {labelMode === "off" ? "Label" : labelMode === "name" ? "Name" : "Name+Sig"}
                  </button>
                </Tooltip>
              </div>
              {labelMode !== "off" && (
                <div className="flex items-center gap-2">
                  <Tooltip content={TOOLTIPS.fontCycle}>
                    <button
                      onClick={handleFontCycle}
                      className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono tracking-wider uppercase border border-[#c8881a] text-[#c8881a] bg-[#c8881a]/10 flex flex-col items-center leading-tight"
                    >
                      <span>{getFontOption(fontChoice).label[0]}</span>
                      {getFontOption(fontChoice).label[1] && <span>{getFontOption(fontChoice).label[1]}</span>}
                    </button>
                  </Tooltip>
                  <input
                    type="text"
                    value={nameLabel}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="FULL NAME"
                    maxLength={60}
                    className="flex-1 min-w-0 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#444] font-mono focus:outline-none focus:border-[#c8881a]"
                  />
                </div>
              )}
              {labelMode === "name-sig" && (
                <div className="flex items-center gap-2">
                  {signatureDataUrl ? (
                    <img
                      src={signatureDataUrl}
                      alt="Signature"
                      className="h-8 max-w-[100px] object-contain bg-white rounded border border-[#2a2a28]"
                    />
                  ) : (
                    <span className="text-[10px] text-[#555] font-mono">no signature</span>
                  )}
                  <button
                    onClick={() => sigFileInputRef.current?.click()}
                    className="flex-1 px-3 py-1.5 bg-[#1a1a18] border border-[#2a2a28] rounded-lg text-xs text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a] font-mono transition-colors"
                  >
                    {signatureDataUrl ? "Change signature" : "Browse for signature"}
                  </button>
                  <input
                    ref={sigFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleSignatureFile(e.target.files?.[0])}
                  />
                </div>
              )}
            </div>

            <div className="border border-[#2a2a28] rounded-lg p-4 space-y-3 bg-[#111110]">
              <div className="relative" ref={dropdownRef}>
                <label className="text-xs text-[#555] font-mono tracking-widest uppercase">SVG Template</label>
                {templatesLoading ? (
                  <div className="w-full mt-2 h-9 bg-[#1a1a18] border border-[#2a2a28] rounded-lg animate-pulse" />
                ) : (
                  <>
                    <button
                      onClick={() => setTemplateOpen(!templateOpen)}
                      className="w-full mt-2 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] font-mono flex items-center justify-between focus:outline-none focus:border-[#c8881a]"
                    >
                      <span>{displayTemplates.find((t) => t.path === selectedTemplate)?.name ?? "Select"}</span>
                      <ChevronDown
                        className={cn("w-4 h-4 text-[#555] transition-transform", templateOpen && "rotate-180")}
                      />
                    </button>
                    {templateOpen && (
                      <div className="absolute z-10 mt-1 w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg overflow-hidden shadow-xl">
                        {displayTemplates.map((t) => (
                          <button
                            key={t.key}
                            onClick={() => {
                              setSelectedTemplate(t.path);
                              setTemplateOpen(false);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm font-mono transition-colors",
                              t.path === selectedTemplate
                                ? "text-[#c8881a] bg-[#1a1508]"
                                : "text-[#e8e4da] hover:bg-[#2a2a28]",
                            )}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="flex gap-3">
                <Tooltip content={TOOLTIPS.print} className="flex-1">
                  <button
                    onClick={handlePrint}
                    className="flex-1 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors flex items-center justify-center gap-2"
                  >
                    <Printer className="w-4 h-4" /> Print
                  </button>
                </Tooltip>
                <Tooltip content={TOOLTIPS.savePdf} className="flex-1">
                  <button
                    onClick={handleSavePdf}
                    className="flex-1 px-4 py-2.5 bg-transparent text-[#c8881a] border border-[#c8881a] rounded-lg font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <FileDown className="w-4 h-4" /> Save PDF
                  </button>
                </Tooltip>
              </div>
            </div>

            <Tooltip content={TOOLTIPS.startOver}>
              <button
                onClick={handleReset}
                className="text-[#555] hover:text-[#888] text-xs font-mono transition-colors flex items-center gap-1"
              >
                ← Start Over
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      <LogsPanel title="Status & Logs" entries={logs} footer={statFooter} />

      <RetouchWindow
        isOpen={retouchOpen}
        imageDataUrl={retouchImageData}
        onClose={() => setRetouchOpen(false)}
        onSave={handleRetouchSave}
      />
    </main>
  );
});

export default SingleClient;
