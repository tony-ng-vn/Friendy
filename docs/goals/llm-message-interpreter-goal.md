# Goal: Implement Friendy LLM Message Interpreter

Implement Friendy's LLM message interpreter architecture and do not stop until all MVP test cases pass.

## Context

Friendy is a relationship memory agent in the `Desktop/Friendy` repo. The current parser is brittle because humans text in unpredictable ways. Replace parser-first behavior with an interpretation layer:

```text
Spectrum/iMessage/terminal
-> normalized InboundAgentMessage
-> LLM/message interpreter
-> validated MessageInterpretation JSON
-> deterministic relationship tools
-> memory repository
-> interaction logs
-> outbound response
```

## Non-Negotiables

- The LLM must not directly write memory.
- The LLM only interprets the user message into structured JSON.
- Deterministic backend tools execute capture/search/ignore/clarify.
- Every interpreted turn must be logged.
- Keep the existing terminal demo working.
- Keep Spectrum/iMessage as a communication adapter, not the product identity.
- Use TDD and incremental commits in format `<scope>:<message>`.
- Keep `implementation-notes.html` updated.
- Read `AGENTS.md` before editing.
- Do not commit secrets.

## Before Coding

1. Inspect current git status and existing WIP.
2. Read `AGENTS.md`.
3. Read these docs if present:
   - `docs/superpowers/specs/2026-05-20-llm-message-interpreter-design.md`
   - `docs/superpowers/plans/2026-05-20-llm-message-interpreter.md`
4. Create or update:
   - `docs/goals/PLAN.md`
   - `docs/goals/EXPERIMENTS.md`
   - `docs/goals/EXPERIMENT_NOTES.md`
5. Keep `PLAN.md` as a checklist and check items off as completed.
6. Record each attempt/test/failure/fix in `EXPERIMENTS.md`.
7. Use `EXPERIMENT_NOTES.md` as chronological implementation notes.

## Implementation Requirements

- Add `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` support.
- Default model: `nvidia/nemotron-3-super-120b-a12b:free`.
- Use OpenRouter chat completions with:
  - `response_format.type = "json_schema"`
  - `strict = true`
  - `temperature = 0`
  - `provider.require_parameters = true`
- Add a `MessageInterpretation` schema with intents:
  - `capture_memory`
  - `search_memory`
  - `ignore_candidate`
  - `clarify`
  - `unknown`
- Validate model output before executing tools.
- Retry once on invalid model output.
- Fall back to deterministic interpreter if no OpenRouter key exists or the model call fails.
- Add backend interaction logs containing:
  - `inboundText`
  - `interpretedIntentJson`
  - `outboundText`
  - `toolCalls`
  - `modelUsed`
  - `confidence`
  - `latencyMs`
  - `error`
  - `createdAt`
- Spectrum backend should print compact JSON logs for each message.

## MVP Test Cases

All of these must be covered by automated tests and pass.

1. Input:
   `I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :(`

   Expected:
   - Intent: `capture_memory`
   - Saves Amaya
   - Context includes `Photon Residency II`
   - Context includes bed/sleeping context

2. Input:
   `Who I have met at the Residency?`

   Expected:
   - Intent: `search_memory`
   - Returns Amaya after Amaya was saved

3. Input:
   `Ok so at the residency, I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project that allow you to control your computer through your phone with a clicky UI and similar function like Wisper Flow`

   Expected:
   - Intent: `capture_memory`
   - Saves Zhiyuan
   - Alias: Zed
   - School: CMU
   - Class year: 2028
   - Project includes Swift/computer control/phone/clicky UI/Wispr Flow

4. After Amaya and Zhiyuan are saved:
   `Who did I meet at the residency?`

   Expected:
   - Returns both Amaya and Zhiyuan
   - Does not return only one overconfident match

5. Input:
   `Who was making the Swift project?`

   Expected:
   - Returns Zhiyuan/Zed

6. Input:
   `Who slept in the same bed?`

   Expected:
   - Returns Amaya

7. Input:
   `ignore`

   Expected:
   - Ignores pending candidate if one exists
   - Otherwise says no pending contact to ignore

8. Input:
   `that person from the thing`

   Expected:
   - Asks a clarification question
   - Does not save fake memory

9. OpenRouter invalid JSON or malformed schema response.

   Expected:
   - Retry once
   - Fallback if still invalid
   - Log the error

10. Missing `OPENROUTER_API_KEY`.

    Expected:
    - Deterministic fallback still works for local tests

## Verification Commands

Run all commands before completion:

```bash
npm test
npm run build
npm run agent:terminal -- "I met Amaya at Photon Residency II, and me and him sleep on the same bed cuz we ran out of bed :("
git diff --check
```

## Completion Criteria

- All tests pass.
- Build passes.
- At least the 10 MVP cases above are covered by automated tests.
- `README.md` documents OpenRouter env vars and live iMessage test examples.
- `implementation-notes.html` records architecture decisions and verification.
- No secrets are committed.
- Code is committed incrementally with detailed commit messages.
- Final `main` branch is pushed when complete.
