import { useState, useEffect, useRef, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

const TIP_1 = new URL("./PrintReminderModal/assets/tip-1.webp", import.meta.url).href;
const TIP_2 = new URL("./PrintReminderModal/assets/tip-2.webp", import.meta.url).href;

const STEPS = [
  { image: TIP_1, alt: "Acrobat Print Dialog settings" },
  { image: TIP_2, alt: "Epson Printer Properties settings" },
] as const;

interface PrintReminderModalProps {
  open: boolean;
  onClose: () => void;
}

export function PrintReminderModal({ open, onClose }: PrintReminderModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset to Step 1 on every open
  useEffect(() => {
    if (open) setStep(1);
  }, [open]);

  // Focus trap + arrow key navigation
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight" && step < 2) setStep(2);
      if (e.key === "ArrowLeft" && step > 1) setStep(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, step]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const isLeftHalf = clickX < rect.width / 2;
      if (isLeftHalf && step > 1) setStep((s) => (s - 1) as 1 | 2);
      if (!isLeftHalf && step < 2) setStep((s) => (s + 1) as 1 | 2);
    },
    [step]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl shadow-2xl outline-none"
        style={{ width: "min(max(70vw, 480px), 900px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a28]">
          <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">
            Print Settings Reminder
          </h2>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-[#888] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step content */}
        <div className="px-6 py-4">
          <p className="text-[10px] font-mono text-[#555] mb-3 tracking-widest uppercase">
            Step {step} of 2
          </p>
          <img
            src={STEPS[step - 1].image}
            alt={STEPS[step - 1].alt}
            onClick={handleImageClick}
            className={cn(
              "w-full h-auto rounded-lg border border-[#2a2a28]",
              "select-none object-contain",
              "max-h-[60vh]"
            )}
            style={{ cursor: step === 1 ? "e-resize" : "w-resize" }}
            draggable={false}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2a2a28]">
          <button
            onClick={() => setStep(1)}
            disabled={step === 1}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors",
              step === 1
                ? "text-[#333] cursor-not-allowed"
                : "text-[#888] hover:text-[#e8e4da] hover:bg-[#1a1a18]"
            )}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>

          {/* Step dots */}
          <div className="flex gap-2">
            {[1, 2].map((s) => (
              <button
                key={s}
                onClick={() => setStep(s as 1 | 2)}
                className={cn(
                  "w-2 h-2 rounded-full transition-colors",
                  step === s ? "bg-[#c8881a]" : "bg-[#2a2a28] hover:bg-[#555]"
                )}
              />
            ))}
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={step === 2}
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors",
              step === 2
                ? "text-[#333] cursor-not-allowed"
                : "text-[#888] hover:text-[#e8e4da] hover:bg-[#1a1a18]"
            )}
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
