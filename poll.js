import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.8/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { loadMe, setupNav } from "./auth.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayerId = null;
let currentWeek = null;
let isHost = false;
let myVoteId = null;
let channel = null;
let pollTimer = null;

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return locked("Sign in on the leaderboard first, then come back here.");

    const { data: me, error } = await loadMe(db, session);

    if (error || !me) return locked("Sign in on the leaderboard first, then come back here.");

    myPlayerId = me.id;
    // Header links come from a cached role check - instant on repeat
    // navigations, no round trip holding up the poll.
    setupNav(db, me);
    await loadPoll();
  } catch (err) {
    locked("Could not reach the database. Check config.js.");
  }
})();

function locked(message) {
  $("locked-message").textContent = message;
  $("tagline").textContent = "Poll";
  show("view-locked");
}

function show(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
}

/* ============================================================
   POLL
   ============================================================ */
async function loadPoll() {
  const { data: weeks, error } = await db
    .from("weeks")
    .select("id, quiz_date, title, status, host_id")
    .neq("status", "closed")
    .order("quiz_date");

  if (error) return locked("Could not load quizzes. Check the database setup.");

  const polling = (weeks || []).find((w) => w.status === "polling");
  if (!polling) {
    const hosting = (weeks || []).find((w) => w.host_id === myPlayerId && w.status === "draft");
    if (hosting) {
      locked(`No poll is open yet. You're hosting ${fmtDate(hosting.quiz_date)} — build your ballot on the host page.`);
    } else {
      locked("No poll is open right now. Check back closer to Friday.");
    }
    return;
  }

  currentWeek = polling;
  isHost = polling.host_id === myPlayerId;
  $("tagline").textContent = polling.title ? `Vote: ${polling.title}` : "Vote for Friday's topic";
  $("host-note").hidden = !isHost;
  show("view-poll");

  if (!isHost) {
    const { data: voteId } = await db.rpc("my_vote", { p_week_id: polling.id });
    myVoteId = voteId;
  }

  await refreshResults();

  channel = db.channel(`poll-${currentWeek.id}`)
    .on("broadcast", { event: "vote" }, () => refreshResults())
    .subscribe();

  pollTimer = setInterval(() => refreshResults(), 8000);
}

window.addEventListener("pagehide", () => {
  if (pollTimer) clearInterval(pollTimer);
  if (channel) db.removeChannel(channel);
});

async function refreshResults() {
  if (!currentWeek) return;
  const { data, error } = await db.rpc("poll_results", { p_week_id: currentWeek.id });
  if (error) {
    $("poll-error").textContent = error.message;
    $("poll-error").hidden = false;
    return;
  }
  renderOptions(data || []);
}

function renderOptions(options) {
  const top = Math.max(0, ...options.map((o) => Number(o.votes)));

  $("poll-options").innerHTML = options.map((o) => `
    <button type="button" class="poll-card
        ${top > 0 && Number(o.votes) === top ? "is-leading" : ""}
        ${o.option_id === myVoteId ? "is-mine" : ""}"
      data-option-id="${o.option_id}" ${isHost ? "disabled" : ""}>
      <span class="poll-card-topic">${esc(o.topic)}</span>
      <span class="poll-card-votes">${o.votes} ${Number(o.votes) === 1 ? "vote" : "votes"}</span>
      ${top > 0 && Number(o.votes) === top ? `<span class="badge badge-admin">Leading</span>` : ""}
      ${o.option_id === myVoteId ? `<span class="badge badge-left">Your pick</span>` : ""}
    </button>`).join("") || `<p class="hint">No topics on the ballot yet.</p>`;
}

$("poll-options").addEventListener("click", async (e) => {
  const card = e.target.closest(".poll-card");
  if (!card || isHost) return;

  const err = $("poll-error");
  err.hidden = true;

  const optionId = card.dataset.optionId;
  const { error } = await db.rpc("cast_vote", { p_week_id: currentWeek.id, p_option_id: optionId });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  myVoteId = optionId;
  await refreshResults();
  channel?.send({ type: "broadcast", event: "vote", payload: {} });
});

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });
}
