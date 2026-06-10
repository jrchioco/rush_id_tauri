import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Eye, EyeOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [keys, setKeys] = useState<string[]>([""]);
  const [revealed, setRevealed] = useState<boolean[]>([false]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFetching(true);
    invoke<string[]>("get_config")
      .then((apiKeys) => {
        setKeys(apiKeys.length > 0 ? apiKeys : [""]);
        setRevealed(apiKeys.length > 0 ? apiKeys.map(() => false) : [false]);
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setFetching(false));
  }, [open]);

  if (!open) return null;

  function addKey() {
    setKeys([...keys, ""]);
    setRevealed([...revealed, false]);
  }

  function removeKey(i: number) {
    setKeys(keys.filter((_, j) => j !== i));
    setRevealed(revealed.filter((_, j) => j !== i));
  }

  function updateKey(i: number, value: string) {
    const next = [...keys];
    next[i] = value;
    setKeys(next);
  }

  function toggleReveal(i: number) {
    const next = [...revealed];
    next[i] = !next[i];
    setRevealed(next);
  }

  async function handleSave() {
    const filtered = keys.filter((k) => k.trim());
    if (filtered.length === 0) {
      toast.error("At least one API key is required");
      return;
    }
    setLoading(true);
    try {
      await invoke("update_config", { apiKeys: filtered });
      toast.success("Settings saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
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

        <div className="px-6 py-5 space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-[#888] font-mono tracking-widest uppercase mb-1">
              API Keys
            </h3>
            <p className="text-[10px] text-[#555] font-mono mb-3">
              Multiple keys supported — app iterates when one runs out of credits.
            </p>

            {fetching ? (
              <div className="text-xs text-[#555] font-mono py-4 text-center">Loading...</div>
            ) : (
              <div className="space-y-2">
                {keys.map((key, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      type={revealed[i] ? "text" : "password"}
                      value={key}
                      onChange={(e) => updateKey(i, e.target.value)}
                      placeholder="Paste API key..."
                      className="flex-1 min-w-0 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#444] font-mono focus:outline-none focus:border-[#c8881a]"
                    />
                    <button
                      onClick={() => toggleReveal(i)}
                      className="px-2 text-[#555] hover:text-[#888] transition-colors flex-shrink-0"
                      title={revealed[i] ? "Hide key" : "Reveal key"}
                    >
                      {revealed[i] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    {keys.length > 1 && (
                      <button
                        onClick={() => removeKey(i)}
                        className="px-2 text-[#555] hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addKey}
                  className="text-xs text-[#c8881a] hover:text-[#e8a030] font-mono transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> add another key
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#2a2a28]">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-[#555] hover:text-[#888] text-sm font-mono transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || fetching || keys.every((k) => !k.trim())}
            className={cn(
              "flex-1 px-4 py-2 rounded-lg font-bold text-sm tracking-wide transition-colors",
              loading || keys.every((k) => !k.trim())
                ? "bg-[#2a2a28] text-[#555] cursor-not-allowed"
                : "bg-[#c8881a] text-[#0c0c0b] hover:bg-[#e8a030]",
            )}
          >
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
