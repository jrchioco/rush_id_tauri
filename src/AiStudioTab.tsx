import { forwardRef, useImperativeHandle } from "react";
import { Sparkles } from "lucide-react";

const AiStudioTab = forwardRef<{ hasUnsavedWork: () => boolean }>(function AiStudioTab(_, ref) {
  useImperativeHandle(ref, () => ({
    hasUnsavedWork: () => false,
  }));

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-12 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#4285f4] via-[#34a853] to-[#fbbc05] flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-lg font-bold text-[#e8e4da] tracking-wide mb-2">AI Studio</h2>
        <p className="text-sm text-[#555] font-mono mb-6">
          AI-powered studio - coming soon
        </p>
        <div className="max-w-md mx-auto space-y-3 text-left">
          {[
            { label: "Generate ID photos from text prompts", icon: "✨" },
            { label: "AI background replacement", icon: "🖼" },
            { label: "Auto-crop & enhance portraits", icon: "🎯" },
            { label: "Bulk edit with natural language", icon: "💬" },
          ].map(({ label, icon }) => (
            <div key={label} className="flex items-center gap-3 bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-4 py-3">
              <span className="text-lg">{icon}</span>
              <span className="text-xs text-[#888] font-mono">{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-8 px-4 py-2 bg-[#1a1a18] border border-[#2a2a28] rounded-lg inline-block">
          <span className="text-[10px] text-[#555] font-mono tracking-widest">POWERED BY GOOGLE AI</span>
        </div>
      </div>
    </main>
  );
});

export default AiStudioTab;
