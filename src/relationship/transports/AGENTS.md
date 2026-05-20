# Relationship Transport Instructions

Transport modules adapt external communication channels into `InboundAgentMessage`.

- Keep transport code thin: normalize inbound messages, call the relationship agent, send replies, and log compact backend traces.
- Do not put memory parsing, search ranking, or product decisions in transport files.
- Spectrum/iMessage credentials must come from `.env.local`, `.env`, or process env. Never hardcode secrets.
- If a transport needs a provider-specific field, convert it to the shared domain shape before it reaches the agent.
- Keep terminal transport usable as a no-credentials smoke test.

Useful commands:

```bash
npm test -- src/relationship/transports/spectrumTransport.test.ts
npm run agent:terminal -- "yes, recruiting agents, played piano"
```
