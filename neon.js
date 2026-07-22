/* ============================================================
   NEON — the signage across the site buzzes like tired neon tubes.
   The stylesheet gives every glowing element a default flicker; this
   scatters the pattern, speed and phase per element so no two blink in
   unison. That desync is what reads as an old machine humming away
   rather than one coordinated light show.

   Reduced motion is honoured twice over: the stylesheet already forces
   animation:none for everyone, and we skip the work here too.
   ============================================================ */
const PATTERNS = ["neon-flicker-a", "neon-flicker-b", "neon-flicker-c"];
const TUBES = ".deck-brand span:last-child, .page-name, .wordmark span";

function scatterNeon() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  for (const el of document.querySelectorAll(TUBES)) {
    const dur = 4.5 + Math.random() * 5; // 4.5s–9.5s, so the periods never line up
    el.style.animationName = PATTERNS[(Math.random() * PATTERNS.length) | 0];
    el.style.animationDuration = `${dur.toFixed(2)}s`;
    el.style.animationDelay = `${(-Math.random() * dur).toFixed(2)}s`; // start mid-cycle
  }
}

scatterNeon();
