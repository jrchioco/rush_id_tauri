import { useState, useCallback, useRef } from "react";

type Side = "top" | "bottom";

const MARGIN = 8;

export function useTooltipPosition() {
  const [offsetX, setOffsetX] = useState(0);
  const [side, setSide] = useState<Side>("top");
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

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

    if (triggerRect.top < tooltipH + MARGIN * 2) {
      setSide("bottom");
    } else {
      setSide("top");
    }
  }, []);

  return { offsetX, side, triggerRef, tooltipRef, onMouseEnter: updatePosition };
}
