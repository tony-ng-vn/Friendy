/**
 * Durable per-user conversation session for multi-turn agent state (PR 10+).
 *
 * Replaces process-local Maps in `interpretedAgent` with versioned snapshots:
 * active workflows, search/list carryover, route history, and reminder timing.
 * Persisted via `conversationSessionStore`; helpers here stay pure projections.
 */
import type { TemporalContext } from "./temporalContext";
import type { AgentPlatform } from "./types";

export const MAX_ROUTE_HISTORY = 10;
export const MAX_RECENT_ENTITY_REFS = 10;
export const MAX_RECENT_PEOPLE = 10;

/** Stable session identity: user, platform, and optional Spectrum space. */
export type ConversationSessionKey = {
  userId: string;
  platform: AgentPlatform;
  spaceId?: string;
};

export type SearchContext = {
  searchContextId: string;
  createdAt: string;
  expiresAt: string;
  originalQuery: string;
  candidateMemoryIds: string[];
  lastQuestion: string;
};

/** Mutually exclusive in-flight confirmation or mutation workflow for one session. */
export type ActiveWorkflow =
  | {
      kind: "pending_contact_confirm";
      frameId: string;
      candidateId: string;
      displayName: string;
      lastFriendyPrompt: string;
      openedAt: string;
    }
  | {
      kind: "duplicate_resolution";
      candidateId: string;
      suspectedPersonId: string;
      displayName: string;
      priorEventTitle?: string;
      openedAt: string;
    }
  | {
      kind: "pending_delete_confirm";
      memoryId: string;
      displayName: string;
      query: string;
      openedAt: string;
    }
  | {
      kind: "pending_update_confirm";
      memoryId: string;
      displayName: string;
      proposedContextNote: string;
      openedAt: string;
    };

export type ConversationSession = {
  key: ConversationSessionKey;
  activeWorkflow?: ActiveWorkflow;
  lastSearch?: SearchContext;
  lastListResult?: {
    listedAt: string;
    memoryIds: string[];
    personIds?: string[];
    filterSummary?: string;
  };
  activeMemoryId?: string;
  recentEntityRefs: Array<{
    kind: "candidate" | "memory" | "person";
    id?: string;
    displayName: string;
    referencedAt: string;
  }>;
  lastAgentPrompt?: {
    text: string;
    interactionId?: string;
    createdAt: string;
  };
  lastRouteDecision?: {
    intent: string;
    routeSource: string;
    createdAt: string;
  };
  reminderState?: {
    lastReminderAt?: string;
    lastRemindedCandidateId?: string;
    lastUserComplaintAt?: string;
  };
  routeHistory: Array<{
    intent: string;
    routeSource: string;
    createdAt: string;
  }>;
  carryover?: {
    activeEventName?: string;
    activeDateContext?: TemporalContext;
    recentPeople: string[];
  };
  updatedAt: string;
  version: number;
};

export type RouteHistoryEntry = ConversationSession["routeHistory"][number];

export type RecentEntityRef = ConversationSession["recentEntityRefs"][number];

/** Legacy process-local context shape from interpretedAgent before PR 10 migration. */
export type LegacyConversationContext = {
  activeEventName?: string;
  activeDateContext?: TemporalContext;
  lastSearch?: SearchContext;
  activeMemoryId?: string;
  pendingDelete?: {
    memoryId: string;
    displayName: string;
  };
  recentPeople: string[];
};

/** Creates a fresh session snapshot for a user/channel key. */
export function emptySession(key: ConversationSessionKey, now = new Date().toISOString()): ConversationSession {
  return {
    key: normalizeSessionKey(key),
    recentEntityRefs: [],
    routeHistory: [],
    updatedAt: now,
    version: 1
  };
}

/** Normalizes optional spaceId so store keys stay stable. */
export function normalizeSessionKey(key: ConversationSessionKey): ConversationSessionKey {
  return {
    userId: key.userId,
    platform: key.platform,
    spaceId: key.spaceId?.trim() || undefined
  };
}

/** Stable string key for in-memory maps and SQLite primary-key logic. */
export function sessionCacheKey(key: ConversationSessionKey): string {
  const normalized = normalizeSessionKey(key);
  return `${normalized.userId}:${normalized.platform}:${normalized.spaceId ?? ""}`;
}

/** Appends a route decision and trims history to the configured cap. */
export function appendRouteHistory(session: ConversationSession, entry: RouteHistoryEntry): ConversationSession {
  return {
    ...session,
    routeHistory: [...session.routeHistory, entry].slice(-MAX_ROUTE_HISTORY)
  };
}

/** Appends a recent entity reference and trims to the configured cap. */
export function appendRecentEntityRef(
  session: ConversationSession,
  ref: RecentEntityRef
): ConversationSession {
  return {
    ...session,
    recentEntityRefs: [...session.recentEntityRefs, ref].slice(-MAX_RECENT_ENTITY_REFS)
  };
}

/** Bumps updatedAt for optimistic concurrency and cache invalidation. */
export function touchUpdatedAt(session: ConversationSession, now: string): ConversationSession {
  return {
    ...session,
    updatedAt: now
  };
}

/** Projects legacy Map-only conversation context into a durable session snapshot. */
export function migrateFromLegacyContext(
  key: ConversationSessionKey,
  legacy: LegacyConversationContext,
  now = new Date().toISOString()
): ConversationSession {
  const session = emptySession(key, now);

  const carryover =
    legacy.activeEventName || legacy.activeDateContext || legacy.recentPeople.length > 0
      ? {
          activeEventName: legacy.activeEventName,
          activeDateContext: legacy.activeDateContext,
          recentPeople: legacy.recentPeople.slice(-MAX_RECENT_PEOPLE)
        }
      : undefined;

  const activeWorkflow = legacy.pendingDelete
    ? ({
        kind: "pending_delete_confirm" as const,
        memoryId: legacy.pendingDelete.memoryId,
        displayName: legacy.pendingDelete.displayName,
        query: legacy.pendingDelete.displayName,
        openedAt: now
      } satisfies ActiveWorkflow)
    : undefined;

  return {
    ...session,
    activeWorkflow,
    lastSearch: legacy.lastSearch,
    activeMemoryId: legacy.activeMemoryId,
    carryover
  };
}
