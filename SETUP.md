# Trivia Fridays — Stage 1 setup

Stage 1 gives you: a live site, name + PIN login, and the season leaderboard
with your four existing weeks already loaded.

Follow in order. Roughly 30 minutes.

---

## Part 1 — Make the database (Supabase)

**1.1** Go to `https://supabase.com` and sign up (free tier is plenty).

**1.2** Click **New project**.
- Name: `trivia-fridays`
- Database password: click Generate, then **save it somewhere**. You will not need it often, but you cannot recover it.
- Region: **Southeast Asia (Singapore)** — closest to Brisbane.
- Click **Create new project**. Wait ~2 minutes.

**1.3 Turn off email confirmation.** This is essential — logins are name + PIN, there are no real inboxes.
- Left sidebar → **Authentication** → **Sign In / Providers** → **Email**
- Turn **Confirm email** OFF
- Click **Save**

**1.4 Build the tables.**
- Left sidebar → **SQL Editor** → **New query**
- Open `sql/01_schema.sql`, copy the **entire** file, paste it in
- Click **Run**
- You want *Success. No rows returned.* If you get an error, stop and send me the message.

**1.5 Load your people and past scores.**
- **SQL Editor** → **New query**
- Open `sql/02_seed.sql`, copy the whole file, paste, **Run**

**1.6 Check it worked.**
- **SQL Editor** → New query → paste `select * from leaderboard order by total_points desc;` → Run
- You should see 21 people. Benjamin Hay on top with 54.

**1.7 Grab your two keys.**
- Left sidebar → **Project Settings** (cog) → **API Keys**
- Copy the **Project URL** and the **anon / public** key. Keep the tab open.

> The anon key is safe to publish. Answers are protected by the database rules in the schema, not by hiding this key.

---

## Part 2 — Wire up the site

**2.1** Open `config.js` in Notepad (or any text editor).

**2.2** Replace the two placeholder values with the URL and anon key you just copied. Keep the quote marks.

**2.3** Save.

---

## Part 3 — Put it on the internet (GitHub Pages)

**3.1** Sign up at `https://github.com` if you have not already.

**3.2** Click **+** (top right) → **New repository**
- Name: `trivia-fridays`
- **Public** (Pages is free only for public repos)
- Do **not** tick "Add a README"
- **Create repository**

**3.3 Upload the files.**
- On the empty repo page, click **uploading an existing file**
- Drag in: `index.html`, `app.js`, `styles.css`, `config.js`
- Then drag the whole `sql` folder in too (harmless, and it keeps everything together)
- Click **Commit changes**

**3.4 Switch Pages on.**
- Repo → **Settings** → **Pages** (left sidebar)
- Source: **Deploy from a branch**
- Branch: **main**, folder: **/ (root)** → **Save**
- Wait 1–2 minutes, then refresh. GitHub shows your address:
  `https://YOURNAME.github.io/trivia-fridays/`

**3.5** Open it on your phone. Pick your name. Set a PIN. You should land on the leaderboard.

---

## Part 4 — Day to day

**Adding a new starter**
SQL Editor → New query:
```sql
insert into players (slug, display_name)
values ('jane.smith', 'Jane Smith');
```
The slug is the name in lower case with dots instead of spaces, no apostrophes.

**Someone forgot their PIN**
```sql
-- 1. unlink their account
update players set auth_id = null where slug = 'jane.smith';
-- 2. Authentication > Users > find jane.smith@triviafridays.local > Delete user
```
They then set a fresh PIN next visit.

**Making someone else an admin (your backup while you are away)**
```sql
update players set is_admin = true where slug = 'jane.smith';
```

**Making changes to the site**
Edit the file on GitHub (click the file → pencil icon → Commit), or re-upload it.
Live in about a minute. Hard refresh your phone if you see the old version.

---

## Still to build

- **Stage 2** — topic suggestions box + weekly poll
- **Stage 3** — host's quiz builder (multiple choice + free text, points per question)
- **Stage 4** — live play night, auto-scoring, host override panel
- **Stage 5** — the chaos: sounds, streak badges, animated overtakes, hall of shame

The database schema already covers all of it, so no rebuilding later.
