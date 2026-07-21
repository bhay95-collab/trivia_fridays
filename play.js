import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;
let channel = null;
let pollTimer = null;
let findTimer = null;
let lastSig = null;
let currentQuestionId = null;

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

    await initNav(me.id, me.is_admin);
    await findAndEnter();
  } catch (err) {
    locked("Could not reach the database. Check config.js.");
  }
})();

function locked(message) {
  stopLoop();
  $("locked-message").textContent = message;
  $("tagline").textContent = "Play";
  show("view-locked");
}

function show(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
}

/* ============================================================
   NAV
   ============================================================ */
async function initNav(meId, isAdmin) {
  const adminLink = $("nav-admin");
  if (adminLink) adminLink.hidden = !isAdmin;

  const hostLink = $("nav-host");
  const presentLink = $("nav-present");
  if (isAdmin) {
    if (hostLink) hostLink.hidden = false;
    if (presentLink) presentLink.hidden = false;
    return;
  }

  const { data } = await db
    .from("weeks")
    .select("id")
    .eq("host_id", meId)
    .neq("status", "closed")
    .limit(1);
  const hosting = !!(data && data.length);
  if (hostLink) hostLink.hidden = !hosting;
  if (presentLink) presentLink.hidden = !hosting;
}

/* ============================================================
   FINDING THE LIVE WEEK
   ============================================================ */
async function findAndEnter() {
  const { data, error } = await db
    .from("weeks")
    .select("id, quiz_date, title, status, host_id")
    .eq("status", "live")
    .order("quiz_date", { ascending: false })
    .limit(1);

  const week = !error && data && data[0];

  if (!week) {
    locked("No quiz is live right now. This page updates the moment the host starts one.");
    findTimer = setTimeout(findAndEnter, 4000);
    return;
  }

  if (week.host_id === myPlayer.id) {
    return locked("You're hosting this one — head to the Present screen.");
  }

  currentWeek = week;
  show("view-play");
  $("tagline").textContent = week.title || "Live now";

  await refreshState();

  channel = db.channel(`live-${week.id}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "questions", filter: `week_id=eq.${week.id}` },
      refreshState)
    .subscribe();

  pollTimer = setInterval(refreshState, 5000);
}

function stopLoop() {
  if (pollTimer) clearInterval(pollTimer);
  if (findTimer) clearTimeout(findTimer);
  if (channel) db.removeChannel(channel);
  pollTimer = null;
  findTimer = null;
  channel = null;
}

/* ============================================================
   LIVE STATE
   ============================================================ */
async function refreshState() {
  if (!currentWeek) return;

  const { data, error } = await db.rpc("live_state", { p_week_id: currentWeek.id });
  if (error) return; // transient - the next poll or realtime event will retry

  const state = Array.isArray(data) ? data[0] : data;
  if (!state) return;

  currentQuestionId = state.question_id;

  if (state.week_status === "closed") {
    stopLoop();
  }

  const sig = `${state.question_id}|${state.q_status}|${state.already_answered}`;
  if (sig !== lastSig) {
    lastSig = sig;
    renderPlayArea(state);
  }

  const showStandings = state.week_status !== "closed" && (!state.question_id || state.q_status === "locked");
  if (showStandings) refreshStandings();
}

function renderPlayArea(state) {
  ["waiting-block", "question-block", "submitted-block", "reveal-block", "over-block"].forEach((id) => {
    $(id).hidden = true;
  });
  $("standings-panel").hidden = true;

  if (state.week_status === "closed") {
    $("over-block").hidden = false;
    return;
  }

  if (!state.question_id) {
    $("waiting-block").hidden = false;
    $("waiting-message").textContent = state.total_questions
      ? "Waiting for the next question…"
      : "Waiting for the host to start…";
    $("standings-panel").hidden = false;
    return;
  }

  if (state.q_status === "open" && !state.already_answered) {
    $("question-block").hidden = false;
    $("play-progress").textContent = `Question ${state.q_number} of ${state.total_questions}`;
    $("play-prompt").textContent = state.prompt;
    $("play-error").hidden = true;
    renderAnswerInput(state);
    return;
  }

  if (state.q_status === "open" && state.already_answered) {
    $("submitted-block").hidden = false;
    return;
  }

  if (state.q_status === "locked") {
    $("reveal-block").hidden = false;
    $("standings-panel").hidden = false;
    $("reveal-progress").textContent = `Question ${state.q_number} of ${state.total_questions}`;
    $("reveal-prompt").textContent = state.prompt;
    renderReveal(state);
  }
}

function renderAnswerInput(state) {
  const mc = $("mc-options");
  const form = $("text-answer-form");

  if (state.q_type === "mc") {
    mc.hidden = false;
    form.hidden = true;
    mc.innerHTML = (state.options || []).map((o) => `
      <button type="button" class="poll-card" data-key="${esc(o.key)}">
        <span class="poll-card-topic">${esc(o.text)}</span>
      </button>`).join("");
  } else {
    mc.hidden = true;
    form.hidden = false;
    $("text-answer-input").value = "";
  }
}

function renderReveal(state) {
  let answerText;
  if (state.q_type === "mc") {
    const correctOpt = (state.options || []).find((o) => o.key === state.correct_key);
    answerText = correctOpt ? `${state.correct_key}. ${correctOpt.text}` : state.correct_key || "—";
  } else {
    answerText = state.correct_text || "—";
  }
  $("reveal-answer").textContent = `Correct answer: ${answerText}`;

  const v = $("reveal-verdict");
  if (!state.already_answered) {
    v.textContent = "You didn't answer this one.";
    v.className = "reveal-verdict is-wrong";
  } else if (state.my_verdict === "correct") {
    v.textContent = `Full marks — ${fmtPoints(state.my_points)} pts`;
    v.className = "reveal-verdict is-correct";
  } else if (state.my_verdict === "partial") {
    v.textContent = `Half marks — ${fmtPoints(state.my_points)} pts`;
    v.className = "reveal-verdict is-partial";
  } else {
    v.textContent = "No marks this time.";
    v.className = "reveal-verdict is-wrong";
  }
}

/* ============================================================
   ANSWERING
   ============================================================ */
$("mc-options").addEventListener("click", (e) => {
  const btn = e.target.closest(".poll-card");
  if (!btn) return;
  submitAnswer(btn.dataset.key);
});

$("text-answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const val = $("text-answer-input").value.trim();
  if (!val) return;
  submitAnswer(val);
});

async function submitAnswer(answer) {
  const err = $("play-error");
  err.hidden = true;

  const { error } = await db.rpc("submit_answer", { p_question_id: currentQuestionId, p_answer: answer });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  lastSig = null; // force the next refresh to re-render even if the signature looks unchanged
  await refreshState();
}

/* ============================================================
   STANDINGS
   ============================================================ */
async function refreshStandings() {
  const { data, error } = await db.rpc("live_standings", { p_week_id: currentWeek.id });
  if (error) return;

  $("play-standings").innerHTML = (data || []).map((r) => `
    <li class="${r.player_id === myPlayer.id ? "is-me" : ""}">
      <span class="rank">${ordinal(r.standing)}</span>
      <span class="name">${esc(r.display_name)}</span>
      <span class="score">${fmtPoints(r.total_points)}</span>
    </li>`).join("") || `<li class="name">No scores yet.</li>`;
}

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const fmtPoints = (n) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(1);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
