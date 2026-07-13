import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "./components/CompanionWidget/effieInvoke";
import { X, Scan, Layers, Sparkles, IdCard, Camera, Settings, Ruler } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./lib/utils";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SettingsModal } from "./components/SettingsModal";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { Tooltip } from "./components/Tooltip";
import { TOOLTIPS } from "./lib/tooltips";
import SingleClient from "./SingleClient";
import MultiClient from "./MultiClient";
import AiStudioTab from "./AiStudioTab";
import PassportClient from "./PassportClient";
import PolaroidClient from "./PolaroidClient";
import OtherClient from "./OtherClient";
import { CompanionWidget } from "./components/CompanionWidget";
import { useEffieMood, setEffieMood } from "./components/CompanionWidget/moodStore";
import { useEffieSettings } from "./components/CompanionWidget/effieSettings";
import { useTauriDragDrop } from "./lib/hooks/useTauriDragDrop";

type Tab = "single" | "multi" | "passport" | "polaroid" | "other" | "ai-studio";

const TABS: { key: Tab; label: string; icon: typeof Scan }[] = [
  { key: "single", label: "Single", icon: Scan },
  { key: "multi", label: "Multi", icon: Layers },
  { key: "passport", label: "Passport", icon: IdCard },
  { key: "polaroid", label: "Polaroid", icon: Camera },
  { key: "other", label: "Other", icon: Ruler },
  { key: "ai-studio", label: "AI Studio", icon: Sparkles },
];

export default function App() {
  const [configReady, setConfigReady] = useState<boolean | null>(null);
  const [setupKeys, setSetupKeys] = useState([""]);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>("single");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configVersion, setConfigVersion] = useState(0);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const tabRefs = useRef<Record<Tab, { hasUnsavedWork: () => boolean } | null>>({
    single: null, multi: null, passport: null, polaroid: null, other: null, "ai-studio": null,
  });

  const handleTabSwitch = useCallback((key: Tab) => {
    if (key === activeTab) return;
    const current = tabRefs.current[activeTab];
    if (current?.hasUnsavedWork()) {
      toast("Switching tabs will reset your progress. Continue?", {
        action: { label: "Continue", onClick: () => setActiveTab(key) },
      });
    } else {
      setActiveTab(key);
    }
  }, [activeTab]);

  useEffect(() => {
    invoke<boolean>("check_config").then((ready) => {
      setConfigReady(ready);
    });
  }, []);

  useEffect(() => {
    import("@tauri-apps/plugin-updater").then(({ check }) => {
      check().then((update) => {
        if (update) {
          updateRef.current = update;
          setUpdateAvailable(true);
        }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (localStorage.getItem("showWhatsNew") === "true") {
      localStorage.removeItem("showWhatsNew");
      setShowWhatsNew(true);
    }
  }, []);

  // Effie companion widget: subscribe to her mood store and surface a "dragover"
  // mood while a file is dragged anywhere over the window (guarded so it never
  // clobbers an in-flight "working" mood).
  const effie = useEffieMood();
  const effieSettings = useEffieSettings();
  const effieDrag = useTauriDragDrop(() => {});
  useEffect(() => {
    if (effieDrag.isDragging) {
      if (effie.mood !== "working" && effie.mood !== "dragover") setEffieMood("dragover");
    } else {
      if (effie.mood === "dragover") setEffieMood("idle");
    }
  }, [effieDrag.isDragging, effie.mood]);

  async function handleSaveConfig() {
    try {
      const filtered = setupKeys.filter((k) => k.trim());
      const poofKeys = filtered.filter((k) => k.startsWith("pk_f"));
      const removebgKeys = filtered.filter((k) => !k.startsWith("pk_f"));
      await invoke("save_config", { poofKeys, removebgKeys });
      setConfigReady(true);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function handleSkipConfig() {
    try {
      await invoke("save_config", { poofKeys: [], removebgKeys: [] });
      setConfigReady(true);
    } catch (e) {
      toast.error(String(e));
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

          <button
            onClick={handleSaveConfig}
            disabled={setupKeys.length === 0 || setupKeys.some((k) => !k.trim())}
            className="w-full mt-6 px-4 py-2.5 bg-[#c8881a] text-[#0c0c0b] rounded-lg font-bold text-sm tracking-wide hover:bg-[#e8a030] transition-colors disabled:bg-[#2a2a28] disabled:text-[#555] disabled:cursor-not-allowed"
          >
            Save & Launch
          </button>
          <button
            onClick={handleSkipConfig}
            className="w-full mt-2 px-4 py-2 text-[#555] hover:text-[#888] text-xs font-mono transition-colors"
          >
            Skip for now
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
              const update = updateRef.current;
              if (!update) return;
              setUpdating(true);
              update.downloadAndInstall().then(() => {
                toast.success("Update installed. Restarting...");
                localStorage.setItem("showWhatsNew", "true");
                import("@tauri-apps/plugin-process").then(({ relaunch }) => {
                  relaunch();
                });
              }).catch((e: any) => {
                setUpdating(false);
                toast.error("Update failed: " + String(e));
              });
            }}
            disabled={updating}
            className="underline font-medium hover:text-[#e8a030] transition-colors disabled:opacity-50"
          >
            {updating ? "Downloading..." : "Update now"}
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
          <div className="flex items-center gap-1">
            <nav className="flex gap-1">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => handleTabSwitch(key)}
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
            <div className="w-px h-5 bg-[#2a2a28] mx-1" />
            <Tooltip content={TOOLTIPS.settings}>
              <button
                onClick={() => setSettingsOpen(true)}
                className="p-1.5 rounded-lg text-[#555] hover:text-[#888] hover:bg-[#1a1a18] transition-colors"
              >
                <Settings className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      </header>

      {activeTab === "single" && <ErrorBoundary><SingleClient key={configVersion} ref={(el) => { tabRefs.current.single = el; }} /></ErrorBoundary>}
      {activeTab === "multi" && <ErrorBoundary><MultiClient key={configVersion} ref={(el) => { tabRefs.current.multi = el; }} /></ErrorBoundary>}
      {activeTab === "passport" && <ErrorBoundary><PassportClient key={configVersion} ref={(el) => { tabRefs.current.passport = el; }} /></ErrorBoundary>}
      {activeTab === "polaroid" && <ErrorBoundary><PolaroidClient key={configVersion} ref={(el) => { tabRefs.current.polaroid = el; }} /></ErrorBoundary>}
      {activeTab === "other" && <ErrorBoundary><OtherClient key={configVersion} ref={(el) => { tabRefs.current.other = el; }} /></ErrorBoundary>}
      {activeTab === "ai-studio" && <ErrorBoundary><AiStudioTab key={configVersion} ref={(el) => { tabRefs.current["ai-studio"] = el; }} /></ErrorBoundary>}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setConfigVersion((v) => v + 1)}
      />

      <WhatsNewModal
        open={showWhatsNew}
        onClose={() => setShowWhatsNew(false)}
      />

      {effieSettings.enabled && (
        <CompanionWidget
          mood={effie.mood}
          actionKey={effie.actionKey}
          message={effie.message}
          tier={effieSettings.tier}
        />
      )}
    </div>
  );
}
