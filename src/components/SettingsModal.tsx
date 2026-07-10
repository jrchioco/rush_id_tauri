import { useState, useEffect } from "react";
import { invoke } from "./CompanionWidget/effieInvoke";
import { getVersion, getTauriVersion } from "@tauri-apps/api/app";
import { X, Eye, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { useIsMounted } from "../lib/hooks/useIsMounted";
import { PatchNotesModal } from "./PatchNotesModal";
import { LicenseModal } from "./LicenseModal";

type SettingsTab = "keys" | "about";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function KeyRow({
  value,
  revealed,
  onChange,
  onToggle,
  onRemove,
  placeholder,
}: {
  value: string;
  revealed: boolean;
  onChange: (v: string) => void;
  onToggle: () => void;
  onRemove?: () => void;
  placeholder?: string;
}) {
  return (
    <div className="flex gap-1.5">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Paste API key..."}
        className="flex-1 min-w-0 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#444] font-mono focus:outline-none focus:border-[#c8881a]"
      />
      <button
        onClick={onToggle}
        className="px-2 text-[#555] hover:text-[#888] transition-colors flex-shrink-0"
        title={revealed ? "Hide key" : "Reveal key"}
      >
        {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          className="px-2 text-[#555] hover:text-red-400 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const isMounted = useIsMounted();
  const [tab, setTab] = useState<SettingsTab>("keys");
  const [poofKeys, setPoofKeys] = useState<string[]>([""]);
  const [poofRevealed, setPoofRevealed] = useState<boolean[]>([false]);
  const [removebgKeys, setRemovebgKeys] = useState<string[]>([""]);
  const [removebgRevealed, setRemovebgRevealed] = useState<boolean[]>([false]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  const [appVersion, setAppVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    invoke<{ poof: string[]; removebg: string[] }>("get_config")
      .then(({ poof, removebg }) => {
        if (!isMounted()) return;
        setPoofKeys(poof.length > 0 ? poof : [""]);
        setPoofRevealed(poof.length > 0 ? poof.map(() => false) : [false]);
        setRemovebgKeys(removebg.length > 0 ? removebg : [""]);
        setRemovebgRevealed(removebg.length > 0 ? removebg.map(() => false) : [false]);
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => {
        if (isMounted()) setFetching(false);
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    getVersion().then(setAppVersion).catch(() => {});
    getTauriVersion().then(setTauriVersion).catch(() => {});
  }, [open]);

  if (!open) return null;

  function addPoofKey() {
    setPoofKeys([...poofKeys, ""]);
    setPoofRevealed([...poofRevealed, false]);
  }

  function removePoofKey(i: number) {
    setPoofKeys(poofKeys.filter((_, j) => j !== i));
    setPoofRevealed(poofRevealed.filter((_, j) => j !== i));
  }

  function updatePoofKey(i: number, value: string) {
    const next = [...poofKeys];
    next[i] = value;
    setPoofKeys(next);
  }

  function togglePoofReveal(i: number) {
    const next = [...poofRevealed];
    next[i] = !next[i];
    setPoofRevealed(next);
  }

  function addRemovebgKey() {
    setRemovebgKeys([...removebgKeys, ""]);
    setRemovebgRevealed([...removebgRevealed, false]);
  }

  function removeRemovebgKey(i: number) {
    setRemovebgKeys(removebgKeys.filter((_, j) => j !== i));
    setRemovebgRevealed(removebgRevealed.filter((_, j) => j !== i));
  }

  function updateRemovebgKey(i: number, value: string) {
    const next = [...removebgKeys];
    next[i] = value;
    setRemovebgKeys(next);
  }

  function toggleRemovebgReveal(i: number) {
    const next = [...removebgRevealed];
    next[i] = !next[i];
    setRemovebgRevealed(next);
  }

  async function handleSave() {
    const filteredPoof = poofKeys.filter((k) => k.trim());
    const filteredRemovebg = removebgKeys.filter((k) => k.trim());
    if (filteredPoof.length === 0 && filteredRemovebg.length === 0) {
      toast.error("At least one API key is required");
      return;
    }
    setLoading(true);
    try {
      await invoke("update_config", {
        poofKeys: filteredPoof,
        removebgKeys: filteredRemovebg,
      });
      if (!isMounted()) return;
      toast.success("Settings saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      if (isMounted()) setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28]">
          <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">Settings</h2>
          <button onClick={onClose} className="text-[#555] hover:text-[#888] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-[#2a2a28]">
          {([
            { key: "keys" as const, label: "API Keys" },
            { key: "about" as const, label: "About" },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 px-4 py-2.5 text-xs font-mono tracking-wide transition-colors border-b-2",
                tab === t.key
                  ? "text-[#c8881a] border-[#c8881a]"
                  : "text-[#555] border-transparent hover:text-[#888]"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "keys" && (
          <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
            {fetching ? (
              <div className="text-xs text-[#555] font-mono py-4 text-center">Loading...</div>
            ) : (
              <>
                <div>
                  <p className="text-[10px] text-[#4a6aaa] font-mono mb-2 uppercase tracking-widest">
                    remove.bg — Primary
                  </p>
                  <p className="text-[10px] text-[#555] font-mono mb-2">
                    50 free credits/month per account. Iterated first.
                  </p>
                  <div className="space-y-2">
                    {removebgKeys.map((key, i) => (
                      <KeyRow
                        key={i}
                        value={key}
                        revealed={removebgRevealed[i]}
                        onChange={(v) => updateRemovebgKey(i, v)}
                        onToggle={() => toggleRemovebgReveal(i)}
                        onRemove={removebgKeys.length > 1 ? () => removeRemovebgKey(i) : undefined}
                        placeholder="Paste remove.bg key..."
                      />
                    ))}
                    <button
                      onClick={addRemovebgKey}
                      className="text-xs text-[#4a6aaa] hover:text-[#6a8aca] font-mono transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> add remove.bg key
                    </button>
                  </div>
                </div>

                <div className="border-t border-[#2a2a28] pt-4">
                  <p className="text-[10px] text-[#4a9a4a] font-mono mb-2 uppercase tracking-widest">
                    poof.bg — Fallback
                  </p>
                  <p className="text-[10px] text-[#555] font-mono mb-2">
                    100 free credits/month per account. Used when remove.bg credits run out.
                  </p>
                  <div className="space-y-2">
                    {poofKeys.map((key, i) => (
                      <KeyRow
                        key={i}
                        value={key}
                        revealed={poofRevealed[i]}
                        onChange={(v) => updatePoofKey(i, v)}
                        onToggle={() => togglePoofReveal(i)}
                        onRemove={poofKeys.length > 1 ? () => removePoofKey(i) : undefined}
                        placeholder="pk_f..."
                      />
                    ))}
                    <button
                      onClick={addPoofKey}
                      className="text-xs text-[#4a9a4a] hover:text-[#6aba6a] font-mono transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> add poof.bg key
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "about" && (
          <div className="px-6 py-5">
            <div className="mb-5">
              <h3 className="text-base font-bold text-[#e8e4da] tracking-wide mb-4">Rush ID</h3>
              <div className="space-y-1.5 font-mono text-xs">
                <div className="flex">
                  <span className="text-[#555] w-28 flex-shrink-0">Version:</span>
                  <span className="text-[#e8e4da]">{appVersion || "—"}</span>
                </div>
                <div className="flex">
                  <span className="text-[#555] w-28 flex-shrink-0">Tauri:</span>
                  <span className="text-[#e8e4da]">{tauriVersion || "—"}</span>
                </div>
                <div className="flex">
                  <span className="text-[#555] w-28 flex-shrink-0">React:</span>
                  <span className="text-[#e8e4da]">19.1.0</span>
                </div>
                <div className="flex">
                  <span className="text-[#555] w-28 flex-shrink-0">svg2pdf:</span>
                  <span className="text-[#e8e4da]">0.13</span>
                </div>
                <div className="flex">
                  <span className="text-[#555] w-28 flex-shrink-0">OS:</span>
                  <span className="text-[#e8e4da]">{navigator.platform || "—"}</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => setLicenseOpen(true)}
                className="block text-xs text-[#c8881a] hover:text-[#e8a030] font-mono transition-colors"
              >
                License →
              </button>
              <button
                onClick={() => setPatchNotesOpen(true)}
                className="block text-xs text-[#c8881a] hover:text-[#e8a030] font-mono transition-colors"
              >
                Patch Notes →
              </button>
            </div>
          </div>
        )}

        {tab === "keys" && (
          <div className="flex gap-3 px-6 py-4 border-t border-[#2a2a28]">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || fetching || (poofKeys.every((k) => !k.trim()) && removebgKeys.every((k) => !k.trim()))}
              className={cn(
                "flex-1 px-4 py-2 rounded-lg font-bold text-sm tracking-wide transition-colors",
                loading || (poofKeys.every((k) => !k.trim()) && removebgKeys.every((k) => !k.trim()))
                  ? "bg-[#2a2a28] text-[#555] cursor-not-allowed"
                  : "bg-[#c8881a] text-[#0c0c0b] hover:bg-[#e8a030]"
              )}
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        )}

        {tab === "about" && (
          <div className="flex justify-end px-6 py-4 border-t border-[#2a2a28]">
            <button
              onClick={onClose}
              className="px-6 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>

      <PatchNotesModal open={patchNotesOpen} onClose={() => setPatchNotesOpen(false)} />
      <LicenseModal open={licenseOpen} onClose={() => setLicenseOpen(false)} />
    </div>
  );
}
