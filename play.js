import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { mediaRendererMarkup } from "./media-utils.js";
import { sfx } from "./sound.js";
import { animateReorder, reducedMotion, delay, streakShock } from "./fx.js";
import { streakSegments, streakLine, streakBreakLine, STREAK_MIN } from "./streaks.js";
import { jokerPoints } from "./jokers.js";

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
let jokerSupported = false; // true once live_state returns the my_joker field, i.e. the
                            // jokers migration (sql/17_jokers.sql) has been applied.
                            // Until then the joker bar stays hidden — fail soft.

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
    locked("No quiz is live right now. This page updates the moment the host starts one — no refreshing required, no matter how hard you're tempted.");
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

  if (data && data[0] && Object.prototype.hasOwnProperty.call(data[0], "my_joker")) jokerSupported = true;
  const rows = (data || []).map((row) => ({ ...row, media: row.media || [], my_joker: !!row.my_joker }));
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
    $("waiting-message").textContent = "Waiting for the host to open the first question… they're stalling for effect.";
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
  return `${currentIndex}|${questions.map((q) => `${q.question_id}:${q.my_answer || ""}:${q.my_joker ? "J" : ""}`).join(",")}`;
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

  renderJokerBar();
}

/* ============================================================
   THE JOKER — one stake per week, double or nothing. Chosen
   before final submission (so it leaks nothing about correctness);
   the doubling/zeroing lands in the reveal below and in the
   server-side finalize.
   ============================================================ */
function renderJokerBar() {
  const bar = $("joker-bar");
  if (!jokerSupported) { bar.hidden = true; return; }
  const jokerIndex = questions.findIndex((x) => x.my_joker);
  const here = jokerIndex === currentIndex;

  let msg, btnLabel, action;
  if (jokerIndex === -1) {
    msg = "🃏 One joker this week. Stake it on your surest answer — double or nothing, full marks only.";
    btnLabel = "Stake joker here";
    action = "set";
  } else if (here) {
    msg = "🃏 Joker staked here. A full-marks answer pays double; anything less scores zero.";
    btnLabel = "Take it back";
    action = "clear";
  } else {
    msg = `🃏 Joker is on Q${questions[jokerIndex].q_number}. Fancy this one more?`;
    btnLabel = "Move joker here";
    action = "set";
  }

  bar.hidden = false;
  bar.className = `joker-bar ${here ? "is-staked" : ""}`;
  bar.innerHTML =
    `<p class="joker-text">${msg}</p>` +
    `<button type="button" class="btn btn-small joker-btn" data-action="${action}">${esc(btnLabel)}</button>`;
}

$("joker-bar").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  setJoker(btn.dataset.action === "clear" ? null : questions[currentIndex].question_id);
});

async function setJoker(questionId) {
  const err = $("play-error");
  err.hidden = true;

  const { error } = await db.rpc("set_joker", { p_week_id: currentWeek.id, p_question_id: questionId });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  questions.forEach((x) => { x.my_joker = false; });
  if (questionId) {
    const q = questions.find((x) => x.question_id === questionId);
    if (q) q.my_joker = true;
  }
  sfx.tick();
  forceRenderBrowse();
}

/* Points a question actually earns once the joker is settled:
   staked + full marks doubles it, staked + anything else zeroes it. */
function effectivePoints(q) {
  const verdict = q.my_answer ? (q.my_verdict || "wrong") : "wrong";
  return jokerPoints(q.my_points, verdict, q.my_joker);
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
  sfx.tick();
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

/* ============================================================
   THE REVEAL — answers flip over one at a time, streaks earn a
   banner and light the screen up, broken streaks get a eulogy.
   Runs once per quiz per browser; reloads render instantly.
   ============================================================ */
let revealing = false;

function resultRowHTML(q, extra = "") {
  const mine = q.q_type === "mc"
    ? (q.options || []).find((o) => o.key === q.my_answer)?.text || (q.my_answer ? q.my_answer : null)
    : q.my_answer;
  const correct = q.q_type === "mc"
    ? (q.options || []).find((o) => o.key === q.correct_key)?.text || q.correct_key
    : q.correct_text;
  const verdict = q.my_answer ? (q.my_verdict || "wrong") : "wrong";
  const verdictLabel = !q.my_answer ? "Didn't answer" : verdict === "correct" ? "Full marks" : verdict === "partial" ? "Half marks" : "No marks";

  const jokerStamp = q.my_joker
    ? `<span class="joker-stamp ${verdict === "correct" ? "is-won" : "is-lost"}">${verdict === "correct" ? "Joker · doubled" : "Joker · lost"}</span>`
    : "";

  return `
    <li class="results-item is-${verdict} ${q.my_joker ? "is-jokered" : ""} ${extra}">
      ${jokerStamp}
      <p class="results-prompt">Q${q.q_number}. ${esc(q.prompt)}</p>
      <p class="results-mine">Your answer: ${mine ? esc(mine) : "nothing"}</p>
      <p class="results-correct">Correct answer: ${esc(correct)}</p>
      <p class="results-verdict">${verdictLabel} · ${fmtPoints(effectivePoints(q))} pts</p>
    </li>`;
}

/* The full quiz as an ordered list of rows and streak banners. */
function resultsSequence() {
  const verdicts = questions.map((q) => (q.my_answer ? (q.my_verdict || "wrong") : "wrong"));
  const streaks = streakSegments(verdicts).filter((s) => s.type === "correct" && s.length >= STREAK_MIN);

  const bannerAfter = new Map();
  for (const s of streaks) {
    bannerAfter.set(s.start + STREAK_MIN - 1, { break: false, text: streakLine(s.length) });
    const endIdx = s.start + s.length;
    if (endIdx < questions.length) {
      bannerAfter.set(endIdx, { break: true, text: streakBreakLine(s.length, questions[endIdx].q_number) });
    }
  }

  const items = [];
  questions.forEach((q, i) => {
    items.push({ kind: "answer", verdict: verdicts[i], jokered: !!q.my_joker, points: effectivePoints(q), html: (x) => resultRowHTML(q, x) });
    const b = bannerAfter.get(i);
    if (b) {
      items.push({
        kind: b.break ? "break" : "streak",
        html: (x) => `<li class="streak-banner ${b.break ? "is-break" : ""} ${x}">${esc(b.text)}</li>`,
      });
    }
  });
  return items;
}

function renderResults() {
  if (revealing) return;
  const total = questions.reduce((sum, q) => sum + effectivePoints(q), 0);
  const seenKey = `tf-reveal-${currentWeek.id}`;
  const items = resultsSequence();

  if (sessionStorage.getItem(seenKey) || reducedMotion()) {
    sessionStorage.setItem(seenKey, "1");
    $("results-total").textContent = `${fmtPoints(total)} pts`;
    $("results-list").innerHTML = items.map((it) => it.html("")).join("");
    return;
  }

  sessionStorage.setItem(seenKey, "1");
  revealing = true;
  runReveal(items).finally(() => { revealing = false; });
}

async function runReveal(items) {
  const list = $("results-list");
  list.innerHTML = "";
  let running = 0;
  $("results-total").textContent = `${fmtPoints(0)} pts`;

  for (const it of items) {
    list.insertAdjacentHTML("beforeend", it.html("is-veiled"));
    const el = list.lastElementChild;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("is-veiled")));

    if (it.kind === "answer") {
      if (it.jokered && it.verdict === "correct") { sfx.sting(); streakShock(); }
      else if (it.jokered) sfx.womp();
      else if (it.verdict === "correct") sfx.chime();
      else if (it.verdict === "partial") sfx.tick();
      running += it.points;
      const totalEl = $("results-total");
      totalEl.textContent = `${fmtPoints(running)} pts`;
      totalEl.classList.remove("is-scoring");
      void totalEl.offsetWidth; // restart the pop
      totalEl.classList.add("is-scoring");
      await delay(520);
    } else if (it.kind === "streak") {
      sfx.sting();
      streakShock();
      document.body.classList.add("is-onfire");
      setTimeout(() => document.body.classList.remove("is-onfire"), 1900);
      await delay(950);
    } else {
      sfx.womp();
      await delay(950);
    }
  }
}

/* ============================================================
   STANDINGS
   ============================================================ */
async function refreshStandings() {
  const { data, error } = await db.rpc("live_standings", { p_week_id: currentWeek.id });
  if (error) return;

  // FLIP: rows physically slide past each other when the order
  // changes between questions - overtakes happen on screen
  const list = $("play-standings");
  animateReorder(list, () => {
    list.innerHTML = (data || []).map((r) => `
      <li data-key="${r.player_id}" class="${r.player_id === myPlayer.id ? "is-me" : ""}">
        <span class="rank">${ordinal(r.standing)}</span>
        <span class="name">${esc(r.display_name)}</span>
        <span class="score">${fmtPoints(r.total_points)}</span>
      </li>`).join("") || `<li class="name">No scores yet.</li>`;
  });
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
