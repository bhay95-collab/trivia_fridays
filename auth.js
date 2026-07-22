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

// Drop every cached identity in this tab. Call on sign-out so the next
// person to use the tab is looked up fresh instead of inheriting the
// last person's row.
export function clearMe() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("tf.me.")) sessionStorage.removeItem(k);
    }
  } catch {
    /* nothing to clear */
  }
}
