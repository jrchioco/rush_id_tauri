import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Tooltip } from "../../components/Tooltip";
import { TOOLTIPS } from "../../lib/tooltips";
import { FileText, Trash2, Search } from "lucide-react";

interface ResumeSummary {
  id: number;
  full_name: string;
  template_key: string;
  updated_at: string;
  docx_path?: string | null;
  pdf_path?: string | null;
}

function templateLabel(key: string): string {
  switch (key) {
    case "col1_nophoto": return "1-Column";
    case "col1_photo": return "1-Column + Photo";
    case "col2_nophoto": return "2-Column";
    case "col2_photo": return "2-Column + Photo";
    default: return key;
  }
}

interface Props {
  onBack?: () => void;
  onSelect?: (id: number) => void;
}

export default function BrowseResumes({ onBack, onSelect }: Props) {
  const [items, setItems] = useState<ResumeSummary[]>([]);
  const [query, setQuery] = useState("");

  const load = async () => {
    try {
      const list = await invoke<ResumeSummary[]>("list_resumes");
      setItems(list);
    } catch (e) {
      toast.error(String(e));
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this resume?")) return;
    try {
      await invoke("delete_resume", { id });
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const filtered = items.filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      {onBack && <Tooltip content={TOOLTIPS.resumeBack} className="self-start"><button onClick={onBack} className="self-start text-xs font-mono text-[#888] hover:text-[#c8881a]">← Back to Resume Builder</button></Tooltip>}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide">Browse Resumes</h3>
        <div className="flex items-center gap-2">
          <Tooltip content={TOOLTIPS.resumeSearch} className="flex"><div className="flex items-center gap-1 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-2 py-1">
            <Search className="w-3 h-3 text-[#555]" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" className="bg-transparent text-xs font-mono text-[#e8e4da] placeholder-[#555] focus:outline-none" />
          </div></Tooltip>
          <span className="text-xs font-mono text-[#555]">{filtered.length}/{items.length}</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs font-mono text-[#444] py-12 text-center">{items.length === 0 ? "No resumes saved yet — generate one first." : "No matches."}</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((r) => (
            <div key={r.id} className="p-4 rounded-xl border border-[#2a2a28] bg-[#0c0c0b] hover:border-[#c8881a]/30 transition-colors">
              <div className="w-full h-[96px] rounded-lg bg-[#1a1a18] border border-[#2a2a28] flex items-center justify-center mb-3">
                <FileText className="w-6 h-6 text-[#444]" />
              </div>
              <p className="text-sm font-bold text-[#e8e4da] tracking-wide truncate">{r.full_name}</p>
              <p className="text-xs font-mono text-[#555]">{templateLabel(r.template_key)}</p>
              <p className="text-[10px] font-mono text-[#444] mt-1">{new Date(r.updated_at).toLocaleString()}</p>
              <div className="flex gap-1 mt-1">
                {r.docx_path && <span className="text-[9px] font-mono bg-[#1a1a18] border border-[#2a2a28] text-[#888] px-1.5 py-0.5 rounded">DOCX</span>}
                {r.pdf_path && <span className="text-[9px] font-mono bg-[#c8881a]/10 border border-[#c8881a]/30 text-[#c8881a] px-1.5 py-0.5 rounded">PDF</span>}
              </div>
              <div className="flex gap-2 mt-3">
                <Tooltip content={TOOLTIPS.resumeBrowseEdit} className="flex-1"><button onClick={() => onSelect?.(r.id)} className="w-full px-2 py-1 rounded bg-[#c8881a] text-[#0c0c0b] text-xs font-mono font-bold hover:bg-[#e8a030]">Edit</button></Tooltip>
                <Tooltip content={TOOLTIPS.resumeBrowseDelete}><button onClick={() => handleDelete(r.id)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
