import { useState } from "react";
import { X, HelpCircle } from "lucide-react";
import { ThemedModal } from "../../components/ThemedModal";

type Lang = "en" | "tl";

const CONTENT: Record<Lang, { title: string; steps: { heading: string; body: string }[] }> = {
  en: {
    title: "How to Use Resume Builder",
    steps: [
      {
        heading: "1. Pick a layout",
        body: "Choose from 4 layouts under Tools: 1-column and 2-column, each with or without a 35×45mm passport photo. The default is 1-column without photo. All Word files are A4, Calibri, with a navy accent.",
      },
      {
        heading: "2. Fill in or generate JSON",
        body: "You can click Fill Out Form and type everything by hand, or click Generate JSON to copy a blank template to your clipboard. Paste that template into your AI chat along with your biodata (image, PDF, or text). The AI will return a filled JSON. Keep all keys as they are, leave unknown fields as empty strings, and never change photo_path — the app fills it when you upload a photo.",
      },
      {
        heading: "3. Import the JSON",
        body: "Click Import JSON. You can drop a JSON file, click to browse, or paste the JSON text (Ctrl+V) or use Paste from clipboard. The app strips any instruction fields, checks that full_name and template_key are valid, and loads everything into the form so you can review it.",
      },
      {
        heading: "4. Add a photo and polish the details",
        body: "If your layout needs a photo, click Upload Photo. You can drag & drop, browse, or paste an image (Ctrl+V). Crop to the 35×45mm box, adjust zoom with the slider and rotation with Alt+wheel, then use the photo. You can add multiple phones and emails (duplicates are ignored), add education, work experience with bullet points, skills, and certifications. Summary is a short 2–3 sentence overview.",
      },
      {
        heading: "5. Save or generate files",
        body: "Save as JSON keeps a portable copy you can re-import. Generate Resume asks where to save and creates both a Word file and a PDF in one click — the PDF needs LibreOffice installed, otherwise you still get the Word file. Files are remembered in Browse Resumes, where you can search, edit, or delete them. Template cards and entry cards are centered and a bit taller for easy reading.",
      },
    ],
  },
  tl: {
    title: "Paano Gamitin ang Resume Builder",
    steps: [
      {
        heading: "1. Pumili ng layout",
        body: "Pumili sa 4 na layout sa Tools: 1-column at 2-column, bawat isa ay mayroon o walang 35×45mm na passport photo. Ang default ay 1-column nang walang larawan. Lahat ng Word file ay A4, Calibri, na may navy accent.",
      },
      {
        heading: "2. Mag-fill o mag-generate ng JSON",
        body: "Maaari mong i-click ang Fill Out Form at i-type nang manu-mano, o i-click ang Generate JSON para kopyahin ang blankong template sa clipboard. I-paste ang template sa AI chat kasama ang iyong biodata (larawan, PDF, o text). Ibabalik ng AI ang napunang JSON. Huwag baguhin ang mga key, iwanan ang hindi alam bilang walang laman, at huwag galawin ang photo_path — ang app ang maglalagay ng larawan.",
      },
      {
        heading: "3. Mag-import ng JSON",
        body: "I-click ang Import JSON. Maaari kang mag-drop ng JSON file, mag-browse, o mag-paste ng JSON text (Ctrl+V) o gamitin ang Paste from clipboard. Aalisin ng app ang anumang instruction field, tse-tsek kung tama ang full_name at template_key, at ilo-load ito sa form para ma-review mo.",
      },
      {
        heading: "4. Magdagdag ng larawan at ayusin ang detalye",
        body: "Kung kailangan ng layout mo ng larawan, i-click ang Upload Photo. Maaari kang mag-drag & drop, mag-browse, o mag-paste ng larawan (Ctrl+V). I-crop sa 35×45mm na kahon, ayusin ang zoom at rotation gamit ang Alt+wheel, at gamitin ang larawan. Maaari kang magdagdag ng maraming telepono at email (hindi isinasama ang duplikado), edukasyon, karanasan na may bullet, kasanayan, at sertipikasyon. Ang summary ay maikling 2–3 pangungusap.",
      },
      {
        heading: "5. Mag-save o mag-generate ng file",
        body: "Ang Save as JSON ay nagse-save ng kopyang maaaring i-import muli. Ang Generate Resume ay nagtatanong kung saan ise-save at gumagawa ng Word at PDF nang sabay — kailangan ng LibreOffice para sa PDF, kung wala ay Word pa rin ang makukuha mo. Naaalala ang mga file sa Browse Resumes kung saan maaari kang mag-search, mag-edit, o mag-delete. Ang mga card ay nakagitna at medyo mas mataas para madaling basahin.",
      },
    ],
  },
};

export function HowToModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("resumeHowToLang") as Lang) === "tl" ? "tl" : "en");
  const setLangPersist = (l: Lang) => {
    setLang(l);
    localStorage.setItem("resumeHowToLang", l);
  };
  const t = CONTENT[lang];
  return (
    <ThemedModal open={open} onClose={onClose} panelClassName="w-[560px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a28]">
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#c8881a]" /> {t.title}
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-[#111110] border border-[#2a2a28] rounded-lg p-0.5">
            <button onClick={() => setLangPersist("en")} className={`px-3 py-1 rounded-md text-xs font-mono font-bold transition-colors ${lang === "en" ? "bg-[#c8881a] text-[#0c0c0b]" : "text-[#555] hover:text-[#888]"}`}>
              English
            </button>
            <button onClick={() => setLangPersist("tl")} className={`px-3 py-1 rounded-md text-xs font-mono font-bold transition-colors ${lang === "tl" ? "bg-[#c8881a] text-[#0c0c0b]" : "text-[#555] hover:text-[#888]"}`}>
              Tagalog
            </button>
          </div>
          <button onClick={onClose} className="p-1 rounded text-[#555] hover:text-[#e8e4da] hover:bg-[#1a1a18] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {t.steps.map((s, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-[#c8881a]/10 border border-[#c8881a]/30 text-[#c8881a] flex items-center justify-center text-xs font-mono font-bold">
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold text-[#e8e4da] tracking-wide">{s.heading}</p>
              <p className="text-xs font-mono text-[#888] leading-relaxed">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-end px-4 py-3 border-t border-[#2a2a28] bg-[#0c0c0b]">
        <button onClick={onClose} className="px-4 py-1.5 rounded-lg bg-[#c8881a] text-[#0c0c0b] font-bold text-xs tracking-wide hover:bg-[#e8a030] transition-colors">
          Got it
        </button>
      </div>
    </ThemedModal>
  );
}
