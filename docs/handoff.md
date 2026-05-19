# Friendy Handoff

## Repo

- Local path: `/home/thien/Desktop/Friendy`
- GitHub: `https://github.com/tony-ng-vn/Friendy`
- Branch: `feature/photon-memory-agent`
- Pull request URL: `https://github.com/tony-ng-vn/Friendy/pull/new/feature/photon-memory-agent`

## Current State

Friendy is implemented as a local Vite, React, and TypeScript demo for the Photon relationship memory agent MVP.

The current branch includes:

- Chat-first Photon-style agent interface.
- Mocked Photon Residency Dinner calendar event.
- Mocked post-event contact delta.
- Candidate confirmation and ignore flow.
- Natural-language context capture.
- Simple fuzzy memory search with explanation strings.
- Tests for mock data, state transitions, agent behavior, and app rendering.

## Product Thesis

Friendy is a relationship memory agent that helps users remember and refind people they met by watching for new contacts during approved event windows and asking users to add context.

## Commands

Install:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Verify:

```bash
npm test
npm run build
```

## Important Files

- `README.md`: repo overview, setup, and demo script.
- `docs/product-spec.md`: product definition, MVP loop, guardrails, and future features.
- `docs/demo-plan.md`: 60-second demo script.
- `docs/codex-access.md`: recommended Codex command access setup.
- `docs/superpowers/`: original Superpowers spec and implementation plan artifacts.
- `implementation-notes.html`: running implementation decisions and verification notes.
- `src/App.tsx`: demo UI.
- `src/agent.ts`: agent message handling and search.
- `src/memoryStore.ts`: deterministic memory state transitions.
- `src/mockData.ts`: seeded demo event and contact candidates.
- `src/types.ts`: V1 domain model.

## Existing Commits

- `docs:add agent workflow instructions`
- `chore:scaffold friendy demo app`
- `feat:add relationship memory agent demo`
- `docs:record verification notes`

## Next Product Work

1. Add a clearer onboarding flow that explains Calendar and Contacts permissions without sounding creepy.
2. Add a stronger confirmation queue UX for candidate contacts.
3. Add follow-up draft behavior after a memory is found.
4. Replace mocked event/contact signals with a native companion app spike.
5. Decide the first real Photon/Spectrum messaging surface for the agent.

## Constraints To Preserve

- Keep Friendy agent-first.
- Keep V1 event-window scoped.
- Do not require users to manually create event cards.
- Do not scrape social platforms.
- Do not read iMessage.
- Do not use face recognition.
- Do not auto-save people without approval.
