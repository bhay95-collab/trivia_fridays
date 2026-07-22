/* ============================================================
   LIVE REACTIONS — the crowd noise. Players tap an emoji on the
   Play page; it floats up the shared Present screen and fades.
   Purely ephemeral: broadcast over Supabase realtime, never
   written to the database, and it carries nothing about anyone's
   answers, so it can't leak correctness.
   ============================================================ */
import { reducedMotion } from "./fx.js";

/* Small, unambiguous palette so the shared screen reads at a glance. */
export const REACTIONS = ["🎉", "😱", "🤯", "🔥", "😂", "👏"];

export const REACTION_EVENT = "react";
export const reactionTopic = (weekId) => `reactions-${weekId}`;

/* Spawn one floating reaction that drifts up the shared screen and
   fades. Compositor-only (transform/opacity), biased into the side
   gutters so it never sits on top of the question text, and capped so
   a burst can't flood the DOM. Reduced motion: skipped entirely, the
   same finished-state-is-nothing rule confetti follows. */
export function floatReaction(field, emoji) {
  if (!field || reducedMotion()) return;
  if (!REACTIONS.includes(emoji)) return;      // ignore anything off-palette
  if (field.childElementCount > 28) return;    // burst cap

  const el = document.createElement("span");
  el.className = "reaction-floater";
  el.textContent = emoji;

  // keep to the left (0–18%) or right (82–98%) gutter, away from centre
  const gutter = Math.random() < 0.5 ? Math.random() * 18 : 82 + Math.random() * 16;
  el.style.left = `${gutter}%`;
  el.style.setProperty("--drift", `${Math.round(Math.random() * 40 - 20)}px`);
  el.style.setProperty("--spin", `${Math.round(Math.random() * 24 - 12)}deg`);
  el.style.fontSize = `${(1.8 + Math.random() * 1.6).toFixed(2)}rem`;

  el.addEventListener("animationend", () => el.remove());
  field.appendChild(el);
}
