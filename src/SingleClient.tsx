import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Cropper, { Area } from "react-easy-crop";
import { Upload, Printer, FileDown, Scissors, RotateCw, ChevronDown } from "lucide-react";
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
import type { LogEntry } from "./types";

type Step = "select" | "crop" | "done";

export default function SingleClient() {
  const [step, setStep] = useState<Step>("select");
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [rawBase64, setRawBase64] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState("#ffffff");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [rotation, setRotation] = useState(0);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [nameLabel, setNameLabel] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { templates, keyCount } = useTemplates();
  const cropperWrapRef = useCropperWheel({
    onRotate: (delta) => setRotation((r) => Math.max(-90, Math.min(90, r + delta))),
  });
  const activeKeyIndex = useKeyUsed();

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev, { time: fmt(), text }]);
  }, []);

  useEffect(() => {
    if (templates.length > 0 && !selectedTemplate) {
      setSelectedTemplate(templates[0].path);
    }
  }, [templates, selectedTemplate]);

  const { isDragging } = useTauriDragDrop(async (paths) => {
    const filePath = paths[0];
    const ext = filePath.split(".").pop()?.toLowerCase();
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    if (!validExts.includes(ext ?? "")) {
      setError("Please drop an image file");
      return;
    }
    try {
      const { dataUrl, fileName } = await readFileAsDataUrl(filePath);
      setOriginalImage(dataUrl);
      setStep("crop");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setError(null);
      log(`Loaded: ${fileName}`);
    } catch (e) {
      setError(`Failed to read file: ${e}`);
      log(`Error reading file: ${e}`);
    }
  });

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setOriginalImage(reader.result as string);
      setStep("crop");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setError(null);
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

  async function handleColorChange(color: string) {
    if (!rawBase64) return;
    if (color === bgColor) return;
    setBgColor(color);
    log(`Applying background: ${color}`);
    try {
      const labelName = showLabel ? nameLabel : undefined;
      const dataUrl = await compositeOnColor(rawBase64, color, labelName);
      setResultPath(dataUrl);
      await invoke("write_picture", { imageBase64: dataUrl.split(",")[1] });
    } catch (e) {
      log(`Error: ${e}`);
    }
  }

  async function handleLabelToggle(enabled: boolean) {
    setShowLabel(enabled);
    if (!rawBase64) return;
    log(enabled ? "Showing name label" : "Hiding name label");
    try {
      const labelName = enabled ? nameLabel : "";
      const dataUrl = await compositeOnColor(rawBase64, bgColor, labelName);
      setResultPath(dataUrl);
      await invoke("write_picture", { imageBase64: dataUrl.split(",")[1] });
    } catch (e) {
      log(`Error: ${e}`);
    }
  }

  async function handleNameChange(name: string) {
    setNameLabel(name);
    if (!showLabel || !rawBase64) return;
    try {
      const dataUrl = await compositeOnColor(rawBase64, bgColor, name);
      setResultPath(dataUrl);
      await invoke("write_picture", { imageBase64: dataUrl.split(",")[1] });
    } catch (e) {
      log(`Error: ${e}`);
    }
  }

  async function handleProcess() {
    if (!originalImage || !croppedAreaPixels) return;
    setLoading(true);
    setError(null);
    log("Cropping image...");

    try {
      const base64 = await cropImage(originalImage, croppedAreaPixels, rotation);
      log("Removing background...");
      const b64 = await invoke<string>("remove_bg", { imageBase64: base64 });

      setRawBase64(b64);
      setBgColor("#ffffff");
      const labelName = showLabel ? nameLabel : undefined;
      const dataUrl = await compositeOnColor(b64, "#ffffff", labelName);
      setResultPath(dataUrl);
      await invoke("write_picture", { imageBase64: dataUrl.split(",")[1] });
      setStep("done");
      log("✓ Background removed");
    } catch (e) {
      setError(String(e));
      log(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handlePrint() {
    if (!selectedTemplate) return;
    try {
      log("Opening print dialog...");
      const msg = await invoke<string>("print_file", { svgPath: selectedTemplate });
      log(`✓ ${msg}`);
    } catch (e) {
      setError(String(e));
      log(`Error: ${e}`);
    }
  }

  async function handleSavePdf() {
    if (!selectedTemplate) return;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const savePath = await save({ filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!savePath) return;
      log("Exporting PDF...");
      const pdfPath = await invoke<string>("export_pdf", { svgPath: selectedTemplate, savePath });
      await invoke("open_file", { path: pdfPath });
      log("✓ PDF saved — press Ctrl+P to print");
    } catch (e) {
      setError(String(e));
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
    setShowLabel(false);
    setNameLabel("");
    setError(null);
  }

  const inkscapeAction =
    error && error.toLowerCase().includes("inkscape") ? (
      <button
        onClick={async () => {
          const { open } = await import("@tauri-apps/plugin-dialog");
          const selected = await open({
            title: "Find inkscape.exe",
            filters: [{ name: "Executable", extensions: ["exe"] }],
          });
          if (selected) {
            await invoke("save_inkscape_path", { inkscapePath: selected });
            setError(null);
          }
        }}
        className="flex-shrink-0 px-2 py-1 bg-[#2a1a0a] border border-[#c8881a]/40 rounded text-[#c8881a] hover:border-[#c8881a] transition-colors"
      >
        Browse for Inkscape
      </button>
    ) : undefined;

  const statFooter =
    keyCount > 0 ? (
      <div className="border-t border-[#2a2a28] p-3 grid grid-cols-2 gap-2">
        {[
          { label: "API KEY", value: `Key ${activeKeyIndex + 1}/${keyCount}`, accent: true },
          { label: "TEMPLATE", value: templates.find((t) => t.path === selectedTemplate)?.name ?? "—", accent: false },
          { label: "SIZE", value: "2×2 in", accent: false },
          { label: "DPI", value: "300", accent: false },
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
        {error && <ErrorBanner message={error} action={inkscapeAction} />}

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
          <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-hidden">
            <div className="flex min-h-[500px] bg-[#0c0c0b]">
              <RotationSidebar value={rotation} onChange={setRotation} size="lg" />
              <div ref={cropperWrapRef} className="flex-1 relative">
                <Cropper
                  image={originalImage}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  aspect={1}
                  zoomSpeed={0.2}
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
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-[#c8881a]"
              />
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
                {loading ? "Processing..." : "Crop & Remove BG"}
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "done" && resultPath && (
          <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase">Result</h2>
              <span className="text-xs bg-[#0a1f12] text-[#4caf78] font-mono px-2 py-0.5 rounded border border-[#4caf78]/20">
                ✓ BG Removed
              </span>
            </div>

            <div
              className="rounded-lg flex items-center justify-center p-6 min-h-[300px]"
              style={{
                backgroundImage: "repeating-conic-gradient(#1e1e1c 0% 25%, #161614 0% 50%)",
                backgroundSize: "16px 16px",
              }}
            >
              <img src={resultPath} alt="Result" className="max-h-[360px] object-contain rounded shadow-2xl" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-[#555] font-mono tracking-widest uppercase">Background Color</label>
              <ColorPicker value={bgColor} onChange={handleColorChange} size="lg" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#555] font-mono tracking-widest uppercase">Name Label</label>
                <button
                  onClick={() => handleLabelToggle(!showLabel)}
                  title={showLabel ? "Hide name label" : "Show name label"}
                  className={cn(
                    "w-7 h-4 rounded-full transition-colors relative",
                    showLabel ? "bg-[#c8881a]" : "bg-[#2a2a28]",
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full bg-[#111110] absolute top-0.5 transition-transform",
                      showLabel ? "translate-x-[14px]" : "translate-x-[2px]",
                    )}
                  />
                </button>
              </div>
              {showLabel && (
                <input
                  type="text"
                  value={nameLabel}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="FULL NAME"
                  maxLength={60}
                  className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#444] font-mono focus:outline-none focus:border-[#c8881a]"
                />
              )}
            </div>

            <div className="border border-[#2a2a28] rounded-lg p-4 space-y-3 bg-[#111110]">
              <div className="relative" ref={dropdownRef}>
                <label className="text-xs text-[#555] font-mono tracking-widest uppercase">SVG Template</label>
                <button
                  onClick={() => setTemplateOpen(!templateOpen)}
                  className="w-full mt-2 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] font-mono flex items-center justify-between focus:outline-none focus:border-[#c8881a]"
                >
                  <span>{templates.find((t) => t.path === selectedTemplate)?.name ?? "Select"}</span>
                  <ChevronDown
                    className={cn("w-4 h-4 text-[#555] transition-transform", templateOpen && "rotate-180")}
                  />
                </button>
                {templateOpen && (
                  <div className="absolute z-10 mt-1 w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg overflow-hidden shadow-xl">
                    {templates.map((t) => (
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
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button
                  onClick={handleSavePdf}
                  className="flex-1 px-4 py-2.5 bg-transparent text-[#c8881a] border border-[#c8881a] rounded-lg font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 transition-colors flex items-center justify-center gap-2"
                >
                  <FileDown className="w-4 h-4" /> Save PDF
                </button>
              </div>
            </div>

            <button
              onClick={handleReset}
              className="text-[#555] hover:text-[#888] text-xs font-mono transition-colors flex items-center gap-1"
            >
              ← Start Over
            </button>
          </div>
        )}
      </div>

      <LogsPanel title="Status & Logs" entries={logs} footer={statFooter} />
    </main>
  );
}
