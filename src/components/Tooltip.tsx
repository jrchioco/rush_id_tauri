import { type ReactNode } from "react";
import { cn } from "../lib/utils";
import { useTooltipPosition } from "../hooks/useTooltipPosition";

interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const { offsetX, side, triggerRef, tooltipRef, onMouseEnter } = useTooltipPosition();

  return (
    <div
      ref={triggerRef}
      className="group/tooltip relative inline-flex"
      onMouseEnter={onMouseEnter}
    >
      {children}
      <div
        ref={tooltipRef}
        className={cn(
          "absolute z-50 pointer-events-none",
          "opacity-0 group-hover/tooltip:opacity-100",
          "transition-opacity duration-150",
          "px-2.5 py-1.5 rounded-lg",
          "bg-[#0c0c0b] border border-[#2a2a28]",
          "text-[10px] font-mono text-[#888] leading-tight",
          "whitespace-nowrap",
          "left-1/2",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
        style={{ transform: `translateX(calc(-50% + ${offsetX}px))` }}
      >
        {content}
      </div>
    </div>
  );
}
