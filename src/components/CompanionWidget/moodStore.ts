import { useSyncExternalStore } from "react";
import type { CompanionMood } from "./types";

// Tiny zero-dep mood store for the Effie companion widget. rush_id_tauri drives
// Effie's mood from its real async events (drag-over, processing, success, error)
// via setEffieMood(); App.tsx subscribes via useEffieMood() and renders <CompanionWidget>.
//
// The snapshot is skipped when unchanged so re-asserting the same mood (e.g. a
// second invoke firing while Effie is already "working") does NOT re-render or
// replay the transition — the widget only re-rolls a variant on a *transition*
// into a mood, so a same-mood no-op is also a no-op there.

export type EffieSnapshot = {
  mood: CompanionMood;
  actionKey?: string;
  message?: string;
};

let snapshot: EffieSnapshot = { mood: "idle" };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setEffieMood(
  mood: CompanionMood,
  opts?: { actionKey?: string; message?: string },
): void {
  const next: EffieSnapshot = { mood, actionKey: opts?.actionKey, message: opts?.message };
  if (
    next.mood === snapshot.mood &&
    next.actionKey === snapshot.actionKey &&
    next.message === snapshot.message
  ) {
    return; // unchanged — skip (no replay, no re-render)
  }
  snapshot = next;
  emit();
}

export function getEffieMood(): CompanionMood {
  return snapshot.mood;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): EffieSnapshot {
  return snapshot;
}

export function useEffieMood(): EffieSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
