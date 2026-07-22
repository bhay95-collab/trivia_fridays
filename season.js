/* ============================================================
   SEASON LAYER — badges, the Halls of Fame and Shame, the
   Wooden Spoon roast, and the howler ballot. Renders into the
   leaderboard's side rail; app.js calls in after the standings
   are up. Everything fails soft: a missing RPC hides a panel,
   it never breaks the scoreboard.
   ============================================================ */
import { randomRoast } from "./streaks.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The roast is held against the person holding the spoon so flipping
// the Total/Average toggle doesn't reshuffle the line - it only rerolls
// when the spoon actually changes hands.
let spoonHolderId = null;
let spoonRoast = "";

const BADGE_ABBR = {
  perfect: "PQ",
  ever_present: "NM",
  hot_streak: "HS",
  fast_finger: "FF",
  comeback: "CB",
  most_improved: "MI",
  podium_regular: "PR",
  photo_finish: "PF",
  topic_titan: "TT",
};

/* One round trip for everything the rail needs. */
export async function fetchSeason(db) {
  const [badges, records, howlers, streaks] = await Promise.all([
    db.rpc("season_badges"),
    db.rpc("season_records"),
    db.rpc("howler_board"),
    db.rpc("attendance_streaks").then((r) => r, () => ({ data: [] })),
  ]);

  const byPlayer = new Map();
  const groups = new Map();
  for (const b of badges.data || []) {
    const entry = {
      code: b.badge_code,
      abbr: BADGE_ABBR[b.badge_code] || "??",
      name: b.badge_name,
      detail: b.detail,
      holder: b.display_name,
    };
    byPlayer.set(b.player_id, [...(byPlayer.get(b.player_id) || []), entry]);
    const g = groups.get(b.badge_code) || { ...entry, holders: [] };
    groups.set(b.badge_code, { ...g, holders: [...g.holders, { name: b.display_name, detail: b.detail }] });
  }

  const streakBy = new Map();
  for (const s of streaks.data || []) {
    streakBy.set(s.player_id, { current: Number(s.current_streak) || 0, best: Number(s.best_streak) || 0 });
  }

  return {
    byPlayer,
    groups: [...groups.values()],
    records: records.data || [],
    howlers: howlers.data || [],
    streaks: streakBy,
  };
}

/* A small flame chip for anyone on an active run of showing up. Only
   shows from two weeks in — a "streak" of one isn't a streak. */
export function streakChip(season, playerId) {
  const s = season.streaks?.get(playerId);
  if (!s || s.current < 2) return "";
  return `<span class="streak-chip" title="Shown up ${s.current} quizzes running">🔥${s.current}</span>`;
}

/* Chips for a ranking row. */
export function badgeChips(season, playerId, max = 3) {
  return (season.byPlayer.get(playerId) || [])
    .slice(0, max)
    .map((b) => `<span class="badge-chip" title="${esc(b.name)} - ${esc(b.detail)}">${b.abbr}</span>`)
    .join("");
}

/* ============================================================
   THE RAIL
   ============================================================ */
export function renderSeasonRail(db, season) {
  renderHalls(season);
  renderBadgeCase(season);
  renderHowler(db, season.howlers);
}

// The spoon is just last place in the current ranking, so app.js drives
// it from renderBoard() - that way it tracks the Total/Average toggle
// instead of being stuck on whoever the standings loaded sorted by.
export function renderSpoon(ranked, key = "total_points") {
  const el = $("spoon");
  if (!el) return;

  const played = ranked.filter((r) => r.weeks_played > 0);
  if (played.length < 4) { el.hidden = true; return; }

  const last = played[played.length - 1];

  if (last.player_id !== spoonHolderId) {
    spoonHolderId = last.player_id;
    spoonRoast = randomRoast();
  }

  const quizzes = `${last.weeks_played} ${last.weeks_played === 1 ? "quiz" : "quizzes"}`;
  const foot = key === "avg_points"
    ? `${fmt(last.avg_points, 2)} avg · ${quizzes}`
    : `${fmt(last.total_points)} points · ${quizzes}`;

  el.hidden = false;
  el.innerHTML =
    `<span class="spoon-tab">🥄 Wooden Spoon</span>` +
    `<p class="spoon-line"><b>${esc(last.display_name)}</b> ${esc(spoonRoast)}</p>` +
    `<span class="spoon-foot">${foot}</span>`;
}

function renderHalls(season) {
  const fame = season.records.filter((r) => r.hall === "fame");
  const shame = season.records.filter((r) => r.hall === "shame");

  if (fame.length) {
    $("fame-panel").hidden = false;
    $("hall-fame").innerHTML = fame.map(hallRow).join("");
  }

  const shameRows = shame.map(hallRow);

  // the reigning howler tops the wall of shame once votes exist
  const champ = season.howlers.find((h) => Number(h.votes) > 0);
  if (champ) {
    shameRows.push(`
      <li>
        <span class="hall-record">Worst answer (as voted)</span>
        <span class="hall-holder">${esc(champ.display_name)}</span>
        <span class="hall-value">${champ.votes} ${Number(champ.votes) === 1 ? "vote" : "votes"}</span>
        <span class="hall-note">"${esc(champ.answer_raw)}"</span>
      </li>`);
  }

  if (shameRows.length) {
    $("shame-panel").hidden = false;
    $("hall-shame").innerHTML = shameRows.join("");
  }
}

function hallRow(r) {
  return `
    <li>
      <span class="hall-record">${esc(r.record_name)}</span>
      <span class="hall-holder">${esc(r.display_name)}</span>
      <span class="hall-value">${esc(r.value)}</span>
    </li>`;
}

function renderBadgeCase(season) {
  if (!season.groups.length) return;
  $("badge-panel").hidden = false;
  $("badge-case").innerHTML = season.groups.map((g) => `
    <li>
      <span class="badge-chip" aria-hidden="true">${g.abbr}</span>
      <span class="badge-case-text">
        <span class="badge-case-name">${esc(g.name)}</span>
        <span class="badge-case-holders">${g.holders.map((h) => `${esc(h.name)} (${esc(h.detail)})`).join(" · ")}</span>
      </span>
    </li>`).join("");
}

/* ============================================================
   HOWLER BALLOT
   ============================================================ */
function renderHowler(db, howlers) {
  if (!howlers.length) return;
  const block = $("howler-block");
  block.hidden = false;

  $("howler-list").innerHTML = howlers.map((h) => `
    <li>
      <div class="howler-card ${h.mine ? "is-my-vote" : ""}">
        <p class="howler-quote">"${esc(h.answer_raw)}"
          <span class="howler-meta">${esc(h.display_name)} · asked: ${esc(h.prompt)}</span>
        </p>
        <div class="howler-vote">
          <span class="howler-count">${h.votes}</span>
          <button type="button" class="btn btn-small" data-nom="${h.nomination_id}"
                  aria-pressed="${h.mine}">${h.mine ? "Your vote" : "Vote"}</button>
        </div>
      </div>
    </li>`).join("");

  $("howler-list").onclick = async (e) => {
    const btn = e.target.closest("button[data-nom]");
    if (!btn) return;
    const err = $("howler-error");
    err.hidden = true;

    const { error } = await db.rpc("vote_howler", { p_nomination_id: btn.dataset.nom });
    if (error) {
      err.textContent = error.message;
      err.hidden = false;
      return;
    }
    const { data } = await db.rpc("howler_board");
    renderHowler(db, data || []);
  };
}

const fmt = (n, digits = 1) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(digits);
