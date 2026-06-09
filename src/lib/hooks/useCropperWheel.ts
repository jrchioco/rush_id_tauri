import { useCallback, useRef } from "react";

export function useCropperWheel({
  onRotate,
  step = 1,
}: {
  onRotate: (delta: number) => void;
  step?: number;
}) {
  const onRotateRef = useRef(onRotate);
  onRotateRef.current = onRotate;
  const stepRef = useRef(step);
  stepRef.current = step;

  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const handler = (e: WheelEvent) => {
      if (!e.altKey) return;
      e.preventDefault();
      onRotateRef.current(-Math.sign(e.deltaY) * stepRef.current);
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, []);
}
