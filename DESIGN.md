# Design system — the quiz machine

Trivia Fridays is a workplace trivia competition, not a reporting dashboard.
The reference points are a pub quiz machine and a 1980s gameshow, not a
corporate intranet. This file is the record of the material system, motion
rules, and constraints established during the UI uplift, so future changes
stay one coherent object instead of drifting back toward generic AI-panel
defaults.

## Material system

Everything on screen is built from four physical materials. Nothing else
gets invented without extending this list first.

- **Cabinet** (`.panel`, `.admin-panel`, `.marquee-card`) — a purple face
  panel with a *hard offset shadow* (`0 7px 0 rgba(0,0,0,.42)`), never a
  soft glow. Panels do not float; they sit on the page like plastic.
- **Screen** (`.screen`, `.led`) — a recessed near-black display for
  anything with a score or a number on it: the rankings list, LED-style
  totals. Inset shadow, faint scanline overlay, tabular mono numerals.
- **Title tab** (`.panel-title`, `.card-title`) — a gold tab "screwed on"
  at a slight rotation, alternating tilt down the page
  (`nth-of-type(even)` flips the angle) so no two tabs look mass-produced.
- **Arcade button** (`.btn-primary`, `.btn-gold`, `.btn-small`) — a hard
  drop shadow that collapses on `:active` as the button physically
  travels down. Gold (`.btn-gold`, Bungee face) is reserved for the two
  biggest moments in the product: **Start the quiz** and **Reveal the
  winners**. Everything else is magenta or a small cabinet-toned button.

Three further materials extend the system for the full arcade look.
They lean *harder* into the same 1980s reference — they do not soften it.

- **Grid horizon** (`.synth-horizon`) — the synthwave world the cabinet
  sits in: a perspective neon grid flying toward the viewer, an Outrun
  sun on the horizon, a twinkling starfield, a glowing horizon line. One
  fixed layer at `z-index:-1`, `pointer-events:none`, kept dim so panels
  and screens still read on a projector. Present on every page.
- **CRT glass** (`.screen::before`) — turns any recessed `.screen` into a
  real tube: a curved-glass reflection highlight, a corner vignette, and
  one bright band rolling slowly down the screen, on top of the static
  scanlines that were already there. Chromatic RGB-split is applied only
  to the largest display text (`.present-prompt`) so small copy stays
  crisp — never split rankings or body text.
- **Neon tube** — the marquee wordmark (`.wordmark`) and page names
  (`.page-name`) are lit as glowing tubes (white core + coloured halos,
  cyan top / magenta bottom, a tired-tube buzz on one line). Neon is for
  *signage only* — the gold title tabs stay plastic, so the two materials
  never blur together.

Do not introduce soft glassmorphism, AI-purple gradient blur, or
side-tab accent borders (a thick colour bar down one edge of a card) —
the impeccable design hook flags side-tabs specifically as the most
recognisable AI-generated-UI tell, and we removed the two instances that
crept in during the rebuild (the leaderboard's "is-me" row and the
results verdict rows now use a rotated rubber-stamp badge instead).

## Palette

```
--ink       #140722   page background base
--ink-2     #1D0B33   marquee sign interior
--cab       #2B1147   cabinet face (dark end of gradient)
--cab-2     #38175C   cabinet face (light end of gradient)
--cab-edge  #4A2670   cabinet border / stage frame
--screen    #0C0516   recessed display background
--magenta   #FF2D95   primary accent — CTAs, "is-me" highlight
--cyan      #25E8E2   secondary accent — LED numerals, focus rings
--gold      #FFC531   tertiary accent — title tabs, the two big buttons
--cream     #FFF3DE   body text on dark
--dim       #A98CC4   secondary text, metadata
--red       #FF5470   wrong-answer state only
--spoon     #C98F52   Wooden Spoon panel only
```

One accent per job, used identically everywhere it appears: magenta
means "this is you / act here," cyan means "this is a number," gold
means "this is the biggest button on the page." Never swap them.

## Typography

- **Display face:** Bungee — wordmark, panel titles, plinths, prompts.
- **Body face:** Barlow — deliberately *not* Space Grotesk or Inter,
  which the impeccable overused-font check flags as AI-default faces.
  If a future redesign changes the body face, rotate to something that
  isn't already flagged rather than reaching for the nearest geometric
  sans.
- **Numerals:** JetBrains Mono, `font-variant-numeric: tabular-nums`,
  everywhere a score appears, so digits don't jitter as they change.

## Layout

- Chrome is a single-row **control deck** (`.deck`): brand mark, nav
  tabs, sound toggle. Max 80px tall. It replaced a full masthead on
  every page except the leaderboard, which is the one place the big
  wordmark earns its keep.
- Secondary pages get a slim **page strip** (`.page-strip`) — page name
  plus tagline — instead of repeating the masthead treatment.
- The leaderboard is a **two-column grid** above 980px: standings on
  the left, a sticky season rail (badges, halls, howler ballot,
  suggestions) on the right. Below 980px it collapses to one column,
  rail below the standings.
- Present stretches to 1440px and moves the host's controls into a
  **fixed bottom control deck**, so the question itself gets the full
  width of the shared screen instead of competing with a button row.

## Motion

One big moment, everything else supports it: **the podium reveal**
(`present.js: revealPodium`). Third place lands, then second, then a
long held beat under a tightening drum roll, then first arrives with
fanfare, confetti, and the bulb strip going strobe. Sound and visuals
run off a single `async` timeline so they cannot drift apart — never
add a `setTimeout` triggered independently from the audio cue.

Everywhere else, motion is restrained and purpose-built:

- **FLIP reorders** (`fx.js: animateReorder`) — when standings change
  order, rows are measured before and after a re-render and animated
  from their old position to their new one, so an overtake is something
  that visibly *happens*, not a list that's merely different next
  frame. The row that climbed gets a brief cyan highlight.
- **Sequenced results reveal** (`play.js`) — answers flip over one at a
  time on the results screen (never live — the grading is deliberately
  hidden until submission), with streak banners inserted into the
  sequence. This is the only other place besides the podium where
  we choreograph a multi-step animation; don't add a third without a
  reason as strong as those two.
- Buttons get a physical `:active` press. Popovers and menus aren't
  used in this app; if one is added later, it should scale from its
  trigger, not its center.

Arcade-machine motion added in the spectacle pass, all ambient and
compositor-only (transform / opacity / background-position):

- **CRT power-on** (`body::after`, `@keyframes crt-power`) — a thin
  bright line snaps open to a full flash on every page load, then fades.
- **Score reels** (`fx.js: countUp`) — podium totals odometer-roll from
  zero and punch (`.is-scoring`) on landing: on the leaderboard as it
  loads, and on the Present podium as each plinth lands.
- **Winner sunburst** (`fx.js: podiumSunburst`) — slow rotating neon
  spokes spawned behind the winner *inside the existing `revealPodium`
  timeline* (not an independent timer), removed on the next screen change.
- **Streak shockwave** (`fx.js: streakShock`) — a ring blasts across the
  screen when a run lands in the results reveal, alongside the existing
  `is-onfire` glow.
- **Ambient neon** — the top marquee strip chases two colours, the
  leaderboard stage and marquee sign chase their bulb dots, and buttons
  gain a neon rim on hover.

`prefers-reduced-motion` handling for all of the above follows the
existing rule (motion off, finished state shown): the power-on flash is
**hidden outright** (`body::after{ display:none }`) so it can't linger as
a solid sheet; count-ups snap to the final value; the sunburst and
shockwave are skipped entirely (their helpers return early, like
confetti); the grid, sun, stars, neon and attract prompts all keep their
static finished state.

### `prefers-reduced-motion` is motion off, not motion down

The global rule kills every animation and transition outright. Where a
sequence exists purely to reveal information (streak banners, veiled
result rows, podium plinths), the reduced-motion branch renders the
**finished state immediately** rather than a faster version of the
animation. Confetti and the podium's drum-roll/fanfare timeline are
skipped entirely under reduced motion — the podium function branches
at the top and returns the completed board with no theatre at all. Any
new motion must add both halves: the animation and its immediate,
complete, reduced-motion equivalent.

## Sound

All sound effects are synthesised at runtime with the Web Audio API
(`sound.js`) — no audio files, no licensing, no load time, and the
generated tones suit the arcade aesthetic better than samples would.

- **Off by default.** A player has to explicitly turn sound on.
- The header toggle persists the choice in `localStorage` and doubles
  as the browser's required user-gesture to unlock the `AudioContext`
  — don't try to play audio before that click has happened.
- Each effect is a named export on `sfx` (`tick`, `buzz`, `chime`,
  `sting`, `womp`, `slam`, `drumroll`, `fanfare`, `powerOn`) mapped to
  one game moment each — `powerOn` is the rising CRT-whine sweep played
  when the host starts the quiz. Don't reuse `chime` for something that
  isn't "correct answer," and don't add a new effect without a
  one-sentence reason a player would recognise.

## Content tone

- **Rotating copy is the rule, not the exception.** Any line a regular
  player sees week after week is held as a big pool and picked fresh
  each time (the Wooden Spoon pattern), so no joke goes stale. The pools:
  the streak-landing banners and break-line eulogies (`streaks.js`), the
  rivalry needle (`needle.js`), and the "stalling for effect" wait, the
  "no quiz live" holding screen, the "you didn't submit" roast, and the
  "nobody answered" review note (`quips.js`). Each has a unit test
  (`tests/streaks.test.js`, `tests/needle.test.js`, `tests/quips.test.js`)
  covering size, uniqueness, and the same never-personal word guard the
  roasts get. **Callers that re-render on a poll or a toggle must pick
  once and hold the line** (see the held spoon roast in `season.js`, the
  needle cache in `app.js`, and the `waitingQuip`/`overQuip` vars in
  `play.js`) — picking on every render makes the copy flicker.
- **Streak copy** (`streaks.js`) is upbeat and a little cocky when a
  streak lands, dryly affectionate when one breaks. Never insulting.
  Landing lines are length-aware templates (`STREAK_LINES`, plus the
  cockier `STREAK_BIG_LINES` from five in a row), so the count on screen
  is always right; break lines (`STREAK_BREAK_LINES`) always name the
  question that ended the run, since the reveal anchors the eulogy to a row.
- **Wooden Spoon roasts** are a large set (`streaks.js: ROASTS`) picked
  at random on every leaderboard load (`randomRoast()`), so the plaque
  tells a different joke each visit. The whole set is checked by a unit
  test (`tests/streaks.test.js`) to stay strictly about trivia
  performance — never appearance, intelligence, or anything that would
  be awkward to sit next to on Monday. Every line reads as "{name}
  {roast}", so new lines must continue that sentence.
- **The Wooden Spoon plaque** is its own material: a bronze,
  hazard-taped board with a screwed-on `.spoon-tab` (the title-tab
  treatment in `--spoon` instead of gold) and a hard offset shadow, so
  the booby prize reads as a distinct object and never blends into the
  cabinet panels around it in the rail.
- **Badges are generous by design** (`sql/14_season_stats.sql:
  season_badges()`) — nine badge types derived entirely from existing
  scoring data, tuned so a normal office season leaves most players
  holding at least one. If a new badge is added, check it against a
  realistic season size before shipping; a badge nobody can ever earn
  is worse than no badge.

## Data boundaries that shaped the UI

Two features were adapted rather than built as originally briefed,
because the database deliberately hides information until it's safe:

- **Streaks live at the results reveal, not mid-quiz.**
  `submit_answer()` never tells the player whether they were right —
  by design, so nobody can infer another player's answers from a UI
  reaction. A live "three in a row!" banner would leak that. The
  reveal sequence on the results screen is the correct home for this.
- **Badges never reference question categories.** Questions have no
  category column, so "always gets the sport question" became **Topic
  Titan** (won the week their own suggested topic was used) — fully
  derivable from data that already exists, no schema change required.

If a future feature seems to need information the grading functions
withhold, that withholding is very likely intentional (see
`sql/01_schema.sql`'s comments on `submit_answer` and the RLS policies
on `answer_keys` and `responses`). Route around it the way these two
were routed around, rather than loosening the database.

## New surfaces added this session

| File | Purpose |
|---|---|
| `sound.js` | Web Audio synth effects + persistent mute toggle |
| `fx.js` | FLIP reorder animation, confetti, reduced-motion helpers |
| `streaks.js` | Pure streak-detection logic and copy (unit tested) |
| `season.js` | Badges, Halls of Fame/Shame, howler ballot rendering |
| `sql/14_season_stats.sql` | Badge/record RPCs, howler nomination + voting tables |

Each fails soft: a missing RPC hides its panel rather than breaking the
scoreboard (see `app.js: showBoard()`'s try/catch around `fetchSeason`).
Keep that property when extending the season layer — this app runs
live in front of a room of people on a Friday, and a stack trace on the
projector is a worse failure mode than a missing badge case.

## Fun & engagement layer (later session)

| File | Purpose |
|---|---|
| `jokers.js` + `sql/17_jokers.sql` | Double-or-nothing stake, pure scoring math (unit tested) |
| `reactions.js` | Live emoji broadcast + floaters for the shared screen |
| `needle.js` | Rivalry line + head-to-head copy (unit tested) |
| `sql/18_status_streaks.sql` | Attendance-streak read RPC |
| `sql/19_question_types.sql` | True/False, Number, Order grading + save |
| `sql/20_closest_wins.sql` | Closest-wins resolution folded into finalise |

Material notes so these stay one object, not new inventions:

- **The joker is magenta, never gold.** Gold stays reserved for the two
  biggest buttons (Start / Reveal). The stake bar and its reveal stamp use
  magenta (\"act here / this is your move\") and the existing rotated
  rubber-stamp treatment — a full ring on the jokered row, never a
  side-tab.
- **Reactions are ambient and edge-biased.** Floaters rise in the side
  gutters so they never sit on the question text, are compositor-only
  (transform/opacity), and are skipped outright under reduced motion, like
  confetti. They are never written to the database.
- **Crown, streak flame, and needle read as chips/nudges,** not new
  panels: the crown sits before the leader's name, the 🔥 streak is a small
  chip beside the badge chips, and the rivalry line is one cabinet-toned
  banner under the who-am-I row.
- **The profile modal is a cabinet card** (gold title tab, recessed screen
  stat tiles) — the same materials as everything else, opened from a
  name-as-button, and built only from public aggregates already on the
  page.
- **New question types reuse existing materials:** True/False and Order
  render through the same option cards as multiple choice; the shared
  screen shows Order items shuffled so it never gives the answer away; a
  `closest` question shows a dashed \"pending\" reveal row until it settles
  at finalise.
