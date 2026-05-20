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

## Relationship Agent Core

Run the local terminal agent demo:

```bash
npm run agent:terminal -- "yes, recruiting agents, played piano"
```

The iMessage/Spectrum agent also accepts natural save messages such as:

```text
I met Amaya at Photon Residency II, and we talked about AI agents
```

Then search with:

```text
who did I meet at Photon Residency?
```

Run the Spectrum/iMessage agent when Spectrum credentials are available:

```bash
# .env.local is supported for local credentials and is ignored by git.
cp .env.example .env.local
npm run agent:spectrum
```

The agent number for the first iMessage channel is `+14156056081`.

Configure the LLM interpreter in `.env.local`:

```bash
SPECTRUM_PROJECT_ID=
SPECTRUM_PROJECT_SECRET=
FRIENDY_AGENT_NUMBER=+14156056081
OPENROUTER_API_KEY=
OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

`OPENROUTER_API_KEY` is optional for local testing. If it is missing, Friendy falls back to a deterministic interpreter so the MVP examples still run without model access. When OpenRouter is configured, the model only returns validated structured intent JSON; deterministic backend tools still perform all memory writes and searches.

Live iMessage smoke test:

```text
I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(
Who did I meet at the residency?
Ok so at the residency, I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project that allow you to control your computer through your phone with a clicky UI and similar function like Wisper Flow
Who was making the Swift project?
that person from the thing
```

## Product Direction

Friendy should stay agent-centric. A future mobile companion app can provide Contacts and Calendar signals, but the user-facing product is the Photon agent that asks, confirms, remembers, searches, explains, and helps follow up.
