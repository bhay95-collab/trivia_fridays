import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.8/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from "./config.js";
import { startBoot, countUp } from "./fx.js";
import { fetchSeason, badgeChips, streakChip, renderSeasonRail, renderSpoon } from "./season.js";
import { rivalryLine, headToHead } from "./needle.js";
import { loadMe, clearMe, setupNav } from "./auth.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const emailFor = (slug) => `${slug}@${LOGIN_DOMAIN}`;

let roster = [];
let mySlug = null;
let myPlayerId = null;

// kept at module scope so the profile modal can read the board it was
// opened from without another round trip
let boardRanked = [];
let boardSeason = null; // set to the loaded season in showBoard; falls back to EMPTY_SEASON
let boardMeId = null;
let boardRows = []; // raw leaderboard rows, unsorted, so re-sorting doesn't need a round trip
let boardMeSlug = null;
let boardMeName = "Signed in"; // display name for the player HUD
let boardSortBy = "total"; // "total" | "average"

/* ============================================================
   BOOT
   ============================================================ */
boot();

async function boot() {
  // The cabinet is powering on (the #boot overlay is opaque from first
  // paint); keep it up until whichever view we land on is ready.
  const booting = startBoot($("boot"));
  const { data: { session } } = await db.auth.getSession();
  if (session) return showBoard(session, booting);
  await loadRoster();
  show("view-auth");
  $("tagline").textContent = "Sign in to see where you sit.";
  booting.reveal();
}

// The shape season.js hands back, used to render the standings
// immediately before the (heavier) season RPCs have returned.
const EMPTY_SEASON = { byPlayer: new Map(), groups: [], records: [], howlers: [], streaks: new Map() };

// If the browser restores this page from back/forward cache after
// signing in elsewhere, re-check instead of showing a stale sign-in
// form for someone who's actually already signed in.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) boot();
});

function show(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
}

/* ============================================================
   SIGN IN / FIRST-TIME PIN SETUP
   ============================================================ */
async function loadRoster() {
  const { data, error } = await db
    .from("players")
    .select("slug, display_name, auth_id")
    .eq("is_active", true)
    .order("display_name");

  if (error) {
    $("auth-error").textContent = "Could not reach the database. Check config.js.";
    $("auth-error").hidden = false;
    return;
  }

  roster = data;
  const sel = $("name-select");
  for (const p of roster) {
    const o = document.createElement("option");
    o.value = p.slug;
    o.textContent = p.display_name;
    sel.appendChild(o);
  }
}

$("name-select").addEventListener("change", (e) => {
  mySlug = e.target.value;
  const p = roster.find((r) => r.slug === mySlug);
  $("auth-error").hidden = true;

  if (!p) { $("pin-block").hidden = true; return; }

  const firstTime = !p.auth_id;
  $("pin-block").hidden = false;
  $("pin2-field").hidden = !firstTime;
  $("pin-hint").textContent = firstTime
    ? "First time here. Choose a 6-digit PIN you will remember."
    : "Welcome back. Enter your PIN.";
  $("auth-go").textContent = firstTime ? "Create my PIN" : "Let me in";
  $("pin").value = ""; $("pin2").value = "";
  $("pin").focus();
});

$("auth-go").addEventListener("click", signIn);
$("pin").addEventListener("keydown", (e) => e.key === "Enter" && signIn());
$("pin2").addEventListener("keydown", (e) => e.key === "Enter" && signIn());

async function signIn() {
  const err = $("auth-error");
  err.hidden = true;

  const p = roster.find((r) => r.slug === mySlug);
  if (!p) return fail("Pick your name first.");

  const pin = $("pin").value.trim();
  if (!/^\d{6}$/.test(pin)) return fail("PIN must be exactly 6 digits.");

  const firstTime = !p.auth_id;
  if (firstTime && pin !== $("pin2").value.trim()) return fail("The two PINs do not match.");

  $("auth-go").disabled = true;
  $("auth-go").textContent = "Hang on…";

  const creds = { email: emailFor(p.slug), password: pin };
  const { error } = firstTime
    ? await db.auth.signUp(creds)
    : await db.auth.signInWithPassword(creds);

  $("auth-go").disabled = false;
  $("auth-go").textContent = firstTime ? "Create my PIN" : "Let me in";

  if (error) {
    return fail(firstTime
      ? error.message
      : "That PIN does not match. Ask Ben to reset it if you are stuck.");
  }
  showBoard();

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
}

$("sign-out").addEventListener("click", async () => {
  clearMe();
  await db.auth.signOut();
  location.reload();
});

/* ============================================================
   LEADERBOARD
   ============================================================ */
async function showBoard(session, booting) {
  // Called both from boot() (handle passed in) and after a fresh sign-in
  // (start our own power-on for the board coming up).
  booting = booting || startBoot($("boot"));
  show("view-board");
  // The single "Season standings" title lives on the podium stage; the
  // masthead tagline just carries flavour so the label isn't duplicated.
  $("tagline").textContent = "The season so far — live. Climb, or be climbed.";

  // Reuse the session boot() already fetched instead of a second
  // getUser() round trip.
  const user = session?.user ?? (await db.auth.getUser()).data.user;
  const meSlug = user ? user.email.split("@")[0] : null;

  // Fire every independent request at once. The standings come from a
  // single fast view; the season layer is three heavier RPCs, so we
  // don't let it block the board from painting.
  const standingsReq = db
    .from("leaderboard")
    .select("player_id, display_name, total_points, weeks_played, best_week, avg_points")
    .order("total_points", { ascending: false })
    .order("display_name");
  const meReq = user
    ? loadMe(db, { user })
    : Promise.resolve({ data: null });
  // fails soft: a missing RPC hides its panel, never breaks the board
  const seasonReq = fetchSeason(db).catch((e) => {
    console.error("Season stats unavailable:", e);
    return EMPTY_SEASON;
  });

  const { data: rows, error } = await standingsReq;
  if (error) {
    $("rankings").innerHTML = `<li class="name">Scoreboard is not loading. Check the database setup.</li>`;
    booting.reveal(); // never leave the machine warming up on a dead board
    return;
  }

  const meRow = rows.find((r) => slugify(r.display_name) === meSlug);
  boardMeName = meRow ? meRow.display_name : "Signed in";

  boardRows = rows;
  boardMeSlug = meSlug;
  boardMeId = meRow ? meRow.player_id : null;

  // Paint the standings straight away, before the season RPCs land -
  // badge chips fill in a moment later once the season data arrives.
  renderBoard();

  // Identity: nav visibility and suggestion ownership need my id.
  if (user) {
    const { data: me } = await meReq;
    if (!me) {
      clearMe();
      await db.auth.signOut();
      location.reload();
      return;
    }
    myPlayerId = me.id;
    setupNav(db, me);
  }
  loadSuggestions();

  // Season layer streams in when its heavier queries return, then the
  // rankings re-render with badge chips and the rail fills.
  const season = await seasonReq;
  boardSeason = season;
  renderBoard();
  renderSeasonRail(db, season);

  // The board is fully assembled — power the cabinet on so it lands
  // complete rather than building up in front of the player.
  booting.reveal();
}

/* The player HUD read-out: identity, live rank and quiz credits, all
   from the signed-in player's actual ranked row. Rank tracks the
   Total/Average toggle because it's driven from renderBoard(). */
function renderHud(meRow) {
  const nameEl = $("hud-name");
  if (nameEl) nameEl.textContent = boardMeName;

  const rankEl = $("hud-rank");
  const credEl = $("hud-credits");
  if (meRow && meRow.weeks_played > 0) {
    if (rankEl) rankEl.textContent = ordinal(meRow.rank);
    const q = meRow.weeks_played;
    if (credEl) credEl.textContent = `${q} ${q === 1 ? "quiz" : "quizzes"}`;
  } else {
    if (rankEl) rankEl.textContent = "—";
    if (credEl) credEl.textContent = meRow ? "0 quizzes" : "—";
  }
}

// Deterministic initials for a player's avatar tile — first + last
// initial, so everyone gets a consistent, on-palette portrait.
function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const a = parts[0][0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}
const avatar = (name) => `<span class="avatar" aria-hidden="true">${esc(initials(name))}</span>`;

const SORT_KEYS = { total: "total_points", average: "avg_points" };

document.querySelectorAll(".sort-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.sort === boardSortBy || !boardRows.length) return;
    boardSortBy = btn.dataset.sort;
    document.querySelectorAll(".sort-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    renderBoard();
  });
});

function renderBoard() {
  const key = SORT_KEYS[boardSortBy];
  const ranked = sortRows(boardRows, key);
  boardRanked = ranked;
  const meRow = ranked.find((r) => slugify(r.display_name) === boardMeSlug);

  renderHud(meRow);
  renderPodium(ranked.slice(0, 3), key);
  renderRest(ranked.slice(3), boardMeSlug, boardSeason || EMPTY_SEASON, key);
  renderRivalry(ranked, meRow, key);
  renderSpoon(ranked, key);

  const rule = $("board-rule");
  if (rule) {
    rule.textContent = boardSortBy === "average"
      ? "Ranked on average points per quiz played. Consistency counts."
      : "Ranked on total points across the season. Show up, score up.";
  }
}

/* ============================================================
   TOPIC SUGGESTIONS
   ============================================================ */
async function loadSuggestions() {
  const err = $("suggest-error");
  err.hidden = true;

  const { data, error } = await db
    .from("topic_suggestions")
    .select("id, topic, used, player_id, players(display_name)")
    .order("created_at", { ascending: false });

  if (error) {
    $("suggestion-list").innerHTML = `<li class="table-empty">Could not load suggestions.</li>`;
    return;
  }

  $("suggestion-list").innerHTML = data.map((s) => `
    <li class="${s.used ? "is-used" : ""}">
      <div class="suggestion-text">
        <span class="suggestion-topic">${esc(s.topic)}</span>
        <span class="suggestion-by">— ${esc(s.players?.display_name || "someone")}</span>
        ${s.used ? `<span class="badge badge-left">Used</span>` : ""}
      </div>
      ${s.player_id === myPlayerId ? `<button class="btn btn-small" data-id="${s.id}">Remove</button>` : ""}
    </li>`).join("") || `<li class="table-empty">No suggestions yet. Someone has to go first.</li>`;
}

$("suggest-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("suggest-input");
  const err = $("suggest-error");
  err.hidden = true;

  const topic = input.value.trim();
  if (!topic) return;

  const { error } = await db.rpc("suggest_topic", { p_topic: topic });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  input.value = "";
  await loadSuggestions();
});

$("suggestion-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;

  const err = $("suggest-error");
  err.hidden = true;

  const { error } = await db.rpc("delete_suggestion", { p_suggestion_id: btn.dataset.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadSuggestions();
});

// Sorts by the chosen metric (descending, name as tiebreaker) and ranks
// the result. Equal values share a rank: 1,2,2,4 not 1,2,3,4.
function sortRows(rows, key) {
  const sorted = [...rows].sort((a, b) =>
    b[key] - a[key] || a.display_name.localeCompare(b.display_name));
  let rank = 0, prev = null;
  return sorted.map((r, i) => {
    if (r[key] !== prev) { rank = i + 1; prev = r[key]; }
    return { ...r, rank };
  });
}

function renderPodium(top, key = "total_points") {
  const digits = key === "avg_points" ? 2 : 1;
  const order = [1, 0, 2]; // 2nd, 1st, 3rd
  $("podium").innerHTML = order.map((i) => {
    const r = top[i];
    if (!r) return `<div></div>`;
    // the reigning leader (rank 1, when they've actually played) wears the crown
    const crown = i === 0 && r.weeks_played > 0 ? `<span class="crown" title="Reigning champion">👑</span>` : "";
    return `
      <div class="plinth p${i + 1}">
        <span class="medal">${["1st", "2nd", "3rd"][i]}</span>
        ${avatar(r.display_name)}
        <span class="who">${crown}<button type="button" class="who-link" data-player-id="${r.player_id}">${esc(r.display_name)}</button></span>
        <span class="pts" data-pts="${r[key]}">${fmt(r[key], digits)}</span>
        <span class="sub">${r.weeks_played} quizzes</span>
      </div>`;
  }).join("");

  // roll each podium total up from zero on arrival, like a score reel
  $("podium").querySelectorAll(".pts").forEach((el) =>
    countUp(el, el.dataset.pts, { format: (n) => fmt(n, digits) }));
}

/* ============================================================
   PLAYER PROFILE MODAL — built entirely from the board and season
   data already in hand (public aggregates only; individual answers
   stay private), so it needs no extra round trip and fails soft.
   ============================================================ */
document.addEventListener("click", (e) => {
  const link = e.target.closest(".who-link[data-player-id]");
  if (link) { openProfile(link.dataset.playerId); return; }
  if (e.target.closest("#profile-close") || e.target.id === "profile-overlay") closeProfile();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProfile(); });

function openProfile(playerId) {
  const season = boardSeason || EMPTY_SEASON;
  const row = boardRanked.find((r) => r.player_id === playerId);
  if (!row) return;

  const meRow = boardMeId ? boardRanked.find((r) => r.player_id === boardMeId) : null;
  const badges = season.byPlayer.get(playerId) || [];
  const streak = season.streaks?.get(playerId);
  const isMe = playerId === boardMeId;

  const stat = (label, value) => `
    <div class="profile-stat">
      <span class="profile-stat-value">${value}</span>
      <span class="profile-stat-label">${label}</span>
    </div>`;

  const badgeShelf = badges.length
    ? `<ul class="profile-badges">${badges.map((b) => `
        <li><span class="badge-chip">${b.abbr}</span>
          <span class="profile-badge-text"><b>${esc(b.name)}</b><span>${esc(b.detail)}</span></span></li>`).join("")}</ul>`
    : `<p class="hint">No badges yet — the season is young.</p>`;

  const h2h = headToHead(meRow, row, SORT_KEYS[boardSortBy]);
  const streakLine = streak && streak.current >= 2
    ? `<p class="profile-streak">🔥 On a ${streak.current}-quiz attendance streak${streak.best > streak.current ? ` (best: ${streak.best})` : ""}.</p>`
    : "";

  $("profile-body").innerHTML = `
    <h2 class="card-title" id="profile-name">${esc(row.display_name)}${isMe ? " (you)" : ""}</h2>
    <div class="profile-stats">
      ${stat("Rank", ordinal(row.rank))}
      ${stat("Points", fmt(row.total_points))}
      ${stat("Quizzes", row.weeks_played)}
      ${stat("Best week", fmt(row.best_week))}
      ${stat("Average", fmt(row.avg_points))}
    </div>
    ${streakLine}
    ${h2h ? `<p class="profile-h2h">${esc(h2h)}</p>` : ""}
    <h3 class="profile-subhead">Badge shelf</h3>
    ${badgeShelf}`;

  const overlay = $("profile-overlay");
  overlay.hidden = false;
  $("profile-close").focus();
}

function closeProfile() {
  const overlay = $("profile-overlay");
  if (overlay) overlay.hidden = true;
}

// Hold the needle line while the board re-renders (sort toggle, season
// layer streaming in) so the rotating quip doesn't reshuffle under the
// player — same idea as the held spoon roast. It only rerolls when the
// matchup actually changes: who's being needled, the gap, or the metric.
let rivalrySig = null;
let rivalryText = "";

function renderRivalry(ranked, meRow, key = "total_points") {
  const el = $("rivalry");
  if (!el) return;

  if (!meRow) { rivalrySig = null; rivalryText = ""; el.textContent = ""; el.hidden = true; return; }

  const i = ranked.findIndex((r) => r.player_id === meRow.player_id);
  const rival = ranked[i - 1] || ranked[i + 1] || null;
  const gap = rival ? Number(rival[key]) - Number(meRow[key]) : null;
  const sig = `${meRow.player_id}|${rival?.player_id || ""}|${gap}|${key}`;

  if (sig !== rivalrySig) {
    rivalrySig = sig;
    rivalryText = rivalryLine(ranked, meRow.player_id, key);
  }

  el.textContent = rivalryText;
  el.hidden = !rivalryText;
}

function renderRest(rows, meSlug, season, key = "total_points") {
  const digits = key === "avg_points" ? 2 : 1;
  $("rankings").innerHTML = rows.map((r) => `
    <li class="${slugify(r.display_name) === meSlug ? "is-me" : ""}">
      <span class="rank">${ordinal(r.rank)}</span>
      ${avatar(r.display_name)}
      <span class="name"><button type="button" class="who-link" data-player-id="${r.player_id}">${esc(r.display_name)}</button>${badgeChips(season, r.player_id)}${streakChip(season, r.player_id)}</span>
      <span class="played">${r.weeks_played} quizzes</span>
      <span class="score">${fmt(r[key], digits)}</span>
    </li>`).join("");
}

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const fmt = (n, digits = 1) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(digits);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = (n) => n.normalize("NFKD").replace(/[^A-Za-z ]/g, "")
  .trim().toLowerCase().split(/\s+/).join(".");

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
