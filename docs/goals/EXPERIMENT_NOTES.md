# Local macOS Contact/Calendar Checker Goal Notes

- 2026-05-20: Started `feature/local-macos-contact-calendar-checker` from clean `main`.
- 2026-05-20: Design decision: keep real Contacts/Calendar access behind explicit local command adapters and test the main product behavior through injected mock providers.
- 2026-05-20: Design decision: default local check mode is dry-run. Live sending is guarded by `FRIENDY_LOCAL_CHECK_SEND=1` and tested through a mocked sender interface.
- 2026-05-20: Baseline `npm test` passed with 23 files and 92 tests before local-checker behavior changes.
