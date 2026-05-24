/**
 * Single-owner runtime identity for local sensors and iMessage.
 *
 * Bridges local contact ingestion and Spectrum transport under one user id until
 * a signup identity table exists. Callers: `ingestion/localCheck`, Spectrum adapter.
 */
export type FriendyIdentityEnv = Partial<
  Pick<NodeJS.ProcessEnv, "FRIENDY_LOCAL_USER_ID" | "FRIENDY_OWNER_PHONE">
>;

/**
 * Resolves the configured owner user id shared by ingestion and transports.
 *
 * Prefers `FRIENDY_LOCAL_USER_ID`, then `FRIENDY_OWNER_PHONE`, then optional fallback.
 *
 * @returns Trimmed id when configured; otherwise `fallback` or undefined
 */
export function resolveConfiguredUserId(env: FriendyIdentityEnv, fallback?: string): string | undefined {
  return firstNonEmpty(env.FRIENDY_LOCAL_USER_ID, env.FRIENDY_OWNER_PHONE) ?? fallback;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}
