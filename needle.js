/* ============================================================
   THE NEEDLE — one line of gentle rivalry for the signed-in
   player, comparing them to whoever sits directly above (or, if
   they're top, directly below). Pure, no DOM, so it's unit tested.
   Affectionate and about points only — never nasty.

   `ranked` is the leaderboard rows in descending-points order,
   each with { player_id, display_name, total_points, weeks_played }.
   ============================================================ */
const fmt = (n, digits = 1) => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(digits));

// `key` matches whichever metric the board is currently sorted by
// (total_points or avg_points), so the needle always agrees with the
// numbers on screen.
export function rivalryLine(ranked, meId, key = "total_points") {
  const digits = key === "avg_points" ? 2 : 1;
  const i = ranked.findIndex((r) => r.player_id === meId);
  if (i === -1) return "";

  const me = ranked[i];
  if (!me.weeks_played) return ""; // hasn't played yet — nothing to needle

  const above = ranked[i - 1];
  const below = ranked[i + 1];

  if (!above) {
    if (below) {
      const gap = Number(me[key]) - Number(below[key]);
      if (gap === 0) return `Dead level with ${below.display_name} at the top. One slip and it's theirs.`;
      return `Top of the board — ${below.display_name} is ${fmt(gap, digits)} back. Mind the gap.`;
    }
    return "Top of the board. Someone has to challenge you eventually.";
  }

  const gap = Number(above[key]) - Number(me[key]);
  if (gap === 0) return `Level with ${above.display_name} — the tie-break is the next right answer.`;
  return `${fmt(gap, digits)} behind ${above.display_name}. One good week and it's yours.`;
}

/* One-line head-to-head for a profile card: where the signed-in player
   stands against the person whose profile they're looking at. Empty
   when it's their own card, or when either hasn't played. */
export function headToHead(me, them, key = "total_points") {
  const digits = key === "avg_points" ? 2 : 1;
  if (!me || !them || me.player_id === them.player_id || !me.weeks_played) return "";
  const diff = Number(me[key]) - Number(them[key]);
  if (diff === 0) return `You're level with ${them.display_name}.`;
  if (diff > 0) return `You're ${fmt(diff, digits)} ahead of ${them.display_name}.`;
  return `You're ${fmt(-diff, digits)} behind ${them.display_name}.`;
}
