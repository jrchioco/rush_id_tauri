import { useEffect, useState } from "react";

export function useKeyUsed(): number {
  const [activeKeyIndex, setActiveKeyIndex] = useState(0);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<number>("key_used", (e) => setActiveKeyIndex(e.payload)).then(
        (fn) => {
          unlisten = fn;
        },
      );
    });
    return () => {
      unlisten?.();
    };
  }, []);
  return activeKeyIndex;
}
