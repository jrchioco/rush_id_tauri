import { useSyncExternalStore } from "react";
import type { ResolutionTier } from "./index";

// Zero-dep store for Effie's persistent preferences (quality + visibility).
// Mirrors moodStore.ts. Persisted to localStorage (consistent with lastSaveDir /
// showWhatsNew) — no backend change. App.tsx subscribes via useEffieSettings()
// and passes tier/visible down to <CompanionWidget>.

const TIER_KEY = "effie.tier";
const ENABLED_KEY = "effie.enabled";

const TIERS: ResolutionTier[] = ["low", "med", "high", "ultra"];

function readTier(): ResolutionTier {
  try {
    const v = localStorage.getItem(TIER_KEY);
    if (v && (TIERS as string[]).includes(v)) return v as ResolutionTier;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return "med";
}

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(ENABLED_KEY);
    if (v === "false") return false;
    if (v === "true") return true;
  } catch {
    /* storage unavailable — fall through to default */
  }
  return true;
}

export type EffieSettings = { tier: ResolutionTier; enabled: boolean };

let snapshot: EffieSettings = { tier: readTier(), enabled: readEnabled() };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(TIER_KEY, snapshot.tier);
    localStorage.setItem(ENABLED_KEY, String(snapshot.enabled));
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

export function setEffieTier(tier: ResolutionTier): void {
  if (tier === snapshot.tier) return;
  snapshot = { ...snapshot, tier };
  persist();
  emit();
}

export function setEffieEnabled(enabled: boolean): void {
  if (enabled === snapshot.enabled) return;
  snapshot = { ...snapshot, enabled };
  persist();
  emit();
}

export function getEffieSettings(): EffieSettings {
  return snapshot;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): EffieSettings {
  return snapshot;
}

export function useEffieSettings(): EffieSettings {
  return useSyncExternalStore(subscribe, getSnapshot);
}
