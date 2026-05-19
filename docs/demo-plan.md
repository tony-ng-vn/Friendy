# Friendy Demo Plan

## Goal

Show the magic in under 60 seconds: Friendy helps the user recover someone by context, not by name.

## Current Demo Setup

The repo contains a local Vite/React demo with mocked data:

- User: Thien
- Event: Photon Residency Dinner
- Candidates: Maya Chen, Alex Rivera, Priya Shah
- Signal source: mocked calendar and mocked contact delta

## Run The Demo

```bash
npm install
npm run dev
```

Checks:

```bash
npm test
npm run build
```

## 60-Second Script

Setup:

> "Friendy is a Photon relationship memory agent. It does not scrape messages or social profiles. It only tracks people during event windows the user approves."

User action:

1. Open the app.
2. Send `yes` to approve the Photon Residency Dinner memory window.
3. Friendy shows new contact candidates from the mocked post-event contact delta.
4. Send `save Maya: played piano, AI recruiting founder`.
5. Send `who was playing piano at dinner`.

Agent response:

> "Likely Maya Chen. Your saved note says 'played piano, AI recruiting founder' and matched: played, piano, recruiting. Contact: +15550101020."

Magic moment:

The user did not search by name. They searched by a fuzzy human memory fragment, and Friendy recovered the right person with the event context and contact route.

Ending:

> "The demo uses mocked Contacts and Calendar signals. The product bet is that a native companion app can supply those signals later, while Photon remains the user-facing relationship memory agent."

## What The Demo Proves

- The agent asks before tracking.
- Contacts are candidates, not automatically saved memories.
- The user adds context in natural language.
- Vague recall search returns the right person.
- The result includes why it matched and how to contact them.

## What The Demo Does Not Prove Yet

- Real iOS Contacts permission behavior.
- Real Calendar event detection.
- Background execution constraints.
- Multi-platform identity matching.
- Social profile import.
- Production-grade search.
