import { useEffect, useState } from "react";

export function useTauriDragDrop(
  onDrop: (paths: string[]) => void,
): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let ue: (() => void) | null = null;
    let ul: (() => void) | null = null;
    let ud: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("tauri://drag-enter", () => setIsDragging(true)).then((fn) => {
        ue = fn;
      });
      listen("tauri://drag-leave", () => setIsDragging(false)).then((fn) => {
        ul = fn;
      });
      listen("tauri://drag-drop", (event: { payload: { paths: string[] } }) => {
        setIsDragging(false);
        const paths = event.payload?.paths ?? [];
        if (paths.length > 0) onDrop(paths);
      }).then((fn) => {
        ud = fn;
      });
    });
    return () => {
      ue?.();
      ul?.();
      ud?.();
    };
  }, [onDrop]);

  return { isDragging };
}
