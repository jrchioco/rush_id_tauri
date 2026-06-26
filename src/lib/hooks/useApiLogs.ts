import { useEffect } from "react";

interface ApiLogPayload {
  key_prefix: string;
  ok: boolean;
  status: number | string;
  elapsed_ms: number;
  error: string | null;
}

export function useApiLogs(onLog: (text: string) => void) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ApiLogPayload>("api_log", (e) => {
        if (cancelled) return;
        const p = e.payload;
        const elapsed = (p.elapsed_ms / 1000).toFixed(1);
        if (p.ok) {
          onLog(`✓ Key ${p.key_prefix} — ${p.status} OK [${elapsed}s]`);
        } else {
          onLog(`✗ Key ${p.key_prefix} — ${p.status} ${p.error ?? ""} [${elapsed}s]`);
        }
      }).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onLog]);
}
