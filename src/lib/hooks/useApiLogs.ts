import { useEffect } from "react";

interface ApiLogPayload {
  key_prefix: string;
  ok: boolean;
  status: number | string;
  send_ms: number;
  bytes_ms: number;
  write_ms: number;
  total_ms: number;
  endpoint: string;
  error: string | null;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function providerLabel(endpoint: string): string {
  if (endpoint.includes("poof.bg")) return "poof";
  if (endpoint.includes("remove.bg")) return "rmvbg";
  return "???";
}

export function useApiLogs(onLog: (text: string) => void) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<ApiLogPayload>("api_log", (e) => {
        if (cancelled) return;
        const p = e.payload;
        const provider = providerLabel(p.endpoint);
        const total = fmtMs(p.total_ms);
        if (p.ok) {
          const detail = `send ${fmtMs(p.send_ms)} + dl ${fmtMs(p.bytes_ms)} + write ${fmtMs(p.write_ms)}`;
          onLog(`✓ Key ${p.key_prefix} [${provider}] — ${p.status} OK — ${detail} — total ${total}`);
        } else {
          const detail = p.bytes_ms > 0
            ? `send ${fmtMs(p.send_ms)} + dl ${fmtMs(p.bytes_ms)}`
            : `send ${fmtMs(p.send_ms)}`;
          onLog(`✗ Key ${p.key_prefix} [${provider}] — ${p.status} ${p.error ?? ""} — ${detail} — total ${total}`);
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
