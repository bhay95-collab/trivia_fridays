# Trivia Fridays — setup

This gives you the whole site: name + PIN login, the season leaderboard,
topic suggestions and the weekly poll, the host's quiz builder, and a full
live quiz on Play (phones) and Present (the shared screen) — start to
finish, nothing left to wire up by hand.

Follow Parts 1–3 in order to get the site live. Roughly 30 minutes.

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
- This gives the admin page a safe way to add people, reset PINs, and manage quizzes. It is safe to re-run any time you update it.

**1.7 Add the topic suggestions and poll functions.**
- **SQL Editor** → **New query**
- Open `sql/05_poll_functions.sql`, copy the whole file, paste, **Run**
- This powers the suggestion box, the host's ballot builder, and the voting page. Also safe to re-run any time.

**1.8 Add the quiz builder functions.**
- **SQL Editor** → **New query**
- Open `sql/06_quiz_functions.sql`, copy the whole file, paste, **Run**
- This powers the Questions section on the host page — writing questions and answer keys, and grading. Also safe to re-run any time.

**1.9 Add the live quiz functions.**
- **SQL Editor** → **New query**
- Open `sql/07_live_functions.sql`, copy the whole file, paste, **Run**
- This powers the Play and Present pages — starting the quiz, opening questions, live standings, and turns on Realtime for the `questions` table so phones update instantly. Also safe to re-run any time.

**1.10 Add changeable answers and final submission.**
- **SQL Editor** → **New query**
- Open `sql/08_final_submission.sql`, copy the whole file, paste, **Run**
- This lets players change an answer any time before they personally submit, and moves the answer reveal and host override panel to after the quiz ends. Also safe to re-run any time.

**1.11 Close a permissions gap on opening questions.**
- **SQL Editor** → **New query**
- Open `sql/09_gate_open_before_live.sql`, copy the whole file, paste, **Run**
- Makes sure a question can never be opened before the quiz is started, at the database level, not just because the Present page doesn't show a button for it. Safe to re-run any time.

**1.12 Drop "night" from the wording.**
- **SQL Editor** → **New query**
- Open `sql/10_no_more_night.sql`, copy the whole file, paste, **Run**
- Wording only, nothing structural: every message a player or host sees now says "quiz" instead of "quiz night" or "this night" — the quiz still runs every Friday, just during the work day. Safe to re-run any time.

**1.13 Close two gaps the Supabase linter flags.**
- **SQL Editor** → **New query**
- Open `sql/11_security_hardening.sql`, copy the whole file, paste, **Run**
- Locks down a grading function that was reachable directly (not just through the host and player pages), and pins down a setting on one helper function. Safe to re-run any time.

**1.14 Make the leaderboard view respect row level security.**
- **SQL Editor** → **New query**
- Open `sql/12_leaderboard_view_security.sql`, copy the whole file, paste, **Run**
- Views default to running as whoever created them rather than the person asking, silently bypassing row level security. Changes nothing visible today, closes the gap for later. Safe to re-run any time.

**1.15 Apply the readiness hardening patch.**
- **SQL Editor** → **New query**
- Open `sql/13_readiness_hardening.sql`, copy the whole file, paste, **Run**
- This keeps media working on player phones, locks media URLs to HTTPS, applies row level security to question media, and makes deactivated people lose access immediately. Safe to re-run any time.

**1.15b Apply the season stats patch.**
- **SQL Editor** → **New query**
- Open `sql/14_season_stats.sql`, copy the whole file, paste, **Run**
- This adds the season badges, the Hall of Fame and Shame records, and the worst-answer-of-the-season ballot (the host nominates from the answer review, everyone gets one movable vote). Safe to re-run any time.

**1.15c Close the host direct-write security gap.**
- **SQL Editor** → **New query**
- Open `sql/15_close_host_write_gaps.sql`, copy the whole file, paste, **Run**
- This removes four row-level-security policies that let a host bypass the app's own rules by writing straight to the database (skipping the checks that only exist inside the Start Quiz / Close Quiz / Save Question actions). Nothing in the app changes for anyone using it normally. Safe to re-run any time.

**1.15d Add the host review gate.**
- **SQL Editor** → **New query**
- Open `sql/16_host_review_gate.sql`, copy the whole file, paste, **Run**
- This splits closing a quiz from scoring it: ending the quiz still locks the questions and opens the review screen, but points no longer land on the leaderboard until the host finalises them, and finalising is refused while any free-text answer that wasn't graded a straight "correct" still hasn't been looked at. Multiple choice and exact free-text matches never need a look. Safe to re-run any time.

**1.15e Add jokers (double or nothing).**
- **SQL Editor** → **New query**
- Open `sql/17_jokers.sql`, copy the whole file, paste, **Run**
- This gives every player one joker a week to stake on a single question before they submit: staked and full marks doubles it, staked and anything less scores zero. The doubling only lands when the week's scores are finalised, so the live board never gives the stake away early. Until you run this, the Play page simply won't show the joker — everything else works unchanged. Safe to re-run any time.

**1.15f Add attendance streaks.**
- **SQL Editor** → **New query**
- Open `sql/18_status_streaks.sql`, copy the whole file, paste, **Run**
- This adds one read-only function the leaderboard uses to show a 🔥 flame on anyone who's turned up several quizzes running. It reads existing attendance only — no new data. Until you run it, the flames just don't show. Safe to re-run any time.

**1.16 Check it worked.**
- **SQL Editor** → New query → paste `select * from leaderboard order by total_points desc;` → Run
- You should see 22 people. Benjamin Hay on top with 54.

**1.17 Grab your two keys.**
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
- Drag in: `index.html`, `app.js`, `styles.css`, `config.js`, `media-utils.js`, `admin.html`, `admin.js`, `poll.html`, `poll.js`, `host.html`, `host.js`, `play.html`, `play.js`, `present.html`, `present.js`
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
on every page: **Leaderboard**, **Poll**, **Play**, and — only for the
people entitled to see them — **Host**, **Present** and **Admin**.

**Pre-Friday checklist**
Before people start voting, make sure Admin page → **Quizzes** has an upcoming quiz row. Create one if there is no `draft`, `polling`, `building`, or `live` quiz, assign the host, then have the host build the ballot on the Host page. Poll, Play and Present intentionally stay quiet until that quiz exists and moves through the flow.

**Suggesting a topic**
Anyone signed in can drop an idea in the pool from the leaderboard page.
Suggestions are not anonymous — everyone can see who suggested what. Your
own suggestions have a **Remove** button.

**Building a ballot for the week**
Whoever is hosting opens the **Host** page (admins can host any quiz; other
players only see their own). Pick a few suggestions for the ballot, or write
a topic nobody suggested. **Open the poll** once there are at least two
options.

**Voting**
Everyone (except the host of that quiz) votes on the **Poll** page. Tap a
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
Media can be attached to a question with a full `https://` URL for an image,
audio clip, or video. Uploads are not supported yet.

For every free text question, use **Try an answer** before the quiz — type
what you think someone might write and it tells you straight away whether
that would score full marks, half marks, or nothing. If a reasonable answer
scores nothing, loosen your answer key now, not during the quiz.

Move questions up and down to reorder them, and use **Show preview** to see
exactly what players will see — it never shows which option is correct.
An unsaved question is marked so you never lose track of it, and the page
will warn you before you navigate away with changes unsaved. Questions lock
once the quiz goes live.

**Running the quiz**
On Teams, share your screen and open the **Present** page — that's what the
room sees. Everyone else opens **Play** on their phone; it finds the live
quiz on its own, no code to type. When you're ready, **Start the quiz** on
Present.

From there: open a question (or press **Space**), read it aloud, and move
to the next one whenever you like — there's no lock-and-reveal step per
question any more. Once a question is open it stays open and answerable for
the rest of the quiz, and players can go back and change any earlier
answer as many times as they want. Present shows a live count of how many
people have answered whatever's currently on screen, plus how many have
submitted overall — but never a correct answer or anyone's individual
response, since that screen is shared with the whole room.

Once every question has been opened, go back through them together as a
final review — players can still change their minds right up until they
personally tap **Submit my final answers** on their own phone. Submitting
is final for that player only; everyone else keeps going. If someone
submits by mistake, the Host page has a **Let them back in** button while
the quiz is still live (it's not shown on the shared screen).

**End the quiz** finalises scores — anyone who answered something but
forgot to submit is included automatically, so a missed tap doesn't cost
them their score. Only *then* does it become safe to show correct answers
on the shared screen: Present moves into an **answer review**, where you
can step through every question with the room, see each answer given, and
use **Full / Half / None** to fix a free-text grade that came out wrong —
scores update immediately, even after the quiz has closed. When you're
ready, **Reveal the winners** runs the podium: third, then second, then
first. Anyone who never submitted an answer that quiz doesn't get a score
row, so they won't show up on the leaderboard for it.

If a phone's connection drops mid-quiz it recovers on its own — Play checks
in with the server every few seconds regardless of the live connection, so
nobody gets stuck on an old question.

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

**Adding a quiz**
Admin page → **Quizzes** → pick a date, optional title, host → **Create**.
Change the host any time by picking a new one from the dropdown in the table
— it saves as soon as you pick. **Delete** removes a quiz that was created
by mistake; once a quiz is closed it can no longer be deleted.

**Making changes to the site**
Edit the file on GitHub (click the file → pencil icon → Commit), or re-upload it.
Live in about a minute. Hard refresh your phone if you see the old version.

---

## Still to build

- **Stage 5** — the chaos: sounds, streak badges, animated overtakes, hall of shame
- First-class media uploads to Supabase Storage, if URLs become too fiddly.
