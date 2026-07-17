export type CompanionMood = "idle" | "dragover" | "working" | "success" | "error";

export interface CompanionWidgetProps {
  /** Fully controlled mood — parent owns this via setMood. */
  mood: CompanionMood;
  /** Overrides the line bank entirely if provided. */
  message?: string;
  /**
   * Optional per-action key appended to the mood for line lookup,
   * e.g. "polaroid_export" -> looks up "working_polaroid_export".
   * Only used when `message` is not provided.
   */
  actionKey?: string;
  /**
   * Auto-revert: Effie returns to "idle" after this many ms in any non-idle
   * mood. Defaults to 10000 (10s). Implemented as an internal effective-mood
   * override; the parent still owns `mood` and wins on any change (which also
   * re-arms the timer).
   */
  autoIdleAfter?: number;
}
