import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { isSafeMediaUrl, normalizeMediaEntry } from "./media-utils.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;      // full row for the week being managed
let ballot = [];             // poll_options for currentWeek
let results = null;          // poll_results, only fetched while polling
let questions = [];          // draft state for the quiz builder
let previewOpen = false;
let submissionsTimer = null; // polls final-submission status while the quiz is live

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

  if (error) return locked("Could not load quizzes. Check the database setup.");

  if (!data || data.length === 0) {
    return locked(myPlayer.is_admin
      ? "No quizzes need hosting right now. Create one from the admin page."
      : "You are not hosting a quiz at the moment — savour the peace, it's your turn again soon enough.");
  }

  if (myPlayer.is_admin && data.length > 1) {
    $("week-switcher-field").hidden = false;
    $("week-switcher").innerHTML = data.map((w) =>
      `<option value="${w.id}">${fmtDate(w.quiz_date)}${w.title ? " — " + esc(w.title) : ""}</option>`).join("");
  }

  const presentLink = $("nav-present");
  if (presentLink) presentLink.hidden = false;
  const hostLink = $("nav-host");
  if (hostLink) hostLink.hidden = false;

  show("view-host");
  $("tagline").textContent = "Your quiz";
  await loadWeek(data[0].id);
}

$("week-switcher").addEventListener("change", (e) => {
  if (questions.some((q) => !q.saved) && !confirm("Switch quizzes? Any unsaved question changes will be lost.")) {
    e.target.value = currentWeek.id;
    return;
  }
  loadWeek(e.target.value);
});

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
    err.textContent = "Could not load that quiz.";
    err.hidden = false;
    return;
  }

  if (currentWeek?.id !== week.id) questions = []; // switching weeks - don't drag draft questions along
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

  $("questions-locked-hint").hidden = canEditQuestions();

  if (submissionsTimer) clearInterval(submissionsTimer);
  submissionsTimer = null;
  $("submissions-panel").hidden = week.status !== "live";
  if (week.status === "live") {
    await loadSubmissions();
    submissionsTimer = setInterval(loadSubmissions, 4000);
  }

  await Promise.all([loadSuggestions(), loadBallot(), loadQuestions()]);
  renderBallotActions();
}

async function loadSubmissions() {
  const { data, error } = await db.rpc("host_submissions", { p_week_id: currentWeek.id });
  if (error) {
    $("submissions-list").innerHTML = `<li class="table-empty">Could not load submissions.</li>`;
    return;
  }

  $("submissions-list").innerHTML = (data || []).map((s) => `
    <li>
      <span class="suggestion-topic">${esc(s.display_name)}</span>
      <button class="btn btn-small" data-action="reopen-submission" data-id="${s.player_id}">Let them back in</button>
    </li>`).join("") || `<li class="table-empty">Nobody yet.</li>`;
}

$("submissions-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='reopen-submission']");
  if (!btn) return;

  const err = $("host-error");
  err.hidden = true;

  const { error } = await db.rpc("host_reopen_submission", {
    p_week_id: currentWeek.id,
    p_player_id: btn.dataset.id,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadSubmissions();
});

function canEditQuestions() {
  return currentWeek.status !== "live" && currentWeek.status !== "closed";
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
    </li>`).join("") || `<li class="table-empty">No suggestions yet. You'll have to think of a topic yourself.</li>`;
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
  }).join("") || `<li class="table-empty">Nothing on the ballot yet. Democracy needs at least two candidates.</li>`;
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
      hint.textContent = "The ballot is closed for this quiz.";
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
   QUESTIONS
   ============================================================
   Each entry in `questions` is a draft: it may or may not match
   what's saved. Typing into a card marks it dirty immediately (no
   re-render, so focus is never lost). Structural changes - add or
   remove an option, add or remove an alternate, change type, add or
   delete a question - read every visible card back into `questions`
   first with syncAllCardsFromDOM(), so nobody's half-finished edits
   in another card are wiped out by the re-render.
   ============================================================ */
window.addEventListener("beforeunload", (e) => {
  if (questions.some((q) => !q.saved)) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function loadQuestions() {
  // Preserve any in-progress, not-yet-saved edits (including brand
  // new questions) across the refresh - a delete or reorder
  // elsewhere in the list should never wipe out someone's
  // half-written question.
  syncAllCardsFromDOM();
  const priorById = new Map(questions.filter((q) => q.id).map((q) => [q.id, q]));
  const drafts = questions.filter((q) => !q.id);

  const { data, error } = await db.rpc("host_quiz", { p_week_id: currentWeek.id });
  if (error) {
    $("questions-list").innerHTML = `<p class="hint">Could not load questions.</p>`;
    return;
  }

  questions = (data || []).map((row) => {
    const prior = priorById.get(row.id);
    return prior && !prior.saved ? { ...prior, q_number: row.q_number } : rowToDraft(row);
  }).concat(drafts);

  renderQuestions();
}

function rowToDraft(row) {
  let options = [{ text: "" }, { text: "" }];
  let correctIndex = 0;

  if (row.q_type === "mc") {
    options = (row.options || []).map((o) => ({ text: o.text }));
    const ci = (row.options || []).findIndex((o) => o.key === row.correct_key);
    correctIndex = ci >= 0 ? ci : 0;
  } else if (row.q_type === "tf") {
    correctIndex = (row.correct_key || "T").toUpperCase() === "F" ? 1 : 0;
  } else if (row.q_type === "order") {
    // present the items in their correct (authored) order in the builder
    const byKey = new Map((row.options || []).map((o) => [String(o.key).toUpperCase(), o.text]));
    const seq = Array.isArray(row.correct_order) ? row.correct_order : [];
    options = seq.length
      ? seq.map((k) => ({ text: byKey.get(String(k).toUpperCase()) || "" }))
      : (row.options || []).map((o) => ({ text: o.text }));
  }

  return {
    clientId: row.id,
    id: row.id,
    q_number: row.q_number,
    q_type: row.q_type,
    prompt: row.prompt,
    points: Number(row.points),
    options,
    correctIndex,
    correct_text: row.correct_text || "",
    alternates: row.alternates || [],
    num_value: row.num_value ?? null,
    num_tolerance: row.num_tolerance ?? 0,
    media: (row.media || []).map((item) => normalizeMediaEntry(item)),
    saved: true,
  };
}

function newDraft() {
  return {
    clientId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id: null,
    q_number: null,
    q_type: "mc",
    prompt: "",
    points: 1,
    options: [{ text: "" }, { text: "" }],
    correctIndex: 0,
    correct_text: "",
    alternates: [],
    num_value: null,
    num_tolerance: 0,
    media: [],
    saved: false,
  };
}

function syncAllCardsFromDOM() {
  document.querySelectorAll(".question-card").forEach((card) => syncCardFromDOM(card.dataset.clientId));
}

function syncCardFromDOM(clientId) {
  const card = document.querySelector(`.question-card[data-client-id="${clientId}"]`);
  const q = questions.find((x) => x.clientId === clientId);
  if (!card || !q) return;

  q.prompt = card.querySelector(".q-prompt").value;
  q.points = parseFloat(card.querySelector(".q-points").value) || 0;

  if (q.q_type === "mc") {
    const rows = [...card.querySelectorAll(".option-row")];
    if (rows.length) {
      q.options = rows.map((row) => ({ text: row.querySelector(".q-option-text").value }));
      const checkedIndex = rows.findIndex((row) => row.querySelector(".q-option-correct").checked);
      if (checkedIndex >= 0) q.correctIndex = checkedIndex;
    }
  } else if (q.q_type === "tf") {
    const checked = card.querySelector(".q-tf:checked");
    if (checked) q.correctIndex = Number(checked.value);
  } else if (q.q_type === "num" || q.q_type === "closest") {
    const val = card.querySelector(".q-num-value");
    const tol = card.querySelector(".q-num-tol");
    if (val) q.num_value = val.value === "" ? null : parseFloat(val.value);
    if (tol) q.num_tolerance = tol.value === "" ? 0 : parseFloat(tol.value);
  } else if (q.q_type === "order") {
    const rows = [...card.querySelectorAll(".order-row")];
    if (rows.length) q.options = rows.map((row) => ({ text: row.querySelector(".q-order-text").value }));
  } else {
    const correctInput = card.querySelector(".q-correct-text");
    if (correctInput) q.correct_text = correctInput.value;
    const altInputs = card.querySelectorAll(".q-alt");
    if (card.querySelector(".alt-rows")) q.alternates = [...altInputs].map((i) => i.value);
  }

  const mediaRows = [...card.querySelectorAll(".media-row")];
  q.media = mediaRows.map((row) => normalizeMediaEntry({
    id: row.dataset.mediaId || null,
    media_type: row.querySelector(".q-media-type").value,
    source_type: "url",
    url: row.querySelector(".q-media-url").value,
    caption: row.querySelector(".q-media-caption").value,
    sort_order: Number(row.querySelector(".q-media-sort").value || 0),
  }));
}

function renderQuestions() {
  const canEdit = canEditQuestions();
  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0);
  $("questions-summary").textContent = questions.length
    ? `${questions.length} ${questions.length === 1 ? "question" : "questions"} · ${fmtPoints(totalPoints)} ${totalPoints === 1 ? "point" : "points"} total`
    : "No questions yet.";

  const savedIds = questions.filter((q) => q.id).map((q) => q.id);

  $("questions-list").innerHTML = questions.map((q, i) => {
    const savedIndex = q.id ? savedIds.indexOf(q.id) : -1;
    return questionCardHTML(q, i, canEdit, savedIndex, savedIds.length);
  }).join("");

  $("add-question-btn").hidden = !canEdit;

  renderPreview();
}

const TYPE_OPTIONS = [
  ["mc", "Multiple choice"],
  ["tf", "True / False"],
  ["text", "Free text"],
  ["num", "Number"],
  ["closest", "Closest wins"],
  ["order", "Put in order"],
];

function typeFieldsHTML(q, canEdit) {
  switch (q.q_type) {
    case "tf": return tfFieldsHTML(q, canEdit);
    case "num": return numFieldsHTML(q, canEdit);
    case "closest": return closestFieldsHTML(q, canEdit);
    case "order": return orderFieldsHTML(q, canEdit);
    case "text": return textFieldsHTML(q, canEdit);
    default: return mcFieldsHTML(q, canEdit);
  }
}

function questionCardHTML(q, index, canEdit, savedIndex, savedTotal) {
  return `
    <div class="question-card ${q.saved ? "" : "is-dirty"}" data-client-id="${q.clientId}">
      <div class="question-card-head">
        <span class="question-number">Q${index + 1}</span>
        ${!q.saved ? `<span class="badge badge-left">Unsaved</span>` : ""}
        ${canEdit ? `
          <div class="question-card-tools">
            <button type="button" class="btn btn-small" data-action="move-up" ${!q.id || savedIndex === 0 ? "disabled" : ""}>Move up</button>
            <button type="button" class="btn btn-small" data-action="move-down" ${!q.id || savedIndex === savedTotal - 1 ? "disabled" : ""}>Move down</button>
            <button type="button" class="btn btn-small" data-action="delete-question">Delete</button>
          </div>` : ""}
      </div>

      <label class="field">
        <span>Prompt</span>
        <textarea class="q-prompt" rows="2" ${canEdit ? "" : "disabled"}>${esc(q.prompt)}</textarea>
      </label>

      <div class="question-card-row">
        <label class="field field-narrow">
          <span>Type</span>
          <select class="q-type" ${canEdit ? "" : "disabled"}>
            ${TYPE_OPTIONS.map(([v, label]) => `<option value="${v}" ${q.q_type === v ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label class="field field-narrow">
          <span>Points</span>
          <input class="q-points" type="number" min="0.5" step="0.5" value="${q.points}" ${canEdit ? "" : "disabled"}>
        </label>
      </div>

      ${typeFieldsHTML(q, canEdit)}

      <div class="media-section">
        <div class="panel-title-row">
          <h3 class="panel-title panel-title-small">Media</h3>
          ${canEdit ? `<button type="button" class="btn btn-small" data-action="add-media">Add media</button>` : ""}
        </div>
        <div class="media-rows">
          ${(q.media || []).map((m, i) => mediaRowHTML(m, i, canEdit)).join("")}
        </div>
      </div>

      ${canEdit ? `
        <div class="row-actions question-card-save">
          <button type="button" class="btn btn-primary" data-action="save-question">Save question</button>
        </div>` : ""}
    </div>`;
}

function mcFieldsHTML(q, canEdit) {
  return `
    <div class="option-rows">
      ${q.options.map((o, i) => `
        <div class="option-row" data-option-index="${i}">
          <input type="radio" name="correct-${q.clientId}" class="q-option-correct" ${i === q.correctIndex ? "checked" : ""} ${canEdit ? "" : "disabled"}>
          <span class="option-key">${String.fromCharCode(65 + i)}</span>
          <input type="text" class="q-option-text" value="${esc(o.text)}" placeholder="Option text" ${canEdit ? "" : "disabled"}>
          ${canEdit ? `<button type="button" class="btn btn-small" data-action="remove-option" ${q.options.length <= 2 ? "disabled" : ""}>Remove</button>` : ""}
        </div>`).join("")}
    </div>
    ${canEdit ? `<button type="button" class="btn btn-small" data-action="add-option" ${q.options.length >= 6 ? "disabled" : ""}>Add option</button>` : ""}
  `;
}

function tfFieldsHTML(q, canEdit) {
  const correct = q.correctIndex === 1 ? 1 : 0;
  return `
    <div class="tf-choice">
      <label class="tf-option"><input type="radio" name="tf-${q.clientId}" class="q-tf" value="0" ${correct === 0 ? "checked" : ""} ${canEdit ? "" : "disabled"}> True</label>
      <label class="tf-option"><input type="radio" name="tf-${q.clientId}" class="q-tf" value="1" ${correct === 1 ? "checked" : ""} ${canEdit ? "" : "disabled"}> False</label>
    </div>
    <p class="hint">Pick which one is correct.</p>`;
}

function numFieldsHTML(q, canEdit) {
  return `
    <div class="question-card-row">
      <label class="field field-narrow">
        <span>Correct number</span>
        <input type="number" step="any" class="q-num-value" value="${q.num_value ?? ""}" placeholder="e.g. 1969" ${canEdit ? "" : "disabled"}>
      </label>
      <label class="field field-narrow">
        <span>Tolerance (±)</span>
        <input type="number" step="any" min="0" class="q-num-tol" value="${q.num_tolerance ?? 0}" ${canEdit ? "" : "disabled"}>
      </label>
    </div>
    <p class="hint">Exact answer scores full marks; anything within the tolerance scores half. Set tolerance to 0 for exact-only.</p>
    ${q.id ? testerHTML("A number to try") : `<p class="hint">Save this question to try answers against it.</p>`}`;
}

function orderFieldsHTML(q, canEdit) {
  const items = q.options.length ? q.options : [{ text: "" }, { text: "" }];
  return `
    <p class="hint">List the items in the <b>correct</b> order — players see them shuffled and drag them back.</p>
    <div class="order-rows">
      ${items.map((o, i) => `
        <div class="order-row" data-order-index="${i}">
          <span class="order-pos">${i + 1}</span>
          <input type="text" class="q-order-text" value="${esc(o.text)}" placeholder="Item ${i + 1}" ${canEdit ? "" : "disabled"}>
          ${canEdit ? `
            <button type="button" class="btn btn-small" data-action="order-up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="btn btn-small" data-action="order-down" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="btn btn-small" data-action="remove-order" ${items.length <= 2 ? "disabled" : ""}>Remove</button>` : ""}
        </div>`).join("")}
    </div>
    ${canEdit ? `<button type="button" class="btn btn-small" data-action="add-order" ${items.length >= 6 ? "disabled" : ""}>Add item</button>` : ""}`;
}

function closestFieldsHTML(q, canEdit) {
  return `
    <label class="field field-narrow">
      <span>Actual number</span>
      <input type="number" step="any" class="q-num-value" value="${q.num_value ?? ""}" placeholder="e.g. 1204" ${canEdit ? "" : "disabled"}>
    </label>
    <p class="hint">Whoever lands nearest wins full marks — decided when you end the quiz, so it's a great one to save for last. Ties all win.</p>`;
}

function testerHTML(placeholder) {
  return `
    <div class="answer-tester">
      <label class="field">
        <span>Try an answer</span>
        <input type="text" class="q-test-input" placeholder="${placeholder}">
      </label>
      <button type="button" class="btn btn-small" data-action="test-answer">Test</button>
      <p class="test-result" data-role="test-result"></p>
    </div>`;
}

function textFieldsHTML(q, canEdit) {
  return `
    <label class="field">
      <span>Correct answer</span>
      <input type="text" class="q-correct-text" value="${esc(q.correct_text || "")}" ${canEdit ? "" : "disabled"}>
    </label>

    <div class="alt-rows">
      ${(q.alternates || []).map((a, i) => `
        <div class="alt-row" data-alt-index="${i}">
          <input type="text" class="q-alt" value="${esc(a)}" placeholder="Alternate accepted answer" ${canEdit ? "" : "disabled"}>
          ${canEdit ? `<button type="button" class="btn btn-small" data-action="remove-alt">Remove</button>` : ""}
        </div>`).join("")}
    </div>
    ${canEdit ? `<button type="button" class="btn btn-small" data-action="add-alt">Add alternate answer</button>` : ""}

    ${q.id ? `
      <div class="answer-tester">
        <label class="field">
          <span>Try an answer</span>
          <input type="text" class="q-test-input" placeholder="What might someone type?">
        </label>
        <button type="button" class="btn btn-small" data-action="test-answer">Test</button>
        <p class="test-result" data-role="test-result"></p>
      </div>` : `<p class="hint">Save this question to try answers against it.</p>`}
  `;
}

function mediaRowHTML(media, index, canEdit) {
  return `
    <div class="media-row" data-media-id="${media.id || ""}">
      <div class="question-card-row">
        <label class="field field-narrow">
          <span>Type</span>
          <select class="q-media-type" ${canEdit ? "" : "disabled"}>
            <option value="image" ${media.media_type === "image" ? "selected" : ""}>Image</option>
            <option value="audio" ${media.media_type === "audio" ? "selected" : ""}>Audio</option>
            <option value="video" ${media.media_type === "video" ? "selected" : ""}>Video</option>
          </select>
        </label>
        <label class="field field-narrow">
          <span>Order</span>
          <input type="number" class="q-media-sort" min="0" step="1" value="${Number(media.sort_order || index)}" ${canEdit ? "" : "disabled"}>
        </label>
      </div>
      <label class="field">
        <span>File or HTTPS URL</span>
        <div class="media-upload-row">
          <input type="url" class="q-media-url" value="${esc(media.url || "")}" placeholder="https://... or upload a file" ${canEdit ? "" : "disabled"}>
          ${canEdit ? `
            <label class="btn btn-small media-upload-btn">
              Upload
              <input type="file" class="q-media-file" accept="image/*,audio/*,video/*" hidden>
            </label>` : ""}
        </div>
        <p class="media-upload-status" data-role="media-upload-status" hidden></p>
      </label>
      <label class="field">
        <span>Caption</span>
        <input type="text" class="q-media-caption" value="${esc(media.caption || "")}" placeholder="Optional caption" ${canEdit ? "" : "disabled"}>
      </label>
      ${canEdit ? `<button type="button" class="btn btn-small" data-action="remove-media">Remove</button>` : ""}
    </div>`;
}

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // generous for a phone photo or a short clip

async function handleMediaUpload(fileInput) {
  const file = fileInput.files[0];
  fileInput.value = ""; // let the same file be picked again later
  if (!file) return;

  const row = fileInput.closest(".media-row");
  const card = fileInput.closest(".question-card");
  const status = row.querySelector('[data-role="media-upload-status"]');
  const urlInput = row.querySelector(".q-media-url");
  const typeSelect = row.querySelector(".q-media-type");

  const showStatus = (text) => { status.textContent = text; status.hidden = false; };

  if (!/^(image|audio|video)\//.test(file.type)) {
    return showStatus("Please choose an image, audio, or video file.");
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return showStatus("That file is too big (25MB max). Try a smaller one, or paste a link instead.");
  }

  typeSelect.value = file.type.split("/")[0];
  showStatus("Uploading…");

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${currentWeek.id}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await db.storage.from("question-media").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) return showStatus(`Upload failed: ${error.message}`);

  const { data } = db.storage.from("question-media").getPublicUrl(path);
  urlInput.value = data.publicUrl;
  urlInput.dispatchEvent(new Event("input", { bubbles: true }));

  showStatus("Uploaded ✓");
  const q = questions.find((x) => x.clientId === card.dataset.clientId);
  if (q) q.saved = false;
}

function renderPreview() {
  $("quiz-preview").hidden = !previewOpen;
  if (!previewOpen) return;

  const withPrompts = questions.filter((q) => q.prompt.trim());
  $("quiz-preview").innerHTML = withPrompts.map((q, i) => `
    <div class="preview-card">
      <p class="preview-number">Question ${i + 1} · ${fmtPoints(q.points)} ${Number(q.points) === 1 ? "point" : "points"}</p>
      <p class="preview-prompt">${esc(q.prompt)}</p>
      ${previewAnswerHTML(q)}
      ${(q.media || []).length ? `<div class="preview-media">${(q.media || []).map((m) => `<span class="preview-media-tag">${esc(m.media_type || "media")}</span>`).join("")}</div>` : ""}
    </div>`).join("") || `<p class="hint">Nothing to preview yet.</p>`;
}

function previewAnswerHTML(q) {
  if (q.q_type === "mc") {
    return `<div class="preview-options">${q.options.map((o) => `<span class="preview-option">${esc(o.text || "…")}</span>`).join("")}</div>`;
  }
  if (q.q_type === "tf") {
    return `<div class="preview-options"><span class="preview-option">True</span><span class="preview-option">False</span></div>`;
  }
  if (q.q_type === "order") {
    return `<div class="preview-options">${q.options.map((o, i) => `<span class="preview-option">${i + 1}. ${esc(o.text || "…")}</span>`).join("")}<span class="preview-hint-inline">shown shuffled</span></div>`;
  }
  if (q.q_type === "num") {
    return `<input class="preview-answer" disabled placeholder="Player types a number">`;
  }
  if (q.q_type === "closest") {
    return `<input class="preview-answer" disabled placeholder="Player types a number — closest wins">`;
  }
  return `<input class="preview-answer" disabled placeholder="Player types their answer here">`;
}

$("preview-toggle").addEventListener("click", () => {
  previewOpen = !previewOpen;
  $("preview-toggle").textContent = previewOpen ? "Hide preview" : "Show preview";
  renderPreview();
});

$("add-question-btn").addEventListener("click", () => {
  syncAllCardsFromDOM();
  questions.push(newDraft());
  renderQuestions();
});

$("questions-list").addEventListener("input", (e) => {
  const card = e.target.closest(".question-card");
  if (!card) return;
  card.classList.add("is-dirty");
  const q = questions.find((x) => x.clientId === card.dataset.clientId);
  if (q) q.saved = false;
});

$("questions-list").addEventListener("change", (e) => {
  const fileInput = e.target.closest(".q-media-file");
  if (fileInput) return handleMediaUpload(fileInput);

  const typeSelect = e.target.closest(".q-type");
  if (!typeSelect) return;

  const card = typeSelect.closest(".question-card");
  const clientId = card.dataset.clientId;
  syncCardFromDOM(clientId);

  const q = questions.find((x) => x.clientId === clientId);
  q.q_type = typeSelect.value;
  if ((q.q_type === "mc" || q.q_type === "order") && q.options.length < 2) {
    q.options = [{ text: "" }, { text: "" }];
    q.correctIndex = 0;
  }
  q.saved = false;
  renderQuestions();
});

$("questions-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const card = btn.closest(".question-card");
  const clientId = card?.dataset.clientId;
  const action = btn.dataset.action;

  if (["add-option", "remove-option", "add-alt", "remove-alt", "add-media", "remove-media",
       "add-order", "remove-order", "order-up", "order-down"].includes(action)) {
    syncCardFromDOM(clientId);
    const q = questions.find((x) => x.clientId === clientId);

    if (action === "add-option" && q.options.length < 6) {
      q.options.push({ text: "" });
    }
    if (action === "remove-option" && q.options.length > 2) {
      const i = Number(btn.closest(".option-row").dataset.optionIndex);
      q.options.splice(i, 1);
      if (q.correctIndex === i) q.correctIndex = 0;
      else if (q.correctIndex > i) q.correctIndex -= 1;
    }
    if (action === "add-order" && q.options.length < 6) {
      q.options.push({ text: "" });
    }
    if (action === "remove-order" && q.options.length > 2) {
      const i = Number(btn.closest(".order-row").dataset.orderIndex);
      q.options.splice(i, 1);
    }
    if (action === "order-up" || action === "order-down") {
      const i = Number(btn.closest(".order-row").dataset.orderIndex);
      const j = action === "order-up" ? i - 1 : i + 1;
      if (j >= 0 && j < q.options.length) {
        [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
      }
    }
    if (action === "add-alt") {
      q.alternates = q.alternates || [];
      q.alternates.push("");
    }
    if (action === "remove-alt") {
      const i = Number(btn.closest(".alt-row").dataset.altIndex);
      q.alternates.splice(i, 1);
    }
    if (action === "add-media") {
      q.media = q.media || [];
      q.media.push(normalizeMediaEntry({ media_type: "image", source_type: "url", url: "", caption: "", sort_order: q.media.length }));
    }
    if (action === "remove-media") {
      const row = btn.closest(".media-row");
      const idx = Array.from(card.querySelectorAll(".media-row")).indexOf(row);
      if (idx >= 0) q.media.splice(idx, 1);
    }
    q.saved = false;
    renderQuestions();
    return;
  }

  if (action === "delete-question") return deleteQuestion(clientId);
  if (action === "save-question") return saveQuestion(clientId);
  if (action === "test-answer") return testAnswer(clientId);

  if (action === "move-up" || action === "move-down") {
    const q = questions.find((x) => x.clientId === clientId);
    if (q?.id) return moveQuestion(q.id, action === "move-up" ? "up" : "down");
  }
});

async function saveQuestion(clientId) {
  syncAllCardsFromDOM();
  const q = questions.find((x) => x.clientId === clientId);
  const err = $("host-error");
  err.hidden = true;

  const invalidMedia = (q.media || []).find((m) => m.url && !isSafeMediaUrl(m.url));
  if (invalidMedia) {
    err.textContent = "Media links must be full HTTPS URLs.";
    err.hidden = false;
    return;
  }

  const keyed = q.options.map((o, i) => ({ key: String.fromCharCode(65 + i), text: o.text }));

  const { data, error } = await db.rpc("host_save_question", {
    p_question_id: q.id,
    p_week_id: currentWeek.id,
    p_q_type: q.q_type,
    p_prompt: q.prompt,
    p_points: q.points,
    p_options: (q.q_type === "mc" || q.q_type === "order") ? keyed : null,
    p_correct_key: q.q_type === "mc" ? String.fromCharCode(65 + q.correctIndex)
                 : q.q_type === "tf" ? (q.correctIndex === 1 ? "F" : "T")
                 : null,
    p_correct_text: q.q_type === "text" ? q.correct_text : null,
    p_alternates: q.q_type === "text" ? (q.alternates || []).map((a) => a.trim()).filter(Boolean) : [],
    p_media: (q.media || []).map((m) => normalizeMediaEntry(m)),
    p_num_value: (q.q_type === "num" || q.q_type === "closest") ? q.num_value : null,
    p_num_tolerance: q.q_type === "num" ? q.num_tolerance : null,
    // items are authored in correct order, so the correct sequence is just their keys in order
    p_correct_order: q.q_type === "order" ? keyed.map((o) => o.key) : null,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  q.id = row.id;
  q.clientId = row.id;
  q.q_number = row.q_number;
  q.saved = true;
  renderQuestions();
}

async function deleteQuestion(clientId) {
  const q = questions.find((x) => x.clientId === clientId);
  if (!q) return;

  if (q.id) {
    if (!confirm("Delete this question? This can't be undone.")) return;
    const { error } = await db.rpc("host_delete_question", { p_question_id: q.id });
    if (error) {
      $("host-error").textContent = error.message;
      $("host-error").hidden = false;
      return;
    }
    await loadQuestions();
  } else {
    syncAllCardsFromDOM();
    questions = questions.filter((x) => x.clientId !== clientId);
    renderQuestions();
  }
}

async function moveQuestion(id, direction) {
  const savedIds = questions.filter((q) => q.id).map((q) => q.id);
  const idx = savedIds.indexOf(id);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= savedIds.length) return;

  [savedIds[idx], savedIds[swapWith]] = [savedIds[swapWith], savedIds[idx]];

  const err = $("host-error");
  err.hidden = true;

  const { error } = await db.rpc("host_reorder_questions", {
    p_week_id: currentWeek.id,
    p_ordered_ids: savedIds,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadQuestions();
}

async function testAnswer(clientId) {
  const card = document.querySelector(`.question-card[data-client-id="${clientId}"]`);
  const q = questions.find((x) => x.clientId === clientId);
  const input = card.querySelector(".q-test-input");
  const resultEl = card.querySelector("[data-role='test-result']");
  const sample = input.value.trim();
  if (!sample) return;

  const { data, error } = await db.rpc("test_answer", { p_question_id: q.id, p_sample: sample });
  if (error) {
    resultEl.textContent = error.message;
    resultEl.className = "test-result is-wrong";
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const label = row.verdict === "correct" ? "Full marks" : row.verdict === "partial" ? "Half marks" : "No marks";
  resultEl.textContent = `${label} (${fmtPoints(row.points)} pts)`;
  resultEl.className = `test-result is-${row.verdict}`;
}

const fmtPoints = (n) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(1);

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" });
}
