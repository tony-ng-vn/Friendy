import {
  emptySession,
  normalizeSessionKey,
  sessionCacheKey,
  type ConversationSession,
  type ConversationSessionKey
} from "./conversationSession";

export type ConversationSessionStore = {
  getSession(key: ConversationSessionKey): ConversationSession | undefined;
  upsertSession(session: ConversationSession): ConversationSession;
  deleteSession(key: ConversationSessionKey): void;
};

/** In-memory session store for unit tests and non-sqlite runtimes. */
export function createInMemoryConversationSessionStore(): ConversationSessionStore {
  const sessions = new Map<string, ConversationSession>();

  return {
    getSession(key) {
      return sessions.get(sessionCacheKey(key));
    },

    upsertSession(session) {
      const normalizedKey = normalizeSessionKey(session.key);
      const existing = sessions.get(sessionCacheKey(normalizedKey));
      const next: ConversationSession = {
        ...session,
        key: normalizedKey,
        version: existing ? existing.version + 1 : session.version || 1
      };
      sessions.set(sessionCacheKey(normalizedKey), next);
      return next;
    },

    deleteSession(key) {
      sessions.delete(sessionCacheKey(key));
    }
  };
}

export { emptySession };
