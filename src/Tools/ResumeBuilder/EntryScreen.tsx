import { useState } from "react";
import { FileText, Upload, Download, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import ResumeForm, { ResumeFormData } from "./Form";
import BrowseResumes from "./Browse";
import { invoke } from "@tauri-apps/api/core";

const CARDS = [
  {
    key: "fill",
    label: "Fill Out Form",
    desc: "Start blank and fill the resume fields",
    icon: FileText,
  },
  {
    key: "import",
    label: "Import JSON",
    desc: "Load a filled JSON file",
    icon: Upload,
  },
  {
    key: "generate",
    label: "Generate JSON",
    desc: "Copy AI-fillable template to clipboard",
    icon: Download,
  },
  {
    key: "browse",
    label: "Browse Resumes",
    desc: "Grid of saved resumes",
    icon: LayoutGrid,
  },
] as const;

export default function ResumeBuilderEntry() {
  const [view, setView] = useState<"entry" | "form" | "browse">("entry");
  const [editData, setEditData] = useState<ResumeFormData | null>(null);
  const handleSelectResume = async (id: number) => {
    try {
      const r = await invoke<{ data_json: string }>("get_resume", { id });
      const data = JSON.parse(r.data_json);
      setEditData(data);
      setView("form");
    } catch (e) {
      toast.error(String(e));
    }
  };
  if (view === "form") return <ResumeForm initialData={editData ?? undefined} onBack={() => { setEditData(null); setView("entry"); }} />;
  if (view === "browse") return <BrowseResumes onBack={() => setView("entry")} onSelect={handleSelectResume} />;
  return (
    <div className="flex flex-col h-full min-h-[520px]">
      <div className="mb-6">
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#c8881a]" /> Resume Builder
        </h3>
        <p className="text-xs font-mono text-[#555] mt-0.5">J3FF house style — A4, Calibri, navy accent. 4 layout variants.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {CARDS.map(({ key, label, desc, icon: Icon }) => (
          <button
            key={key}
            onClick={async () => {
              if (key === "fill") { setEditData(null); setView("form"); }
              else if (key === "browse") setView("browse");
              else if (key === "generate") {
                try {
                  const content = await invoke<string>("get_resume_template");
                  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
                  await writeText(content);
                  toast.success("Copied! Paste into your LLM chat");
                } catch (e) { toast.error(String(e)); }
              }
              else if (key === "import") {
                try {
                  const { open } = await import("@tauri-apps/plugin-dialog");
                  const p = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
                  if (!p || Array.isArray(p)) return;
                  const content = await invoke<string>("read_file", { path: p as string });
                  let data: any;
                  try { data = JSON.parse(content); } catch { toast.error("Invalid JSON — not parseable"); return; }
                  // Strip _instructions/_note keys (top level and nested)
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
                  const clean = strip(data);
                  const validKeys = ["col1_nophoto","col1_photo","col2_nophoto","col2_photo"];
                  const errors: string[] = [];
                  if (!clean.full_name || typeof clean.full_name !== "string" || !clean.full_name.trim()) errors.push("full_name missing");
                  if (!clean.template_key || !validKeys.includes(clean.template_key)) errors.push(`template_key must be one of ${validKeys.join(", ")}`);
                  if (clean.education && !Array.isArray(clean.education)) errors.push("education must be array");
                  if (clean.experience && !Array.isArray(clean.experience)) errors.push("experience must be array");
                  if (clean.skills && !Array.isArray(clean.skills)) errors.push("skills must be array");
                  if (clean.certifications && !Array.isArray(clean.certifications)) errors.push("certifications must be array");
                  if (errors.length) { toast.error("Import failed: " + errors.join("; ")); return; }
                  setEditData(clean);
                  setView("form");
                  toast.success(`Loaded ${clean.full_name || "resume"} — review then Generate`);
                } catch (e) { toast.error(String(e)); }
              }
            }}
            className="text-left p-5 rounded-xl border border-[#2a2a28] bg-[#0c0c0b] hover:border-[#c8881a]/30 hover:bg-[#1a1a18] transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-[#1a1a18] border border-[#2a2a28] group-hover:border-[#c8881a]/30 flex items-center justify-center mb-3">
              <Icon className="w-5 h-5 text-[#555] group-hover:text-[#c8881a] transition-colors" />
            </div>
            <p className="text-sm font-bold text-[#e8e4da] tracking-wide">{label}</p>
            <p className="text-xs font-mono text-[#555] mt-1">{desc}</p>
          </button>
        ))}
      </div>

      <div className="mt-6 p-3 rounded-lg bg-[#0c0c0b] border border-[#2a2a28]">
        <p className="text-xs font-mono text-[#444]">Engine: <span className="text-[#888]">docx-rs</span> (native Rust) · Storage: <span className="text-[#888]">resumes</span> in <span className="text-[#888]">activity.db</span> · No LLM calls in-app (portable JSON contract).</p>
      </div>
    </div>
  );
}
