/* ============================================================
   QUIPS — the site's recurring bits of flavour, each held as a
   big pool so the same joke never lands two weeks running. Same
   idea as the Wooden Spoon roasts in streaks.js: a large set and
   a fresh pick each time (pick()), so nothing goes stale.

   Pure strings, no DOM, so the tests import it straight into Node.
   Callers that re-render on a poll should pick once and hold the
   line (the way app.js holds the spoon roast) rather than calling
   these on every tick, or the copy will flicker.
   ============================================================ */

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* Play screen, before the host opens the first question — the
   deliberate pause while the room settles. Every line leans into
   the stall being on purpose. */
export const WAITING_FIRST = [
  "Waiting for the host to open the first question… they're stalling for effect.",
  "No questions yet. The host is milking the suspense.",
  "Hang tight — the host is pausing for dramatic effect.",
  "The first question is loading in someone's head. Stand by.",
  "Nothing open yet. The host is enjoying the power a little too much.",
  "Waiting on the host. Great trivia can't be rushed, apparently.",
  "The stage is set, the host is stalling. Any second now.",
  "First question incoming, once the host finishes the build-up.",
  "Still waiting. The host insists this pause is 'for effect'.",
  "Hold the line — the host is savouring the calm before the quiz.",
  "No question on screen yet. Suspense: successfully built.",
  "The host is warming up the room. Patience.",
  "Any moment now. The host is timing their entrance.",
  "Waiting for question one. The drama is entirely intentional.",
  "The host is letting the tension build. It's working.",
];

export const pickWaitingFirst = () => pick(WAITING_FIRST);

/* Play screen, nothing live — the page auto-refreshes, so every
   line gently tells the player to keep their hands off reload. */
export const NO_QUIZ_LIVE = [
  "No quiz is live right now. This page updates the moment the host starts one — no refreshing required, no matter how hard you're tempted.",
  "Nothing running at the moment. Sit tight; this page springs to life the second a host hits go.",
  "No live quiz yet. Keep this open — it'll wake up on its own when the fun starts.",
  "All quiet on the trivia front. The page is watching for you; no need to refresh.",
  "No quiz in progress. When one starts, this screen jumps in automatically — hands off that reload button.",
  "Nothing live just now. Leave the tab open and the quiz will find you.",
  "The quiz hasn't started. This page is listening; it'll switch over the instant it's on.",
  "No game right now. Refreshing won't help — the page updates itself the moment a host begins.",
  "Trivia's on a break. Stay here and you'll be first in when it returns.",
  "No live quiz. This screen refreshes for you — resist the urge, it's handled.",
  "Nothing to play yet. The page will light up on its own when a host starts one.",
  "Standing by for the next quiz. No refresh needed; the page has it covered.",
];

export const pickNoQuizLive = () => pick(NO_QUIZ_LIVE);

/* Play screen, quiz closed and this player submitted nothing — the
   affectionate "you sat this one out" roast. Never nasty, always
   points them back at the leaderboard. */
export const NO_SUBMISSION = [
  "You didn't submit any answers this week. Bold strategy — technically unbeatable, technically unranked. Check the leaderboard for the standings.",
  "No answers submitted this week. Can't lose if you don't play — can't win either. The leaderboard has the rest.",
  "You sat this one out. A flawless zero, untouched by risk. See where everyone else landed on the leaderboard.",
  "Nothing submitted this week. The only undefeated record is the one never tested. Standings are on the leaderboard.",
  "You watched this one from the bench. No points, no scars. Check the leaderboard for the damage.",
  "No card submitted. Bold, mysterious, entirely unscored. The leaderboard awaits.",
  "You skipped the scoring this week. Perfectly safe, perfectly ranked nowhere. See the leaderboard.",
  "Zero answers in. You kept a clean sheet and an empty scoreline. The leaderboard's this way.",
  "You didn't play your hand this week. Unbeaten in theory, absent in practice. Standings on the leaderboard.",
  "No submission this time. The bravest score is the one you never risked. Check the leaderboard.",
  "You held your cards all night. Nothing ventured, nothing tallied. The leaderboard has the rest.",
  "Sat out the scoring this week. An immaculate nothing. See how the others fared on the leaderboard.",
];

export const pickNoSubmission = () => pick(NO_SUBMISSION);

/* Present screen, review panel — a question nobody in the room
   answered. Plays the shared silence for laughs, never anyone in
   particular. */
export const NOBODY_ANSWERED = [
  "Nobody answered this one. A rare moment of total consensus.",
  "Not a single answer. The room united in silence.",
  "Zero responses. Everyone agreed to say nothing.",
  "Nobody touched this one. A collective, dignified pass.",
  "No answers at all. Group solidarity, of a sort.",
  "Empty. The whole room let this one sail by.",
  "Not one taker. A rare unanimous shrug.",
  "Nobody had a go. The silence was, at least, consistent.",
  "No answers here. Everyone blinked at once.",
  "Completely blank. The room voted with its silence.",
  "Nobody chanced it. A perfect record of restraint.",
  "Not a peep. This one goes down as a mutual mystery.",
];

export const pickNobodyAnswered = () => pick(NOBODY_ANSWERED);
