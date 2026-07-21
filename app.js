import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const emailFor = (slug) => `${slug}@${LOGIN_DOMAIN}`;

let roster = [];
let mySlug = null;
let myPlayerId = null;

/* ============================================================
   BOOT
   ============================================================ */
boot();

async function boot() {
  const { data: { session } } = await db.auth.getSession();
  if (session) return showBoard();
  await loadRoster();
  show("view-auth");
  $("tagline").textContent = "Sign in to see where you sit.";
}

// If the browser restores this page from back/forward cache after
// signing in elsewhere, re-check instead of showing a stale sign-in
// form for someone who's actually already signed in.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) boot();
});

function show(id) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== id));
}

/* ============================================================
   SIGN IN / FIRST-TIME PIN SETUP
   ============================================================ */
async function loadRoster() {
  const { data, error } = await db
    .from("players")
    .select("slug, display_name, auth_id")
    .eq("is_active", true)
    .order("display_name");

  if (error) {
    $("auth-error").textContent = "Could not reach the database. Check config.js.";
    $("auth-error").hidden = false;
    return;
  }

  roster = data;
  const sel = $("name-select");
  for (const p of roster) {
    const o = document.createElement("option");
    o.value = p.slug;
    o.textContent = p.display_name;
    sel.appendChild(o);
  }
}

$("name-select").addEventListener("change", (e) => {
  mySlug = e.target.value;
  const p = roster.find((r) => r.slug === mySlug);
  $("auth-error").hidden = true;

  if (!p) { $("pin-block").hidden = true; return; }

  const firstTime = !p.auth_id;
  $("pin-block").hidden = false;
  $("pin2-field").hidden = !firstTime;
  $("pin-hint").textContent = firstTime
    ? "First time here. Choose a 6-digit PIN you will remember."
    : "Welcome back. Enter your PIN.";
  $("auth-go").textContent = firstTime ? "Create my PIN" : "Let me in";
  $("pin").value = ""; $("pin2").value = "";
  $("pin").focus();
});

$("auth-go").addEventListener("click", signIn);
$("pin").addEventListener("keydown", (e) => e.key === "Enter" && signIn());
$("pin2").addEventListener("keydown", (e) => e.key === "Enter" && signIn());

async function signIn() {
  const err = $("auth-error");
  err.hidden = true;

  const p = roster.find((r) => r.slug === mySlug);
  if (!p) return fail("Pick your name first.");

  const pin = $("pin").value.trim();
  if (!/^\d{6}$/.test(pin)) return fail("PIN must be exactly 6 digits.");

  const firstTime = !p.auth_id;
  if (firstTime && pin !== $("pin2").value.trim()) return fail("The two PINs do not match.");

  $("auth-go").disabled = true;
  $("auth-go").textContent = "Hang on…";

  const creds = { email: emailFor(p.slug), password: pin };
  const { error } = firstTime
    ? await db.auth.signUp(creds)
    : await db.auth.signInWithPassword(creds);

  $("auth-go").disabled = false;
  $("auth-go").textContent = firstTime ? "Create my PIN" : "Let me in";

  if (error) {
    return fail(firstTime
      ? error.message
      : "That PIN does not match. Ask Ben to reset it if you are stuck.");
  }
  showBoard();

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
  }
}

$("sign-out").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

/* ============================================================
   LEADERBOARD
   ============================================================ */
async function showBoard() {
  show("view-board");
  $("tagline").textContent = "Season standings";

  const { data: { user } } = await db.auth.getUser();
  const meSlug = user ? user.email.split("@")[0] : null;

  const { data: rows, error } = await db
    .from("leaderboard")
    .select("*")
    .order("total_points", { ascending: false })
    .order("display_name");

  if (error) {
    $("rankings").innerHTML = `<li class="name">Scoreboard is not loading. Check the database setup.</li>`;
    return;
  }

  const meRow = rows.find((r) => slugify(r.display_name) === meSlug);
  $("whoami-name").textContent = meRow ? meRow.display_name : "Signed in";

  if (user) {
    const { data: me } = await db
      .from("players")
      .select("id, is_admin")
      .eq("auth_id", user.id)
      .maybeSingle();
    if (me) {
      myPlayerId = me.id;
      await initNav(me.id, me.is_admin);
    }
  }

  const ranked = withRanks(rows);
  renderPodium(ranked.slice(0, 3));
  renderRest(ranked.slice(3), meSlug);
  renderSpoon(ranked);

  if (meRow && ranked[0] && ranked[0].display_name === meRow.display_name) fireConfetti();

  await loadSuggestions();
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
   TOPIC SUGGESTIONS
   ============================================================ */
async function loadSuggestions() {
  const err = $("suggest-error");
  err.hidden = true;

  const { data, error } = await db
    .from("topic_suggestions")
    .select("id, topic, used, player_id, players(display_name)")
    .order("created_at", { ascending: false });

  if (error) {
    $("suggestion-list").innerHTML = `<li class="table-empty">Could not load suggestions.</li>`;
    return;
  }

  $("suggestion-list").innerHTML = data.map((s) => `
    <li class="${s.used ? "is-used" : ""}">
      <div class="suggestion-text">
        <span class="suggestion-topic">${esc(s.topic)}</span>
        <span class="suggestion-by">— ${esc(s.players?.display_name || "someone")}</span>
        ${s.used ? `<span class="badge badge-left">Used</span>` : ""}
      </div>
      ${s.player_id === myPlayerId ? `<button class="btn btn-small" data-id="${s.id}">Remove</button>` : ""}
    </li>`).join("") || `<li class="table-empty">No suggestions yet. Add the first one.</li>`;
}

$("suggest-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("suggest-input");
  const err = $("suggest-error");
  err.hidden = true;

  const topic = input.value.trim();
  if (!topic) return;

  const { error } = await db.rpc("suggest_topic", { p_topic: topic });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  input.value = "";
  await loadSuggestions();
});

$("suggestion-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-id]");
  if (!btn) return;

  const err = $("suggest-error");
  err.hidden = true;

  const { error } = await db.rpc("delete_suggestion", { p_suggestion_id: btn.dataset.id });
  if (error) {
    err.textContent = error.message;
    err.hidden = false;
    return;
  }

  await loadSuggestions();
});

// Equal points share a rank. 1,2,2,4 not 1,2,3,4.
function withRanks(rows) {
  let rank = 0, prev = null;
  return rows.map((r, i) => {
    if (r.total_points !== prev) { rank = i + 1; prev = r.total_points; }
    return { ...r, rank };
  });
}

function renderPodium(top) {
  const order = [1, 0, 2]; // 2nd, 1st, 3rd
  $("podium").innerHTML = order.map((i) => {
    const r = top[i];
    if (!r) return `<div></div>`;
    return `
      <div class="plinth p${i + 1}">
        <span class="medal">${["1st", "2nd", "3rd"][i]}</span>
        <span class="who">${esc(r.display_name)}</span>
        <span class="pts">${fmt(r.total_points)}</span>
        <span class="sub">${r.weeks_played} nights</span>
      </div>`;
  }).join("");
}

function renderRest(rows, meSlug) {
  $("rankings").innerHTML = rows.map((r, i) => `
    <li class="${slugify(r.display_name) === meSlug ? "is-me" : ""}"
        style="animation-delay:${0.6 + i * 0.04}s">
      <span class="rank">${ordinal(r.rank)}</span>
      <span class="name">${esc(r.display_name)}</span>
      <span class="played">${r.weeks_played} nights</span>
      <span class="score">${fmt(r.total_points)}</span>
    </li>`).join("");
}

function renderSpoon(ranked) {
  const played = ranked.filter((r) => r.weeks_played > 0);
  if (played.length < 4) return;
  const last = played[played.length - 1];
  const el = $("spoon");
  el.hidden = false;
  el.innerHTML = `<b>Wooden Spoon:</b> ${esc(last.display_name)} — ${fmt(last.total_points)} points
    across ${last.weeks_played} nights. There is nowhere to go but up.`;
}

/* ============================================================
   BITS AND PIECES
   ============================================================ */
const fmt = (n) => Number(n) % 1 === 0 ? Number(n).toString() : Number(n).toFixed(1);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slugify = (n) => n.normalize("NFKD").replace(/[^A-Za-z ]/g, "")
  .trim().toLowerCase().split(/\s+/).join(".");

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fireConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const cv = $("confetti"), ctx = cv.getContext("2d");
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ["#FF2D95", "#22E3E0", "#FFC531", "#FFF1DC"];
  const bits = Array.from({ length: 140 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height,
    r: 3 + Math.random() * 5, vy: 2 + Math.random() * 3,
    vx: -1 + Math.random() * 2, a: Math.random() * Math.PI,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const b of bits) {
      b.y += b.vy; b.x += b.vx; b.a += 0.1;
      ctx.fillStyle = b.c;
      ctx.fillRect(b.x, b.y, b.r, b.r * 2.2 * Math.abs(Math.cos(b.a)));
    }
    if (++frames < 320) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}
