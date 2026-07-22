/* ============================================================
   THE NEEDLE — one line of gentle rivalry for the signed-in
   player, comparing them to whoever sits directly above (or, if
   they're top, directly below). Pure, no DOM, so it's unit tested.
   Affectionate and about points only — never nasty.

   `ranked` is the leaderboard rows in descending-points order,
   each with { player_id, display_name, total_points, weeks_played }.
   ============================================================ */
const fmt = (n, digits = 1) => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(digits));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* The needle repeats every leaderboard load, so — like the Wooden
   Spoon roast — each state carries a pool of tails and picks a fresh
   one, keeping it from going stale week to week. The factual lead
   (the gap and the rival's name) is fixed; only the closing quip
   rotates. app.js holds the chosen line while the board re-renders so
   a sort toggle doesn't reshuffle it. */

// behind the player directly above: "{gap} behind {name}. {tail}"
export const RIVAL_BEHIND = [
  "One good week and it's yours.",
  "Close the gap and take it.",
  "That's one strong quiz away.",
  "Nothing a good night won't fix.",
  "Reelable in a single week.",
  "Keep the pressure on.",
  "One category could flip it.",
  "You're within striking distance.",
];

// level with the player above: "Level with {name}. {tail}"
export const RIVAL_TIE = [
  "The tie-break is the next right answer.",
  "Whoever blinks first drops a place.",
  "One question decides this.",
  "It's yours to take or lose next week.",
  "Dead heat — the next point breaks it.",
  "The slimmest of margins: zero.",
];

// top of the board with a runner-up in view:
// "Top of the board — {name} is {gap} back. {tail}"
export const RIVAL_TOP_RUNNERUP = [
  "Mind the gap.",
  "Don't get comfortable.",
  "Keep an eye behind you.",
  "The chase is on.",
  "Lead's nice; keep it.",
  "No coasting from here.",
];

// dead level at the very top: "Dead level with {name} at the top. {tail}"
export const RIVAL_TIE_TOP = [
  "One slip and it's theirs.",
  "The crown is shared for now.",
  "Whoever cracks first hands it over.",
  "It's a two-horse race up here.",
  "Next right answer breaks the deadlock.",
];

// alone at the top, nobody below to name — full lines
export const RIVAL_TOP_ALONE = [
  "Top of the board. Someone has to challenge you eventually.",
  "Top of the board. Enjoy the view while it lasts.",
  "Top of the board, all on your own. Bring a challenger.",
  "Top of the board. The only way from here is defended.",
  "Top of the board. Lonely up here, isn't it?",
  "Top of the board. Now the hard part: staying there.",
];

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
      if (gap === 0) return `Dead level with ${below.display_name} at the top. ${pick(RIVAL_TIE_TOP)}`;
      return `Top of the board — ${below.display_name} is ${fmt(gap, digits)} back. ${pick(RIVAL_TOP_RUNNERUP)}`;
    }
    return pick(RIVAL_TOP_ALONE);
  }

  const gap = Number(above[key]) - Number(me[key]);
  if (gap === 0) return `Level with ${above.display_name}. ${pick(RIVAL_TIE)}`;
  return `${fmt(gap, digits)} behind ${above.display_name}. ${pick(RIVAL_BEHIND)}`;
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
