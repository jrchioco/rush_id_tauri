import { useSyncExternalStore } from "react";

// Tiny zero-dep store tracking whether a native "click to browse" file picker is
// active. rush_id_tauri glue only (not part of the effie/ widget) — it exists so
// Effie can show her "dragover" anticipation mood while the OS file dialog is open,
// mirroring the drag-over beat.
//
// A native file dialog has no close event, so the app window regaining focus is
// used as the "dialog closed" signal (App.tsx wires a window "focus" listener to
// endBrowse()). App.tsx feeds this flag into the same anticipation effect as
// drag-over, so browsing and dragging share one dragover path.
//
// Safety net: if that "focus" signal never arrives (e.g. a cancelled dialog on
// some Linux/WebKitGTK setups), beginBrowse() arms a timeout that force-ends the
// browse so Effie can't get stuck in "dragover". Cleared by any normal endBrowse().

const BROWSE_TIMEOUT_MS = 20000;

let browsing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function beginBrowse(): void {
  if (browsing) return;
  browsing = true;
  timer = setTimeout(endBrowse, BROWSE_TIMEOUT_MS);
  emit();
}

export function endBrowse(): void {
  if (!browsing) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  browsing = false;
  emit();
}

export function getIsBrowsing(): boolean {
  return browsing;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useIsBrowsing(): boolean {
  return useSyncExternalStore(subscribe, getIsBrowsing);
}
