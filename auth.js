// ============================================================
// WHO AM I? — resolved once per tab, then cached.
//
// Every page has to turn the signed-in session into a player row
// (id, display_name, is_admin). The session token itself lives in
// localStorage and is read with no network call, but mapping it to a
// player used to be a fresh round trip to Supabase on *every* page
// navigation - that is the "Checking who you are…" pause you feel
// between pages. That mapping never changes for the life of a tab, so
// we keep it in sessionStorage and hand it straight back on the next
// page. A brand-new tab starts with empty sessionStorage and looks it
// up once; signing out clears it - so it can never go stale across
// different people sharing a device.
// ============================================================

const keyFor = (userId) => `tf.me.${userId}`;

function readCache(userId) {
  try {
    const raw = sessionStorage.getItem(keyFor(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // storage blocked - just fall back to the network
  }
}

function writeCache(userId, me) {
  try {
    sessionStorage.setItem(keyFor(userId), JSON.stringify(me));
  } catch {
    /* storage blocked - skip the cache, correctness is unaffected */
  }
}

// Returns the same { data, error } shape as the players query it
// replaces, so callers keep their existing branching untouched.
export async function loadMe(db, session) {
  const userId = session.user.id;

  const cached = readCache(userId);
  if (cached) return { data: cached, error: null };

  const res = await db
    .from("players")
    .select("id, display_name, is_admin")
    .eq("auth_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!res.error && res.data) writeCache(userId, res.data);
  return res;
}

// ============================================================
// HEADER NAV — resolved once, then held constant across pages.
//
// The Host / Present / Admin links start hidden and only show for the
// people they apply to. Working that out for a non-admin used to mean
// a `weeks` lookup on every page (are you hosting an open quiz?) -
// which is exactly why the links flickered on as you moved between
// pages. Whether you're an admin or a host doesn't change mid-session,
// so we resolve it once, cache it, and every later page applies it
// synchronously with no round trip and no flicker.
// ============================================================

const NAV_KEY = "tf.nav";

function readNav() {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applyNav({ admin, host }) {
  const set = (id, show) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !show;
  };
  set("nav-admin", admin);
  set("nav-host", host);
  set("nav-present", host);
}

// Set the header links for the signed-in player. Cache-first: if we
// already worked this out in the tab, apply it instantly. Otherwise
// resolve it - admins get every link; everyone else gets Host/Present
// only while they're hosting an open quiz - then cache and apply.
export async function setupNav(db, me) {
  const cached = readNav();
  if (cached) return applyNav(cached);

  const admin = !!me.is_admin;
  let host = admin;
  if (!admin) {
    const { data } = await db
      .from("weeks")
      .select("id")
      .eq("host_id", me.id)
      .neq("status", "closed")
      .limit(1);
    host = !!(data && data.length);
  }

  const nav = { admin, host };
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify(nav));
  } catch {
    /* storage blocked - apply anyway, just without the cache */
  }
  applyNav(nav);
}

// Drop every cached identity and nav state in this tab. Call on
// sign-out so the next person to use the tab is looked up fresh
// instead of inheriting the last person's row or links.
export function clearMe() {
  try {
    sessionStorage.removeItem(NAV_KEY);
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("tf.me.")) sessionStorage.removeItem(k);
    }
  } catch {
    /* nothing to clear */
  }
}
