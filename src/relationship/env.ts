/**
 * Local environment loading for standalone Node/tsx scripts.
 *
 * Browser/Vite commands auto-load `.env.local`; Spectrum and ingestion CLIs
 * call `loadFriendyEnv()` first. Does not define product identity — see `identity.ts`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

const FRIENDY_ENV_FILES = [".env.local", ".env"] as const;

/** Spectrum project credentials read after env files are loaded. */
export type SpectrumCredentials = {
  projectId: string;
  projectSecret: string;
};

/**
 * Loads local env files for standalone Node/tsx agent scripts.
 *
 * @param cwd - Directory to search for `.env.local` then `.env`
 * @returns Filenames that were found and loaded (shell exports are never overridden)
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

/**
 * Reads Spectrum credentials after environment files have been loaded.
 *
 * @throws When `SPECTRUM_PROJECT_ID` or `SPECTRUM_PROJECT_SECRET` is missing
 */
export function readSpectrumCredentials(env: NodeJS.ProcessEnv = process.env): SpectrumCredentials {
  const projectId = env.SPECTRUM_PROJECT_ID;
  const projectSecret = env.SPECTRUM_PROJECT_SECRET;

  if (!projectId || !projectSecret) {
    throw new Error("Missing SPECTRUM_PROJECT_ID or SPECTRUM_PROJECT_SECRET.");
  }

  return { projectId, projectSecret };
}
