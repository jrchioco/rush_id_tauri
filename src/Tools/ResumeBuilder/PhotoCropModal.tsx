import { useState, useCallback, useEffect, useRef } from "react";
import Cropper, { Area } from "react-easy-crop";
import { X, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { Tooltip } from "../../components/Tooltip";
import { TOOLTIPS } from "../../lib/tooltips";
import { ThemedModal } from "../../components/ThemedModal";
import { RotationSidebar } from "../../components/RotationSidebar";
import { cropImage } from "../../lib/cropImage";
import { loadCropperImage } from "../../lib/loadCropperImage";
import { useTauriDragDrop } from "../../lib/hooks/useTauriDragDrop";

const ASPECT = 35 / 45;

interface PhotoCropModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (base64: string, fileName: string) => void;
  /** Optional preloaded image dataUrl for Phase A scaffold testing */
  imageSrc?: string | null;
  fileName?: string;
}

export function PhotoCropModal({ open, onClose, onConfirm, imageSrc: initialImageSrc, fileName: initialFileName }: PhotoCropModalProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageSrc ?? null);
  const [fileName, setFileName] = useState(initialFileName ?? "photo.png");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setImageSrc(initialImageSrc ?? null);
      setFileName(initialFileName ?? "photo.png");
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setCroppedAreaPixels(null);
      setBusy(false);
      setLoading(false);
    }
  }, [open, initialImageSrc, initialFileName]);

  const handleLoad = useCallback(async (source: File | string) => {
    setLoading(true);
    try {
      const result = await loadCropperImage(source);
      setImageSrc(result.dataUrl);
      setFileName(result.fileName);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setCroppedAreaPixels(null);
    } catch (e) {
      toast.error(`Failed to load image: ${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const { isDragging } = useTauriDragDrop((paths) => {
    if (!open) return;
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
    const p = paths.find((pp) => validExts.includes(pp.split(".").pop()?.toLowerCase() ?? ""));
    if (!p) {
      toast.error("No valid image file dropped");
      return;
    }
    handleLoad(p);
    if (paths.length > 1) toast.error(`${paths.length - 1} file(s) skipped — only one photo allowed`);
  });

  useEffect(() => {
    if (!open) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile() ?? e.clipboardData?.files?.[0];
          if (file) {
            handleLoad(file);
            break;
          }
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [open, handleLoad]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels) {
      toast.error("No crop area");
      return;
    }
    setBusy(true);
    try {
      const base64 = await cropImage(imageSrc, croppedAreaPixels, rotation || 0);
      onConfirm(base64, fileName);
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const wheelRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const handler = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      setRotation((r) => Math.max(-90, Math.min(90, r - Math.sign(e.deltaY))));
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, []);

  return (
    <ThemedModal open={open} onClose={onClose} panelClassName="w-[720px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a28]">
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide">Crop Photo — 35×45mm passport</h3>
        <Tooltip content={TOOLTIPS.resumePhotoClose}><button onClick={onClose} className="p-1 rounded text-[#555] hover:text-[#e8e4da] hover:bg-[#1a1a18] transition-colors">
          <X className="w-4 h-4" />
        </button></Tooltip>
      </div>

      <div className="flex-1 flex min-h-[380px] bg-[#0c0c0b] overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 z-10 bg-[#0c0c0b]/70 flex items-center justify-center">
            <p className="text-xs font-mono text-[#888]">Loading…</p>
          </div>
        )}
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-[#c8881a]/10 border-2 border-dashed border-[#c8881a] flex items-center justify-center pointer-events-none">
            <p className="text-sm font-mono text-[#c8881a]">Drop image here</p>
          </div>
        )}
        {imageSrc ? (
          <>
            <RotationSidebar value={rotation} onChange={setRotation} size="sm" />
            <div ref={wheelRef} className="flex-1 relative bg-[#0c0c0b]">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={ASPECT}
                zoomSpeed={0.1}
                showGrid={false}
                restrictPosition={false}
                classes={{ cropAreaClassName: "cropper-face-guide-passport" }}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>
          </>
        ) : (
          <Tooltip content={TOOLTIPS.resumePhotoDropzone} className="flex-1 flex"><div onClick={() => fileInputRef.current?.click()} className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#111110] cursor-pointer hover:bg-[#1a1a18] transition-colors">
            <Upload className="w-6 h-6 text-[#444] mb-2" />
            <p className="text-xs font-mono text-[#888]">Drop image, click to browse, or paste (Ctrl+V)</p>
            <p className="text-[10px] font-mono text-[#555] mt-1">PNG, JPG, WEBP — 35×45mm crop</p>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleLoad(e.target.files[0])} />
          </div></Tooltip>
        )}
      </div>

      {imageSrc && (
        <div className="px-4 py-3 flex items-center gap-3 border-t border-[#2a2a28] bg-[#111110]">
          <span className="text-xs font-mono text-[#555]">Zoom</span>
          <Tooltip content={TOOLTIPS.resumePhotoZoom} className="flex-1"><input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[#c8881a]" /></Tooltip>
          <span className="text-[10px] font-mono text-[#555]">{zoom.toFixed(2)}×</span>
          <Tooltip content={TOOLTIPS.resumePhotoChange}><button onClick={() => fileInputRef.current?.click()} className="ml-2 px-2 py-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[10px] font-mono text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30">Change</button></Tooltip>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleLoad(e.target.files[0])} />
        </div>
      )}

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#2a2a28] bg-[#0c0c0b]">
        <Tooltip content={TOOLTIPS.resumePhotoCancel}><button onClick={onClose} disabled={busy} className="px-4 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30 text-xs font-mono disabled:opacity-50">
          Cancel
        </button></Tooltip>
        <Tooltip content={TOOLTIPS.resumePhotoConfirm}><button onClick={handleConfirm} disabled={busy || !imageSrc || !croppedAreaPixels} className="px-4 py-1.5 rounded-lg bg-[#c8881a] text-[#0c0c0b] font-bold text-xs tracking-wide hover:bg-[#e8a030] flex items-center gap-1.5 disabled:bg-[#2a2a28] disabled:text-[#555]">
          <Check className="w-3.5 h-3.5" /> {busy ? "Cropping…" : "Use Photo"}
        </button></Tooltip>
      </div>
    </ThemedModal>
  );
}
