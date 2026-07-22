/* ============================================================
   NEON — the signage across the site buzzes like tired neon tubes.
   Each glowing element gets one of a few flicker patterns at a random
   speed and phase, so no two ever blink in unison. That desync is what
   reads as an old machine humming away rather than one coordinated
   light show.

   The list below is the single source of truth for what flickers. A lot
   of it - scores, LED totals, the host's chosen topic - is rendered in
   after data loads, so a MutationObserver picks those up as they appear
   instead of only what exists at first paint.

   Reduced motion is honoured: if the viewer asked for less motion we
   never apply a thing (and the stylesheet forces animation:none too).
   ============================================================ */
const PATTERNS = ["neon-flicker-a", "neon-flicker-b", "neon-flicker-c"];

// Glowing signage only - never body copy, the live question prompt, or a
// revealed answer, so nothing that has to stay readable ever dims.
const TUBES = [
  ".deck-brand span:last-child", // header brand, every page
  ".page-name",                  // page title, every page
  ".wordmark span",              // the big landing-page sign
  ".rankings .score",            // leaderboard / results scoreboard
  ".led",                        // LED chips
  ".results-total-led",          // a player's LED points total
  ".winner-topic",               // the host's chosen topic
].join(", ");

function fizz(el) {
  if (el.dataset.neon) return; // already lit - leave its rhythm alone
  el.dataset.neon = "1";
  const dur = 4.5 + Math.random() * 5;                 // 4.5s–9.5s, periods never line up
  const pattern = PATTERNS[(Math.random() * PATTERNS.length) | 0];
  const delay = -(Math.random() * dur);                // start somewhere mid-cycle
  el.style.animation = `${pattern} ${dur.toFixed(2)}s steps(1) ${delay.toFixed(2)}s infinite`;
}

function scan(root) {
  if (root.matches?.(TUBES)) fizz(root);
  root.querySelectorAll?.(TUBES).forEach(fizz);
}

function init() {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  scan(document);

  // Light up glowing elements the pages render in later (scoreboards,
  // the host's topic, etc.) the moment they land in the DOM.
  new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType === 1) scan(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

init();
