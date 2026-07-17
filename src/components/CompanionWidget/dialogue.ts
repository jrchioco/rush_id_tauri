import type { CompanionMood } from "./types";

/**
 * Line bank. Keys beyond the 5 CompanionMood values are per-action overrides
 * (e.g. "working_polaroid_export"), reached via the widget's `actionKey` prop.
 * The widget resolves: message prop wins, else actionKey lookup, else mood pool.
 */
export const LINES: Record<string, string[]> = {
  // idle has no speech (per SPEC) — she just bobs and re-rolls her pose.
  idle: [],

  // dragover: a file is hovering the dropzone — anticipation / curiosity.
  dragover: [
    "ooh, ano 'yan?",
    "plot twist incoming, I can feel it",
    "sige, idrop mo na!",
    "hmm, ano 'to?",
    "teka lang, ano 'yan?",
    "Ah s***, here we go again.",
    "the suspense is real, drop it already!",
    "ready ka na ba? drop mo na!",
    "luh, ano 'yun?",
    "suspenders on, drop it here!",
    "is this for me?",
  ],

  // working: a generic async action is in flight.
  working: [
    "ginagawa na...",
    "sandali lang!",
    "we're so back! (task in progress)",
    "antay ka lang ha",
    "tinatapos ko na 'to",
    "medyo matagal 'to, wait lang",
    "processing... wag ma-pressure",
    "we put it here, we put it there, we put it everywhere",
    "konti na lang!",
    "paano nga yun ulit?...",
    "wait... wait...",
  ],

  // working + per-action overrides (via the `actionKey` prop).
  working_polaroid_export: [
    "oh we're doing polaroid!",
    "polaroid time! click click",
    "Alright, let me cook!",
    "picture picture — developing na!",
    "we're framing this masterpiece rn",
    "capturing the moment, hold on",
  ],
  working_bg_removal: [
    "tinanggal ko na yung background!",
    "bye-bye background!",
    "Ryōiki Tenkai: Background Annihilation! 🤞",
    "greenscreen begone!",
    "erasing the background like it owes me money",
    "sudo rm -rf /background",
  ],

  // success: the action resolved OK.
  success: [
    "tapos na!",
    "ayan, oks na!",
    "done! enjoy~",
    "yes! tapos na",
    "MY MAGNUM OPUS!!!",
    "lagay mo na sa album mo",
    "solved! chik chak",
    "eto na oh, hehe",
    "ayun, smooth!",
    "packaged and ready",
    "Done! Meryenda ko?",
  ],

  // error: the action threw / rejected — apologetic.
  error: [
    "uy, may problema...",
    "pasensya na, na-stuck ako",
    "ay teh, may error",
    "Task failed successfully",
    "di ko kaya 'to huhu",
    "this is fine 🔥🐶",
    "ayaw gumana nito eh",
    "Error: ask Darkelle?",
    "baka di mo araw today? hehe...",
  ],
};

// Idle ambient pool — shown occasionally while idle (she bobs + re-rolls her
// pose in between). The widget surfaces one of these on a timer when mood is
// "idle" and she's not being head-patted.
export const IDLE_AMBIENT: string[] = [
  "pa milktea ka para di boring.",
  "vibing lang, walang render, walang crash, ang saya.",
  "miss ko na mag-shoot",
  "Bored here, can you play any NewJeans song?",
  "NPC Mode: ON",
  "big NPC energy right now",
  "Ensaladang Avocado 🥑🌶️🤤",
  "just here, existing, thriving (allegedly)",
  "sigma idle grindset: doing absolutely nothing",
  "kape muna tayo?",
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function pickLine(mood: CompanionMood): string {
  const pool = LINES[mood];
  if (!pool || pool.length === 0) return "";
  return pickRandom(pool);
}

/** Resolves the most specific line: actionKey override -> mood pool -> empty. */
export function pickLineFor(mood: CompanionMood, actionKey?: string): string {
  if (actionKey && LINES[`${mood}_${actionKey}`]?.length) {
    return pickRandom(LINES[`${mood}_${actionKey}`]);
  }
  return pickLine(mood);
}

// Welcome pool — shown once when the app (and thus the widget) opens.
export const WELCOME: string[] = [
  "uy, camera's hot and ready. let's shoot something!",
  "heyy, welcome! anong gupit today?",
  "andito ka na pala, let's get to work!",
  "hi... antok pa ako, pero welcome!",
  "uy uy uy, andiyan na si boss!",
  "ready ka na sa magic? lapag mo na!",
  "Effie here! your friendly neighborhood editor.",
];

export function pickWelcome(): string {
  return pickRandom(WELCOME);
}

// Greeting bank — shown once on every app launch via the full-screen launch
// greeting overlay (VN-style). Taglish/meme lines. Avoids repeating the
// immediately previous launch's line when the bank has >1 entry (in-memory
// dedup only — resets on restart, which is fine since dedup is a nice-to-have).
export const GREETING: string[] = [
  "uy, andiyan na si boss! camera's hot, let's make magic ✨",
  "welcome back! ready ka na sa mga gupit-gupit? hehe",
  "heyy! new day, new IDs. lapag mo na 'yan!",
  "Effie online! papagalawin natin yang photos mo 💅",
  "oh ayan na ang legend. tara, edit tayo!",
  "hi hi! kape muna before magtrabaho? char, let's go!",
  "welcome sa rush ID! ako na bahala sa background mo 😎",
];

let lastGreetingIndex = -1;

export function pickGreeting(): string {
  if (GREETING.length <= 1) return pickRandom(GREETING);
  let i = Math.floor(Math.random() * GREETING.length);
  if (i === lastGreetingIndex) {
    i = (i + 1) % GREETING.length;
  }
  lastGreetingIndex = i;
  return GREETING[i];
}
