/* ============================================================
   JOKER SCORING — pure double-or-nothing math, no DOM, so the
   tests import it straight into Node and it stays in lockstep
   with the SQL in sql/17_jokers.sql.

   A staked question pays DOUBLE on full marks and ZERO on
   anything less (partial, wrong, or blank). Every other question
   scores exactly what it was graded.
   ============================================================ */
export function jokerPoints(basePoints, verdict, jokered) {
  const base = Number(basePoints) || 0;
  if (!jokered) return base;
  return verdict === "correct" ? base * 2 : 0;
}
