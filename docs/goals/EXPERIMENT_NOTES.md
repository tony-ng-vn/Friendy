# Contextual Memory Capture V2 Goal Notes

- 2026-05-20: Started goal execution from clean `main`; created `feature/contextual-memory-capture-v2`. Read repo guidance and the Contextual Memory Capture V2 goal file. The core behavior gap is multi-turn context: current agent saves Felix without inheriting Photon Residency II and captures only first names in rule-based fallback.
- 2026-05-20: Added RED tests for the exact Amaya/Sarah Fah/Felix Ng conversation and for natural-language date parsing. Implemented the first green slice with `chrono-node`, stored date context, full-name extraction, and a per-agent conversation context that carries active event/date context into "also met..." messages.
- 2026-05-20: Added a contract regression for `dateContext: null` because strict structured-output models need an explicit nullable value when no date was parsed. Validation now converts null to internal `undefined`.
