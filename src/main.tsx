/**
 * Legacy Vite demo entry point.
 *
 * Mounts the browser chat UI in `App.tsx`. Production relationship runtime and
 * transports live in `src/relationship/`; see `src/relationship/types.ts` and
 * `src/relationship/agentCore.ts` / `src/relationship/interpretedAgent.ts`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
