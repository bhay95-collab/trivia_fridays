import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { mediaRendererMarkup } from "./media-utils.js";
import { sfx } from "./sound.js";
import { fireConfetti, delay, reducedMotion } from "./fx.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;   // { id, quiz_date, title, status, host_id, topic }
let quiz = [];             // host_quiz() rows for currentWeek
let viewIndex = 0;         // which opened question is showing on the shared screen
let reviewIndex = 0;       // which question is showing in the post-close review
let finalStandings = [];
let channel = null;
let meterTicker = null;
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
      .eq("is_active", true)
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
  const activeQuery = db
    .from("weeks")
    .select("id, quiz_date, title, status")
    .in("status", ["building", "live"])
    .order("quiz_date");

  const { data: active, error } = myPlayer.is_admin
    ? await activeQuery
    : await activeQuery.eq("host_id", myPlayer.id);

  if (error) return locked("Could not load quizzes. Check the database setup.");

  let data = active || [];

  if (data.length === 0) {
    // Nothing to start or run right now - fall back to the most
    // recently closed quiz, in case the host needs to pick back up
    // reviewing answers or revealing the podium after a reload.
    const closedQuery = db
      .from("weeks")
      .select("id, quiz_date, title, status")
      .eq("status", "closed")
      .order("quiz_date", { ascending: false })
      .limit(1);
    const { data: closed } = myPlayer.is_admin
      ? await closedQuery
      : await closedQuery.eq("host_id", myPlayer.id);
    data = closed || [];
  }

  if (data.length === 0) {
    return locked(myPlayer.is_admin
      ? "No quiz is ready to present right now."
      : "You don't have a quiz ready to present — the big screen can wait.");
  }

  if (myPlayer.is_admin && data.length > 1) {
    $("week-switcher-field").hidden = false;
    $("week-switcher").innerHTML = data.map((w) =>
      `<option value="${w.id}">${fmtDate(w.quiz_date)}${w.title ? " — " + esc(w.title) : ""} (${w.status})</option>`).join("");
  }

  const hostLink = $("nav-host");
  if (hostLink) hostLink.hidden = false;
  const presentLink = $("nav-present");
  if (presentLink) presentLink.hidden = false;

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

  if (error || !week) return locked("Could not load that quiz.");

  currentWeek = week;
  if ($("week-switcher-field").hidden === false) $("week-switcher").value = weekId;

  $("ready-panel").hidden = true;
  $("live-panel").hidden = true;
  $("review-panel").hidden = true;
  $("podium-panel").hidden = true;

  if (week.status === "building") {
    $("tagline").textContent = "Ready to start";
    await showReadyPanel(week);
  } else if (week.status === "live") {
    $("tagline").textContent = week.title || "Live now";
    await enterLive();
  } else if (week.status === "closed") {
    $("tagline").textContent = "That's a wrap";
    await enterReview();
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
  if (meterTicker) clearInterval(meterTicker);
  if (fallbackTimer) clearInterval(fallbackTimer);
  if (channel) db.removeChannel(channel);
  meterTicker = null;
  fallbackTimer = null;
  channel = null;
}

/* ============================================================
   LIVE DRIVING SCREEN
   This is on the shared Teams screen. It never shows a correct
   answer or another player's response - that only ever happens
   after the quiz is closed, in the review panel below.
   ============================================================ */
async function enterLive() {
  $("live-panel").hidden = false;
  $("review-panel").hidden = true;
  viewIndex = 0;

  await reloadQuiz();
  renderLive();

  channel = db.channel(`present-${currentWeek.id}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "questions", filter: `week_id=eq.${currentWeek.id}` },
      async () => { await reloadQuiz(); renderLive(); })
    .subscribe();

  fallbackTimer = setInterval(async () => { await reloadQuiz(); renderLive(); }, 5000);
  meterTicker = setInterval(updateMeter, 2000);
  updateMeter();
}

async function reloadQuiz() {
  const { data, error } = await db.rpc("host_quiz", { p_week_id: currentWeek.id });
  if (error) { showLiveError(error.message); return; }
  quiz = data || [];
}

function openedQuestions() {
  return quiz.filter((q) => q.status !== "pending");
}

function renderLive() {
  const opened = openedQuestions();
  const next = quiz.find((q) => q.status === "pending");

  if (opened.length === 0) {
    $("present-progress").textContent = `Question 1 of ${quiz.length}`;
    $("present-prompt").textContent = "Ready for the first question.";
    $("present-options").hidden = true;
    $("answer-meter").hidden = true;
    $("present-prev").disabled = true;
    $("present-next").disabled = !next;
    $("present-next").textContent = next ? "Open question 1 (Space)" : "Next (Space)";
    $("live-hint").textContent = "";
    return;
  }

  if (viewIndex >= opened.length) viewIndex = opened.length - 1;
  const q = opened[viewIndex];

  $("present-progress").textContent = `Question ${q.q_number} of ${quiz.length}`;
  $("present-prompt").textContent = q.prompt;
  $("present-media").innerHTML = mediaRendererMarkup(q.media || []);
  $("present-media").hidden = !(q.media || []).length;

  if (q.q_type === "mc") {
    $("present-options").hidden = false;
    $("present-options").innerHTML = (q.options || []).map((o) => `
      <div class="present-option">
        <span class="present-option-key">${esc(o.key)}</span>
        <span>${esc(o.text)}</span>
      </div>`).join("");
  } else {
    $("present-options").hidden = true;
  }

  $("answer-meter").hidden = false;
  $("answer-meter-fill").style.transform = "scaleX(0)";
  $("answer-meter-label").textContent = "";

  $("present-prev").disabled = viewIndex === 0;
  const atLatest = viewIndex === opened.length - 1;
  $("present-next").disabled = atLatest && !next;
  $("present-next").textContent = atLatest && next ? `Open question ${next.q_number} (Space)` : "Next (Space)";
  $("live-hint").textContent = atLatest && !next
    ? "That's every question — go back through with the room, then end the quiz when you're ready."
    : "";

  updateMeter();
}

$("present-prev").addEventListener("click", () => {
  if (viewIndex > 0) { viewIndex--; renderLive(); }
});

$("present-next").addEventListener("click", async () => {
  const opened = openedQuestions();
  if (viewIndex < opened.length - 1) { viewIndex++; renderLive(); return; }

  const next = quiz.find((q) => q.status === "pending");
  if (!next) return;

  const { error } = await db.rpc("set_question_status", { p_question_id: next.id, p_status: "open" });
  if (error) return showLiveError(error.message);

  sfx.tick();
  await reloadQuiz();
  viewIndex = openedQuestions().length - 1;
  renderLive();
});

document.addEventListener("keydown", (e) => {
  if (!currentWeek || currentWeek.status !== "live") return;
  if (e.code !== "Space" && e.key !== "Enter") return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  e.preventDefault();
  $("present-next").click();
});

async function updateMeter() {
  if (!currentWeek || currentWeek.status !== "live") return;
  const opened = openedQuestions();
  const q = opened[viewIndex];

  const { data } = await db.rpc("host_live_state", { p_week_id: currentWeek.id });
  const state = Array.isArray(data) ? data[0] : data;
  const expected = state?.expected_count || 0;

  $("submitted-meta").textContent = `${state?.submitted_count || 0} of ${expected} submitted their final answers`;

  if (!q) return;
  const { count } = await db.from("responses").select("id", { count: "exact", head: true }).eq("question_id", q.id);
  const answered = count || 0;
  const pct = expected ? Math.min(answered / expected, 1) : 0;
  $("answer-meter-fill").style.transform = `scaleX(${pct})`;
  $("answer-meter-label").textContent = `${answered} / ${expected} answered`;
}

function showLiveError(message) {
  const err = $("live-error");
  err.textContent = message;
  err.hidden = false;
}

/* ============================================================
   FINISHING THE QUIZ
   ============================================================ */
$("end-quiz-btn").addEventListener("click", async () => {
  if (!confirm("End the quiz? Anyone who hasn't submitted yet will be finalised automatically.")) return;

  const err = $("live-error");
  err.hidden = true;

  const { error } = await db.rpc("close_week", { p_week_id: currentWeek.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  stopAllTimers();
  sfx.buzz(); // the answers are locked
  currentWeek.status = "closed";
  $("tagline").textContent = "That's a wrap";
  $("live-panel").hidden = true;
  await enterReview();
});

/* ============================================================
   ANSWER REVIEW (after the quiz is closed - safe to show answers)
   ============================================================ */
async function enterReview() {
  await reloadQuiz();
  reviewIndex = 0;
  $("review-panel").hidden = false;
  $("podium-panel").hidden = false;
  $("reveal-podium-btn").hidden = false;
  $("present-podium").innerHTML = "";
  $("present-rest").innerHTML = "";
  renderReview();
  await refreshReviewGate();
}

/* Free-text answers the grader didn't call a straight "correct"
   need a human look before scores can go final - multiple choice
   and exact matches never do. This keeps the reveal button in sync
   with how many of those are still untouched. */
async function refreshReviewGate() {
  const { data, error } = await db.rpc("host_review_status", { p_week_id: currentWeek.id });
  const row = Array.isArray(data) ? data[0] : data;
  const pending = error ? null : (row?.still_pending || 0);
  const btn = $("reveal-podium-btn");
  const hint = $("review-gate-hint");

  if (btn.hidden) return; // podium already revealed - nothing to gate

  if (pending) {
    btn.disabled = true;
    hint.hidden = false;
    hint.textContent = `${pending} free-text ${pending === 1 ? "answer" : "answers"} still need review before you can reveal the podium.`;
  } else {
    btn.disabled = false;
    hint.hidden = true;
  }
}

function renderReview() {
  const q = quiz[reviewIndex];
  if (!q) return;

  $("review-error").hidden = true;
  $("review-progress").textContent = `Question ${q.q_number} of ${quiz.length}`;
  $("review-prev").disabled = reviewIndex === 0;
  $("review-next").disabled = reviewIndex === quiz.length - 1;
  $("review-prompt").textContent = q.prompt;
  $("review-answer").textContent = `Correct answer: ${correctAnswerText(q)}`;

  loadOverridePanel(q.id);
}

$("review-prev").addEventListener("click", () => {
  if (reviewIndex > 0) { reviewIndex--; renderReview(); }
});
$("review-next").addEventListener("click", () => {
  if (reviewIndex < quiz.length - 1) { reviewIndex++; renderReview(); }
});

function correctAnswerText(q) {
  if (q.q_type === "mc") {
    const opt = (q.options || []).find((o) => o.key === q.correct_key);
    return opt ? `${q.correct_key}. ${opt.text}` : q.correct_key || "—";
  }
  return q.correct_text || "—";
}

async function loadOverridePanel(questionId) {
  const q = quiz.find((x) => x.id === questionId);
  const isText = q && q.q_type === "text";

  const [respRes, nomRes] = await Promise.all([
    db.from("responses")
      .select("id, answer_raw, verdict, points_awarded, overridden, reviewed, players(display_name)")
      .eq("question_id", questionId)
      .order("created_at"),
    isText
      ? db.from("howler_nominations").select("id, response_id")
      : Promise.resolve({ data: [] }),
  ]);

  if (respRes.error) {
    $("override-list").innerHTML = `<li class="table-empty">Could not load answers.</li>`;
    return;
  }

  const noms = new Map((nomRes.data || []).map((n) => [n.response_id, n.id]));

  $("override-list").innerHTML = (respRes.data || []).map((r) => `
    <li>
      <div class="suggestion-text">
        <span class="suggestion-topic">${esc(r.players?.display_name || "someone")}</span>
        <span class="suggestion-by">"${esc(r.answer_raw)}" · ${fmtPoints(r.points_awarded)} pts</span>
        ${r.overridden ? `<span class="badge badge-left">Overridden</span>` : ""}
        ${isText && r.verdict !== "correct" && !r.reviewed ? `<span class="badge badge-warn">Needs review</span>` : ""}
      </div>
      <div class="row-actions">
        <button class="btn btn-small ${r.verdict === "correct" ? "is-active-verdict" : ""}" data-action="override" data-id="${r.id}" data-verdict="correct">Full</button>
        <button class="btn btn-small ${r.verdict === "partial" ? "is-active-verdict" : ""}" data-action="override" data-id="${r.id}" data-verdict="partial">Half</button>
        <button class="btn btn-small ${r.verdict === "wrong" ? "is-active-verdict" : ""}" data-action="override" data-id="${r.id}" data-verdict="wrong">None</button>
        ${isText ? `
        <button class="btn btn-small ${noms.has(r.id) ? "is-active-verdict" : ""}"
                data-action="howler" data-id="${r.id}" data-nom="${noms.get(r.id) || ""}"
                title="Put this answer on the season's worst-answer ballot">
          ${noms.has(r.id) ? "On the ballot" : "Howler"}
        </button>` : ""}
      </div>
    </li>`).join("") || `<li class="table-empty">Nobody answered this one. A rare moment of total consensus.</li>`;
}

$("override-list").addEventListener("click", async (e) => {
  const howler = e.target.closest("button[data-action='howler']");
  if (howler) {
    const { error } = howler.dataset.nom
      ? await db.rpc("retract_howler", { p_nomination_id: howler.dataset.nom })
      : await db.rpc("nominate_howler", { p_response_id: howler.dataset.id });
    if (error) return showReviewError(error.message);
    return loadOverridePanel(quiz[reviewIndex].id);
  }

  const btn = e.target.closest("button[data-action='override']");
  if (!btn) return;

  const { error } = await db.rpc("override_response", { p_response_id: btn.dataset.id, p_verdict: btn.dataset.verdict });
  if (error) return showReviewError(error.message);

  await loadOverridePanel(quiz[reviewIndex].id);
  await refreshReviewGate();
});

function showReviewError(message) {
  const err = $("review-error");
  err.textContent = message;
  err.hidden = false;
}

/* ============================================================
   PODIUM
   ============================================================ */
$("reveal-podium-btn").addEventListener("click", async () => {
  const btn = $("reveal-podium-btn");
  btn.disabled = true;

  const { error: finalizeError } = await db.rpc("finalize_week_scores", { p_week_id: currentWeek.id });
  if (finalizeError) {
    showReviewError(finalizeError.message);
    return refreshReviewGate(); // re-checks pending count and re-disables if still blocked
  }

  const { data, error } = await db.rpc("live_standings", { p_week_id: currentWeek.id });
  if (error) {
    btn.disabled = false;
    return showReviewError(error.message);
  }

  finalStandings = data || [];
  btn.hidden = true;
  $("review-gate-hint").hidden = true;
  await revealPodium(finalStandings);
});

/* The one big moment. Sound and motion run off the same timeline
   so they cannot drift: drums build, third and second land with a
   thud, the drums hold through a long beat, and first arrives with
   the fanfare, the confetti and the lights all at once. */
async function revealPodium(rows) {
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

  // reduced motion: the full result, immediately, no theatre
  if (reducedMotion()) {
    document.querySelectorAll("#present-podium .plinth").forEach((el) => el.classList.remove("is-hidden"));
    renderRest(rows.slice(3));
    return;
  }

  document.body.classList.add("house-dim");
  const roll = sfx.drumroll(7);
  await delay(1500);              // let the drums build

  await land(2);                  // 3rd
  await delay(1100);
  await land(1);                  // 2nd
  await delay(1700);              // the held beat before the winner
  roll.stop();
  await land(0);                  // 1st
  sfx.fanfare();
  document.body.classList.add("is-strobe");
  fireConfetti($("confetti"), { count: 220, frames: 430 });

  await delay(1900);
  document.body.classList.remove("house-dim");
  renderRest(rows.slice(3));
  setTimeout(() => document.body.classList.remove("is-strobe"), 6000);
}

async function land(rank) {
  const el = document.querySelector(`.plinth[data-rank="${rank}"]`);
  if (!el) return;
  el.classList.remove("is-hidden");
  el.classList.add("is-landing");
  sfx.slam();
  await delay(480);
}

function renderRest(rows) {
  $("present-rest").innerHTML = rows.map((r, i) => `
    <li data-key="${r.player_id}">
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
