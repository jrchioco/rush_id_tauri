import { useState } from "react";
import { toast } from "sonner";
import { Upload, User, Mail, Phone, MapPin, Link2 } from "lucide-react";

export type ResumeTemplateKey = "col1_nophoto" | "col1_photo" | "col2_nophoto" | "col2_photo";

export interface ResumeFormData {
  template_key: ResumeTemplateKey;
  full_name: string;
  contact: { phone: string; email: string; address: string; linkedin: string };
  summary: string;
  education: { school: string; degree: string; year: string }[];
  experience: { company: string; role: string; start_date: string; end_date: string; bullets: string[] }[];
  skills: string[];
  certifications: { name: string; issuer: string; year: string }[];
  photoPath?: string;
}

const TEMPLATES: { key: ResumeTemplateKey; label: string; desc: string }[] = [
  { key: "col1_nophoto", label: "1-Column", desc: "No photo" },
  { key: "col1_photo", label: "1-Column + Photo", desc: "35×45mm passport" },
  { key: "col2_nophoto", label: "2-Column", desc: "Sidebar no photo" },
  { key: "col2_photo", label: "2-Column + Photo", desc: "Sidebar with photo" },
];

interface Props {
  onBack?: () => void;
}

export default function ResumeForm({ onBack }: Props) {
  const [template, setTemplate] = useState<ResumeTemplateKey>("col1_nophoto");
  const [fullName, setFullName] = useState("");
  const [contact, setContact] = useState({ phone: "", email: "", address: "", linkedin: "" });
  const [summary, setSummary] = useState("");
  const [photoPath, setPhotoPath] = useState<string>("");

  const isPhoto = template.endsWith("_photo");

  const handlePhotoPick = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const p = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }] });
      if (p && typeof p === "string") setPhotoPath(p);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {onBack && (
        <button onClick={onBack} className="self-start text-xs font-mono text-[#888] hover:text-[#c8881a]">← Back to Resume Builder</button>
      )}

      <div>
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide">Resume Details</h3>
        <p className="text-xs font-mono text-[#555] mt-0.5">Fill the fields — repeatable sections (education, experience, skills) land in Phase 3b. Photo appears for *_photo templates.</p>
      </div>

      <div>
        <p className="text-xs font-mono text-[#888] tracking-widest uppercase mb-2">Template</p>
        <div className="grid grid-cols-4 gap-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.key}
              onClick={() => setTemplate(t.key)}
              className={`p-3 rounded-xl border text-left transition-colors ${template === t.key ? "bg-[#c8881a]/10 border-[#c8881a] text-[#c8881a]" : "bg-[#0c0c0b] border-[#2a2a28] text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da]"}`}
            >
              <p className="text-xs font-bold tracking-wide">{t.label}</p>
              <p className="text-[10px] font-mono mt-0.5">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 p-4 rounded-xl bg-[#0c0c0b] border border-[#2a2a28]">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-[#888] tracking-widest uppercase">Full Name *</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Juan Dela Cruz" className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><Phone className="w-3 h-3" /> Phone</span>
            <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="09xx xxx xxxx" className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><Mail className="w-3 h-3" /> Email</span>
            <input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="juan@email.com" className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><MapPin className="w-3 h-3" /> Address</span>
            <input value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} placeholder="Bulacan, PH" className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><Link2 className="w-3 h-3" /> LinkedIn</span>
            <input value={contact.linkedin} onChange={(e) => setContact({ ...contact, linkedin: e.target.value })} placeholder="linkedin.com/in/..." className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><User className="w-3 h-3" /> Summary</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="2-3 sentence professional summary..." className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
        </label>

        {isPhoto && (
          <div className="flex items-center gap-3">
            <button onClick={handlePhotoPick} className="px-3 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30 text-xs font-mono flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> {photoPath ? "Change Photo" : "Upload Photo (35×45mm)"}
            </button>
            {photoPath && <span className="text-xs font-mono text-[#555] truncate max-w-[260px]">{photoPath}</span>}
          </div>
        )}
      </div>

      <div className="p-3 rounded-lg bg-[#1a1508] border border-[#c8881a]/30">
        <p className="text-xs font-mono text-[#c8881a]">Phase 3a — skeleton + template picker only. Repeatable education / experience / skills / certifications + Save as JSON land in Phase 3b.</p>
      </div>
    </div>
  );
}
