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

export default function App() {
  const [step, setStep] = useState<Step>("select");
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SvgTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Crop state
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function handleFile(file: File) {
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
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleCropComplete(_: Area, pixels: Area) {
    setCroppedAreaPixels(pixels);
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

      setResultPath("data:image/png;base64," + b64);
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
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-xl p-16 text-center cursor-pointer hover:border-blue-400 transition-colors bg-white"
            >
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-600 mb-1">Drop an image here</p>
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
