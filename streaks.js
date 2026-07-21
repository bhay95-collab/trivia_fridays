/* ============================================================
   STREAKS & GAME COPY — pure logic, no DOM, so the tests can
   import it straight into Node.

   Streaks are computed at results time, never mid-quiz: the
   game deliberately tells players nothing about correctness
   until they have submitted, and this module respects that.
   ============================================================ */

export const STREAK_MIN = 3;

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
   it something to say when a streak lands and when one dies. */
const STREAK_LINES = [
  "Three straight. The table has noticed.",
  "Four in a row. Save some for the rest of us.",
  "Five on the bounce. Somebody unplug them.",
  "Six straight. This is showing off now.",
];

export function streakLine(length) {
  if (length < STREAK_MIN) return "";
  const idx = Math.min(length - STREAK_MIN, STREAK_LINES.length - 1);
  return STREAK_LINES[idx];
}

export function streakBreakLine(length, qNumber) {
  if (length < STREAK_MIN) return "";
  return `The streak dies at Q${qNumber}. It was beautiful while it lasted.`;
}

/* ============================================================
   WOODEN SPOON ROASTS — affectionate, strictly about trivia,
   and rotating so the same line never sits there two weeks
   running. Deterministic: keyed off how many quizzes the
   season has seen, so everyone's screen tells the same joke.
   ============================================================ */
const ROASTS = [
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
];

export function spoonRoast(weeksPlayed) {
  return ROASTS[Math.abs(weeksPlayed) % ROASTS.length];
}
