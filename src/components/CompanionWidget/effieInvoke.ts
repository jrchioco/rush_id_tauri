import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { setEffieMood } from "./moodStore";

// Central wrapper around Tauri's invoke() that drives Effie's mood from the
// app's real async work. Replace `import { invoke } from "@tauri-apps/api/core"`
// with this module in any component that performs backend calls.
//
// Commands are split into two groups:
// - WORKING_ONLY: show "working" while in-flight, but do NOT fire "success"/
//   "error" on settle (e.g. the crop step's write_picture, or remove_bg whose
//   success would be premature — compositing still happens after it).
// - RESULT: fire "success"/"error" once the command settles — the real end of
//   a user-visible unit of work (PDF export / print / composite).
//
// An in-flight reference count means parallel invokes don't prematurely show
// "success", and a second invoke while already "working" does NOT replay the
// transition (the store skips unchanged sets). "success"/"error" only fires
// when the last tracked command settles AND a RESULT command ran in that batch;
// WORKING_ONLY commands alone never flip Effie to success or error.
//
// Commands not in these maps pass through untouched (no mood change).
//
// This wrapper alone cannot cover the frontend crop step in test mode (no
// representative Tauri command there). The process handlers in SingleClient/
// MultiClient/PassportClient therefore also set "working"/"success"/"error"
// explicitly for that step.

type MoodMap = Record<string, string | undefined>;

const WORKING_ONLY: MoodMap = {
  remove_bg: "bg_removal",
  write_picture: undefined,
};

const RESULT: MoodMap = {
  export_pdf: undefined,
  print_file: undefined,
  composite_multi_pdf: undefined,
  composite_polaroid_pdf: "polaroid_export",
  composite_other_pdf: undefined,
};

function moodKeyFor(cmd: string): string | undefined {
  const working = WORKING_ONLY[cmd];
  if (working !== undefined) return working;
  return RESULT[cmd];
}

let inflight = 0;
let failed = false;
let resultRan = false;

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  options?: unknown,
): Promise<T> {
  const isResult = cmd in RESULT;
  const isTracked = isResult || cmd in WORKING_ONLY;
  const key = moodKeyFor(cmd);

  if (isTracked) {
    if (isResult) resultRan = true;
    inflight++;
    if (inflight === 1) {
      setEffieMood("working", key ? { actionKey: key } : undefined);
    }
  }

  try {
    const result = await tauriInvoke<T>(cmd, args, options as never);
    if (isTracked) {
      inflight--;
      if (inflight === 0) {
        if (resultRan) {
          setEffieMood(failed ? "error" : "success");
        }
        failed = false;
        resultRan = false;
      }
    }
    return result;
  } catch (err) {
    if (isTracked) {
      if (isResult) failed = true;
      inflight--;
      if (inflight === 0) {
        if (resultRan) {
          setEffieMood(failed ? "error" : "success");
        }
        failed = false;
        resultRan = false;
      }
    }
    throw err;
  }
}
