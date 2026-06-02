import { useEffect, useRef, useState } from "react";

export function useTauriDragDrop(
  onDrop: (paths: string[]) => void,
): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    let cancelled = false;
    let ue: (() => void) | null = null;
    let ul: (() => void) | null = null;
    let ud: (() => void) | null = null;

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (cancelled) return;
      listen("tauri://drag-enter", () => setIsDragging(true)).then((fn) => {
        if (cancelled) fn(); else ue = fn;
      });
      listen("tauri://drag-leave", () => setIsDragging(false)).then((fn) => {
        if (cancelled) fn(); else ul = fn;
      });
      listen("tauri://drag-drop", (event: { payload: { paths: string[] } }) => {
        setIsDragging(false);
        const paths = event.payload?.paths ?? [];
        if (paths.length > 0) onDropRef.current(paths);
      }).then((fn) => {
        if (cancelled) fn(); else ud = fn;
      });
    });

    return () => {
      cancelled = true;
      ue?.();
      ul?.();
      ud?.();
    };
  }, []);

  return { isDragging };
}
