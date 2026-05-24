# Goal: Core Relationship Agent Verification

Verify that Friendy's existing core relationship-agent behaviors work correctly before adding more features.

## Objective

Confirm the current agent can:

- chat through the relationship-memory scope,
- detect new contacts and create pending confirmation prompts,
- add contacts to Friendy memory after user confirmation,
- retrieve and list saved contacts from memory,
- edit saved memory after confirmation,
- delete saved memory after confirmation.

## Current Result

2026-05-24: Core verification passed with no new feature expansion.

- Focused core tests passed 11 files/190 tests.
- `npm run eval:agent` passed 46/46 required cases with 0 unsafe mutations and 0 hallucinations.
- `npm test` passed 72 files/515 tests.
- `npm run build` passed.
- `npm run doctor:friendy` passed after sandbox escalation for the `tsx` temp-pipe permission issue.
- `npm run agent:friendy:check` passed after sandbox escalation for the same `tsx` temp-pipe issue.
- `npm run check:mac-mvp-demo` passed after sandbox escalation; the transcript covered start, contact prompt, memory save, recall, update confirmation, and confirmed update.
- `git diff --check` passed.
- `curl -I https://spectrum.photon.codes` returned HTTP/2 200.

## Notes

- The earlier live `agent:friendy` timeout was a Spectrum network connect timeout to `spectrum.photon.codes:443`, not a deterministic relationship-agent logic failure.
- Live iMessage/Spectrum delivery still depends on the external Spectrum endpoint being reachable.
- No commit has been made for this verification pass.
