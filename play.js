import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { mediaRendererMarkup } from "./media-utils.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;
let channel = null;
let pollTimer = null;
let findTimer = null;

let questions = [];      // rows from live_state(), one per open question
let submitted = false;
let weekStatus = null;
let currentIndex = 0;    // which question is being browsed right now
let lastBrowseSig = null; // skip re-rendering the browse view when nothing actually changed,
                           // so a poll cycle never wipes out a half-typed answer

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
      .eq("is_active", true)
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

  const setHosting = (hosting) => {
    if (hostLink) hostLink.hidden = !hosting;
    if (presentLink) presentLink.hidden = !hosting;
  };

  if (isAdmin) return setHosting(true);
  if (!meId) return setHosting(false);

  const { data } = await db
    .from("weeks")
    .select("id")
    .eq("host_id", meId)
    .neq("status", "closed")
    .limit(1);
  setHosting(!!(data && data.length));
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

  const rows = (data || []).map((row) => ({ ...row, media: row.media || [] }));
  const first = rows[0];
  if (!first) return;

  weekStatus = first.week_status;
  submitted = first.submitted;
  questions = first.question_id ? rows : [];

  if (currentIndex >= questions.length) currentIndex = Math.max(0, questions.length - 1);

  render();

  if (weekStatus === "closed" && !submitted && questions.length === 0) return; // nothing to stand for
  refreshStandings();

  if (weekStatus === "closed" && submitted) stopLoop(); // final result is in, nothing left to watch for
}

function render() {
  ["waiting-block", "browse-block", "results-block", "over-block"].forEach((id) => { $(id).hidden = true; });
  $("standings-panel").hidden = true;

  if (weekStatus === "closed" && !submitted) {
    $("over-block").hidden = false;
    return;
  }

  if (submitted) {
    $("results-block").hidden = false;
    $("standings-panel").hidden = false;
    renderResults();
    return;
  }

  if (questions.length === 0) {
    $("waiting-block").hidden = false;
    $("waiting-message").textContent = "Waiting for the host to open the first question…";
    $("standings-panel").hidden = false;
    return;
  }

  $("browse-block").hidden = false;
  $("standings-panel").hidden = false;

  const sig = browseSig();
  if (sig !== lastBrowseSig) {
    lastBrowseSig = sig;
    renderBrowse();
  }
}

function browseSig() {
  return `${currentIndex}|${questions.map((q) => `${q.question_id}:${q.my_answer || ""}`).join(",")}`;
}

/* ============================================================
   BROWSING AND ANSWERING
   ============================================================ */
function renderBrowse() {
  const q = questions[currentIndex];

  $("play-progress").textContent = `Question ${q.q_number} of ${q.total_questions}`;
  $("play-prev").disabled = currentIndex === 0;
  $("play-next").disabled = currentIndex === questions.length - 1;

  $("play-prompt").textContent = q.prompt;
  $("play-error").hidden = true;
  $("play-media").innerHTML = mediaRendererMarkup(q.media || []);
  $("play-media").hidden = !(q.media || []).length;

  const mc = $("mc-options");
  const form = $("text-answer-form");

  if (q.q_type === "mc") {
    mc.hidden = false;
    form.hidden = true;
    mc.innerHTML = (q.options || []).map((o) => `
      <button type="button" class="poll-card ${o.key === q.my_answer ? "is-mine" : ""}" data-key="${esc(o.key)}">
        <span class="poll-card-topic">${esc(o.text)}</span>
      </button>`).join("");
  } else {
    mc.hidden = true;
    form.hidden = false;
    $("text-answer-input").value = q.my_answer || "";
  }

  $("answer-status").textContent = q.my_answer
    ? "You've answered this one — change it any time before you submit."
    : "Not answered yet.";

  const answeredCount = questions.filter((x) => x.my_answer).length;
  $("answered-count").textContent = `${answeredCount} of ${questions.length} answered so far`;
}

$("play-prev").addEventListener("click", () => {
  if (currentIndex > 0) { currentIndex--; forceRenderBrowse(); }
});
$("play-next").addEventListener("click", () => {
  if (currentIndex < questions.length - 1) { currentIndex++; forceRenderBrowse(); }
});

function forceRenderBrowse() {
  lastBrowseSig = browseSig();
  renderBrowse();
}

$("mc-options").addEventListener("click", (e) => {
  const btn = e.target.closest(".poll-card");
  if (!btn) return;
  saveAnswer(btn.dataset.key);
});

$("text-answer-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const val = $("text-answer-input").value.trim();
  if (!val) return;
  saveAnswer(val);
});

async function saveAnswer(answer) {
  const q = questions[currentIndex];
  const err = $("play-error");
  err.hidden = true;

  const { error } = await db.rpc("submit_answer", { p_question_id: q.question_id, p_answer: answer });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  q.my_answer = answer;
  forceRenderBrowse();
}

/* ============================================================
   FINAL SUBMISSION
   ============================================================ */
$("submit-final-btn").addEventListener("click", async () => {
  const unanswered = questions.length - questions.filter((x) => x.my_answer).length;
  const warning = unanswered > 0
    ? `You still have ${unanswered} unanswered. Submit anyway? You can't change any answer after this.`
    : "Submit your final answers? You can't change any answer after this.";
  if (!confirm(warning)) return;

  const err = $("play-error");
  err.hidden = true;

  const { error } = await db.rpc("submit_final_answers", { p_week_id: currentWeek.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await refreshState();
});

function renderResults() {
  const total = questions.reduce((sum, q) => sum + (Number(q.my_points) || 0), 0);
  $("results-total").textContent = `${fmtPoints(total)} ${Number(total) === 1 ? "point" : "points"}`;

  $("results-list").innerHTML = questions.map((q) => {
    const mine = q.q_type === "mc"
      ? (q.options || []).find((o) => o.key === q.my_answer)?.text || (q.my_answer ? q.my_answer : null)
      : q.my_answer;
    const correct = q.q_type === "mc"
      ? (q.options || []).find((o) => o.key === q.correct_key)?.text || q.correct_key
      : q.correct_text;
    const verdict = q.my_answer ? (q.my_verdict || "wrong") : "wrong";
    const verdictLabel = !q.my_answer ? "Didn't answer" : verdict === "correct" ? "Full marks" : verdict === "partial" ? "Half marks" : "No marks";

    return `
      <li class="results-item is-${verdict}">
        <p class="results-prompt">Q${q.q_number}. ${esc(q.prompt)}</p>
        <p class="results-mine">Your answer: ${mine ? esc(mine) : "—"}</p>
        <p class="results-correct">Correct answer: ${esc(correct)}</p>
        <p class="results-verdict">${verdictLabel} — ${fmtPoints(q.my_points || 0)} pts</p>
      </li>`;
  }).join("");
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
