# Friendy AI System Architecture

## Definition

An AI system is a product system where models, tools, memory, state, interfaces, rules, and evaluations work together to turn uncertain human input or external signals into useful actions.

Friendy is an iMessage-first relationship memory AI system. The LLM is not the whole system. The system is the loop that detects relationship signals, asks the user for consent and context, stores structured memory, and retrieves the right person later from vague human recall.

## Product Loop

```text
new phone contact
-> event/context guess
-> Friendy texts the user in iMessage
-> user confirms or ignores
-> user adds messy human context
-> Friendy saves structured relationship memory
-> user later searches by context in iMessage
-> Friendy returns likely person and contact route
```

The MVP focuses on phone contacts as the first connection source and iMessage as the only primary communication surface. LinkedIn, X, Instagram, and other connection sources can become future detectors, but they are not part of the current MVP.

## System Boundary

These parts count as Friendy's AI system:

- Spectrum/iMessage transport for the user conversation.
- Contact/calendar ingestion for detecting likely new relationship events.
- Message normalization into a stable inbound message shape.
- Interpretation layer that converts messy text into structured intent.
- Deterministic tools for confirmation, memory writes, ignores, search, and event-match lookup.
- Relationship memory repository.
- Search and ranking over names, events, notes, roles, projects, schools, aliases, dates, and contact labels.
- Response composer for short human-facing iMessage replies.
- Eval harness for messy multi-turn agent trajectories.
- Privacy and consent guardrails.

These parts are outside the current MVP:

- LinkedIn, X, Instagram, or website scraping.
- Face recognition.
- Full CRM workflows.
- Multi-channel communication as a product focus.
- Automatic memory creation without user confirmation.
- Production durable storage and mobile background execution.

## Current Architecture Flow

```text
contact snapshot diff
-> newly detected phone/email method
-> detectedAt from snapshot data
-> calendar event match
-> pending contact candidate
-> iMessage confirmation prompt
-> user reply
-> interpreted intent
-> deterministic tool call
-> relationship memory
-> later fuzzy search
-> composed iMessage response
```

Today, ingestion is fixture-based in the repo. The important architectural boundary is already present: contact detection creates pending candidates, and the agent flow confirms or ignores those candidates before memory is saved.

## Agent Loop

```text
InboundAgentMessage
-> interpret message
-> enrich with recent conversation context
-> choose bounded action
-> execute deterministic tool
-> compose user-facing reply
-> log/evaluate behavior
```

The model may help interpret messy language, but it should not directly mutate memory. Writes, ignores, event corrections, and searches go through explicit deterministic tools so the system can be tested and audited.

## Memory Model

Friendy needs to separate facts that humans often blend together in one sentence:

- `eventContext`: where or when the current interaction happened.
- `relationshipContext`: prior history, backstory, or how the user already knew the person.
- `userNote`: the user's raw or lightly cleaned memory note.
- `contactMethod`: the route back to the person, such as phone, iMessage, email, or future social links.
- `detectedAt`: when the contact signal appeared.
- `confirmedAt`: when the user approved saving the relationship memory.

This separation matters because event context and relationship backstory can point to different times and places.

## Important Parsing Example

User says:

```text
met abc at Photon Residency II after havent met him since high school in minnesota
```

Friendy should understand:

- Current interaction/event: `Photon Residency II`
- Person: `abc`
- Relationship backstory: `had not seen him since high school in Minnesota`
- Searchable note: `Met again at Photon Residency II after not seeing him since high school in Minnesota`

Friendy should not treat `high school in Minnesota` as the current event. It is prior relationship context.

## Current Repo Implementation

```text
src/relationship/transports/
  iMessage/Spectrum and terminal adapters

src/relationship/ingestion/
  fixture contact snapshot diffing and fixture calendar ingestion

src/relationship/interpretation.ts
src/relationship/openRouterInterpreter.ts
  structured message interpretation contract and optional LLM-backed interpreter

src/relationship/interpretedAgent.ts
  conversation context carryover and interpreted execution

src/relationship/tools.ts
src/relationship/repository.ts
  deterministic tool and memory boundary

src/relationship/responseComposer.ts
  user-facing response wording

src/relationship/evals/
  deterministic trajectory-level agent evaluation
```

## Design Principles

- iMessage is the primary communication surface for the MVP.
- New phone contacts are the first detection source.
- Every detected person starts as a pending candidate, not a saved memory.
- User confirmation is required before saving a relationship memory.
- The agent should ask when uncertain instead of inventing details.
- Deterministic tools own state changes.
- LLM interpretation is useful, but bounded and replaceable.
- Evals should test whole relationship trajectories, not only single functions.

## Current Limitations

- Contact detection is fixture-based except for the explicit macOS Contacts smoke command.
- Calendar matching is fixture-based.
- Memory is in-memory, not production durable storage.
- Spectrum/iMessage is wired as the primary live transport, but the deterministic test path still uses local simulated messages.
- LinkedIn, X, Instagram, and other social connection sources are future detectors, not MVP requirements.
- The system does not yet run a real background watcher that notices a new phone contact and proactively texts the user.

## Next MVP Milestone

The next milestone is the iMessage-first contact confirmation loop:

```text
new phone contact detected
-> Friendy texts the user
-> user replies with messy context
-> Friendy separates event context from relationship backstory
-> deterministic tool saves confirmed memory
-> later iMessage search retrieves the person
```

The demo should prove this product behavior before adding more connection sources or a richer UI.
