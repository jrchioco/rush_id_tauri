import { useEffect, useState } from "react";

export function useKeyUsed(): number {
  const [activeKeyIndex, setActiveKeyIndex] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<number>("key_used", (e) => setActiveKeyIndex(e.payload)).then(
        (fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        },
      );
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return activeKeyIndex;
}
