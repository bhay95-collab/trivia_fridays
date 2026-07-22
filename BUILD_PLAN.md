# Trivia Fridays — state of the build

This file used to be a forward plan for polls and question media. Both of
those shipped long ago, so it now records **what the app actually does**,
so the next person doesn't re-plan finished work.

## Core loop (built and live)

- **Leaderboard** (`index.html` / `app.js`) — season standings with a top-3
  podium (score reels), full rankings, badge chips, the Wooden Spoon roast,
  Halls of Fame/Shame, the howler ballot, and topic suggestions.
- **Poll** (`poll.html` / `poll.js`) — the weekly topic ballot: vote once,
  live results, leading indicator.
- **Play** (`play.html` / `play.js`) — browse and answer open questions,
  change answers until a final submit, then a choreographed results reveal
  with streak banners. Grading is hidden until submission by design.
- **Host** (`host.html` / `host.js`) — manage the week, build the ballot,
  open/close the poll, build questions of every type with media, preview,
  test answers, reorder, and reopen mistaken submissions.
- **Present** (`present.html` / `present.js`) — the shared-screen driver:
  start the week, open questions one at a time, an answer meter, end the
  quiz, review answers with host overrides + howler nominations, and the
  podium reveal.
- **Admin** (`admin.html` / `admin.js`) — people (add, reset PIN, toggle
  admin/active) and quizzes (create, set host, delete).

## Question types

`mc`, `text`, `tf` (True/False), `num` (number with a ± tolerance),
`order` (put items in order), and `closest` (nearest number wins, decided
at week finalise). Grading lives in `grade_response()`; `closest` settles
in `resolve_closest()` inside `finalize_week_scores()`.

## Fun & engagement layer (added this session)

| Feature | Files | Notes |
|---|---|---|
| **Jokers** (double or nothing) | `sql/17_jokers.sql`, `jokers.js`, `play.js` | One stake per player per week, chosen before submit; doubles on full marks, zeroes otherwise. Resolves at finalise so the live board never leaks it. |
| **Live reactions** | `reactions.js`, `play.js`, `present.js` | Players tap emoji that float up the shared screen. Ephemeral broadcast, no DB writes, skipped under reduced motion. |
| **Status & needle** | `sql/18_status_streaks.sql`, `needle.js`, `season.js`, `app.js` | Reigning-champion crown, attendance-streak flames, and a one-line rivalry nudge for the signed-in player. |
| **Player profiles** | `app.js`, `needle.js` | Tap any name for a stats card (rank, best week, badges, streak, head-to-head). Built from data already on the page — no round trip. |
| **Media uploads** | `sql/21_media_storage.sql`, `host.js` | Host builder can upload an image/audio/video file straight from the device (Supabase Storage, `question-media` bucket) instead of only pasting a link. The file's public URL is stored exactly like a pasted URL, so `question_media` and grading are untouched. |

## Data boundaries still in force

The three invariants from `DESIGN.md` still hold and every feature above
respects them: grading is hidden until final submission, there is no
question timer (the host paces by opening/locking), and the season layer
fails soft (a missing RPC hides a panel, never breaks the projector).

## Setup

Run the SQL files in `sql/` in numerical order (see `SETUP.md`). Each new
feature is its own migration (`17`–`21`) and is safe to re-run; until a
migration is applied its feature simply stays hidden, and everything else
keeps working.

## Not built (deliberately deferred)

- Recurring seasons / a champions archive (the leaderboard is one running
  season).
- AI-assisted question drafting for hosts.
