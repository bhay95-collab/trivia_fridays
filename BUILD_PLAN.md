# Trivia Fridays build plan

## 1) Current build review

The current app already has the core flow for a trivia night:
- leaderboard sign-in and admin access
- host-side quiz question creation and preview
- player-side answer entry and results
- poll-style ballot flow for selecting the weekly topic
- shared present screen for showing the active question

What is already working well:
- The host can create a quiz week, build questions, and open/close a ballot.
- Players can answer multiple-choice and free-text questions.
- The UI is already structured around host, play, poll, and present views.

Readiness gaps now covered by the implementation:
- Player live state returns media again after the final-submission SQL changes.
- Deactivated people are no longer treated as active players/admins/hosts by the core database helpers.
- Question media is URL-only, HTTPS-only, escaped before rendering, and protected by RLS.
- Privileged nav links start hidden until auth and role checks pass.

Remaining optional scope:
- There is no dedicated, first-class “new poll” experience beyond the existing weekly topic ballot.
- Supabase Storage uploads are not implemented; media uses HTTPS URLs only.

---

## 2) Plan: add a new Poll section

### Goal
Create a dedicated poll experience that is separate from the current quiz-topic ballot and can be used for broader audience polls during a week.

### Recommended scope
Build this as a new section in the host experience, with player-facing support on the poll page.

### Data model
Add a new poll feature with its own tables:
- polls
  - id
  - week_id
  - title
  - description
  - status (draft, open, closed)
  - created_at
- poll_options
  - id
  - poll_id
  - label
  - sort_order
- poll_votes
  - id
  - poll_id
  - option_id
  - player_id
  - created_at

### UI plan
In the host page:
- Add a new panel called “Polls”.
- Add actions to:
  - create a poll
  - add/edit poll options
  - open the poll
  - close the poll
  - view results

In the poll page:
- Show the active poll for the current week.
- Let players vote once.
- Show live results after the poll closes.

### Implementation order
1. Add SQL schema and RPCs for poll CRUD, voting, and results.
2. Add host-side UI and state handling in host.js and host.html.
3. Add player-side voting UI and results rendering in poll.js and poll.html.
4. Add styling in styles.css.

### Acceptance criteria
- A host can create a poll for a quiz week.
- Players can vote from the poll page.
- Results can be viewed after closing the poll.
- Existing quiz-topic ballot behavior remains intact.

---

## 3) Plan: build a quiz section with media support

### Goal
Allow quiz questions to include media assets such as music, images, and videos, and show those assets during the live quiz.

### Recommended approach
Use a question-level media model so each question can have one or more media items.

### Data model
Add a new table such as:
- question_media
  - id
  - question_id
  - media_type (audio, image, video)
  - source_type (url)
  - url
  - caption
  - sort_order

### Media handling strategy
Current implementation:
- Accept full HTTPS URLs for audio/image/video.
- Treat Supabase Storage uploads as future work.

### Host-side UI plan
Extend the existing question card builder in host.html and host.js to include:
- a media section per question
- a media type selector: audio, image, video
- an HTTPS URL field
- preview before saving
- a remove action

### Playback/rendering plan
Render media on the play screen and present screen before the prompt.
- Audio: show a native audio player with controls.
- Image: show the image in a card with caption.
- Video: show a native video player with controls.

### Data flow
1. Host adds media while building the question.
2. Media is saved with the question.
3. The question payload returned by the backend includes media items.
4. The play and present screens render the media before showing the prompt or options.

### Implementation order
1. Add the question_media table and RPC support.
2. Extend the host question save flow to include media payload.
3. Update the live question payload used by play and present pages.
4. Render media in play.js and present.js.
5. Add styling for media cards and player controls.

### Acceptance criteria
- A host can attach music, photos, or videos to a quiz question.
- The media is saved with the question.
- Players see the media when the question appears during the quiz.
- The present screen shows the same media for the shared display.

---

## 4) Files to update

### Frontend
- host.html
- host.js
- play.html
- play.js
- present.html
- present.js
- styles.css

### Backend / data
- sql/01_schema.sql
- sql/06_quiz_functions.sql
- sql/07_live_functions.sql
- sql/08_final_submission.sql
- new SQL migration file for poll tables if needed

---

## 5) Suggested implementation sequence

1. Add the new poll tables and RPCs.
2. Add the poll UI to host and poll pages.
3. Add the media table and save flow.
4. Render media on play and present screens.
5. Test the full flow end to end.

---

## 6) Recommended MVP

If the goal is to ship quickly, the best MVP is:
- Polls: create, vote, and view results.
- Quiz media: support remote URLs for audio/image/video only.
- Rendering: show media on play and present screens.

That gives the team a strong feature set without overcomplicating the first build.
