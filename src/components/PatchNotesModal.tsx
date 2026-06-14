import { X, ExternalLink } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { PATCH_NOTES, GITHUB_RELEASES_URL } from "../lib/patchNotes";

interface PatchNotesModalProps {
  open: boolean;
  onClose: () => void;
}

export function PatchNotesModal({ open, onClose }: PatchNotesModalProps) {
  if (!open) return null;

  const versions = Object.entries(PATCH_NOTES);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl w-[75%] max-w-3xl h-[75%] mx-4 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28] flex-shrink-0">
          <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">Patch Notes</h2>
          <button onClick={onClose} className="text-[#555] hover:text-[#888] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {versions.map(([version, entry]) => (
            <div key={version}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-bold text-[#e8e4da]">v{version}</span>
                <span className="text-xs text-[#555] font-mono">({entry.date})</span>
              </div>
              <ul className="space-y-1 ml-1">
                {entry.notes.map((note, i) => (
                  <li key={i} className="text-xs text-[#888] font-mono flex items-start gap-2">
                    <span className="text-[#c8881a] mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-[#2a2a28] flex-shrink-0">
          <button
            onClick={() => shellOpen(GITHUB_RELEASES_URL)}
            className="text-xs text-[#c8881a] hover:text-[#e8a030] font-mono transition-colors flex items-center gap-1.5"
          >
            View on GitHub <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
