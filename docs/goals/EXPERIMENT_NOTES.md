# Contact Calendar Ingestion Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/contact-calendar-ingestion`.
- 2026-05-20: Baseline `npm test` passed with 18 files and 75 tests before ingestion changes.
- 2026-05-20: Design decision: keep normal ingestion deterministic and fixture-based. Real Contacts writes are allowed only through the explicit smoke command and never during tests, build, evals, or `ingest:demo`.
- 2026-05-20: The fixture ingestion should enqueue candidates through the existing relationship repository/tool boundary so the confirmation/search flow remains shared with Spectrum and terminal agents.
- 2026-05-20: Added fixture snapshots with Maya Chen as an overlapping-event phone detection and Nina Park as a no-event email detection. Name-only edits and duplicate known methods are ignored by the diff.
- 2026-05-20: Added a fixture calendar event provider and `ingestContactSnapshotDiff`, which syncs fixture events into the repository before creating candidates so event matching still happens through the existing repository/tool boundary.
- 2026-05-20: Added explicit `ingest:contacts:smoke` behavior for macOS Contacts only. It validates names as `Friendy-<number>`, derives a deterministic test phone number, reuses an exact matching test contact if present, and fails clearly outside macOS without touching Contacts.
