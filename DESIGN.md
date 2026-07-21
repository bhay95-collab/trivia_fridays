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
  `sting`, `womp`, `slam`, `drumroll`, `fanfare`) mapped to one game
  moment each. Don't reuse `chime` for something that isn't "correct
  answer," and don't add a new effect without a one-sentence reason a
  player would recognise.

## Content tone

- **Streak copy** (`streaks.js`) is upbeat and a little cocky when a
  streak lands, dryly affectionate when one breaks. Never insulting.
- **Wooden Spoon roasts** rotate deterministically by season week
  count so the room sees the same joke, and are checked by a unit test
  (`tests/streaks.test.js`) to stay strictly about trivia performance —
  never appearance, intelligence, or anything that would be awkward to
  sit next to on Monday.
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
