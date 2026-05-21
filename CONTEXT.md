# Friendy Context

This file defines the product language future agents should use when planning or changing Friendy. Keep these names stable unless the product concept changes.

## Domain Terms

### Contact Signal

A new or changed contact method observed from an approved source, such as a phone number or email added to the user's contacts. A Contact Signal is not yet a memory; it is evidence that a person may need review.

### Candidate Intake

The module that turns Contact Signals into Pending Candidates, event guesses, and structured Review Prompt data, then resolves confirmation or ignore replies for those Pending Candidates. Candidate Intake owns the detected-contact pending-candidate lifecycle.

### Pending Candidate

A person inferred from a Contact Signal who is waiting for the user to confirm, ignore, or annotate. A Pending Candidate must not become a Relationship Memory until the user confirms.

### Review Prompt

Structured prompt data describing what Friendy should ask the user about a Pending Candidate, such as the candidate name and best event guess. User-facing wording belongs in `responseComposer`, not Candidate Intake.

### Relationship Memory

A user-approved memory about a person, including contact route, event context, relationship backstory, notes, tags, and timestamps used for later context search.

### Relationship Runtime

The assembled Friendy runtime that connects transports, interpretation, deterministic tools, repository state, response composition, and logs for a user conversation.

## Current Architectural Decisions

- Candidate Intake should return structured outcomes, not user-facing copy.
- `responseComposer` remains the module for user-facing wording.
- `candidateConfirmation.ts` event-correction parsing should be reused in the Candidate Intake implementation before any redesign.
- Manual memory capture is outside Candidate Intake for now.
- Durable/shared state is outside the first Candidate Intake refactor.
