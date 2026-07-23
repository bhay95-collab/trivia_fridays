/* ============================================================
   FX — the shared visual toolbox: FLIP reorders, confetti,
   and the small timing helpers the podium reveal is built on.

   Reduced motion is motion OFF, not motion-lite: every effect
   here checks and bails to the finished state.
   ============================================================ */

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const OVERTAKE_MS = 650;
const CLIMB_FLASH_MS = 1100;

/* ============================================================
   FLIP reorder. Measure where each keyed row is, let the caller
   re-render, measure again, then slide every row from its old
   position to its new one — so overtakes physically happen on
   screen instead of the list just being different next frame.
   Rows need data-key. Rows that climbed get .is-climbing for a
   moment so the room can see who did the overtaking.
   ============================================================ */
export function animateReorder(list, render) {
  const before = new Map();
  for (const el of list.children) {
    if (el.dataset.key) before.set(el.dataset.key, el.getBoundingClientRect().top);
  }

  render();

  if (reducedMotion() || before.size === 0) return;

  for (const el of list.children) {
    const prev = before.get(el.dataset.key);
    if (prev == null) continue;
    const shift = prev - el.getBoundingClientRect().top;
    if (Math.abs(shift) < 1) continue;

    el.animate(
      [{ transform: `translateY(${shift}px)` }, { transform: "translateY(0)" }],
      { duration: OVERTAKE_MS, easing: EASE_OUT }
    );

    if (shift > 0) {
      // it moved up the board — let it glow while it passes
      el.classList.add("is-climbing");
      setTimeout(() => el.classList.remove("is-climbing"), CLIMB_FLASH_MS);
    }
  }
}

/* ============================================================
   Count-up. A number odometer-rolls from zero to its value, then
   punches once on landing. Under reduced motion it snaps straight
   to the final value with no roll and no pop.
     el      — the element whose textContent holds the number
     to      — the final numeric value
     format  — how to render an intermediate/final value as text
   ============================================================ */
export function countUp(el, to, { ms = 900, format = (n) => String(Math.round(n)) } = {}) {
  if (!el) return;
  const target = Number(to) || 0;

  if (reducedMotion()) {
    el.textContent = format(target);
    return;
  }

  const start = performance.now();
  (function step(now) {
    const t = Math.min((now - start) / ms, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(target * eased);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = format(target);
      el.classList.remove("is-scoring");
      void el.offsetWidth; // restart the pop animation if it just ran
      el.classList.add("is-scoring");
    }
  })(start);
}

/* ============================================================
   Winner sunburst. Slow rotating neon spokes behind the podium,
   spawned into a positioned container and returned with a cleanup
   handle. Skipped (returns a no-op) under reduced motion.
   ============================================================ */
export function podiumSunburst(container) {
  if (reducedMotion() || !container) return () => {};
  const el = document.createElement("div");
  el.className = "sunburst";
  el.setAttribute("aria-hidden", "true");
  container.insertBefore(el, container.firstChild);
  return () => el.remove();
}

/* ============================================================
   Streak shockwave. A ring blasts across the screen when a run
   lands, then removes itself. Skipped under reduced motion.
   ============================================================ */
export function streakShock() {
  if (reducedMotion()) return;
  const el = document.createElement("div");
  el.className = "shockwave";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/* ============================================================
   Arcade boot sequence. Landing on the leaderboard powers the
   cabinet on like it's been switched off for decades: the tube
   strikes to a bright line, warms up with a flicker, runs a short
   self-test, then flashes white and fades to reveal the fully
   rendered board behind it. The overlay is opaque from first paint
   so the page assembles unseen, and this only drives the timing.

     overlay — the #boot element
     minMs   — hold the sequence at least this long before revealing,
               so a fast load still gets the full power-on
     capMs   — reveal no matter what by here, so a slow/failed load
               can never trap the page behind the overlay

   Returns a handle whose reveal() lifts the overlay once the board
   is ready. Under reduced motion it removes the overlay immediately
   and does nothing else — motion OFF, page shown straight away.

   The power-on is a boot-up moment, not a page transition: it plays
   once when someone first arrives at the site and is then suppressed
   for the rest of the browsing session, so bouncing back to the
   leaderboard from elsewhere in the app doesn't replay it. The guard
   lives in sessionStorage, which survives navigations within a tab but
   clears when the tab closes — exactly a "fresh visit" boundary.

   Only a handful of self-test lines print per boot, drawn at random
   from a deep pool below, so it reads unhurried and never the same
   twice running.
   ============================================================ */
const BOOT_FLAG = "tf_booted";

// How many roast/self-test lines print between the header and the
// closer. Kept small so each has room to breathe across the hold.
const BOOT_TEST_LINES = 5;

// The bench. `s` is the status readout, `k` its colour class
// (ok = green, warn = gold, bad = pink). A random handful runs each boot.
const BOOT_POOL = [
  { t: "CATHODE RAY WARM-UP",             s: "OK",     k: "ok" },
  { t: "PHOSPHOR REALIGNMENT",            s: "OK",     k: "ok" },
  { t: "DUSTING OFF HIGH SCORES",         s: "OK",     k: "ok" },
  { t: "REHEATING STALE EXCUSES",         s: "OK",     k: "ok" },
  { t: "PRETEND-SHUFFLING QUESTIONS",     s: "OK",     k: "ok" },
  { t: "COUNTING GOOGLE CHEATERS",        s: "47",     k: "warn" },
  { t: "CHECKING IF YOU STUDIED",         s: "NO",     k: "bad" },
  { t: "INFLATING FALSE CONFIDENCE",      s: "OK",     k: "ok" },
  { t: "BUFFERING HOT TAKES",             s: "OK",     k: "ok" },
  { t: "LOWERING EXPECTATIONS",           s: "DONE",   k: "ok" },
  { t: "BLAMING THE HOST",                s: "OK",     k: "ok" },
  { t: "WARMING UP THE WOODEN SPOON",     s: "1 READY", k: "warn" },
  { t: "LOCATING YOUR LAST BRAINCELL",    s: "404",    k: "bad" },
  { t: "SHARPENING PETTY RIVALRIES",      s: "OK",     k: "ok" },
  { t: "TALLYING WRONG ANSWERS",          s: "LOTS",   k: "warn" },
  { t: "CONFISCATING PHONES",             s: "OK",     k: "ok" },
  { t: "REVIEWING YOUR APPEAL",           s: "DENIED", k: "bad" },
  { t: "MEASURING TRASH TALK",            s: "98%",    k: "warn" },
  { t: "OVERRULING THE JUDGES",           s: "OK",     k: "ok" },
  { t: "DEFROSTING LAST PLACE",           s: "OK",     k: "ok" },
  { t: "PRICING THE BAR TAB",             s: "OUCH",   k: "bad" },
  { t: "CUEING NEARLY-RIGHT ANSWERS",     s: "OK",     k: "ok" },
  { t: "AWARDING PITY POINTS",            s: "0",      k: "warn" },
  { t: "SUMMONING OBSCURE 80s FACTS",     s: "OK",     k: "ok" },
  { t: "IGNORING THE HOUSE RULES",        s: "OK",     k: "ok" },
  { t: "FACT-CHECKING THAT ONE GUY",      s: "WRONG",  k: "bad" },
];

// Fisher–Yates, non-mutating: returns the first n of a shuffled copy.
function sample(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Rebuild the self-test read-out: fixed header, a random run of pool
// lines, then the blinking-cursor closer. Line reveals are timed inline
// and spread across `holdMs` so the sequence fills the hold instead of
// rattling through in the first couple of seconds.
function renderBootLog(overlay, holdMs) {
  const log = overlay.querySelector(".boot-log");
  if (!log) return;

  const COL = 30; // status column: pad each label out to here with dots
  const dots = (label) => ".".repeat(Math.max(3, COL - label.length));
  const test = ({ t, s, k }) =>
    `  ${t} ${dots(t)} <span class="${k}">${s}</span>`;

  const rows = [
    "<b>TRIVIA FRIDAYS</b> ENTERTAINMENT SYSTEM",
    "(C) 1982   ·   ALL RIGHTS RESERVED",
    " ",
    ...sample(BOOT_POOL, BOOT_TEST_LINES).map(test),
    `  RECALLING THE SEASON ${dots("RECALLING THE SEASON")} <span class="boot-cursor">&#9608;</span>`,
  ];

  // Header prints quickly; the test run + closer spread evenly from
  // ~1.6s out to shortly before the reveal.
  const hold = holdMs / 1000;
  const first = 1.6;
  const last = Math.max(first + 1, hold - 0.8);
  const spread = last - first;
  const testCount = rows.length - 3; // tests + closer

  const delayFor = (i) => {
    if (i === 0) return 0.45;
    if (i === 1) return 0.7;
    if (i === 2) return 0.9;
    return first + ((i - 3) / (testCount - 1)) * spread;
  };

  log.innerHTML = rows
    .map((html, i) => `<span class="ln" style="animation-delay:${delayFor(i).toFixed(2)}s">${html}</span>`)
    .join("");
}

// How long the self-test read-out spreads across. The screen holds for
// `minMs` (longer), but the log keeps this pacing so the lines print at
// their usual speed and simply sit finished for the extra beat.
const BOOT_LOG_MS = 10000;

export function startBoot(overlay, { minMs = 13000, capMs = 17000 } = {}) {
  if (!overlay) return { reveal() {} };
  if (reducedMotion()) { overlay.hidden = true; return { reveal() {} }; }

  // Already powered on earlier this session — skip straight to the board.
  try {
    if (sessionStorage.getItem(BOOT_FLAG)) { overlay.hidden = true; return { reveal() {} }; }
    sessionStorage.setItem(BOOT_FLAG, "1");
  } catch (_) { /* storage blocked (private mode) — just boot */ }

  overlay.hidden = false;
  renderBootLog(overlay, BOOT_LOG_MS);
  // restart cleanly if a previous boot (e.g. the sign-in screen) ran
  overlay.classList.remove("is-done");
  void overlay.offsetWidth;
  overlay.classList.add("is-booting");

  const started = performance.now();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(cap);
    overlay.classList.remove("is-booting");
    overlay.classList.add("is-done"); // the white flash + fade-out
    setTimeout(() => {
      overlay.hidden = true;
      overlay.classList.remove("is-done");
    }, 640); // must outlast boot-out
  };

  const cap = setTimeout(finish, capMs);

  return {
    reveal() {
      setTimeout(finish, Math.max(0, minMs - (performance.now() - started)));
    },
  };
}

/* ============================================================
   Confetti. Canvas-based, fixed duration, cleans up after
   itself. Skipped entirely under reduced motion.
   ============================================================ */
const CONFETTI_COLORS = ["#FF2D95", "#25E8E2", "#FFC531", "#FFF3DE"];

/* A short celebratory burst. `heroBand` (0–1) caps how far down the
   screen pieces spawn and fall, so on the leaderboard the reward stays
   in the hero region and clears quickly; the Present screen leaves it
   full-height. Skipped entirely under reduced motion. */
export function fireConfetti(canvas, { count = 70, frames = 200, heroBand = 1 } = {}) {
  if (reducedMotion() || !canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth;
  canvas.height = innerHeight;

  const floor = canvas.height * heroBand; // pieces settle/clear by here
  // full-height spawn when unconstrained (Present screen), a tight upper
  // cluster when constrained to a hero band (leaderboard)
  const spawnSpread = heroBand < 1 ? canvas.height * 0.4 * heroBand : canvas.height;
  const bits = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * spawnSpread,
    r: 3 + Math.random() * 5,
    vy: 2 + Math.random() * 3,
    vx: -1 + Math.random() * 2,
    a: Math.random() * Math.PI,
    c: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
  }));

  let elapsed = 0;
  (function trickle() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const b of bits) {
      if (b.y > floor) continue; // don't rain past the hero band
      b.y += b.vy;
      b.x += b.vx;
      b.a += 0.1;
      ctx.fillStyle = b.c;
      ctx.fillRect(b.x, b.y, b.r, b.r * 2.2 * Math.abs(Math.cos(b.a)));
    }
    if (++elapsed < frames) requestAnimationFrame(trickle);
    else ctx.clearRect(0, 0, canvas.width, canvas.height); // leave no trace
  })();
}
