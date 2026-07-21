import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let myPlayer = null;
let currentWeek = null;      // full row for the week being managed
let ballot = [];             // poll_options for currentWeek
let results = null;          // poll_results, only fetched while polling
let questions = [];          // draft state for the quiz builder
let previewOpen = false;

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

  const presentLink = $("nav-present");
  if (presentLink) presentLink.hidden = false;

  show("view-host");
  $("tagline").textContent = "Your quiz night";
  await loadWeek(data[0].id);
}

$("week-switcher").addEventListener("change", (e) => {
  if (questions.some((q) => !q.saved) && !confirm("Switch nights? Any unsaved question changes will be lost.")) {
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
    err.textContent = "Could not load that quiz night.";
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

  await Promise.all([loadSuggestions(), loadBallot(), loadQuestions()]);
  renderBallotActions();
}

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
  const isMC = row.q_type === "mc";
  const options = isMC ? (row.options || []).map((o) => ({ text: o.text })) : [{ text: "" }, { text: "" }];
  const correctIndex = isMC ? (row.options || []).findIndex((o) => o.key === row.correct_key) : 0;
  return {
    clientId: row.id,
    id: row.id,
    q_number: row.q_number,
    q_type: row.q_type,
    prompt: row.prompt,
    points: Number(row.points),
    options,
    correctIndex: correctIndex >= 0 ? correctIndex : 0,
    correct_text: row.correct_text || "",
    alternates: row.alternates || [],
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
  } else {
    const correctInput = card.querySelector(".q-correct-text");
    if (correctInput) q.correct_text = correctInput.value;
    const altInputs = card.querySelectorAll(".q-alt");
    if (card.querySelector(".alt-rows")) q.alternates = [...altInputs].map((i) => i.value);
  }
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

function questionCardHTML(q, index, canEdit, savedIndex, savedTotal) {
  const isMC = q.q_type === "mc";
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
            <option value="mc" ${isMC ? "selected" : ""}>Multiple choice</option>
            <option value="text" ${!isMC ? "selected" : ""}>Free text</option>
          </select>
        </label>
        <label class="field field-narrow">
          <span>Points</span>
          <input class="q-points" type="number" min="0.5" step="0.5" value="${q.points}" ${canEdit ? "" : "disabled"}>
        </label>
      </div>

      ${isMC ? mcFieldsHTML(q, canEdit) : textFieldsHTML(q, canEdit)}

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

function renderPreview() {
  $("quiz-preview").hidden = !previewOpen;
  if (!previewOpen) return;

  const withPrompts = questions.filter((q) => q.prompt.trim());
  $("quiz-preview").innerHTML = withPrompts.map((q, i) => `
    <div class="preview-card">
      <p class="preview-number">Question ${i + 1} · ${fmtPoints(q.points)} ${Number(q.points) === 1 ? "point" : "points"}</p>
      <p class="preview-prompt">${esc(q.prompt)}</p>
      ${q.q_type === "mc"
        ? `<div class="preview-options">${q.options.map((o) => `<span class="preview-option">${esc(o.text || "…")}</span>`).join("")}</div>`
        : `<input class="preview-answer" disabled placeholder="Player types their answer here">`}
    </div>`).join("") || `<p class="hint">Nothing to preview yet.</p>`;
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
  const typeSelect = e.target.closest(".q-type");
  if (!typeSelect) return;

  const card = typeSelect.closest(".question-card");
  const clientId = card.dataset.clientId;
  syncCardFromDOM(clientId);

  const q = questions.find((x) => x.clientId === clientId);
  q.q_type = typeSelect.value;
  if (q.q_type === "mc" && q.options.length < 2) {
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

  if (["add-option", "remove-option", "add-alt", "remove-alt"].includes(action)) {
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
    if (action === "add-alt") {
      q.alternates = q.alternates || [];
      q.alternates.push("");
    }
    if (action === "remove-alt") {
      const i = Number(btn.closest(".alt-row").dataset.altIndex);
      q.alternates.splice(i, 1);
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

  const { data, error } = await db.rpc("host_save_question", {
    p_question_id: q.id,
    p_week_id: currentWeek.id,
    p_q_type: q.q_type,
    p_prompt: q.prompt,
    p_points: q.points,
    p_options: q.q_type === "mc" ? q.options.map((o, i) => ({ key: String.fromCharCode(65 + i), text: o.text })) : null,
    p_correct_key: q.q_type === "mc" ? String.fromCharCode(65 + q.correctIndex) : null,
    p_correct_text: q.q_type === "text" ? q.correct_text : null,
    p_alternates: q.q_type === "text" ? (q.alternates || []).map((a) => a.trim()).filter(Boolean) : [],
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
