import { useState, useCallback, useRef } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { X, Images, FolderOpen, Loader2, ExternalLink } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTauriDragDrop } from "../../lib/hooks/useTauriDragDrop";
import { Tooltip } from "../../components/Tooltip";
import { setEffieMood } from "../../components/CompanionWidget/moodStore";

type TargetFormat = "png" | "jpeg" | "webp";

interface BatchItem {
  id: string;
  path: string;
  filename: string;
  checked: boolean;
  status: "pending" | "success" | "error";
  error?: string;
}

const VALID_EXTS = ["png", "jpg", "jpeg", "webp"];

function filenameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

function isValidImage(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return VALID_EXTS.includes(ext);
}

function Tile({ item, tileSize, onToggle, onRemove }: {
  item: BatchItem;
  tileSize: number;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const primarySrc = convertFileSrc(item.path);

  const handleImgError = useCallback(async () => {
    if (fallbackSrc !== null || failed) return;
    try {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes = await readFile(item.path);
      let binary = "";
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.slice(i, i + chunk));
      }
      const b64 = btoa(binary);
      const ext = item.path.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
      setFallbackSrc(`data:${mime};base64,${b64}`);
    } catch {
      setFailed(true);
    }
  }, [fallbackSrc, failed, item.path]);

  const src = fallbackSrc ?? primarySrc;

  return (
    <div
      className="group relative flex flex-col rounded-lg overflow-hidden border bg-[#0c0c0b] transition-colors"
      style={{ borderColor: item.checked ? "#c8881a55" : "#2a2a28" }}
    >
      <div
        className="relative flex items-center justify-center bg-[#111110] overflow-hidden"
        style={{ height: tileSize }}
      >
        {!failed ? (
          <img
            src={src}
            alt={item.filename}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={handleImgError}
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-[#444] p-2">
            <Images className="w-6 h-6 mb-1" />
            <span className="text-[9px] font-mono">preview unavailable</span>
          </div>
        )}

        <label
          className="absolute top-1.5 left-1.5 w-5 h-5 rounded bg-[#0c0c0b]/90 border border-[#2a2a28] flex items-center justify-center cursor-pointer hover:border-[#c8881a]/50 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={item.checked}
            onChange={onToggle}
            className="sr-only"
          />
          {item.checked && <span className="w-2.5 h-2.5 rounded-sm bg-[#c8881a]" />}
        </label>

        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[#0c0c0b]/90 border border-[#2a2a28] flex items-center justify-center text-[#888] hover:text-red-400 hover:border-red-400/30 opacity-0 group-hover:opacity-100 transition-all"
          aria-label="Remove"
        >
          <X className="w-3 h-3" />
        </button>

        {item.status === "success" && (
          <span className="absolute bottom-1 left-1 text-[9px] font-mono bg-[#4caf78] text-[#0c0c0b] px-1.5 py-0.5 rounded font-bold">done</span>
        )}
        {item.status === "error" && (
          <span className="absolute bottom-1 left-1 text-[9px] font-mono bg-red-500/90 text-white px-1.5 py-0.5 rounded font-bold" title={item.error}>failed</span>
        )}
      </div>

      <div className="px-2 py-1.5 bg-[#0c0c0b] border-t border-[#2a2a28]">
        <p className="text-[10px] font-mono text-[#888] truncate" title={item.filename}>{item.filename}</p>
        <p className="text-[9px] font-mono text-[#444] truncate" title={item.path}>{item.path}</p>
      </div>
    </div>
  );
}

interface BatchSummary {
  total: number;
  succeeded: number;
  failed: { file: string; reason: string }[];
  batch_dir: string;
}

export default function BatchConverter() {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [target, setTarget] = useState<TargetFormat>("png");
  const [tileSize, setTileSize] = useState(140);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastBatchDir, setLastBatchDir] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<BatchSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkedCount = items.filter((i) => i.checked).length;
  const allChecked = items.length > 0 && checkedCount === items.length;

  const addPaths = useCallback((paths: string[]) => {
    const valid = paths.filter(isValidImage);
    if (valid.length === 0) {
      if (paths.length > 0) toast.error("No supported images (PNG, JPEG, WebP)");
      return;
    }
    if (valid.length < paths.length) {
      toast.warning(`${paths.length - valid.length} file(s) ignored — unsupported format`);
    }
    setItems((prev) => {
      const existing = new Set(prev.map((p) => p.path));
      const next: BatchItem[] = [];
      for (const p of valid) {
        if (existing.has(p)) continue;
        next.push({
          id: `${p}::${Date.now()}::${Math.random().toString(36).slice(2, 6)}`,
          path: p,
          filename: filenameFromPath(p),
          checked: true,
          status: "pending",
        });
      }
      if (next.length === 0) toast.info("All dropped files already in batch");
      return [...prev, ...next];
    });
  }, []);

  useTauriDragDrop(addPaths);

  const handleToggle = useCallback((id: string) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, checked: !it.checked } : it));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const handleSelectAll = useCallback(() => {
    const next = !allChecked;
    setItems((prev) => prev.map((it) => ({ ...it, checked: next })));
  }, [allChecked]);

  const handleBrowse = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [{ name: "Images", extensions: ["png", "jpeg", "jpg", "webp"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected as string];
      addPaths(paths);
    } catch (e) {
      toast.error(String(e));
    }
  }, [addPaths]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.target.value = "";
    toast.info("Use drag & drop or Browse to add files via Tauri dialog for best preview.");
  }, []);

  const handleConvert = useCallback(async () => {
    const checked = items.filter((i) => i.checked);
    if (checked.length === 0) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dest = await open({ directory: true, multiple: false, title: "Choose destination folder" });
      if (!dest || Array.isArray(dest)) return;
      const checkedPaths = checked.map((c) => c.path);
      setConverting(true);
      setProgress({ done: 0, total: checkedPaths.length });
      setLastSummary(null);
      setEffieMood("working");

      let unlisten: (() => void) | null = null;
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ done: number; total: number }>("convert_progress", (e) => {
          setProgress({ done: e.payload.done, total: e.payload.total });
        });
      } catch {
        // listen not critical
      }

      try {
        const summary = await invoke<BatchSummary>("convert_images_batch", {
          sourcePaths: checkedPaths,
          targetFormat: target,
          destParent: dest as string,
        });
        setLastBatchDir(summary.batch_dir);
        setLastSummary(summary);

        // Per-file handling: success -> uncheck, failed -> keep checked for retry
        const failedFiles = new Set(summary.failed.map((f) => f.file));
        setItems((prev) =>
          prev.map((it) => {
            if (!checkedPaths.includes(it.path)) return it;
            if (failedFiles.has(it.filename)) {
              const reason = summary.failed.find((f) => f.file === it.filename)?.reason ?? "failed";
              return { ...it, status: "error" as const, error: reason, checked: true };
            }
            return { ...it, status: "success" as const, checked: false, error: undefined };
          })
        );

        if (summary.failed.length === 0) {
          toast.success(`${summary.succeeded}/${summary.total} converted — ${summary.batch_dir}`);
          setEffieMood("success");
        } else {
          toast.warning(`${summary.succeeded}/${summary.total} converted, ${summary.failed.length} failed — ${summary.failed.map((f) => `${f.file} (${f.reason})`).join(", ")}`);
          setEffieMood("error");
        }

        // Auto-open batch folder
        try {
          const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
          await revealItemInDir(summary.batch_dir);
        } catch {
          // fallback toast already shows path
        }
        console.log("[convert] summary", summary);
      } finally {
        unlisten?.();
        setProgress(null);
      }
    } catch (e) {
      toast.error(String(e));
      setEffieMood("error");
    } finally {
      setConverting(false);
    }
  }, [items, target]);

  const handleOpenFolder = useCallback(async () => {
    if (!lastBatchDir) return;
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(lastBatchDir);
    } catch (e) {
      toast.error(String(e));
    }
  }, [lastBatchDir]);

  return (
    <div className="flex flex-col h-full min-h-[520px]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide flex items-center gap-2">
            <Images className="w-4 h-4 text-[#c8881a]" /> Batch Image Converter
          </h3>
          <p className="text-xs font-mono text-[#555] mt-0.5">Drag in WebP, JPEG, or PNG — convert all checked to one target format.</p>
        </div>
        <Tooltip content="Browse via system dialog">
          <button
            onClick={handleBrowse}
            className="px-3 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30 text-xs font-mono flex items-center gap-1.5 transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" /> Browse
          </button>
        </Tooltip>
        <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={handleFileInput} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 p-3 rounded-lg bg-[#0c0c0b] border border-[#2a2a28]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#555] tracking-widest uppercase">Target</span>
          <div className="flex rounded-lg border border-[#2a2a28] overflow-hidden">
            {(["png", "jpeg", "webp"] as TargetFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setTarget(fmt)}
                className={cn(
                  "px-3 py-1.5 text-xs font-mono font-bold tracking-wide transition-colors",
                  target === fmt ? "bg-[#c8881a] text-[#0c0c0b]" : "bg-[#111110] text-[#888] hover:text-[#e8e4da]"
                )}
              >
                {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="w-px h-6 bg-[#2a2a28]" />

        <button
          onClick={handleSelectAll}
          disabled={items.length === 0}
          className="text-xs font-mono text-[#c8881a] hover:text-[#e8a030] disabled:text-[#444] disabled:cursor-not-allowed transition-colors"
        >
          {allChecked ? "Deselect All" : "Select All"}
        </button>
        <span className="text-xs font-mono text-[#555]">{checkedCount}/{items.length} selected</span>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-[#555] tracking-widest uppercase">Density</span>
          <input
            type="range"
            min={80}
            max={200}
            step={10}
            value={tileSize}
            onChange={(e) => setTileSize(Number(e.target.value))}
            className="w-24 accent-[#c8881a]"
          />
          <span className="text-[10px] font-mono text-[#444] w-8">{tileSize}px</span>
        </div>
      </div>

      <div
        className="flex-1 min-h-[300px] rounded-xl border-2 border-dashed bg-[#0c0c0b] p-4 flex flex-col overflow-hidden"
        style={{ borderColor: items.length === 0 ? "#2a2a28" : "#1a1a18" }}
      >
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
            <div className="w-12 h-12 rounded-xl bg-[#1a1a18] border border-[#2a2a28] flex items-center justify-center mb-3">
              <Images className="w-6 h-6 text-[#444]" />
            </div>
            <p className="text-sm font-mono text-[#555]">Drop images here</p>
            <p className="text-xs font-mono text-[#444] mt-1">PNG, JPEG, WebP — mixed formats allowed</p>
            <p className="text-xs font-mono text-[#444] mt-3">or <button onClick={handleBrowse} className="text-[#c8881a] hover:underline">browse</button> via dialog</p>
          </div>
        ) : (
          <div
            className="flex-1 overflow-y-auto pr-1"
            style={{ ["--tile-size" as string]: `${tileSize}px` } as React.CSSProperties}
          >
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--tile-size), 1fr))" }}>
              {items.map((it) => (
                <Tile key={it.id} item={it} tileSize={tileSize} onToggle={() => handleToggle(it.id)} onRemove={() => handleRemove(it.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 mt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleConvert}
            disabled={checkedCount === 0 || converting}
            className="flex-1 px-4 py-2.5 rounded-lg font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed bg-[#c8881a] text-[#0c0c0b] hover:bg-[#e8a030] disabled:bg-[#2a2a28] disabled:text-[#555]"
            title={checkedCount === 0 ? "Select at least one image" : `Convert ${checkedCount} image(s) to ${target.toUpperCase()}`}
          >
            {converting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {converting && progress ? `Converting ${progress.done}/${progress.total}...` : converting ? "Converting..." : `Convert ${checkedCount > 0 ? `(${checkedCount}) → ${target.toUpperCase()}` : ""}`}
          </button>
          {lastBatchDir && !converting && (
            <button
              onClick={handleOpenFolder}
              className="px-4 py-2.5 rounded-lg font-bold text-sm tracking-wide flex items-center justify-center gap-2 border border-[#c8881a] text-[#c8881a] hover:bg-[#c8881a]/10 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Open Folder
            </button>
          )}
        </div>
        {converting && progress ? (
          <p className="text-xs font-mono text-[#c8881a]">Converting {progress.done}/{progress.total} — {target.toUpperCase()} @ ~90 quality</p>
        ) : lastSummary ? (
          <p className="text-xs font-mono">
            <span className="text-[#4caf78]">{lastSummary.succeeded}/{lastSummary.total} converted</span>
            {lastSummary.failed.length > 0 && (
              <span className="text-red-400">, {lastSummary.failed.length} failed — {lastSummary.failed.map((f) => `${f.file} (${f.reason})`).join(", ")}</span>
            )}
            <span className="text-[#555]"> — {lastBatchDir}</span>
          </p>
        ) : (
          <p className="text-xs font-mono text-[#444]">{converting ? "Pick destination, then converting..." : "End-to-end via Rust image crate — failures stay checked for retry"}</p>
        )}
      </div>
    </div>
  );
}
