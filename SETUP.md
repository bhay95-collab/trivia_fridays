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

**1.6 Add the admin functions.**
- **SQL Editor** → **New query**
- Open `sql/04_admin_functions.sql`, copy the whole file, paste, **Run**
- This gives the admin page a safe way to add people, reset PINs, and manage quiz nights. It is safe to re-run any time you update it.

**1.7 Add the topic suggestions and poll functions.**
- **SQL Editor** → **New query**
- Open `sql/05_poll_functions.sql`, copy the whole file, paste, **Run**
- This powers the suggestion box, the host's ballot builder, and the voting page. Also safe to re-run any time.

**1.8 Add the quiz builder functions.**
- **SQL Editor** → **New query**
- Open `sql/06_quiz_functions.sql`, copy the whole file, paste, **Run**
- This powers the Questions section on the host page — writing questions and answer keys, and grading. Also safe to re-run any time.

**1.9 Check it worked.**
- **SQL Editor** → New query → paste `select * from leaderboard order by total_points desc;` → Run
- You should see 21 people. Benjamin Hay on top with 54.

**1.10 Grab your two keys.**
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
- Drag in: `index.html`, `app.js`, `styles.css`, `config.js`, `admin.html`, `admin.js`, `poll.html`, `poll.js`, `host.html`, `host.js`
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

Everything below is done from the site, not raw SQL. There's a small nav bar
on every page: **Leaderboard**, **Poll**, and — only for the people entitled
to see them — **Host** and **Admin**.

**Suggesting a topic**
Anyone signed in can drop an idea in the pool from the leaderboard page.
Suggestions are not anonymous — everyone can see who suggested what. Your
own suggestions have a **Remove** button.

**Building a ballot for the week**
Whoever is hosting opens the **Host** page (admins can host any night; other
players only see their own). Pick a few suggestions for the ballot, or write
a topic nobody suggested. **Open the poll** once there are at least two
options.

**Voting**
Everyone (except the host of that night) votes on the **Poll** page. Tap a
topic to vote, tap another to change your mind. Counts update live.

**Closing the poll**
Back on the **Host** page, **Close the poll** once people have voted. The
winning topic is saved automatically and shown on the host page. A tie is
broken at random and the page tells you when that happens.

**Writing the questions**
On the **Host** page, scroll down to **Questions**. **Add question**, pick
multiple choice or free text, write the prompt, and set the points (1 by
default — make a bonus round worth more if you like). Multiple choice needs
2 to 6 options with one marked correct. Free text needs a correct answer,
plus any alternates you want to accept ("JFK" as well as "John F Kennedy").

For every free text question, use **Try an answer** before the night — type
what you think someone might write and it tells you straight away whether
that would score full marks, half marks, or nothing. If a reasonable answer
scores nothing, loosen your answer key now, not during the quiz.

Move questions up and down to reorder them, and use **Show preview** to see
exactly what players will see — it never shows which option is correct.
An unsaved question is marked so you never lose track of it, and the page
will warn you before you navigate away with changes unsaved. Questions lock
once the night goes live.

**Adding a new starter**
Admin page → **People** → type their full name → **Add**.
The login handle (slug) is generated for you — you never type it.
They pick their name from the roster on the sign-in page and set their own PIN.

**Someone forgot their PIN**
Admin page → **People** → find them → **Reset PIN** → confirm.
Their scores are untouched. They set a fresh PIN next time they sign in.

**Making someone else an admin (your backup while you are away)**
Admin page → **People** → find them → **Make admin**.
You can't remove your own admin rights, and the last remaining admin can't be
removed either — so there's always someone who can get back in.

**Someone left**
Admin page → **People** → find them → **Deactivate**.
They disappear from the sign-in list and the leaderboard, but their past
scores are kept. **Reactivate** brings them back.

**Adding a quiz night**
Admin page → **Quiz nights** → pick a date, optional title, host → **Create**.
Change the host any time by picking a new one from the dropdown in the table
— it saves as soon as you pick. **Delete** removes a night that was created
by mistake; once a night is closed it can no longer be deleted.

**Making changes to the site**
Edit the file on GitHub (click the file → pencil icon → Commit), or re-upload it.
Live in about a minute. Hard refresh your phone if you see the old version.

---

## Still to build

- **Stage 4** — live play night, auto-scoring, host override panel
- **Stage 5** — the chaos: sounds, streak badges, animated overtakes, hall of shame

The database schema already covers all of it, so no rebuilding later.
