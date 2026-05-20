# Contact Calendar Ingestion Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/contact-calendar-ingestion`.
- 2026-05-20: Baseline `npm test` passed with 18 files and 75 tests before ingestion changes.
- 2026-05-20: Design decision: keep normal ingestion deterministic and fixture-based. Real Contacts writes are allowed only through the explicit smoke command and never during tests, build, evals, or `ingest:demo`.
- 2026-05-20: The fixture ingestion should enqueue candidates through the existing relationship repository/tool boundary so the confirmation/search flow remains shared with Spectrum and terminal agents.
