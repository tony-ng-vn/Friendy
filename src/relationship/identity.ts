export type FriendyIdentityEnv = Partial<
  Pick<NodeJS.ProcessEnv, "FRIENDY_LOCAL_USER_ID" | "FRIENDY_OWNER_PHONE">
>;

/**
 * Resolves the single-owner runtime identity shared by local sensors and iMessage.
 *
 * The MVP has no signup identity table yet, so configured owner identity is the seam that lets a
 * local contact check write candidates under the same user id that Spectrum later uses to confirm.
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
