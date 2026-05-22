# Mac-Only MVP Final Goal Notes

- 2026-05-22: The runbook contains 13 task goals. They should mostly run sequentially because later tasks build on repository, runtime, prompt, and eval surfaces changed by earlier tasks.
- 2026-05-22: Started with Task 1 because Node/CI is the least coupled reliability foundation and does not depend on future behavior work.
- 2026-05-22: Task 1 updates `package-lock.json` as well as `package.json` so `npm ci` and package metadata stay aligned.
- 2026-05-22: Task 2 keeps `doctor:friendy` structured internally through `FriendyDoctorCheck[]`, then renders stable human-readable lines so future UI/setup surfaces do not need to scrape ad hoc text.
- 2026-05-22: Task 3 logs prompt transport as `custom` when tests inject a sender without a `kind`, while normal runtime-created senders still report `console` or `spectrum`.
- 2026-05-22: Task 4 keeps behavior rules and structured-output instructions as separate builders so adding product rules does not weaken the OpenRouter JSON-schema constraint.
- 2026-05-22: Task 5 treats weak calendar guesses as suggestions rather than confirmations, so a user can correct the event/place without fighting the calendar guess.
- 2026-05-22: Task 6 intentionally does not rename `detectedAt`; it keeps it for candidate identity/expiry compatibility and adds `eventMatchAnchorAt` for the calendar-matching decision.
- 2026-05-22: Task 7 keeps start/pause/resume as a per-process gate for the foreground MVP runtime. Held contact events are not marked processed or acked, so the native outbox can replay them after the user starts or resumes Friendy.
- 2026-05-22: Task 8 stores memory revision snapshots as partial memory projections rather than raw inbound text. User correction text is kept only when explicitly provided to `updateMemory`.
- 2026-05-22: Task 9 treats delete as a soft delete on the current projection, not physical removal. Search and normal memory lists hide deleted rows, while revisions remain available for audit.
