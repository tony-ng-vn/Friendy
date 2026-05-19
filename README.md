# Friendy

Friendy is a Photon-centric relationship memory agent that helps you remember and refind people you met during approved event windows.

The current version is a local demo prototype. It uses mocked calendar and contact signals to prove the core agent loop before building native mobile Contacts/Calendar integrations.

## MVP Loop

1. Friendy notices an upcoming event from a mocked calendar feed.
2. The Photon-style agent asks whether to remember new people during that event.
3. The user approves the memory window.
4. Mocked contact deltas appear after the event.
5. The agent asks the user to confirm which contacts were actually met.
6. The user adds context in natural language.
7. Later, the user can ask vague recall questions like `who was playing piano at dinner?`.

## What This Demo Includes

- Chat-first Photon agent interface.
- Mocked `Photon Residency Dinner` calendar event.
- Mocked new contact queue.
- User-approved memory session.
- Candidate confirmation and ignore flow.
- Natural-language context capture.
- Simple fuzzy memory search with match explanations.

## Docs

- [Product spec](docs/product-spec.md)
- [Demo plan](docs/demo-plan.md)
- [Handoff](docs/handoff.md)
- [Codex access setup](docs/codex-access.md)
- [Original Superpowers planning artifacts](docs/superpowers/README.md)

## Explicit Non-Goals For V1

- No iMessage reading.
- No Instagram, LinkedIn, or X scraping.
- No face recognition.
- No full CRM workflow.
- No automatic identity graph.
- No real iOS background contact monitoring yet.

## Getting Started

```bash
npm install
npm run dev
```

Run checks:

```bash
npm test
npm run build
```

## Demo Script

In the chat UI:

1. Send `yes`.
2. Confirm the candidate queue shows Maya, Alex, and Priya.
3. Send `save Maya: played piano, AI recruiting founder`.
4. Confirm saved memories show Maya.
5. Send `who was playing piano at dinner`.
6. Friendy should return Maya with the saved context and contact label.

## Product Direction

Friendy should stay agent-centric. A future mobile companion app can provide Contacts and Calendar signals, but the user-facing product is the Photon agent that asks, confirms, remembers, searches, explains, and helps follow up.
