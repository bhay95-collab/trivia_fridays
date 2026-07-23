import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.8/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { loadMe, setupNav } from "./auth.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

let roster = [];       // last result of admin_roster()
let myPlayerId = null;

/* ============================================================
   BOOT
   ============================================================ */
(async function boot() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return locked("Sign in on the leaderboard first, then come back here.");

    const { data: me, error } = await loadMe(db, session);

    if (error || !me) return locked("This page is for admins only.");
    if (!me.is_admin) return locked("This page is for admins only.");

    myPlayerId = me.id;
    show("view-admin");
    $("tagline").textContent = "People and quizzes";
    $("whoami-name").textContent = me.display_name;

    setupNav(db, me); // admins get every link

    await loadPeople();
    await loadWeeks();
  } catch (err) {
    locked("Could not reach the database. Check config.js.");
  }
})();

function locked(message) {
  $("locked-message").textContent = message;
  $("tagline").textContent = "Admin";
  show("view-locked");
}

function show(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
}

/* ============================================================
   PEOPLE
   ============================================================ */
async function loadPeople() {
  const err = $("people-error");
  err.hidden = true;

  const { data, error } = await db.rpc("admin_roster");
  if (error) {
    $("people-rows").innerHTML = `<tr><td colspan="5" class="table-empty">${esc(error.message)}</td></tr>`;
    return;
  }

  roster = data || [];
  renderPeople();
  fillHostSelect($("new-week-host"));
  document.querySelectorAll(".week-host-select").forEach((sel) => fillHostSelect(sel, sel.dataset.selected));
}

function renderPeople() {
  const activeAdmins = roster.filter((p) => p.is_admin && p.is_active).length;

  $("people-rows").innerHTML = roster.map((p) => {
    const isMe = p.id === myPlayerId;
    const lastAdmin = p.is_admin && activeAdmins <= 1;

    return `
      <tr class="${p.is_active ? "" : "is-inactive"}">
        <td>
          <div class="cell-name">
            ${esc(p.display_name)}
            ${isMe ? `<span class="tag-you">you</span>` : ""}
            ${p.is_admin ? `<span class="badge badge-admin">Admin</span>` : ""}
            ${!p.is_active ? `<span class="badge badge-left">Left</span>` : ""}
          </div>
          <div class="cell-slug">${esc(p.slug)}</div>
        </td>
        <td>${p.pin_set ? "Set" : "Not set"}</td>
        <td class="mono">${fmt(p.total_points)}</td>
        <td class="mono">${p.weeks_played}</td>
        <td>
          <div class="row-actions">
            ${p.pin_set ? `<button class="btn btn-small" data-action="reset-pin" data-id="${p.id}" data-name="${esc(p.display_name)}">Reset PIN</button>` : ""}
            <button class="btn btn-small" data-action="toggle-admin" data-id="${p.id}" data-value="${!p.is_admin}"
              ${isMe || lastAdmin ? "disabled" : ""}
              title="${isMe ? "You cannot remove your own admin rights." : lastAdmin ? "This is the last admin." : ""}">
              ${p.is_admin ? "Remove admin" : "Make admin"}
            </button>
            <button class="btn btn-small" data-action="toggle-active" data-id="${p.id}" data-value="${!p.is_active}" data-name="${esc(p.display_name)}"
              ${isMe && p.is_active ? "disabled" : ""}
              title="${isMe && p.is_active ? "You cannot deactivate yourself." : ""}">
              ${p.is_active ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="5" class="table-empty">Nobody on the roster yet.</td></tr>`;
}

$("add-player-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("new-player-name");
  const err = $("people-error");
  err.hidden = true;

  const name = input.value.trim();
  if (!name) return;

  const { error } = await db.rpc("admin_add_player", { p_display_name: name });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  input.value = "";
  await loadPeople();
});

$("people-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const err = $("people-error");
  err.hidden = true;

  const id = btn.dataset.id;
  let error;

  if (btn.dataset.action === "reset-pin") {
    if (!confirm(`Reset the PIN for ${btn.dataset.name}? They will need to set a new one next time they sign in. Their past scores are not affected.`)) return;
    ({ error } = await db.rpc("admin_reset_pin", { p_player_id: id }));
  }

  if (btn.dataset.action === "toggle-admin") {
    const makeAdmin = btn.dataset.value === "true";
    ({ error } = await db.rpc("admin_set_admin", { p_player_id: id, p_is_admin: makeAdmin }));
  }

  if (btn.dataset.action === "toggle-active") {
    const makeActive = btn.dataset.value === "true";
    if (!makeActive && !confirm(`Deactivate ${btn.dataset.name}? They won't be able to sign in, but all of their past scores stay on the board.`)) return;
    ({ error } = await db.rpc("admin_set_active", { p_player_id: id, p_active: makeActive }));
  }

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadPeople();
});

/* ============================================================
   QUIZZES
   ============================================================ */
async function loadWeeks() {
  const err = $("weeks-error");
  err.hidden = true;

  const { data, error } = await db.rpc("weeks_with_hosts");
  if (error) {
    $("weeks-rows").innerHTML = `<tr><td colspan="5" class="table-empty">${esc(error.message)}</td></tr>`;
    return;
  }

  renderWeeks(data || []);
}

function renderWeeks(weeks) {
  $("weeks-rows").innerHTML = weeks.map((w) => `
    <tr>
      <td class="mono">${w.quiz_date}</td>
      <td>${esc(w.title || "—")}</td>
      <td>
        <select class="week-host-select" data-week-id="${w.id}" data-selected="${w.host_id || ""}">
          <option value="">No host yet</option>
        </select>
      </td>
      <td><span class="badge badge-status status-${w.status}">${w.status}</span></td>
      <td>
        <button class="btn btn-small" data-action="delete-week" data-id="${w.id}" data-date="${w.quiz_date}"
          data-status="${w.status}">Delete</button>
      </td>
    </tr>`).join("") || `<tr><td colspan="5" class="table-empty">No quizzes yet.</td></tr>`;

  document.querySelectorAll(".week-host-select").forEach((sel) => fillHostSelect(sel, sel.dataset.selected));
}

function fillHostSelect(select, selectedId) {
  const current = selectedId !== undefined ? selectedId : select.value;
  const options = roster
    .slice()
    .sort((a, b) => a.display_name.localeCompare(b.display_name))
    .map((p) => `<option value="${p.id}">${esc(p.display_name)}${p.is_active ? "" : " (left)"}</option>`)
    .join("");
  select.innerHTML = `<option value="">No host yet</option>${options}`;
  select.value = current || "";
}

$("add-week-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("weeks-error");
  err.hidden = true;

  const date = $("new-week-date").value;
  if (!date) {
    err.textContent = "Pick a date first.";
    err.hidden = false;
    return;
  }

  const title = $("new-week-title").value.trim();
  const hostId = $("new-week-host").value || null;

  const { error } = await db.rpc("admin_create_week", {
    p_quiz_date: date,
    p_title: title || null,
    p_host_id: hostId,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  $("new-week-date").value = "";
  $("new-week-title").value = "";
  $("new-week-host").value = "";
  await loadWeeks();
});

$("weeks-rows").addEventListener("change", async (e) => {
  const sel = e.target.closest(".week-host-select");
  if (!sel) return;

  const err = $("weeks-error");
  err.hidden = true;

  const { error } = await db.rpc("admin_set_host", {
    p_week_id: sel.dataset.weekId,
    p_host_id: sel.value || null,
  });

  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    await loadWeeks();
    return;
  }
});

$("weeks-rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action='delete-week']");
  if (!btn) return;

  const status = btn.dataset.status;
  const message = status === "closed"
    ? `Delete the ${btn.dataset.date} quiz? It's already closed - this permanently wipes its questions, answers, and everyone's scores for that night. Other quizzes' scores and streaks are unaffected.`
    : status === "live"
    ? `Delete the ${btn.dataset.date} quiz? It's LIVE right now - players are actively answering questions. Deleting it will immediately kick everyone out mid-quiz and wipe every answer submitted so far. This can't be undone.`
    : `Delete the ${btn.dataset.date} quiz? This can't be undone.`;
  if (!confirm(message)) return;

  const err = $("weeks-error");
  err.hidden = true;

  const { error } = await db.rpc("admin_delete_week", { p_week_id: btn.dataset.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadWeeks();
});

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const fmt = (n) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(1);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
