import { type ReactNode } from "react";
import { cn } from "../lib/utils";
import { useTooltipPosition } from "../hooks/useTooltipPosition";

interface TooltipProps {
  content: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  fixed?: boolean;
  children: ReactNode;
}

export function Tooltip({ content, className, fixed, children }: TooltipProps) {
  const { offsetX, side, fixedTop, fixedLeft, triggerRef, tooltipRef, onMouseEnter } = useTooltipPosition({ fixed });

  return (
    <div
      ref={triggerRef}
      className={cn("group/tooltip relative inline-flex", className)}
      onMouseEnter={onMouseEnter}
    >
      {children}
      <div
        ref={tooltipRef}
        className={cn(
          "z-50 pointer-events-none",
          "opacity-0 group-hover/tooltip:opacity-100",
          "transition-opacity duration-150",
          "px-2.5 py-1.5 rounded-lg",
          "bg-[#0c0c0b] border border-[#2a2a28]",
          "text-[10px] font-mono text-[#888] leading-tight",
          "whitespace-nowrap",
          fixed ? "fixed" : "absolute",
        )}
        style={fixed ? {
          top: fixedTop,
          left: fixedLeft,
        } : {
          left: "50%",
          transform: `translateX(calc(-50% + ${offsetX}px))`,
          ...(side === "top" ? { bottom: "100%", marginBottom: 8 } : { top: "100%", marginTop: 8 }),
        }}
      >
        {content}
      </div>
    </div>
  );
}
