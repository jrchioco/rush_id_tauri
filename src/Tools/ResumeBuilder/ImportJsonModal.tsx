import { useState, useEffect, useCallback, useRef } from "react";
import { X, Upload, ClipboardPaste, FileJson } from "lucide-react";
import { toast } from "sonner";
import { Tooltip } from "../../components/Tooltip";
import { TOOLTIPS } from "../../lib/tooltips";
import { ThemedModal } from "../../components/ThemedModal";
import { useTauriDragDrop } from "../../lib/hooks/useTauriDragDrop";
import { invoke } from "@tauri-apps/api/core";
import type { ResumeFormData } from "./Form";

interface ImportJsonModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: ResumeFormData) => void;
}

function strip(obj: any): any {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("_")) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return obj;
}

function validate(clean: any): string[] {
  const validKeys = ["col1_nophoto", "col1_photo", "col2_nophoto", "col2_photo"];
  const errors: string[] = [];
  if (!clean.full_name || typeof clean.full_name !== "string" || !clean.full_name.trim()) errors.push("full_name missing");
  if (!clean.template_key || !validKeys.includes(clean.template_key)) errors.push(`template_key must be one of ${validKeys.join(", ")}`);
  if (clean.education && !Array.isArray(clean.education)) errors.push("education must be array");
  if (clean.experience && !Array.isArray(clean.experience)) errors.push("experience must be array");
  if (clean.skills && !Array.isArray(clean.skills)) errors.push("skills must be array");
  if (clean.certifications && !Array.isArray(clean.certifications)) errors.push("certifications must be array");
  if (clean.contact) {
    if (clean.contact.phones && !Array.isArray(clean.contact.phones)) errors.push("contact.phones must be array");
    if (clean.contact.emails && !Array.isArray(clean.contact.emails)) errors.push("contact.emails must be array");
    if (clean.contact.phone && typeof clean.contact.phone !== "string" && !Array.isArray(clean.contact.phone)) errors.push("contact.phone must be string");
    if (clean.contact.email && typeof clean.contact.email !== "string" && !Array.isArray(clean.contact.email)) errors.push("contact.email must be string");
    for (const k of ["age", "birthdate", "height", "weight", "gender", "civil_status", "religion", "nationality"]) {
      if (clean.contact[k] !== undefined && clean.contact[k] !== null && typeof clean.contact[k] !== "string") errors.push(`contact.${k} must be string`);
    }
  }
  return errors;
}

export function ImportJsonModal({ open, onClose, onImport }: ImportJsonModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleJsonText = useCallback((text: string) => {
    setError(null);
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      setError("Invalid JSON — not parseable");
      toast.error("Invalid JSON — not parseable");
      return;
    }
    const clean = strip(data);
    const errors = validate(clean);
    if (errors.length) {
      const msg = "Import failed: " + errors.join("; ");
      setError(msg);
      toast.error(msg);
      return;
    }
    onImport(clean as ResumeFormData);
    onClose();
    toast.success(`Loaded ${clean.full_name || "resume"} — review then Generate`);
  }, [onImport, onClose]);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      handleJsonText(text);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [handleJsonText]);

  const handlePath = useCallback(async (path: string) => {
    setBusy(true);
    try {
      const content = await invoke<string>("read_file", { path });
      handleJsonText(content);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [handleJsonText]);

  const { isDragging } = useTauriDragDrop((paths) => {
    if (!open) return;
    if (paths.length === 0) return;
    const p = paths[0];
    const ext = p.split(".").pop()?.toLowerCase();
    if (ext !== "json") {
      toast.error("Please drop a .json file");
      return;
    }
    handlePath(p);
    if (paths.length > 1) toast.error(`${paths.length - 1} file(s) ignored — only one JSON allowed`);
  });

  useEffect(() => {
    if (!open) return;
    const handlePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text");
      if (text && text.trim().startsWith("{")) {
        e.preventDefault();
        handleJsonText(text);
        return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type === "text/plain") {
          item.getAsString((s) => {
            if (s.trim().startsWith("{")) handleJsonText(s);
          });
          break;
        }
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [open, handleJsonText]);

  const handleBrowse = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const p = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (!p || Array.isArray(p)) return;
      await handlePath(p as string);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handlePasteButton = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error("Clipboard is empty");
        return;
      }
      handleJsonText(text);
    } catch (e) {
      toast.error(`Paste failed: ${String(e)}`);
    }
  };

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <ThemedModal open={open} onClose={onClose} panelClassName="w-[520px] max-w-[95vw] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a28]">
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide flex items-center gap-2"><FileJson className="w-4 h-4 text-[#c8881a]" /> Import JSON</h3>
        <Tooltip content={TOOLTIPS.resumePhotoClose}><button onClick={onClose} className="p-1 rounded text-[#555] hover:text-[#e8e4da] hover:bg-[#1a1a18] transition-colors">
          <X className="w-4 h-4" />
        </button></Tooltip>
      </div>

      <div className="relative flex flex-col items-center justify-center p-8 text-center bg-[#111110] flex-1 w-full min-h-[220px]">
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-[#c8881a]/10 border-2 border-dashed border-[#c8881a] flex items-center justify-center pointer-events-none">
            <p className="text-sm font-mono text-[#c8881a]">Drop JSON here</p>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 z-10 bg-[#0c0c0b]/60 flex items-center justify-center">
            <p className="text-xs font-mono text-[#888]">Loading…</p>
          </div>
        )}
        <Tooltip content={TOOLTIPS.resumeImportDropzone} className="flex flex-col items-center">
          <Upload className="w-6 h-6 text-[#444] mb-2" />
          <p className="text-xs font-mono text-[#888]">Drop JSON, click to browse, or paste (Ctrl+V)</p>
          <p className="text-[10px] font-mono text-[#555] mt-1">Full resume JSON — _instructions stripped automatically</p>
        </Tooltip>
        <div className="flex gap-2 mt-4">
          <Tooltip content={TOOLTIPS.resumeImportBrowse}><button onClick={handleBrowse} className="px-3 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30 text-xs font-mono flex items-center gap-1.5">
            <Upload className="w-3.5 h-3.5" /> Browse
          </button></Tooltip>
          <Tooltip content={TOOLTIPS.resumeImportPaste}><button onClick={handlePasteButton} className="px-3 py-1.5 rounded-lg border border-[#c8881a]/30 bg-[#c8881a]/10 text-[#c8881a] hover:bg-[#c8881a]/20 text-xs font-mono flex items-center gap-1.5">
            <ClipboardPaste className="w-3.5 h-3.5" /> Paste from clipboard
          </button></Tooltip>
        </div>
        <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <Tooltip content={TOOLTIPS.resumeImportBrowse}><button onClick={() => fileInputRef.current?.click()} className="mt-3 text-[10px] font-mono text-[#555] hover:text-[#888]">or click here to browse</button></Tooltip>
        {error && <p className="mt-4 text-xs font-mono text-red-400 max-w-full break-words">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#2a2a28] bg-[#0c0c0b]">
        <Tooltip content={TOOLTIPS.cancel}><button onClick={onClose} className="px-4 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30 text-xs font-mono">Cancel</button></Tooltip>
      </div>
    </ThemedModal>
  );
}
