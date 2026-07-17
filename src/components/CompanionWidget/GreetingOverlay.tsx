import { useEffect, useRef, useState } from "react";
import { pickGreeting } from "./dialogue";
import "./GreetingOverlay.css";

const TYPEWRITER_MS = 25;
const COUNTDOWN_SECONDS = 5;
const FADE_MS = 150;

const GREETING_IMG = new URL("./assets/greeting-idle.webp", import.meta.url).href;

export function GreetingOverlay({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(true);
  const [closing, setClosing] = useState(false);
  const [count, setCount] = useState(COUNTDOWN_SECONDS);

  const fullLineRef = useRef("");
  const dismissedRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Typewriter reveal.
  useEffect(() => {
    const full = pickGreeting();
    fullLineRef.current = full;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setText(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(id);
        setTyping(false);
      }
    }, TYPEWRITER_MS);
    return () => clearInterval(id);
  }, []);

  // Countdown — starts only after typing finishes.
  useEffect(() => {
    if (typing) return;
    if (count <= 0) {
      dismiss();
      return;
    }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [typing, count]);

  function dismiss() {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setClosing(true);
    setTimeout(onClose, FADE_MS);
  }

  // Click/tap anywhere on the overlay (after reveal) dismisses.
  function handleOverlayClick() {
    if (!typing) dismiss();
  }

  // Keypress: during typing → complete the line; after → dismiss.
  useEffect(() => {
    function onKey() {
      if (typing) {
        setText(fullLineRef.current);
        setTyping(false);
      } else {
        dismiss();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing]);

  return (
    <div
      ref={overlayRef}
      className={`greeting-overlay${closing ? " is-closing" : ""}`}
      onClick={handleOverlayClick}
    >
      <div className="greeting-scrim" />
      <img src={GREETING_IMG} alt="" aria-hidden className="greeting-art" />
      <div className="greeting-box">
        <div className="greeting-name">Effie</div>
        <div className="greeting-text">{text}</div>
        {!typing && (
          <div className="greeting-prompt">
            Click anywhere to proceed ({count})
          </div>
        )}
      </div>
    </div>
  );
}
