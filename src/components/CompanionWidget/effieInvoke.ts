import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { setEffieMood } from "./moodStore";

// Central wrapper around Tauri's invoke() that drives Effie's mood from the
// app's real async work. Replace `import { invoke } from "@tauri-apps/api/core"`
// with this module in any component that performs backend calls.
//
// - Only "heavy" commands (slow network/PDF ops) flip Effie to "working".
// - An in-flight reference count means parallel invokes (e.g. MultiClient's
//   parallel RemoveBG) don't prematurely show "success", and a second invoke
//   while already "working" does NOT replay the transition (the store skips
//   unchanged sets).
// - "success"/"error" only fires once all in-flight invokes settle; if any
//   failed, the settled mood is "error".
//
// Commands not in HEAVY pass through untouched (no mood change).

const HEAVY: Record<string, string | undefined> = {
  remove_bg: "bg_removal",
  export_pdf: undefined,
  print_file: undefined,
  composite_multi_pdf: undefined,
  composite_polaroid_pdf: "polaroid_export",
  composite_other_pdf: undefined,
};

let inflight = 0;
let failed = false;

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: unknown,
): Promise<T> {
  const actionKey = HEAVY[cmd];

  if (actionKey !== undefined) {
    inflight++;
    if (inflight === 1) {
      setEffieMood("working", actionKey ? { actionKey } : undefined);
    }
  }

  try {
    const result = await tauriInvoke<T>(cmd, args, options as never);
    if (actionKey !== undefined) {
      inflight--;
      if (inflight === 0) {
        setEffieMood(failed ? "error" : "success");
        failed = false;
      }
    }
    return result;
  } catch (err) {
    if (actionKey !== undefined) {
      failed = true;
      inflight--;
      if (inflight === 0) {
        setEffieMood("error");
        failed = false;
      }
    }
    throw err;
  }
}
