import { useState, useCallback, useRef } from "react";

type Side = "top" | "bottom";

const MARGIN = 8;

interface UseTooltipPositionOptions {
  fixed?: boolean;
}

interface UseTooltipPositionResult {
  offsetX: number;
  side: Side;
  fixedTop: number;
  fixedLeft: number;
  triggerRef: React.RefObject<HTMLDivElement | null>;
  tooltipRef: React.RefObject<HTMLDivElement | null>;
  onMouseEnter: () => void;
}

export function useTooltipPosition(options?: UseTooltipPositionOptions): UseTooltipPositionResult {
  const fixed = options?.fixed ?? true;
  const [offsetX, setOffsetX] = useState(0);
  const [side, setSide] = useState<Side>("top");
  const [fixedPos, setFixedPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const tooltipW = tooltipRect.width;
    const tooltipH = tooltipRect.height;

    const centerX = triggerRect.left + triggerRect.width / 2;

    let offset = 0;
    if (centerX - tooltipW / 2 < 0) {
      offset = tooltipW / 2 - centerX + MARGIN;
    } else if (centerX + tooltipW / 2 > window.innerWidth) {
      offset = -(centerX + tooltipW / 2 - window.innerWidth + MARGIN);
    }
    setOffsetX(offset);

    const spaceAbove = triggerRect.top;
    const spaceBelow = window.innerHeight - triggerRect.bottom;

    let newSide: Side;
    if (spaceBelow < tooltipH + MARGIN && spaceAbove >= spaceBelow) {
      newSide = "top";
    } else if (spaceAbove < tooltipH + MARGIN) {
      newSide = "bottom";
    } else {
      newSide = "top";
    }
    setSide(newSide);

    if (fixed) {
      const tooltipCenterX = centerX + offset;
      let left = tooltipCenterX - tooltipW / 2;
      left = Math.max(MARGIN, Math.min(window.innerWidth - tooltipW - MARGIN, left));

      let top: number;
      if (newSide === "top") {
        top = triggerRect.top - tooltipH - MARGIN;
      } else {
        top = triggerRect.bottom + MARGIN;
      }

      setFixedPos({ top, left });
    }
  }, [fixed]);

  return { offsetX, side, fixedTop: fixedPos.top, fixedLeft: fixedPos.left, triggerRef, tooltipRef, onMouseEnter: updatePosition };
}
