# iMessage Contact Confirmation Loop Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/imessage-contact-confirmation-loop`.
- 2026-05-20: Existing architecture has the needed boundaries: fixture ingestion creates pending candidates, Spectrum normalizes to `InboundAgentMessage`, interpreted agent executes deterministic tools, and search runs through field-aware memory ranking.
- 2026-05-20: Design decision: the required demo should use a deterministic iMessage/Spectrum-style simulator so it exercises the iMessage runtime boundary without sending live messages. Live Spectrum remains optional.
- 2026-05-20: The tricky confirmation phrase must keep `Photon Residency II` as the current event and `high school in Minnesota` as relationship backstory.
