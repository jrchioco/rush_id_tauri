import { useState } from "react";
import { toast } from "sonner";
import { Upload, User, Mail, Phone, MapPin, Link2, Plus, Trash2, Save } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Tooltip } from "../../components/Tooltip";
import { TOOLTIPS } from "../../lib/tooltips";
import { PhotoCropModal } from "./PhotoCropModal";

export type ResumeTemplateKey = "col1_nophoto" | "col1_photo" | "col2_nophoto" | "col2_photo";

export interface ResumeFormData {
  template_key: ResumeTemplateKey;
  full_name: string;
  contact: { address: string; linkedin: string; phone?: string; email?: string; phones?: string[]; emails?: string[] };
  summary: string;
  education: { school: string; degree: string; year: string }[];
  experience: { company: string; role: string; start_date: string; end_date: string; bullets: string[] }[];
  skills: string[];
  certifications: { name: string; issuer: string; year: string }[];
  photo_path?: string;
  /** legacy alias for backward compat with old saved JSON */
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
  initialData?: ResumeFormData;
}

function normalizeContact(c: any): { address: string; linkedin: string; phones: string[]; emails: string[] } {
  if (!c) return { address: "", linkedin: "", phones: [], emails: [] };
  const phones: string[] = [];
  if (Array.isArray(c.phones)) phones.push(...c.phones.filter((s: any) => typeof s === "string" && s.trim()));
  else if (Array.isArray(c.phone)) phones.push(...c.phone.filter((s: any) => typeof s === "string" && s.trim()));
  if (typeof c.phone === "string" && c.phone.trim() && !phones.includes(c.phone.trim())) phones.unshift(c.phone.trim());
  if (c.phone && typeof c.phone === "string" && c.phone.includes(",") && phones.length === 1) {
    const parts = c.phone.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (parts.length > 1) { phones.splice(0, 1, ...parts); }
  }
  const emails: string[] = [];
  if (Array.isArray(c.emails)) emails.push(...c.emails.filter((s: any) => typeof s === "string" && s.trim()));
  else if (Array.isArray(c.email)) emails.push(...c.email.filter((s: any) => typeof s === "string" && s.trim()));
  if (typeof c.email === "string" && c.email.trim() && !emails.includes(c.email.trim())) emails.unshift(c.email.trim());
  if (c.email && typeof c.email === "string" && c.email.includes(",") && emails.length === 1) {
    const parts = c.email.split(",").map((s: string) => s.trim()).filter(Boolean);
    if (parts.length > 1) { emails.splice(0, 1, ...parts); }
  }
  return { address: c.address ?? "", linkedin: c.linkedin ?? "", phones, emails };
}

export default function ResumeForm({ onBack, initialData }: Props) {
  const [template, setTemplate] = useState<ResumeTemplateKey>(initialData?.template_key ?? "col1_nophoto");
  const [fullName, setFullName] = useState(initialData?.full_name ?? "");
  const [contact, setContact] = useState(() => normalizeContact(initialData?.contact));
  const [summary, setSummary] = useState(initialData?.summary ?? "");
  const [photoPath, setPhotoPath] = useState<string>(initialData?.photo_path ?? initialData?.photoPath ?? "");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [education, setEducation] = useState<{ school: string; degree: string; year: string }[]>(initialData?.education ?? []);
  const [experience, setExperience] = useState<{ company: string; role: string; start_date: string; end_date: string; bullets: string[] }[]>(initialData?.experience ?? []);
  const [skills, setSkills] = useState<string[]>(initialData?.skills ?? []);
  const [skillsDraft, setSkillsDraft] = useState("");
  const [certifications, setCertifications] = useState<{ name: string; issuer: string; year: string }[]>(initialData?.certifications ?? []);

  const isPhoto = template.endsWith("_photo");

  const handlePhotoConfirm = async (base64: string, fileName: string) => {
    try {
      const p = await invoke<string>("write_temp_photo", { base64, fileName });
      setPhotoPath(p);
      setPhotoPreview(`data:image/png;base64,${base64}`);
      toast.success(`Photo ready — ${p.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handlePhotoClear = () => {
    setPhotoPath("");
    setPhotoPreview(null);
  };

  const addPhone = () => setContact({ ...contact, phones: [...contact.phones, ""] });
  const updatePhone = (i: number, v: string) => {
    const next = [...contact.phones];
    next[i] = v;
    setContact({ ...contact, phones: next });
  };
  const removePhone = (i: number) => setContact({ ...contact, phones: contact.phones.filter((_, idx) => idx !== i) });

  const addEmail = () => setContact({ ...contact, emails: [...contact.emails, ""] });
  const updateEmail = (i: number, v: string) => {
    const next = [...contact.emails];
    next[i] = v;
    setContact({ ...contact, emails: next });
  };
  const removeEmail = (i: number) => setContact({ ...contact, emails: contact.emails.filter((_, idx) => idx !== i) });

  const addEducation = () => setEducation([...education, { school: "", degree: "", year: "" }]);
  const updateEducation = (i: number, patch: Partial<{ school: string; degree: string; year: string }>) => {
    const next = [...education];
    next[i] = { ...next[i], ...patch };
    setEducation(next);
  };
  const removeEducation = (i: number) => setEducation(education.filter((_, idx) => idx !== i));

  const addExperience = () => setExperience([...experience, { company: "", role: "", start_date: "", end_date: "", bullets: [""] }]);
  const updateExperience = (i: number, patch: Partial<{ company: string; role: string; start_date: string; end_date: string }>) => {
    const next = [...experience];
    next[i] = { ...next[i], ...patch };
    setExperience(next);
  };
  const removeExperience = (i: number) => setExperience(experience.filter((_, idx) => idx !== i));
  const addBullet = (ei: number) => {
    const next = [...experience];
    next[ei].bullets = [...next[ei].bullets, ""];
    setExperience(next);
  };
  const updateBullet = (ei: number, bi: number, val: string) => {
    const next = [...experience];
    next[ei].bullets[bi] = val;
    setExperience(next);
  };
  const removeBullet = (ei: number, bi: number) => {
    const next = [...experience];
    next[ei].bullets = next[ei].bullets.filter((_, idx) => idx !== bi);
    if (next[ei].bullets.length === 0) next[ei].bullets = [""];
    setExperience(next);
  };

  const addSkillFromDraft = () => {
    const parts = skillsDraft.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    setSkills([...skills, ...parts]);
    setSkillsDraft("");
  };
  const removeSkill = (i: number) => setSkills(skills.filter((_, idx) => idx !== i));

  const addCert = () => setCertifications([...certifications, { name: "", issuer: "", year: "" }]);
  const updateCert = (i: number, patch: Partial<{ name: string; issuer: string; year: string }>) => {
    const next = [...certifications];
    next[i] = { ...next[i], ...patch };
    setCertifications(next);
  };
  const removeCert = (i: number) => setCertifications(certifications.filter((_, idx) => idx !== i));

  const buildData = (): ResumeFormData => ({
    template_key: template,
    full_name: fullName.trim(),
    contact: {
      address: contact.address.trim(),
      linkedin: contact.linkedin.trim(),
      phones: contact.phones.map((s) => s.trim()).filter(Boolean),
      emails: contact.emails.map((s) => s.trim()).filter(Boolean),
      phone: contact.phones.map((s) => s.trim()).filter(Boolean)[0] ?? "",
      email: contact.emails.map((s) => s.trim()).filter(Boolean)[0] ?? "",
    },
    summary: summary.trim(),
    education: education.filter((e) => e.school || e.degree || e.year),
    experience: experience
      .filter((e) => e.company || e.role)
      .map((e) => ({ ...e, bullets: e.bullets.filter((b) => b.trim()) })),
    skills: skills.filter((s) => s.trim()),
    certifications: certifications.filter((c) => c.name || c.issuer || c.year),
    photo_path: isPhoto ? photoPath : undefined,
  });

  const handleSaveJson = async () => {
    if (!fullName.trim()) {
      toast.error("Full name is required");
      return;
    }
    const data = buildData();
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ filters: [{ name: "JSON", extensions: ["json"] }], defaultPath: `${fullName.replace(/[^\w]+/g, "_")}_resume.json` });
      if (!path) return;
      await invoke("write_file", { path, content: JSON.stringify(data, null, 2) });
      toast.success(`Saved ${path}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleGenerateResume = async () => {
    if (!fullName.trim()) {
      toast.error("Full name is required");
      return;
    }
    const data = buildData();
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ filters: [{ name: "Word", extensions: ["docx"] }], defaultPath: `${fullName.replace(/[^\w]+/g, "_")}_Resume.docx` });
      if (!path) return;
      const res = await invoke<{ docx_path: string; pdf_path: string | null }>("generate_resume", { dataJson: JSON.stringify(data), templateKey: template, saveStemPath: path });
      if (res.pdf_path) toast.success(`Resume saved — ${res.docx_path} + ${res.pdf_path}`);
      else toast.success(`Resume saved — ${res.docx_path} (PDF skipped — install LibreOffice for PDF)`);
      try {
        const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
        await revealItemInDir(res.pdf_path ?? res.docx_path);
      } catch {}
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {onBack && (
        <Tooltip content={TOOLTIPS.resumeBack}><button onClick={onBack} className="self-start text-xs font-mono text-[#888] hover:text-[#c8881a]">← Back to Resume Builder</button></Tooltip>
      )}

      <div>
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide">Resume Details</h3>
        <p className="text-xs font-mono text-[#555] mt-0.5">All fields save to the same shape as resume-template.json (minus _instructions). Use Save as JSON to export.</p>
      </div>

      <div>
        <p className="text-xs font-mono text-[#888] tracking-widest uppercase mb-2">Template</p>
        <div className="grid grid-cols-4 gap-3">
          {TEMPLATES.map((t) => (
            <Tooltip key={t.key} content={TOOLTIPS.resumeTemplateSelect}><button
              onClick={() => setTemplate(t.key)}
              className={`p-3 rounded-xl border text-left transition-colors ${template === t.key ? "bg-[#c8881a]/10 border-[#c8881a] text-[#c8881a]" : "bg-[#0c0c0b] border-[#2a2a28] text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da]"}`}
            >
              <p className="text-xs font-bold tracking-wide">{t.label}</p>
              <p className="text-[10px] font-mono mt-0.5">{t.desc}</p>
            </button></Tooltip>
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
            <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><MapPin className="w-3 h-3" /> Address</span>
            <input value={contact.address} onChange={(e) => setContact({ ...contact, address: e.target.value })} placeholder="Bulacan, PH" className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><Link2 className="w-3 h-3" /> LinkedIn</span>
            <input value={contact.linkedin} onChange={(e) => setContact({ ...contact, linkedin: e.target.value })} placeholder="linkedin.com/in/..." className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><Phone className="w-3 h-3" /> Phone Numbers</span>
              <Tooltip content={TOOLTIPS.resumeAddPhone}><button onClick={addPhone} className="px-1.5 py-0.5 rounded bg-[#1a1a18] border border-[#2a2a28] text-[10px] font-mono text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da] flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button></Tooltip>
            </div>
            {contact.phones.length === 0 ? <p className="text-xs font-mono text-[#444]">No phone numbers — click Add.</p> : contact.phones.map((p, i) => (
              <div key={i} className="flex gap-1">
                <input value={p} onChange={(e) => updatePhone(i, e.target.value)} placeholder="09xx xxx xxxx" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
                <Tooltip content={TOOLTIPS.resumeRemovePhone}><button onClick={() => removePhone(i)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><Mail className="w-3 h-3" /> Emails</span>
              <Tooltip content={TOOLTIPS.resumeAddEmail}><button onClick={addEmail} className="px-1.5 py-0.5 rounded bg-[#1a1a18] border border-[#2a2a28] text-[10px] font-mono text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da] flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button></Tooltip>
            </div>
            {contact.emails.length === 0 ? <p className="text-xs font-mono text-[#444]">No emails — click Add.</p> : contact.emails.map((e, i) => (
              <div key={i} className="flex gap-1">
                <input value={e} onChange={(ev) => updateEmail(i, ev.target.value)} placeholder="juan@email.com" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
                <Tooltip content={TOOLTIPS.resumeRemoveEmail}><button onClick={() => removeEmail(i)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
              </div>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-mono text-[#555] flex items-center gap-1"><User className="w-3 h-3" /> Summary</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="2-3 sentence professional summary..." className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
        </label>

        {isPhoto && (
          <div className="flex items-center gap-3">
            {photoPreview && <img src={photoPreview} alt="Photo preview" className="w-10 h-14 object-cover rounded border border-[#2a2a28]" />}
            <Tooltip content={TOOLTIPS.resumeUploadPhoto}><button onClick={() => setPhotoModalOpen(true)} className="px-3 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:text-[#e8e4da] hover:border-[#c8881a]/30 text-xs font-mono flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5" /> {photoPath ? "Change Photo" : "Upload Photo (35×45mm)"}
            </button></Tooltip>
            {photoPath && <span className="text-xs font-mono text-[#555] truncate max-w-[260px]">{photoPath}</span>}
            {photoPath && <Tooltip content={TOOLTIPS.resumeClearPhoto}><button onClick={handlePhotoClear} className="p-1 rounded text-[#555] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button></Tooltip>}
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl bg-[#0c0c0b] border border-[#2a2a28]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-[#888] tracking-widest uppercase">Education</span>
          <Tooltip content={TOOLTIPS.resumeAddEducation}><button onClick={addEducation} className="px-2 py-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-xs font-mono text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da] flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button></Tooltip>
        </div>
        {education.length === 0 ? <p className="text-xs font-mono text-[#444]">No education entries — click Add.</p> : education.map((ed, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 mb-2 p-2 rounded-lg bg-[#111110] border border-[#2a2a28]">
            <input value={ed.school} onChange={(e) => updateEducation(i, { school: e.target.value })} placeholder="School" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
            <input value={ed.degree} onChange={(e) => updateEducation(i, { degree: e.target.value })} placeholder="Degree" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
            <div className="flex gap-1">
              <input value={ed.year} onChange={(e) => updateEducation(i, { year: e.target.value })} placeholder="Year" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
              <Tooltip content={TOOLTIPS.resumeRemoveEducation}><button onClick={() => removeEducation(i)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl bg-[#0c0c0b] border border-[#2a2a28]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-[#888] tracking-widest uppercase">Experience</span>
          <Tooltip content={TOOLTIPS.resumeAddExperience}><button onClick={addExperience} className="px-2 py-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-xs font-mono text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da] flex items-center gap-1"><Plus className="w-3 h-3" /> Add Role</button></Tooltip>
        </div>
        {experience.length === 0 ? <p className="text-xs font-mono text-[#444]">No experience entries — click Add Role.</p> : experience.map((ex, ei) => (
          <div key={ei} className="mb-3 p-3 rounded-lg bg-[#111110] border border-[#2a2a28]">
            <div className="grid grid-cols-2 gap-2">
              <input value={ex.company} onChange={(e) => updateExperience(ei, { company: e.target.value })} placeholder="Company" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
              <input value={ex.role} onChange={(e) => updateExperience(ei, { role: e.target.value })} placeholder="Role" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
              <input value={ex.start_date} onChange={(e) => updateExperience(ei, { start_date: e.target.value })} placeholder="Start date" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
              <div className="flex gap-1">
                <input value={ex.end_date} onChange={(e) => updateExperience(ei, { end_date: e.target.value })} placeholder="End date" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
                <Tooltip content={TOOLTIPS.resumeRemoveExperience}><button onClick={() => removeExperience(ei)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#555] tracking-widest uppercase">Bullets</span>
              <Tooltip content={TOOLTIPS.resumeAddBullet}><button onClick={() => addBullet(ei)} className="px-2 py-0.5 rounded bg-[#1a1a18] border border-[#2a2a28] text-[10px] font-mono text-[#888] hover:border-[#c8881a]/30">+ Bullet</button></Tooltip>
            </div>
            {ex.bullets.map((b, bi) => (
              <div key={bi} className="flex gap-1 mt-1">
                <input value={b} onChange={(e) => updateBullet(ei, bi, e.target.value)} placeholder="Bullet point" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
                <Tooltip content={TOOLTIPS.resumeRemoveBullet}><button onClick={() => removeBullet(ei, bi)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="p-4 rounded-xl bg-[#0c0c0b] border border-[#2a2a28]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-[#888] tracking-widest uppercase">Skills</span>
        </div>
        <div className="flex gap-2">
          <input value={skillsDraft} onChange={(e) => setSkillsDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkillFromDraft(); } }} placeholder="Add skill, comma separated — press Enter" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-1.5 text-sm text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
          <Tooltip content={TOOLTIPS.resumeAddSkill}><button onClick={addSkillFromDraft} className="px-3 py-1.5 rounded-lg border border-[#2a2a28] bg-[#1a1a18] text-[#888] hover:border-[#c8881a]/30 text-xs font-mono">Add</button></Tooltip>
        </div>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {skills.map((s, i) => (
              <span key={i} className="px-2 py-1 rounded-full bg-[#1a1a18] border border-[#2a2a28] text-xs font-mono text-[#888] flex items-center gap-1">
                {s} <Tooltip content={TOOLTIPS.resumeRemoveSkill}><button onClick={() => removeSkill(i)} className="text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="p-4 rounded-xl bg-[#0c0c0b] border border-[#2a2a28]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono text-[#888] tracking-widest uppercase">Certifications</span>
          <Tooltip content={TOOLTIPS.resumeAddCert}><button onClick={addCert} className="px-2 py-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-xs font-mono text-[#888] hover:border-[#c8881a]/30 hover:text-[#e8e4da] flex items-center gap-1"><Plus className="w-3 h-3" /> Add</button></Tooltip>
        </div>
        {certifications.length === 0 ? <p className="text-xs font-mono text-[#444]">No certifications — click Add.</p> : certifications.map((c, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 mb-2 p-2 rounded-lg bg-[#111110] border border-[#2a2a28]">
            <input value={c.name} onChange={(e) => updateCert(i, { name: e.target.value })} placeholder="Name" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
            <input value={c.issuer} onChange={(e) => updateCert(i, { issuer: e.target.value })} placeholder="Issuer" className="bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
            <div className="flex gap-1">
              <input value={c.year} onChange={(e) => updateCert(i, { year: e.target.value })} placeholder="Year" className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded px-2 py-1 text-xs text-[#e8e4da] placeholder-[#555] font-mono focus:outline-none focus:border-[#c8881a]" />
              <Tooltip content={TOOLTIPS.resumeRemoveCert}><button onClick={() => removeCert(i)} className="p-1 rounded bg-[#1a1a18] border border-[#2a2a28] text-[#555] hover:text-red-400"><Trash2 className="w-3 h-3" /></button></Tooltip>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 self-end">
        <Tooltip content={TOOLTIPS.resumeSaveJson}><button onClick={handleSaveJson} className="px-4 py-2 rounded-lg border border-[#c8881a] text-[#c8881a] font-bold text-sm tracking-wide hover:bg-[#c8881a]/10 flex items-center gap-2">
          <Save className="w-4 h-4" /> Save as JSON
        </button></Tooltip>
        <Tooltip content={fullName.trim() ? TOOLTIPS.resumeGenerate : TOOLTIPS.resumeGenerateDisabled}><button onClick={handleGenerateResume} className="px-4 py-2 rounded-lg bg-[#c8881a] text-[#0c0c0b] font-bold text-sm tracking-wide hover:bg-[#e8a030] flex items-center gap-2">
          <Save className="w-4 h-4" /> Generate Resume
        </button></Tooltip>
      </div>

      <PhotoCropModal open={photoModalOpen} onClose={() => setPhotoModalOpen(false)} onConfirm={handlePhotoConfirm} />
    </div>
  );
}
