import { useCallback, useEffect, useRef, useState } from "react";
import type { CompanionMood, CompanionWidgetProps } from "./types";
import { pickLineFor, IDLE_AMBIENT, pickWelcome } from "./dialogue";
import "./CompanionWidget.css";

// Resolution tier — matches the asset export tiers. Exposed as a prop so the
// widget knows which pre-exported asset path to load. (SPEC treats resolution
// as an app-level setting; this prop is the widget's handle on that choice.)
export type ResolutionTier = "low" | "med" | "high" | "ultra";

interface Props extends CompanionWidgetProps {
  tier?: ResolutionTier; // default "med"
}

const WORKING_VARIANTS = ["working-a", "working-b"] as const;
const ERROR_VARIANTS = ["error", "error-2"] as const;
const SUCCESS_VARIANTS = ["success", "success-2"] as const;
const HEADPAT_VARIANTS = ["headpat-a", "headpat-b"] as const; // non-idle head-pat (equipment present)
const HEADPAT_IDLE_VARIANTS = ["headpat-solo", "headpat-solo2"] as const; // idle head-pat (no equipment)

// Any bubble auto-hides after this long (ms) so lines don't linger.
const BUBBLE_TIMEOUT = 5000;
// Crossfade duration — must match --effie-fade in the CSS (plus a small buffer).
const CROSSFADE_MS = 300;
// One-shot success "pop" duration.
const POP_MS = 400;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Fisher–Yates shuffle (returns a new array; input untouched).
function shuffled<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Idle pose cycle: Effie rests as canonical; every IDLE_CYCLE_MS she shows one
// of the active poses (yawn/lookup/idle-4/idle-5) for IDLE_POSE_MS, then returns
// to canonical and the cycle restarts. The active poses are drawn from a no-
// repeat shuffled deck so each gets airtime before any repeats.
const IDLE_CYCLE_MS = 30000;
const IDLE_POSE_MS = 5000;
const IDLE_ACTIVE_POSES = ["idle-yawn", "idle-lookup", "idle-4", "idle-5"] as const;

export function CompanionWidget({
  mood,
  message,
  actionKey,
  tier = "med",
  autoIdleAfter = 20000,
}: Props) {
  const [idleVariant, setIdleVariant] = useState<string>("idle-canonical");
  // Drives the idle pose cycle (30s canonical -> 5s yawn/lookup -> repeat).
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [workingVariant, setWorkingVariant] = useState<string>(() => pickRandom(WORKING_VARIANTS));
  const [errorVariant, setErrorVariant] = useState<string>(() => pickRandom(ERROR_VARIANTS));
  const [successVariant, setSuccessVariant] = useState<string>(() => pickRandom(SUCCESS_VARIANTS));
  const [isHeadPatted, setIsHeadPatted] = useState(false);
  const [headpatVariant, setHeadpatVariant] = useState<string>(() => pickRandom(HEADPAT_VARIANTS));
  const [bubbleLine, setBubbleLine] = useState("");
  // Effective mood = parent's `mood`, optionally auto-reverted to "idle" after
  // `autoIdleAfter` ms. All visible behavior keys off this, so a revert just
  // flows through the existing crossfade / variant-reroll / bubble logic.
  const [effectiveMood, setEffectiveMood] = useState<CompanionMood>(mood);
  const prevMood = useRef<CompanionMood | null>(null);
  // Head-pat suppresses the bubble without resetting its line (so it returns
  // on mouse-leave). A ref avoids an extra re-render / effect loop.
  const headPattedRef = useRef(false);
  // Latest idle ambient line, readable synchronously by resolveLine.
  const idleAmbientRef = useRef("");
  const autoIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync from the parent's controlled `mood` and (re)arm the auto-revert timer.
  useEffect(() => {
    setEffectiveMood(mood);
    if (autoIdleTimer.current !== null) {
      clearTimeout(autoIdleTimer.current);
      autoIdleTimer.current = null;
    }
    if (autoIdleAfter && mood !== "idle") {
      autoIdleTimer.current = setTimeout(() => setEffectiveMood("idle"), autoIdleAfter);
    }
    return () => {
      if (autoIdleTimer.current !== null) clearTimeout(autoIdleTimer.current);
    };
  }, [mood, autoIdleAfter]);

  // Resolve the target image for the current (effective) mood/variant/tier/head-pat.
  const activeVariant = isHeadPatted
    ? headpatVariant
    : effectiveMood === "idle"
    ? idleVariant
    : effectiveMood === "working"
    ? workingVariant
    : effectiveMood === "success"
    ? successVariant
    : effectiveMood === "error"
    ? errorVariant
    : effectiveMood; // dragover: single image, variant name === mood
  const activeFolder = isHeadPatted
    ? "headpat"
    : effectiveMood === "idle"
    ? "idle"
    : effectiveMood === "working"
    ? "working"
    : effectiveMood;
  const imageSrc = new URL(`./assets/${activeFolder}/${activeVariant}-${tier}.webp`, import.meta.url).href;

  // Crossfade: keep the previous image mounted briefly so it can fade out
  // while the new one fades in (true overlap, not a cut + fade-in).
  const [outgoingSrc, setOutgoingSrc] = useState<string | null>(null);
  const prevSrcRef = useRef(imageSrc);
  useEffect(() => {
    if (imageSrc !== prevSrcRef.current) {
      setOutgoingSrc(prevSrcRef.current);
      prevSrcRef.current = imageSrc;
    }
  }, [imageSrc]);
  useEffect(() => {
    if (!outgoingSrc) return;
    const t = setTimeout(() => setOutgoingSrc(null), CROSSFADE_MS);
    return () => clearTimeout(t);
  }, [outgoingSrc]);

  // One-shot success "pop".
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (effectiveMood !== "success") return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), POP_MS);
    return () => clearTimeout(t);
  }, [effectiveMood]);

  // Speech bubble: text persists through its fade-out; `is-visible` toggles it.
  const [bubbleText, setBubbleText] = useState("");
  const [bubbleShown, setBubbleShown] = useState(false);

  const resolveLine = useCallback(() => {
    if (effectiveMood === "idle") return idleAmbientRef.current;
    return message ?? pickLineFor(effectiveMood, actionKey);
  }, [effectiveMood, message, actionKey]);

  // Re-roll pooled variant only on transition INTO that (effective) mood, not every render.
  useEffect(() => {
    if (effectiveMood !== prevMood.current) {
      if (effectiveMood === "working") setWorkingVariant(pickRandom(WORKING_VARIANTS));
      if (effectiveMood === "success") setSuccessVariant(pickRandom(SUCCESS_VARIANTS));
      if (effectiveMood === "error") setErrorVariant(pickRandom(ERROR_VARIANTS));
      prevMood.current = effectiveMood;
    }
  }, [effectiveMood]);

  // Idle pose cycle: rest at canonical, every 30s briefly yawn/lookup, then
  // return to canonical and restart the count. Self-rescheduling (not a free-
  // running interval) so the 30s re-arms from canonical.
  useEffect(() => {
    if (effectiveMood !== "idle") return;
    setIdleVariant("idle-canonical");
    let cancelled = false;
    // No-repeat deck of active poses; reshuffles when exhausted so each of the
    // four appears before any repeat.
    let deck: string[] = [];
    const drawActive = (): string => {
      if (deck.length === 0) deck = shuffled(IDLE_ACTIVE_POSES);
      return deck.pop() as string;
    };
    const tick = () => {
      if (cancelled) return;
      setIdleVariant(drawActive());
      idleTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        setIdleVariant("idle-canonical");
        idleTimerRef.current = setTimeout(tick, IDLE_CYCLE_MS);
      }, IDLE_POSE_MS);
    };
    idleTimerRef.current = setTimeout(tick, IDLE_CYCLE_MS);
    return () => {
      cancelled = true;
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setIdleVariant("idle-canonical");
    };
  }, [effectiveMood]);

  // While idle (and not head-patted), surface an ambient musing on a slow timer.
  useEffect(() => {
    if (effectiveMood !== "idle") {
      idleAmbientRef.current = "";
      return;
    }
    const tick = () => {
      idleAmbientRef.current = pickRandom(IDLE_AMBIENT);
      setBubbleLine(idleAmbientRef.current);
    };
    const first = setTimeout(tick, 60000);
    const interval = setInterval(tick, 75000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [effectiveMood]);

  // Drive the displayed bubble from the active line source (incl. idle timer,
  // message/actionKey prop changes, mood transitions). Auto-hides after a beat.
  useEffect(() => {
    const next = resolveLine();
    setBubbleLine(next);
  }, [effectiveMood, message, actionKey, resolveLine]);

  // One-shot welcome on app open (widget mount). Greets once. Under StrictMode
  // the mount effect runs twice, but it's declared AFTER the resolveLine effect,
  // so the second run re-asserts the welcome after resolveLine clears the bubble
  // to "" — net result: a single greeting, no flicker. Skips if the parent passed
  // an explicit `message` (their line wins), and only when she starts idle.
  useEffect(() => {
    if (effectiveMood !== "idle" || message) return;
    setBubbleLine(pickWelcome());
  }, []);

  useEffect(() => {
    if (!bubbleLine) return;
    const hide = setTimeout(() => setBubbleLine(""), BUBBLE_TIMEOUT);
    return () => clearTimeout(hide);
  }, [bubbleLine]);

  // Show/hide the bubble (keeps text mounted so it can fade out smoothly).
  useEffect(() => {
    if (bubbleLine.length > 0 && !headPattedRef.current) {
      setBubbleText(bubbleLine);
      setBubbleShown(true);
    } else {
      setBubbleShown(false);
    }
  }, [bubbleLine, isHeadPatted]);

  const showBubble = bubbleText.length > 0;

  return (
    <div className="companion-widget">
      <div className="companion-image-stack">
        <div className={`companion-image-inner${pulsing ? " is-pulsing" : ""}`}>
          {outgoingSrc && (
            <img
              key={`out-${outgoingSrc}`}
              src={outgoingSrc}
              alt=""
              aria-hidden
              className="companion-image companion-image--out"
            />
          )}
          <img
            key={`in-${imageSrc}`}
            src={imageSrc}
            alt="Effie"
            className="companion-image companion-image--in"
          />
        </div>
        <div
          className="companion-headpat-region"
          onMouseEnter={() => {
            setHeadpatVariant(
              pickRandom(effectiveMood === "idle" ? HEADPAT_IDLE_VARIANTS : HEADPAT_VARIANTS)
            );
            headPattedRef.current = true;
            setIsHeadPatted(true);
          }}
          onMouseLeave={() => {
            headPattedRef.current = false;
            setIsHeadPatted(false);
          }}
        />
        {showBubble && (
          <div className={`companion-bubble${bubbleShown ? " is-visible" : ""}`}>
            <span className="companion-bubble-text">{bubbleText}</span>
            <button
              className="companion-bubble-dismiss"
              onClick={() => {
                setBubbleText("");
                setBubbleShown(false);
              }}
              aria-label="Dismiss"
            >
              ×
              </button>
          </div>
        )}
      </div>
    </div>
  );
}
