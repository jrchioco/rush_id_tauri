import { type ReactNode } from "react";
import { cn } from "../lib/utils";

interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

export function Tooltip({ content, side = "top", children }: TooltipProps) {
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div className="group/tooltip relative inline-flex">
      {children}
      <div
        className={cn(
          "absolute z-50 pointer-events-none",
          "opacity-0 group-hover/tooltip:opacity-100",
          "transition-opacity duration-150",
          "px-2.5 py-1.5 rounded-lg",
          "bg-[#0c0c0b] border border-[#2a2a28]",
          "text-[10px] font-mono text-[#888] leading-tight",
          "whitespace-nowrap",
          positionClasses[side],
        )}
      >
        {content}
      </div>
    </div>
  );
}
