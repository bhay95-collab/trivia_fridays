/* ============================================================
   STREAKS & GAME COPY — pure logic, no DOM, so the tests can
   import it straight into Node.

   Streaks are computed at results time, never mid-quiz: the
   game deliberately tells players nothing about correctness
   until they have submitted, and this module respects that.
   ============================================================ */

export const STREAK_MIN = 3;

/* One fresh item from a pool. Every rotating bit of copy in here —
   streak banners, break-line eulogies, the Wooden Spoon roasts —
   goes through this, so nothing repeats predictably. */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ['correct','correct','wrong',...] -> [{ start, length, type }]
   start is the 0-based index of the first answer in the run. */
export function streakSegments(verdicts) {
  const segments = [];
  let run = null;
  verdicts.forEach((verdict, i) => {
    const type = verdict === "correct" ? "correct" : "other";
    if (run && run.type === type) {
      run = { ...run, length: run.length + 1 };
      segments[segments.length - 1] = run;
    } else {
      run = { start: i, length: 1, type };
      segments.push(run);
    }
  });
  return segments;
}

/* Longest run of correct answers. */
export function bestStreak(verdicts) {
  return streakSegments(verdicts)
    .filter((s) => s.type === "correct")
    .reduce((best, s) => Math.max(best, s.length), 0);
}

/* The reveal walks the results in order. These two functions hand
   it something to say when a streak lands and when one dies.

   Both draw from big pools and pick fresh each call — like the
   Wooden Spoon roasts below — so the same banner never fires two
   weeks running. Lines are length-aware templates so the count is
   always right no matter how long the run gets. STREAK_LINES carries
   the ordinary runs; STREAK_BIG_LINES is the cockier set that only
   comes out once a streak is genuinely showing off (five or more). */
const STREAK_LINES = [
  (n) => `${n} straight. The table has noticed.`,
  (n) => `${n} in a row. Save some for the rest of us.`,
  (n) => `${n} on the bounce. Steady on.`,
  (n) => `${n} correct on the trot. Someone's warmed up.`,
  (n) => `${n} in a row — the room just went quiet.`,
  (n) => `${n} straight. That's not luck any more.`,
  (n) => `${n} on the spin. Keep it going.`,
  (n) => `${n} correct back to back. Nicely done.`,
  (n) => `${n} in a row. The scoreboard is taking notes.`,
  (n) => `${n} straight and counting. Don't jinx it.`,
  (n) => `${n} on the bounce. The others have clocked it.`,
  (n) => `${n} clean in a row. Momentum is a real thing.`,
  (n) => `${n} straight. Quietly building something here.`,
  (n) => `${n} correct running. The table's watching now.`,
];

const STREAK_BIG_LINES = [
  (n) => `${n} in a row. Somebody unplug them.`,
  (n) => `${n} straight. This is showing off now.`,
  (n) => `${n} on the bounce. Save some for next week.`,
  (n) => `${n} correct in a row — is anyone checking these?`,
  (n) => `${n} straight. The rest of us are spectators now.`,
  (n) => `${n} on the trot. Leave some questions for the others.`,
  (n) => `${n} in a row. This has stopped being fair.`,
  (n) => `${n} straight. Frame this one.`,
  (n) => `${n} on the bounce. Absolute machine.`,
  (n) => `${n} correct running. The quiz has met its match.`,
];

export function streakLine(length) {
  if (length < STREAK_MIN) return "";
  const pool = length >= 5 ? STREAK_BIG_LINES : STREAK_LINES;
  return pick(pool)(length);
}

/* Dry, affectionate eulogies for a run that just ended. Every line
   names the question that broke it, so the reveal still points at the
   right row. */
const STREAK_BREAK_LINES = [
  (q) => `The streak dies at Q${q}. It was beautiful while it lasted.`,
  (q) => `And it ends at Q${q}. Nothing gold can stay.`,
  (q) => `Q${q} breaks the spell. We'll always have the run.`,
  (q) => `The run stops at Q${q}. Pour one out.`,
  (q) => `Q${q} was the wall. Every streak meets one.`,
  (q) => `Streak over at Q${q}. It had a good innings.`,
  (q) => `Q${q} calls time on the streak. Gone but not forgotten.`,
  (q) => `The magic runs out at Q${q}. Still, what a stretch.`,
  (q) => `Q${q} ends the party. Lovely while it lasted.`,
  (q) => `The streak bows out at Q${q}. Take the memories.`,
  (q) => `Q${q} snaps it. All good things, and so on.`,
  (q) => `That's the streak done at Q${q}. History now.`,
];

export function streakBreakLine(length, qNumber) {
  if (length < STREAK_MIN) return "";
  return pick(STREAK_BREAK_LINES)(qNumber);
}

/* ============================================================
   WOODEN SPOON ROASTS — affectionate, strictly about trivia,
   never about the person. A big set so the plaque tells a
   different joke on every visit to the leaderboard; randomRoast()
   picks one fresh each load. Every line reads as "{name} {roast}".
   ============================================================ */
export const ROASTS = [
  "holds the spoon with quiet dignity. Statistically, the only way is up.",
  "is running a long-term experiment on how little trivia a person needs.",
  "keeps the rest of the leaderboard feeling good about itself. A public service.",
  "has answers. The questions simply keep disagreeing with them.",
  "is pacing the season. Nobody peaks in the group stage.",
  "treats every question as a chance to surprise us. Mission accomplished.",
  "is proof that turning up is its own kind of victory.",
  "knows things. Just not, so far, the things being asked.",
  "is saving the comeback for when it will hurt the most.",
  "plays trivia the way jazz musicians play notes: the right answers, eventually, in some order.",
  "is building suspense. The payoff had better be enormous.",
  "has decided points are a distraction from the pure joy of guessing.",
  "answered with total confidence all night. Confidence, it turns out, isn't worth points.",
  "is here for the vibes, and the vibes are immaculate.",
  "treats the scoreboard as a gentle suggestion rather than a binding contract.",
  "is one lucky category away from greatness. Has been all season.",
  "keeps the wooden spoon warm so nobody else has to.",
  "is playing a longer game than the rest of us can perceive.",
  "brings the energy. The accuracy is still in transit.",
  "has mastered every topic except the ones that came up.",
  "is rounding down. Way down.",
  "gave every question a fair hearing before getting it wrong.",
  "has a system. The system is not, strictly speaking, working.",
  "finished the quiz. That is more than the questions did for them.",
  "is trivia's most reliable constant: never top of the board, never absent from it.",
  "treats \"close enough\" as a personal philosophy.",
  "is collecting wrong answers like they'll be worth something someday.",
  "answered from the heart. The heart, sadly, does not do dates and capitals.",
  "is the reason the spoon has a name and a nameplate.",
  "keeps the podium honest by staying very far from it.",
  "showed up, guessed boldly, and asked for nothing. Received exactly that.",
  "has been warming up since round one. The warm-up continues.",
  "makes the leaderboard a story of hope: if the fall is this gentle, anyone can climb.",
  "answers fast and wrong, which at least respects everyone's time.",
  "treats the right answer as one option among many, and rarely the chosen one.",
  "is the control group. Every experiment needs one.",
  "read the question carefully, considered it deeply, and missed it anyway.",
  "has never met a category they couldn't lose to.",
  "is undefeated at coming last. A streak in its own right.",
  "guessed C. It is almost never C.",
  "brings a red herring to every question and leaves with it.",
  "is proof the multiple choice was, in fact, optional.",
  "keeps the answers close to the chest and even further from correct.",
  "peaked during the warm-up chatter, before any points were involved.",
  "has a photographic memory for the wrong decade.",
  "answered every question. Ownership of the results remains disputed.",
  "is the leaderboard's foundation. Everyone else is built on top of them.",
  "confused the picture round with an art appreciation class.",
  "was robbed, allegedly, by facts.",
  "took the scenic route past every correct answer.",
  "is one right answer away from second-last. Dream big.",
  "gives each wrong answer a good home and a warm meal.",
  "plays defence: no points for, none against, a clean sheet of zeros.",
  "is the quiz's most loyal customer. Loyalty, it turns out, is not scored.",
  "keeps the spoon polished for the eventual handover. Not tonight, though.",
  "answered in good faith. The questions did not reciprocate.",
  "treats trivia night as a listening exercise, and listens beautifully.",
  "is saving all the right answers for a quiz that isn't this one.",
  "left the hard questions blank and the easy ones optimistic.",
];

/* A fresh roast each call, so the plaque never reads the same on
   two visits in a row within a sitting. */
export function randomRoast() {
  return pick(ROASTS);
}
