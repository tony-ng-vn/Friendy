import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const FRIENDY_ENV_FILES = [".env.local", ".env"] as const;

export type SpectrumCredentials = {
  projectId: string;
  projectSecret: string;
};

/**
 * Loads local env files for standalone Node/tsx agent scripts.
 *
 * Vite loads `.env.local` automatically for browser/dev commands, but `tsx` does not.
 * Loading `.env.local` before `.env` mirrors the intended local override behavior while
 * preserving credentials already exported in the shell.
 */
export function loadFriendyEnv(cwd = process.cwd()): string[] {
  const loaded: string[] = [];

  for (const filename of FRIENDY_ENV_FILES) {
    const path = resolve(cwd, filename);
    if (!existsSync(path)) {
      continue;
    }

    config({ path, override: false, quiet: true });
    loaded.push(filename);
  }

  return loaded;
}

/** Reads the Spectrum credentials after environment files have been loaded. */
export function readSpectrumCredentials(env: NodeJS.ProcessEnv = process.env): SpectrumCredentials {
  const projectId = env.SPECTRUM_PROJECT_ID;
  const projectSecret = env.SPECTRUM_PROJECT_SECRET;

  if (!projectId || !projectSecret) {
    throw new Error("Missing SPECTRUM_PROJECT_ID or SPECTRUM_PROJECT_SECRET.");
  }

  return { projectId, projectSecret };
}
