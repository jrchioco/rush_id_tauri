import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/utils";

interface ThemedModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
  dismissible?: boolean;
}

export function ThemedModal({ open, onClose, children, className, panelClassName, dismissible = true }: ThemedModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !dismissible) return;
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, dismissible]);

  if (!open) return null;

  return (
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center", className)}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "relative bg-[#0c0c0b] border border-[#2a2a28] rounded-xl shadow-2xl outline-none",
          panelClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
