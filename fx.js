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
   Confetti. Canvas-based, fixed duration, cleans up after
   itself. Skipped entirely under reduced motion.
   ============================================================ */
const CONFETTI_COLORS = ["#FF2D95", "#25E8E2", "#FFC531", "#FFF3DE"];

export function fireConfetti(canvas, { count = 160, frames = 340 } = {}) {
  if (reducedMotion() || !canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth;
  canvas.height = innerHeight;

  const bits = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height,
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
      b.y += b.vy;
      b.x += b.vx;
      b.a += 0.1;
      ctx.fillStyle = b.c;
      ctx.fillRect(b.x, b.y, b.r, b.r * 2.2 * Math.abs(Math.cos(b.a)));
    }
    if (++elapsed < frames) requestAnimationFrame(trickle);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}
