import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Cropper, { Area } from "react-easy-crop";
import { Upload, Printer, FileDown, Scissors, RotateCw, X } from "lucide-react";
import type { SvgTemplate } from "./types";
import { cn } from "./lib/utils";

type Step = "select" | "crop" | "done";

interface LogEntry {
  time: string;
  text: string;
}

function fmt() {
  return new Date().toLocaleTimeString();
}

const COLORS = [
  { label: "White", value: "#ffffff" },
  { label: "Blue", value: "#2563eb" },
  { label: "Red", value: "#dc2626" },
  { label: "Yellow", value: "#eab308" },
  { label: "Gray", value: "#6b7280" },
];

export default function App() {
  const [step, setStep] = useState<Step>("select");
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [rawBase64, setRawBase64] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState("#ffffff");
  const [templates, setTemplates] = useState<SvgTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Crop state
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const log = useCallback((text: string) => {
    setLogs((prev) => [...prev, { time: fmt(), text }]);
  }, []);

  useEffect(() => {
    invoke<SvgTemplate[]>("get_svg_templates")
      .then((t) => {
        setTemplates(t);
        if (t.length > 0) setSelectedTemplate(t[0].path);
      })
      .catch((e) => setError(String(e)));
  }, []);

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
          if (file) { handleFile(file); break; }
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handleFile]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("tauri://drag-drop", (event: any) => {
        const paths: string[] = event.payload.paths;
        if (!paths?.length) return;
        const filePath = paths[0];
        const ext = filePath.split(".").pop()?.toLowerCase();
        const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
        if (!validExts.includes(ext ?? "")) {
          setError("Please drop an image file");
          return;
        }
        import("@tauri-apps/plugin-fs").then(({ readFile }) => {
          readFile(filePath).then((bytes) => {
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
            let binary = "";
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
            }
            const base64 = btoa(binary);
            const dataUrl = `data:${mimeType};base64,${base64}`;
            setOriginalImage(dataUrl);
            setStep("crop");
            setCrop({ x: 0, y: 0 });
            setZoom(1);
            setError(null);
            log(`Loaded: ${filePath.split("/").pop() ?? filePath}`);
          }).catch((e) => {
            setError(`Failed to read file: ${e}`);
            log(`Error reading file: ${e}`);
          });
        });
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [log]);

  useEffect(() => {
    let unlistenEnter: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("tauri://drag-enter", () => setIsDragging(true)).then((fn) => { unlistenEnter = fn; });
      listen("tauri://drag-leave", () => setIsDragging(false)).then((fn) => { unlistenLeave = fn; });
      listen("tauri://drag-drop", () => setIsDragging(false));
    });
    return () => {
      unlistenEnter?.();
      unlistenLeave?.();
    };
  }, []);

  function handleCropComplete(_: Area, pixels: Area) {
    setCroppedAreaPixels(pixels);
  }

  function compositeOnColor(base64: string, color: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Canvas toBlob failed")); return; }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        }, "image/png");
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = "data:image/png;base64," + base64;
    });
  }

  async function handleColorChange(color: string) {
    if (!rawBase64) return;
    if (color === bgColor) return;
    setBgColor(color);
    log(`Applying background: ${color}`);
    try {
      const dataUrl = await compositeOnColor(rawBase64, color);
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
      const img = new Image();
      img.src = originalImage;
      await new Promise((r) => (img.onload = r));

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      canvas.width = croppedAreaPixels.width;
      canvas.height = croppedAreaPixels.height;

      ctx.drawImage(
        img,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        croppedAreaPixels.width,
        croppedAreaPixels.height
      );

      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
      const base64 = await new Promise<string>((r) => {
        const reader = new FileReader();
        reader.onload = () => r((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      });

      log("Removing background...");
      const b64 = await invoke<string>("remove_bg", { imageBase64: base64 });

      setRawBase64(b64);
      setBgColor("#ffffff");
      const dataUrl = await compositeOnColor(b64, "#ffffff");
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
      log("Sending to printer...");
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
      const savePath = await save({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!savePath) return;
      log("Exporting PDF...");
      await invoke("export_pdf", { svgPath: selectedTemplate, savePath });
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(savePath);
      log("✓ PDF saved");
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
    setError(null);
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <img src="/comlogo.png" alt="Logo" className="w-12 h-12 object-contain" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">J3FF PRINTING SERVICES</h1>
            <p className="text-sm text-gray-500">Image Background Removal & SVG Printer</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 grid grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
              <X className="w-4 h-4" /> {error}
            </div>
          )}

          {step === "select" && (
            <div
              ref={dropRef}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-all duration-200 bg-white",
                isDragging
                  ? "border-blue-500 bg-blue-50 scale-[1.01]"
                  : "border-gray-300 hover:border-blue-400"
              )}
            >
              <Upload className={cn("w-12 h-12 mx-auto mb-4", isDragging ? "text-blue-500" : "text-gray-400")} />
              <p className={cn("text-lg font-medium mb-1", isDragging ? "text-blue-600" : "text-gray-600")}>
                {isDragging ? "Release to upload" : "Drop an image here"}
              </p>
              <p className="text-sm text-gray-400">or click to browse</p>
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
            <div className="bg-white rounded-xl overflow-hidden">
              <div className="relative h-[500px] bg-gray-900">
                <Cropper
                  image={originalImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={handleCropComplete}
                />
              </div>
              <div className="p-4 flex items-center gap-4">
                <label className="text-sm text-gray-500">Zoom:</label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.1}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="flex-1"
                />
                <button
                  onClick={handleProcess}
                  disabled={loading}
                  className={cn(
                    "px-6 py-2 rounded-lg font-medium text-white flex items-center gap-2",
                    loading
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700"
                  )}
                >
                  {loading ? (
                    <RotateCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Scissors className="w-4 h-4" />
                  )}
                  {loading ? "Processing..." : "Crop & Remove Background"}
                </button>
                <button onClick={handleReset} className="px-4 py-2 text-gray-500 hover:text-gray-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {step === "done" && resultPath && (
            <div className="bg-white rounded-xl p-6 space-y-4">
              <h2 className="text-lg font-semibold">Result</h2>
              <div className="bg-gray-100 rounded-lg flex items-center justify-center p-4">
                <img src={resultPath} alt="Result" className="max-h-[400px] object-contain rounded" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Background Color:</label>
                <div className="flex items-center gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      onClick={() => handleColorChange(c.value)}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-all",
                        bgColor === c.value
                          ? "border-blue-500 ring-2 ring-blue-200 scale-110"
                          : "border-gray-300 hover:scale-110"
                      )}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                  <input
                    type="color"
                    value={bgColor}
                    onChange={(e) => handleColorChange(e.target.value)}
                    className="w-8 h-8 rounded-full border-2 border-gray-300 overflow-hidden cursor-pointer"
                    title="Custom"
                  />
                </div>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                <label className="text-sm font-medium text-gray-700">Choose SVG template:</label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => setSelectedTemplate(e.target.value)}
                  className="w-full rounded-lg border-gray-300 border px-3 py-2 text-sm"
                >
                  {templates.map((t) => (
                    <option key={t.key} value={t.path}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-3">
                  <button
                    onClick={handlePrint}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium flex items-center justify-center gap-2"
                  >
                    <Printer className="w-4 h-4" /> Print
                  </button>
                  <button
                    onClick={handleSavePdf}
                    className="flex-1 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 font-medium flex items-center justify-center gap-2"
                  >
                    <FileDown className="w-4 h-4" /> Save PDF
                  </button>
                </div>
              </div>

              <button
                onClick={handleReset}
                className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm"
              >
                ← Start Over
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border shadow-sm h-fit">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-sm text-gray-700">Status & Logs</h3>
          </div>
          <div className="h-[400px] overflow-y-auto p-4 space-y-1 font-mono text-xs">
            {logs.length === 0 && (
              <p className="text-gray-400 italic">No activity yet</p>
            )}
            {logs.map((entry, i) => (
              <div key={i} className="text-gray-600">
                <span className="text-gray-400">[{entry.time}]</span> {entry.text}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
