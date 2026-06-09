import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Scan, Layers, Sparkles, IdCard } from "lucide-react";
import { cn } from "./lib/utils";
import SingleClient from "./SingleClient";
import MultiClient from "./MultiClient";
import GeminiTab from "./GeminiTab";
import PassportClient from "./PassportClient";

type Tab = "single" | "multi" | "passport" | "gemini";

const TABS: { key: Tab; label: string; icon: typeof Scan }[] = [
  { key: "single", label: "Single", icon: Scan },
  { key: "multi", label: "Multi", icon: Layers },
  { key: "passport", label: "Passport", icon: IdCard },
  { key: "gemini", label: "Gemini", icon: Sparkles },
];

export default function App() {
  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [setupKeys, setSetupKeys] = useState([""]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("single");

  useEffect(() => {
    invoke<boolean>("check_config").then((ready) => {
      setConfigReady(ready);
    });
  }, []);

  useEffect(() => {
    import("@tauri-apps/plugin-updater").then(({ check }) => {
      check().then((update) => {
        if (update) setUpdateAvailable(true);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  async function handleSaveConfig() {
    setSaveError(null);
    try {
      await invoke("save_config", {
        apiKeys: setupKeys.filter((k) => k.trim()),
      });
      setConfigReady(true);
    } catch (e) {
      setSaveError(String(e));
    }
  }

  if (configReady === null) {
    return (
      <div className="min-h-screen bg-[#111110] flex items-center justify-center">
        <p className="text-[#555] font-mono text-sm tracking-widest">initializing...</p>
      </div>
    );
  }

  if (!configReady) {
    return (
      <div className="min-h-screen bg-[#111110] flex items-center justify-center">
        <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-8 max-w-md w-full mx-4">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#c8881a] rounded flex items-center justify-center">
              <img src="/comlogo.png" alt="Logo" className="w-8 h-8 object-contain" />
            </div>
            <div>
              <h1 className="text-base font-bold text-[#e8e4da] tracking-wide">RUSH ID</h1>
              <p className="text-xs text-[#555] font-mono">J3FF PRINTING SERVICES</p>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-[#e8e4da] mb-1">Setup API Keys</h2>
          <p className="text-xs text-[#555] font-mono mb-4">
            Multiple keys supported — app iterates when one runs out of credits.
          </p>

          <div className="space-y-2">
            {setupKeys.map((key, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => {
                    const next = [...setupKeys];
                    next[i] = e.target.value;
                    setSetupKeys(next);
                  }}
                  placeholder="Paste API key..."
                  className="flex-1 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-sm text-[#e8e4da] placeholder-[#444] font-mono focus:outline-none focus:border-[#c8881a]"
                />
                {setupKeys.length > 1 && (
                  <button
                    onClick={() => setSetupKeys(setupKeys.filter((_, j) => j !== i))}
                    className="text-[#555] hover:text-red-400 p-2 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setSetupKeys([...setupKeys, ""])}
              className="text-xs text-[#c8881a] hover:text-[#e8a030] font-mono transition-colors"
            >
              + add another key
            </button>
          </div>

          {saveError && (
            <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-400 text-xs mt-4 flex items-center gap-2 font-mono">
              <X className="w-3 h-3 flex-shrink-0" /> {saveError}
            </div>
          )}

          <button
            onClick={handleSaveConfig}
            disabled={setupKeys.length === 0 || setupKeys.some((k) => !k.trim())}
            className="w-full mt-6 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] disabled:cursor-not-allowed"
          >
            Save & Launch
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111110]">
      {updateAvailable && (
        <div className="bg-[#1a1508] border-b border-[#c8881a]/30 px-6 py-2 text-[#c8881a] text-xs flex items-center justify-center gap-2 font-mono">
          <span>A new version is available.</span>
          <button
            onClick={() => {
              import("@tauri-apps/plugin-updater").then(({ check }) => {
                check().then((update) => update?.downloadAndInstall()).catch(() => {});
              }).catch(() => {});
            }}
            className="underline font-medium hover:text-[#e8a030] transition-colors"
          >
            Update now
          </button>
        </div>
      )}

      <header className="bg-[#0c0c0b] border-b border-[#2a2a28]">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#c8881a] rounded flex items-center justify-center flex-shrink-0">
              <img src="/comlogo.png" alt="Logo" className="w-7 h-7 object-contain" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[#e8e4da] tracking-wider">J3FF PRINTING SERVICES</h1>
              <p className="text-xs text-[#555] font-mono">Image Background Removal & SVG Printer</p>
            </div>
          </div>
          <nav className="flex gap-1">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-mono tracking-wide flex items-center gap-1.5 transition-colors",
                  activeTab === key
                    ? "bg-[#c8881a]/20 text-[#c8881a] border border-[#c8881a]/30"
                    : "text-[#555] hover:text-[#888] hover:bg-[#1a1a18]"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {activeTab === "single" && <SingleClient />}
      {activeTab === "multi" && <MultiClient />}
      {activeTab === "passport" && <PassportClient />}
      {activeTab === "gemini" && <GeminiTab />}
    </div>
  );
}
