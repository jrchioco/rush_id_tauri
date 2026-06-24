import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { PATCH_NOTES } from "../lib/patchNotes";
import { useIsMounted } from "../lib/hooks/useIsMounted";

interface WhatsNewModalProps {
  open: boolean;
  onClose: () => void;
}

export function WhatsNewModal({ open, onClose }: WhatsNewModalProps) {
  const isMounted = useIsMounted();
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    getVersion().then((v) => { if (isMounted()) setVersion(v); }).catch(() => {});
  }, [open]);

  if (!open) return null;

  const entry = version ? PATCH_NOTES[version] : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl w-[70%] max-w-2xl mx-4 shadow-2xl">
        <div className="px-6 py-5">
          <h2 className="text-base font-bold text-[#e8e4da] tracking-wide mb-4">
            {entry ? entry.title : "What's New"}
          </h2>

          {entry ? (
            <div>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-sm font-bold text-[#c8881a]">v{version}</span>
                <span className="text-xs text-[#555] font-mono">({entry.date})</span>
              </div>
              <ul className="space-y-1.5 ml-1">
                {entry.notes.map((note, i) => (
                  <li key={i} className="text-xs text-[#888] font-mono flex items-start gap-2">
                    <span className="text-[#c8881a] mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-[#555] font-mono">You're now running the latest version.</p>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-[#2a2a28]">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
