import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;      // full row for the week being managed
let ballot = [];             // poll_options for currentWeek
let results = null;          // poll_results, only fetched while polling

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return locked("Sign in on the leaderboard first, then come back here.");

    const { data: me, error } = await db
      .from("players")
      .select("id, display_name, is_admin")
      .eq("auth_id", session.user.id)
      .maybeSingle();

    if (error || !me) return locked("Sign in on the leaderboard first, then come back here.");
    myPlayer = me;

    const adminLink = $("nav-admin");
    if (adminLink) adminLink.hidden = !me.is_admin;

    await findWeeks();
  } catch (err) {
    locked("Could not reach the database. Check config.js.");
  }
})();

function locked(message) {
  $("locked-message").textContent = message;
  $("tagline").textContent = "Host";
  show("view-locked");
}

function show(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
}

/* ============================================================
   WHICH WEEK
   ============================================================ */
async function findWeeks() {
  const query = db
    .from("weeks")
    .select("id, quiz_date, title, status")
    .neq("status", "closed")
    .order("quiz_date");

  const { data, error } = myPlayer.is_admin
    ? await query
    : await query.eq("host_id", myPlayer.id);

  if (error) return locked("Could not load quiz nights. Check the database setup.");

  if (!data || data.length === 0) {
    return locked(myPlayer.is_admin
      ? "No quiz nights need hosting right now. Create one from the admin page."
      : "You are not hosting a quiz night at the moment.");
  }

  if (myPlayer.is_admin && data.length > 1) {
    $("week-switcher-field").hidden = false;
    $("week-switcher").innerHTML = data.map((w) =>
      `<option value="${w.id}">${fmtDate(w.quiz_date)}${w.title ? " — " + esc(w.title) : ""}</option>`).join("");
  }

  show("view-host");
  $("tagline").textContent = "Your quiz night";
  await loadWeek(data[0].id);
}

$("week-switcher").addEventListener("change", (e) => loadWeek(e.target.value));

/* ============================================================
   THE WEEK
   ============================================================ */
async function loadWeek(weekId) {
  const err = $("host-error");
  err.hidden = true;

  const { data: week, error } = await db
    .from("weeks")
    .select("id, quiz_date, title, status, topic, host_id")
    .eq("id", weekId)
    .single();

  if (error || !week) {
    err.textContent = "Could not load that quiz night.";
    err.hidden = false;
    return;
  }

  currentWeek = week;
  if ($("week-switcher-field").hidden === false) $("week-switcher").value = weekId;

  $("week-heading").textContent = `Hosting ${fmtDate(week.quiz_date)}`;
  $("week-meta").innerHTML = `${week.title ? esc(week.title) + " &middot; " : ""}<span class="badge badge-status status-${week.status}">${week.status}</span>`;

  $("winner-panel").hidden = !week.topic;
  $("winner-tie-note").hidden = true;
  if (week.topic) $("winner-topic").textContent = week.topic;

  const canEditBallot = week.status === "draft" || week.status === "polling";
  $("custom-topic-panel").hidden = !canEditBallot;

  results = week.status === "polling" ? await fetchResults(weekId) : null;

  await Promise.all([loadSuggestions(), loadBallot()]);
  renderBallotActions();
}

async function fetchResults(weekId) {
  const { data } = await db.rpc("poll_results", { p_week_id: weekId });
  return data || [];
}

/* ============================================================
   SUGGESTION POOL
   ============================================================ */
async function loadSuggestions() {
  const { data, error } = await db
    .from("topic_suggestions")
    .select("id, topic, used, players(display_name)")
    .order("created_at", { ascending: false });

  const canEditBallot = currentWeek.status === "draft" || currentWeek.status === "polling";

  if (error) {
    $("host-suggestion-list").innerHTML = `<li class="table-empty">Could not load suggestions.</li>`;
    return;
  }

  $("host-suggestion-list").innerHTML = data.map((s) => `
    <li class="${s.used ? "is-used" : ""}">
      <div class="suggestion-text">
        <span class="suggestion-topic">${esc(s.topic)}</span>
        <span class="suggestion-by">— ${esc(s.players?.display_name || "someone")}</span>
      </div>
      ${s.used
        ? `<span class="badge badge-left">On a ballot</span>`
        : canEditBallot
          ? `<button class="btn btn-small" data-action="add-suggestion" data-id="${s.id}">Add to ballot</button>`
          : ""}
    </li>`).join("") || `<li class="table-empty">No suggestions yet.</li>`;
}

$("host-suggestion-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='add-suggestion']");
  if (!btn) return;

  const err = $("host-error");
  err.hidden = true;

  const { error } = await db.rpc("host_add_poll_option", {
    p_week_id: currentWeek.id,
    p_suggestion_id: btn.dataset.id,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await Promise.all([loadSuggestions(), loadBallot()]);
  renderBallotActions();
});

$("custom-topic-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("custom-topic-input");
  const err = $("host-error");
  err.hidden = true;

  const topic = input.value.trim();
  if (!topic) return;

  const { error } = await db.rpc("host_add_custom_option", {
    p_week_id: currentWeek.id,
    p_topic: topic,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  input.value = "";
  await loadBallot();
  renderBallotActions();
});

/* ============================================================
   BALLOT
   ============================================================ */
async function loadBallot() {
  const { data, error } = await db
    .from("poll_options")
    .select("id, topic, sort_order")
    .eq("week_id", currentWeek.id)
    .order("sort_order");

  if (error) {
    $("ballot-list").innerHTML = `<li class="table-empty">Could not load the ballot.</li>`;
    ballot = [];
    return;
  }

  ballot = data || [];
  const canEditBallot = currentWeek.status === "draft" || currentWeek.status === "polling";

  $("ballot-list").innerHTML = ballot.map((o) => {
    const tally = results?.find((r) => r.option_id === o.id);
    return `
      <li>
        <div class="suggestion-text">
          <span class="suggestion-topic">${esc(o.topic)}</span>
          ${tally ? `<span class="suggestion-by">${tally.votes} ${Number(tally.votes) === 1 ? "vote" : "votes"}</span>` : ""}
        </div>
        ${canEditBallot ? `<button class="btn btn-small" data-action="remove-option" data-id="${o.id}">Remove</button>` : ""}
      </li>`;
  }).join("") || `<li class="table-empty">Nothing on the ballot yet.</li>`;
}

$("ballot-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='remove-option']");
  if (!btn) return;

  const err = $("host-error");
  err.hidden = true;

  const { error } = await db.rpc("host_remove_poll_option", { p_option_id: btn.dataset.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await Promise.all([loadSuggestions(), loadBallot()]);
  renderBallotActions();
});

/* ============================================================
   OPEN / CLOSE THE POLL
   ============================================================ */
function renderBallotActions() {
  const openBtn = $("open-poll-btn");
  const closeBtn = $("close-poll-btn");
  const hint = $("ballot-hint");
  hint.hidden = true;

  if (currentWeek.status === "draft") {
    openBtn.hidden = false;
    closeBtn.hidden = true;
    if (ballot.length < 2) {
      openBtn.disabled = true;
      hint.textContent = "Add at least two topics to the ballot before you can open the poll.";
      hint.hidden = false;
    } else {
      openBtn.disabled = false;
    }
  } else if (currentWeek.status === "polling") {
    openBtn.hidden = true;
    closeBtn.hidden = false;
    const totalVotes = (results || []).reduce((sum, r) => sum + Number(r.votes), 0);
    if (totalVotes === 0) {
      hint.textContent = "Nobody has voted yet.";
      hint.hidden = false;
    }
  } else {
    openBtn.hidden = true;
    closeBtn.hidden = true;
    if (currentWeek.status !== "closed") {
      hint.textContent = "The ballot is closed for this night.";
      hint.hidden = false;
    }
  }
}

$("open-poll-btn").addEventListener("click", async () => {
  const err = $("host-error");
  err.hidden = true;

  const { error } = await db.rpc("host_open_poll", { p_week_id: currentWeek.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadWeek(currentWeek.id);
});

$("close-poll-btn").addEventListener("click", async () => {
  const err = $("host-error");
  err.hidden = true;

  const { data, error } = await db.rpc("host_close_poll", { p_week_id: currentWeek.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  await loadWeek(currentWeek.id);
  if (row?.tied) $("winner-tie-note").hidden = false;
});

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });
}
