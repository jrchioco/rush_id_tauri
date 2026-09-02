import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { PATCH_NOTES } from "../lib/patchNotes";
import { useIsMounted } from "../lib/hooks/useIsMounted";
import { ThemedModal } from "./ThemedModal";

interface PatchNotesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function PatchNotesPanel({ open, onClose }: PatchNotesPanelProps) {
  const isMounted = useIsMounted();
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    getVersion().then((v) => { if (isMounted()) setVersion(v); }).catch(() => {});
  }, [open]);

  const entry = version ? PATCH_NOTES[version] : undefined;

  return (
    <ThemedModal open={open} onClose={onClose} dismissible={false} panelClassName="w-[75%] max-w-3xl h-[75%] mx-4 flex flex-col">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28] flex-shrink-0">
        <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">
          {entry ? entry.title : "What's New"}
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {entry ? (
          <div>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-sm font-bold text-[#c8881a]">v{version}</span>
              <span className="text-xs text-[#555] font-mono">({entry.date})</span>
            </div>
            {entry.groups ? (
              <div className="space-y-5">
                {entry.groups.map((group, gi) => (
                  <div key={gi}>
                    <h3 className="text-xs font-bold text-[#e8e4da] tracking-wide flex items-center gap-2 mb-2">
                      {group.heading} <span className="text-[10px] text-[#555] font-mono font-normal">{group.subheading}</span>
                    </h3>
                    <ul className="space-y-1.5 ml-1 border-l border-[#2a2a28] pl-3">
                      {group.bullets.map((note, i) => (
                        <li key={i} className="text-xs text-[#888] font-mono flex items-start gap-2">
                          <span className="text-[#c8881a] mt-0.5">•</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <ul className="space-y-1.5 ml-1">
                {entry.notes.map((note, i) => (
                  <li key={i} className="text-xs text-[#888] font-mono flex items-start gap-2">
                    <span className="text-[#c8881a] mt-0.5">•</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-xs text-[#555] font-mono">You're now running the latest version.</p>
        )}
      </div>

      <div className="flex justify-end px-6 py-4 border-t border-[#2a2a28] flex-shrink-0">
        <button
          onClick={onClose}
          className="px-6 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors"
        >
          Got it
        </button>
      </div>
    </ThemedModal>
  );
}
