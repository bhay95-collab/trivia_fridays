import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;   // { id, quiz_date, title, status, host_id, topic }
let quiz = [];             // host_quiz() rows for currentWeek
let finalStandings = [];   // captured once, right after close_week()
let channel = null;
let liveTicker = null;
let fallbackTimer = null;

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
  stopAllTimers();
  $("locked-message").textContent = message;
  $("tagline").textContent = "Present";
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
    .in("status", ["building", "live"])
    .order("quiz_date");

  const { data, error } = myPlayer.is_admin
    ? await query
    : await query.eq("host_id", myPlayer.id);

  if (error) return locked("Could not load quiz nights. Check the database setup.");

  if (!data || data.length === 0) {
    return locked(myPlayer.is_admin
      ? "No quiz night is ready to present right now."
      : "You don't have a quiz night ready to present.");
  }

  if (myPlayer.is_admin && data.length > 1) {
    $("week-switcher-field").hidden = false;
    $("week-switcher").innerHTML = data.map((w) =>
      `<option value="${w.id}">${fmtDate(w.quiz_date)}${w.title ? " — " + esc(w.title) : ""} (${w.status})</option>`).join("");
  }

  const hostLink = $("nav-host");
  if (hostLink) hostLink.hidden = false;

  show("view-present");
  await loadWeek(data[0].id);
}

$("week-switcher").addEventListener("change", (e) => loadWeek(e.target.value));

/* ============================================================
   THE WEEK
   ============================================================ */
async function loadWeek(weekId) {
  stopAllTimers();

  const { data: week, error } = await db
    .from("weeks")
    .select("id, quiz_date, title, status, host_id, topic")
    .eq("id", weekId)
    .single();

  if (error || !week) return locked("Could not load that quiz night.");

  currentWeek = week;
  if ($("week-switcher-field").hidden === false) $("week-switcher").value = weekId;

  $("ready-panel").hidden = true;
  $("live-panel").hidden = true;
  $("podium-panel").hidden = true;

  if (week.status === "building") {
    $("tagline").textContent = "Ready to start";
    await showReadyPanel(week);
  } else if (week.status === "live") {
    $("tagline").textContent = week.title || "Live now";
    await enterLive();
  }
}

async function showReadyPanel(week) {
  const { data } = await db.rpc("host_quiz", { p_week_id: week.id });
  quiz = data || [];

  $("ready-heading").textContent = `Ready for ${fmtDate(week.quiz_date)}${week.title ? " — " + week.title : ""}`;
  const totalPoints = quiz.reduce((sum, q) => sum + Number(q.points), 0);
  $("ready-meta").textContent = quiz.length
    ? `${quiz.length} ${quiz.length === 1 ? "question" : "questions"} · ${fmtPoints(totalPoints)} points`
    : "No questions yet — add some on the Host page first.";
  $("ready-error").hidden = true;
  $("ready-panel").hidden = false;
}

$("start-week-btn").addEventListener("click", async () => {
  const err = $("ready-error");
  err.hidden = true;

  const { error } = await db.rpc("start_week", { p_week_id: currentWeek.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  currentWeek.status = "live";
  $("ready-panel").hidden = true;
  $("tagline").textContent = currentWeek.title || "Live now";
  await enterLive();
});

function stopAllTimers() {
  if (liveTicker) clearInterval(liveTicker);
  if (fallbackTimer) clearInterval(fallbackTimer);
  if (channel) db.removeChannel(channel);
  liveTicker = null;
  fallbackTimer = null;
  channel = null;
}

/* ============================================================
   LIVE DRIVING SCREEN
   ============================================================ */
async function enterLive() {
  $("live-panel").hidden = false;
  $("podium-panel").hidden = true;

  await reloadQuiz();

  channel = db.channel(`present-${currentWeek.id}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "questions", filter: `week_id=eq.${currentWeek.id}` },
      reloadQuiz)
    .subscribe();

  liveTicker = setInterval(tick, 2000);
  fallbackTimer = setInterval(reloadQuiz, 5000);
}

async function reloadQuiz() {
  const { data, error } = await db.rpc("host_quiz", { p_week_id: currentWeek.id });
  if (error) return showLiveError(error.message);
  quiz = data || [];
  renderLive();
}

function currentQuestion() {
  const reached = quiz.filter((q) => q.status !== "pending");
  return reached[reached.length - 1] || null;
}

function nextPending() {
  return quiz.find((q) => q.status === "pending") || null;
}

function renderLive() {
  const cur = currentQuestion();
  const next = nextPending();

  $("present-options").hidden = true;
  $("present-reveal").hidden = true;
  $("answer-meter").hidden = true;
  $("lock-btn").hidden = true;
  $("next-btn").hidden = true;
  $("reopen-btn").hidden = true;
  $("override-panel").hidden = true;
  $("live-hint").textContent = "";

  if (!cur) {
    $("present-progress").textContent = `Question 1 of ${quiz.length}`;
    $("present-prompt").textContent = "Ready for the first question.";
    if (next) {
      $("next-btn").hidden = false;
      $("next-btn").textContent = "Open question 1 (Space)";
    }
    return;
  }

  $("present-progress").textContent = `Question ${cur.q_number} of ${quiz.length}`;
  $("present-prompt").textContent = cur.prompt;

  if (cur.q_type === "mc") {
    $("present-options").hidden = false;
    $("present-options").innerHTML = (cur.options || []).map((o) => `
      <div class="present-option" data-key="${esc(o.key)}">
        <span class="present-option-key">${esc(o.key)}</span>
        <span>${esc(o.text)}</span>
      </div>`).join("");
  }

  if (cur.status === "open") {
    $("answer-meter").hidden = false;
    $("answer-meter-fill").style.width = "0%";
    $("answer-meter-label").textContent = "";
    $("lock-btn").hidden = false;
    tick();
  } else if (cur.status === "locked") {
    $("present-reveal").hidden = false;
    $("present-answer").textContent = `Correct answer: ${correctAnswerText(cur)}`;
    markCorrectOption(cur);

    $("reopen-btn").hidden = false;
    if (next) {
      $("next-btn").hidden = false;
      $("next-btn").textContent = `Open question ${next.q_number} (Space)`;
    } else {
      $("live-hint").textContent = "That's the last question — end the night when you're ready.";
    }

    $("override-panel").hidden = false;
    loadOverridePanel(cur.id);
  }
}

function correctAnswerText(cur) {
  if (cur.q_type === "mc") {
    const opt = (cur.options || []).find((o) => o.key === cur.correct_key);
    return opt ? `${cur.correct_key}. ${opt.text}` : cur.correct_key || "—";
  }
  return cur.correct_text || "—";
}

function markCorrectOption(cur) {
  if (cur.q_type !== "mc") return;
  document.querySelectorAll(".present-option").forEach((el) => {
    el.classList.toggle("is-correct", el.dataset.key === cur.correct_key);
  });
}

async function tick() {
  if (!currentWeek || currentWeek.status !== "live") return;
  const cur = currentQuestion();
  if (!cur || cur.status !== "open") return;

  const { data } = await db.rpc("host_live_state", { p_week_id: currentWeek.id });
  const state = Array.isArray(data) ? data[0] : data;
  if (!state || !state.question_id) return;

  const pct = state.expected_count ? Math.round((state.answered_count / state.expected_count) * 100) : 0;
  $("answer-meter-fill").style.width = `${Math.min(pct, 100)}%`;
  $("answer-meter-label").textContent = `${state.answered_count} / ${state.expected_count} answered`;
}

/* ============================================================
   CONTROLS
   ============================================================ */
async function lockCurrent() {
  const cur = currentQuestion();
  if (!cur || cur.status !== "open") return;
  const { error } = await db.rpc("set_question_status", { p_question_id: cur.id, p_status: "locked" });
  if (error) return showLiveError(error.message);
  await reloadQuiz();
}

async function openNext() {
  const cur = currentQuestion();
  if (cur && cur.status === "open") return;
  const next = nextPending();
  if (!next) return;
  const { error } = await db.rpc("set_question_status", { p_question_id: next.id, p_status: "open" });
  if (error) return showLiveError(error.message);
  await reloadQuiz();
}

$("lock-btn").addEventListener("click", lockCurrent);
$("next-btn").addEventListener("click", openNext);

$("reopen-btn").addEventListener("click", async () => {
  const cur = currentQuestion();
  if (!cur) return;
  const { error } = await db.rpc("reopen_question", { p_question_id: cur.id });
  if (error) return showLiveError(error.message);
  await reloadQuiz();
});

document.addEventListener("keydown", (e) => {
  if (!currentWeek || currentWeek.status !== "live") return;
  if (e.code !== "Space" && e.key !== "Enter") return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;

  e.preventDefault();
  const cur = currentQuestion();
  if (cur && cur.status === "open") lockCurrent();
  else openNext();
});

function showLiveError(message) {
  const err = $("live-error");
  err.textContent = message;
  err.hidden = false;
}

/* ============================================================
   OVERRIDE PANEL
   ============================================================ */
async function loadOverridePanel(questionId) {
  const { data, error } = await db
    .from("responses")
    .select("id, answer_raw, verdict, points_awarded, overridden, players(display_name)")
    .eq("question_id", questionId)
    .order("created_at");

  if (error) {
    $("override-list").innerHTML = `<li class="table-empty">Could not load answers.</li>`;
    return;
  }

  $("override-list").innerHTML = (data || []).map((r) => `
    <li>
      <div class="suggestion-text">
        <span class="suggestion-topic">${esc(r.players?.display_name || "someone")}</span>
        <span class="suggestion-by">"${esc(r.answer_raw)}" · ${fmtPoints(r.points_awarded)} pts</span>
        ${r.overridden ? `<span class="badge badge-left">Overridden</span>` : ""}
      </div>
      <div class="row-actions">
        <button class="btn btn-small ${r.verdict === "correct" ? "is-active-verdict" : ""}" data-action="override" data-id="${r.id}" data-verdict="correct">Full</button>
        <button class="btn btn-small ${r.verdict === "partial" ? "is-active-verdict" : ""}" data-action="override" data-id="${r.id}" data-verdict="partial">Half</button>
        <button class="btn btn-small ${r.verdict === "wrong" ? "is-active-verdict" : ""}" data-action="override" data-id="${r.id}" data-verdict="wrong">None</button>
      </div>
    </li>`).join("") || `<li class="table-empty">Nobody answered this one.</li>`;
}

$("override-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='override']");
  if (!btn) return;

  const { error } = await db.rpc("override_response", { p_response_id: btn.dataset.id, p_verdict: btn.dataset.verdict });
  if (error) return showLiveError(error.message);

  const cur = currentQuestion();
  if (cur) await loadOverridePanel(cur.id);
});

/* ============================================================
   FINISHING THE NIGHT
   ============================================================ */
$("end-night-btn").addEventListener("click", async () => {
  if (!confirm("End the night? This locks in final scores and can't be undone.")) return;

  const err = $("live-error");
  err.hidden = true;

  const { error } = await db.rpc("close_week", { p_week_id: currentWeek.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  const { data } = await db.rpc("live_standings", { p_week_id: currentWeek.id });
  finalStandings = data || [];

  stopAllTimers();
  currentWeek.status = "closed";
  $("tagline").textContent = "Night's over";
  $("live-panel").hidden = true;
  $("podium-panel").hidden = false;
  $("reveal-podium-btn").hidden = false;
  $("present-podium").innerHTML = "";
  $("present-rest").innerHTML = "";
});

$("reveal-podium-btn").addEventListener("click", () => {
  $("reveal-podium-btn").hidden = true;
  revealPodium(finalStandings);
});

function revealPodium(rows) {
  const top3 = rows.slice(0, 3);
  const order = [1, 0, 2]; // left-to-right: 2nd, 1st, 3rd

  $("present-podium").innerHTML = order.map((i) => {
    const r = top3[i];
    if (!r) return `<div></div>`;
    return `
      <div class="plinth p${i + 1} is-hidden" data-rank="${i}">
        <span class="medal">${["1st", "2nd", "3rd"][i]}</span>
        <span class="who">${esc(r.display_name)}</span>
        <span class="pts">${fmtPoints(r.total_points)}</span>
      </div>`;
  }).join("");

  const revealOrder = [2, 1, 0]; // 3rd, then 2nd, then 1st
  let i = 0;
  (function step() {
    if (i >= revealOrder.length) {
      renderRest(rows.slice(3));
      return;
    }
    const rank = revealOrder[i++];
    const el = document.querySelector(`.plinth[data-rank="${rank}"]`);
    if (el) el.classList.remove("is-hidden");
    setTimeout(step, 1300);
  })();
}

function renderRest(rows) {
  $("present-rest").innerHTML = rows.map((r, i) => `
    <li>
      <span class="rank">${ordinal(i + 4)}</span>
      <span class="name">${esc(r.display_name)}</span>
      <span class="score">${fmtPoints(r.total_points)}</span>
    </li>`).join("");
}

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const fmtPoints = (n) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(1);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
