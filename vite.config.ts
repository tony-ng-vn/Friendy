/// <reference types="vitest" />
/** Vite + Vitest config; excludes git worktrees from test discovery. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Parallel agent worktrees should not be scanned as test roots.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.worktrees/**"],
    environment: "jsdom",
    globals: true
  }
});
