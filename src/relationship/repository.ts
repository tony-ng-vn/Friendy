/**
 * In-memory relationship persistence boundary for the MVP agent loop.
 *
 * Callers: `createRuntimeRelationshipRepository` (default store), tests, and eval fixtures.
 * Production SQLite persistence lives in `sqliteRepository.ts` but must honor this interface.
 *
 * Invariants:
 * - One `RelationshipMemory` per confirmed candidate (`assertCandidateHasNoMemory`).
 * - Memories require a confirmed candidate (`assertMemoryHasConfirmedCandidate`).
 * - Pending/prompted candidates expire after {@link CANDIDATE_EXPIRATION_DAYS} so stale contact
 *   prompts do not linger indefinitely.
 */
import { createHash, randomUUID } from "node:crypto";
import { buildMemorySearchDocument, type MemorySearchDocument, type RetrievalCandidate } from "./memorySearchDocument";
import { createCandidateId, mapCandidateToEvents } from "./eventMapper";
import {
  computeMethodFingerprint,
  normalizeDisplayNameForIdentity,
  type AppleContactLink,
  type PersonIdentity
} from "./personIdentity";
import type {
  CalendarEvent,
  CandidatePromptAttempt,
  ContactCandidate,
  ContactCandidateDetected,
  EventContextMatch,
  AgentInteraction,
  MemoryRevision,
  MemoryRevisionReason,
  RelationshipDateContext,
  RelationshipMemory,
  DuplicateResolutionStatus,
  User
} from "./types";

/** Optional bootstrap data for tests and local fixtures. */
export type RepositorySeed = {
  users?: User[];
  calendarEvents?: CalendarEvent[];
  candidates?: ContactCandidate[];
  eventMatches?: EventContextMatch[];
  promptAttempts?: CandidatePromptAttempt[];
  memories?: RelationshipMemory[];
  memoryRevisions?: MemoryRevision[];
  interactions?: AgentInteraction[];
  personIdentities?: PersonIdentity[];
  appleContactLinks?: AppleContactLink[];
};

/** Input for creating a durable person identity row during candidate confirmation. */
export type CreatePersonIdentityInput = {
  userId: string;
  canonicalDisplayName: string;
  createdAt?: string;
};

/** Links an Apple Contacts row to a person identity via method fingerprint. */
export type LinkAppleContactInput = {
  personId: string;
  userId: string;
  contactIdentifier?: string;
  unifiedContactIdentifier?: string;
  containerIdentifier?: string;
  methodFingerprint: string;
  displayNameSnapshot: string;
  sensorEventId?: string;
  linkedAt?: string;
};

/** User choice when a new contact shares a display name with saved memory. */
export type ResolveDuplicateCandidateInput = {
  resolution: DuplicateResolutionStatus;
  personId?: string;
  suspectedDuplicatePersonId?: string;
};

/** Optional overrides when confirming a detected contact into a durable memory. */
export type ConfirmCandidateOptions = {
  eventTitle?: string;
  relationshipContext?: string;
  dateContext?: RelationshipDateContext;
  /** Wall-clock confirmation time; defaults to now when omitted. */
  confirmedAt?: string;
};

/** Links a proactive review prompt to the Spectrum space that received it. */
export type MarkCandidatePromptedOptions = {
  spaceId?: string;
  promptedAt?: string;
};

/** Audit fields written when a user edits an existing memory in place. */
export type UpdateMemoryInput = {
  contextNote: string;
  relationshipContext?: string;
  reason: MemoryRevisionReason;
  userText?: string;
  updatedAt: string;
};

/** Audit fields written when a user soft-deletes a memory. */
export type DeleteMemoryInput = {
  userText?: string;
  deletedAt: string;
};

/**
 * Pending candidates older than this are auto-expired on read.
 *
 * Two weeks balances giving the user time to reply in iMessage against not keeping ambiguous
 * contact prompts in the review queue forever.
 */
const CANDIDATE_EXPIRATION_DAYS = 14;

/**
 * Persistence contract for calendar context, contact candidates, memories, and agent interactions.
 *
 * Implementations must preserve candidate lifecycle ordering and the one-memory-per-candidate rule.
 */
export type RelationshipRepository = {
  listCalendarEvents(userId: string): CalendarEvent[];
  addCalendarEvents(events: CalendarEvent[]): CalendarEvent[];
  createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate;
  listPendingCandidates(userId: string): ContactCandidate[];
  getCandidate(candidateId: string): ContactCandidate | undefined;
  listEventMatches(candidateId: string): EventContextMatch[];
  recordPromptAttempt(attempt: CandidatePromptAttempt): CandidatePromptAttempt;
  listCandidatePromptAttempts(candidateId: string): CandidatePromptAttempt[];
  markCandidatePrompted(
    candidateId: string,
    interactionId: string,
    options?: MarkCandidatePromptedOptions
  ): ContactCandidate;
  markCandidatePromptFailed(candidateId: string, reason: string): ContactCandidate;
  confirmCandidate(
    candidateId: string,
    contextNote: string,
    eventId?: string,
    options?: ConfirmCandidateOptions
  ): RelationshipMemory;
  ignoreCandidate(candidateId: string): void;
  /** Reopens an ignored or expired candidate for a fresh post-start contact detection. */
  reactivateCandidateForIntake(
    candidateId: string,
    options?: { detectedAt?: string }
  ): ContactCandidate;
  /** Ignored/expired candidates without memories that still have recent sensor processing. */
  listIgnoredCandidateIdsForReintake(
    userId: string,
    options?: { sensorActivitySince?: string }
  ): string[];
  listMemories(userId?: string): RelationshipMemory[];
  listMemorySearchDocuments(userId?: string): MemorySearchDocument[];
  searchMemoryDocuments?(userId: string, query: string, terms: string[]): RetrievalCandidate[];
  addMemory(memory: RelationshipMemory): RelationshipMemory;
  updateMemory(memoryId: string, updates: UpdateMemoryInput): RelationshipMemory;
  deleteMemory(memoryId: string, input: DeleteMemoryInput): RelationshipMemory;
  listMemoryRevisions(memoryId: string): MemoryRevision[];
  addInteraction(interaction: AgentInteraction): AgentInteraction;
  listInteractions(userId?: string): AgentInteraction[];
  createPersonIdentity(input: CreatePersonIdentityInput): PersonIdentity;
  linkAppleContact(input: LinkAppleContactInput): AppleContactLink;
  listAppleContactLinksForPerson(userId: string, personId: string): AppleContactLink[];
  findPersonByMethodFingerprint(userId: string, methodFingerprint: string): PersonIdentity | undefined;
  findPeopleByDisplayNameNormalized(userId: string, displayName: string): PersonIdentity[];
  attachCandidateToPerson(candidateId: string, personId: string): ContactCandidate;
  resolveDuplicateCandidate(candidateId: string, input: ResolveDuplicateCandidateInput): ContactCandidate;
};

/**
 * Creates the MVP memory repository.
 *
 * It is intentionally in-memory so the agent loop can be tested without Notion, Mem0,
 * or a production database. The returned API is the boundary those stores can replace later.
 */
export function createRelationshipRepository(seed: RepositorySeed = {}): RelationshipRepository {
  const calendarEvents = [...(seed.calendarEvents ?? [])];
  const candidates = [...(seed.candidates ?? [])];
  const eventMatches = [...(seed.eventMatches ?? [])];
  const promptAttempts = [...(seed.promptAttempts ?? [])];
  const memories = [...(seed.memories ?? [])];
  const memoryRevisions = [...(seed.memoryRevisions ?? seed.memories?.map(createCreatedMemoryRevision) ?? [])];
  const interactions = [...(seed.interactions ?? [])];
  const personIdentities = [...(seed.personIdentities ?? [])];
  const appleContactLinks = [...(seed.appleContactLinks ?? [])];

  return {
    listCalendarEvents(userId: string) {
      return calendarEvents.filter((event) => event.userId === userId);
    },

    addCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
      for (const event of events) {
        const existingIndex = calendarEvents.findIndex((item) => item.id === event.id);
        if (existingIndex >= 0) {
          calendarEvents[existingIndex] = event;
        } else {
          calendarEvents.push(event);
        }
      }

      return events;
    },

    createCandidateFromDetectedContact(contact: ContactCandidateDetected): ContactCandidate {
      const candidateId = createCandidateId(contact);
      const existing = candidates.find((candidate) => candidate.id === candidateId);
      if (existing) {
        return reactivateCandidateForIntakeIfEligible(existing, contact.detectedAt);
      }

      const candidate: ContactCandidate = {
        ...contact,
        id: candidateId,
        status: "pending",
        expiresAt: calculateCandidateExpiresAt(contact.detectedAt)
      };

      candidates.push(candidate);
      // Persist event guesses at detection time so the later confirmation prompt can explain its assumption.
      eventMatches.push(...mapCandidateToEvents(candidate.id, eventMatchContact(contact), calendarEvents));
      return candidate;
    },

    listPendingCandidates(userId: string): ContactCandidate[] {
      return candidates.filter((candidate) => {
        expireCandidateIfStale(candidate);
        return candidate.userId === userId && isReviewableCandidateStatus(candidate.status);
      });
    },

    getCandidate(candidateId: string): ContactCandidate | undefined {
      return candidates.find((candidate) => candidate.id === candidateId);
    },

    listEventMatches(candidateId: string): EventContextMatch[] {
      return eventMatches
        .filter((match) => match.candidateId === candidateId)
        .sort((a, b) => a.rank - b.rank);
    },

    recordPromptAttempt(attempt: CandidatePromptAttempt): CandidatePromptAttempt {
      const existingIndex = promptAttempts.findIndex((item) => item.id === attempt.id);
      if (existingIndex >= 0) {
        promptAttempts[existingIndex] = attempt;
      } else {
        promptAttempts.push(attempt);
      }
      return attempt;
    },

    listCandidatePromptAttempts(candidateId: string): CandidatePromptAttempt[] {
      return promptAttempts.filter((attempt) => attempt.candidateId === candidateId);
    },

    confirmCandidate(
      candidateId: string,
      contextNote: string,
      eventId?: string,
      options: ConfirmCandidateOptions = {}
    ): RelationshipMemory {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (!isReviewableCandidateStatus(candidate.status)) {
        throw new Error(`Candidate is not confirmable: ${candidateId}`);
      }

      candidate.status = "confirmed";
      const confirmedAt = options.confirmedAt ?? new Date().toISOString();
      const personId = ensureCandidatePersonId({
        candidate,
        personIdentities,
        appleContactLinks,
        now: confirmedAt
      });
      candidate.personId = personId;
      const selectedMatch = options.eventTitle && !eventId ? undefined : selectEventMatch(eventMatches, candidateId, eventId);
      const memory: RelationshipMemory = {
        id: `memory_${candidate.id}`,
        userId: candidate.userId,
        candidateId: candidate.id,
        personId,
        displayName: candidate.displayName,
        primaryContactLabel: candidate.phoneNumbers[0] ?? candidate.emails[0] ?? "contact saved",
        eventId: selectedMatch?.calendarEventId,
        eventTitle: options.eventTitle ?? selectedMatch?.eventTitle,
        dateContext: options.dateContext,
        contextNote,
        relationshipContext: options.relationshipContext,
        tags: extractTags(contextNote),
        confidence: selectedMatch?.confidence ?? 0.5,
        createdAt: confirmedAt,
        updatedAt: confirmedAt
      };

      memories.push(memory);
      memoryRevisions.push(createCreatedMemoryRevision(memory));
      return memory;
    },

    markCandidatePrompted(
      candidateId: string,
      interactionId: string,
      options: MarkCandidatePromptedOptions = {}
    ): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (candidate.status !== "pending") {
        throw new Error(`Candidate is not promptable: ${candidateId}`);
      }

      candidate.status = "prompted";
      candidate.promptInteractionId = interactionId;
      candidate.promptSpaceId = options.spaceId;
      candidate.promptedAt = options.promptedAt;
      delete candidate.statusReason;
      return candidate;
    },

    markCandidatePromptFailed(candidateId: string, reason: string): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (candidate.status !== "pending") {
        throw new Error(`Candidate is not pending: ${candidateId}`);
      }

      candidate.statusReason = reason;
      return candidate;
    },

    ignoreCandidate(candidateId: string): void {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (!isReviewableCandidateStatus(candidate.status)) {
        throw new Error(`Candidate is not ignorable: ${candidateId}`);
      }
      candidate.status = "ignored";
    },

    reactivateCandidateForIntake(candidateId: string, options: { detectedAt?: string } = {}): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }
      expireCandidateIfStale(candidate);
      if (!isReintakeEligibleCandidateStatus(candidate.status)) {
        throw new Error(`Candidate is not eligible for contact re-intake: ${candidateId}`);
      }

      candidate.status = "pending";
      delete candidate.statusReason;
      delete candidate.promptInteractionId;
      delete candidate.promptSpaceId;
      delete candidate.promptedAt;
      if (options.detectedAt) {
        candidate.detectedAt = options.detectedAt;
        candidate.expiresAt = calculateCandidateExpiresAt(options.detectedAt);
      }

      return candidate;
    },

    listIgnoredCandidateIdsForReintake(): string[] {
      return [];
    },

    listMemories(userId?: string): RelationshipMemory[] {
      const visibleMemories = memories.filter((memory) => !memory.deletedAt);
      return userId ? visibleMemories.filter((memory) => memory.userId === userId) : [...visibleMemories];
    },

    listMemorySearchDocuments(userId?: string): MemorySearchDocument[] {
      const visibleMemories = memories.filter((memory) => !memory.deletedAt);
      return (userId ? visibleMemories.filter((memory) => memory.userId === userId) : visibleMemories).map(
        buildMemorySearchDocument
      );
    },

    addMemory(memory: RelationshipMemory): RelationshipMemory {
      assertMemoryHasConfirmedCandidate(memory, candidates);
      assertCandidateHasNoMemory(memory, memories);
      if (memories.some((existing) => existing.id === memory.id)) {
        throw new Error(`Memory already exists: ${memory.id}`);
      }
      memories.push(memory);
      memoryRevisions.push(createCreatedMemoryRevision(memory));
      return memory;
    },

    updateMemory(memoryId: string, updates: UpdateMemoryInput): RelationshipMemory {
      const index = memories.findIndex((memory) => memory.id === memoryId);
      if (index < 0) {
        throw new Error(`Memory not found: ${memoryId}`);
      }

      const previous = memories[index];
      if (previous.deletedAt) {
        throw new Error(`Memory is deleted: ${memoryId}`);
      }
      const updated: RelationshipMemory = {
        ...previous,
        contextNote: updates.contextNote,
        relationshipContext: updates.relationshipContext ?? previous.relationshipContext,
        tags: extractTags([updates.contextNote, updates.relationshipContext ?? ""].join(" ")),
        updatedAt: updates.updatedAt
      };
      memories[index] = updated;
      memoryRevisions.push(createUpdatedMemoryRevision(previous, updated, updates, memoryRevisions.length + 1));
      return updated;
    },

    deleteMemory(memoryId: string, input: DeleteMemoryInput): RelationshipMemory {
      const index = memories.findIndex((memory) => memory.id === memoryId);
      if (index < 0) {
        throw new Error(`Memory not found: ${memoryId}`);
      }

      const previous = memories[index];
      if (previous.deletedAt) {
        return previous;
      }

      const deleted: RelationshipMemory = {
        ...previous,
        deletedAt: input.deletedAt,
        updatedAt: input.deletedAt
      };
      memories[index] = deleted;
      memoryRevisions.push(createDeletedMemoryRevision(previous, deleted, input, memoryRevisions.length + 1));
      return deleted;
    },

    listMemoryRevisions(memoryId: string): MemoryRevision[] {
      return memoryRevisions.filter((revision) => revision.memoryId === memoryId);
    },

    addInteraction(interaction: AgentInteraction): AgentInteraction {
      interactions.push(interaction);
      return interaction;
    },

    listInteractions(userId?: string): AgentInteraction[] {
      return userId ? interactions.filter((interaction) => interaction.userId === userId) : [...interactions];
    },

    createPersonIdentity(input: CreatePersonIdentityInput): PersonIdentity {
      const timestamp = input.createdAt ?? new Date().toISOString();
      const person: PersonIdentity = {
        id: `person_${randomUUID()}`,
        userId: input.userId,
        canonicalDisplayName: input.canonicalDisplayName,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      personIdentities.push(person);
      return person;
    },

    linkAppleContact(input: LinkAppleContactInput): AppleContactLink {
      const person = personIdentities.find((item) => item.id === input.personId);
      if (!person || person.userId !== input.userId) {
        throw new Error(`Person not found: ${input.personId}`);
      }

      const linkedAt = input.linkedAt ?? new Date().toISOString();
      const link: AppleContactLink = {
        id: `apple_contact_link_${randomUUID()}`,
        personId: input.personId,
        userId: input.userId,
        contactIdentifier: input.contactIdentifier,
        unifiedContactIdentifier: input.unifiedContactIdentifier,
        containerIdentifier: input.containerIdentifier,
        methodFingerprint: input.methodFingerprint,
        displayNameSnapshot: input.displayNameSnapshot,
        sensorEventId: input.sensorEventId,
        linkedAt
      };
      appleContactLinks.push(link);
      return link;
    },

    listAppleContactLinksForPerson(userId: string, personId: string): AppleContactLink[] {
      return appleContactLinks
        .filter((link) => link.userId === userId && link.personId === personId)
        .sort((left, right) => left.linkedAt.localeCompare(right.linkedAt) || left.id.localeCompare(right.id));
    },

    findPersonByMethodFingerprint(userId: string, methodFingerprint: string): PersonIdentity | undefined {
      const link = appleContactLinks.find(
        (item) => item.userId === userId && item.methodFingerprint === methodFingerprint
      );
      if (!link) {
        return undefined;
      }

      return personIdentities.find((person) => person.id === link.personId && person.userId === userId && !person.mergedIntoPersonId);
    },

    findPeopleByDisplayNameNormalized(userId: string, displayName: string): PersonIdentity[] {
      const normalizedDisplayName = normalizeDisplayNameForIdentity(displayName);
      if (!normalizedDisplayName) {
        return [];
      }

      return personIdentities.filter(
        (person) =>
          person.userId === userId &&
          !person.mergedIntoPersonId &&
          normalizeDisplayNameForIdentity(person.canonicalDisplayName) === normalizedDisplayName
      );
    },

    attachCandidateToPerson(candidateId: string, personId: string): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      const person = personIdentities.find((item) => item.id === personId);
      if (!person || person.userId !== candidate.userId) {
        throw new Error(`Person not found: ${personId}`);
      }

      candidate.personId = personId;
      return candidate;
    },

    resolveDuplicateCandidate(candidateId: string, input: ResolveDuplicateCandidateInput): ContactCandidate {
      const candidate = candidates.find((item) => item.id === candidateId);
      if (!candidate) {
        throw new Error(`Candidate not found: ${candidateId}`);
      }

      if (input.personId) {
        const person = personIdentities.find((item) => item.id === input.personId);
        if (!person || person.userId !== candidate.userId) {
          throw new Error(`Person not found: ${input.personId}`);
        }
        candidate.personId = input.personId;
      }

      candidate.suspectedDuplicatePersonId = input.suspectedDuplicatePersonId;
      candidate.duplicateResolutionStatus = input.resolution;
      if (input.resolution === "ignored") {
        candidate.status = "ignored";
      }
      return candidate;
    }
  };
}

/** Temporary method fingerprint for legacy memories without contact metadata. */
export function computeLegacyMemoryMethodFingerprint(displayName: string, memoryId: string): string {
  return createHash("sha256").update(`${displayName}|${memoryId}`).digest("hex");
}

/** Computes a stable method fingerprint from a candidate's normalized contact methods. */
export function candidateMethodFingerprint(
  candidate: Pick<ContactCandidate, "phoneNumbers" | "emails"> &
    Partial<Pick<ContactCandidate, "id" | "contactIdentifier" | "unifiedContactIdentifier">>
): string {
  const methodFingerprint = computeMethodFingerprint({
    phoneNumbers: candidate.phoneNumbers,
    emails: candidate.emails
  });
  const emptyFingerprint = computeMethodFingerprint({});
  if (methodFingerprint !== emptyFingerprint) {
    return methodFingerprint;
  }

  const contactIdentifier = candidate.unifiedContactIdentifier || candidate.contactIdentifier;
  if (contactIdentifier?.trim()) {
    return createHash("sha256").update(`contact:${contactIdentifier.trim().toLowerCase()}`).digest("hex");
  }

  return createHash("sha256").update(`candidate:${candidate.id ?? "unknown"}`).digest("hex");
}

type EnsureCandidatePersonIdInput = {
  candidate: ContactCandidate;
  personIdentities: PersonIdentity[];
  appleContactLinks: AppleContactLink[];
  now: string;
};

/** Ensures a confirmed candidate has a durable person id, creating identity rows when needed. */
export function ensureCandidatePersonId(input: EnsureCandidatePersonIdInput): string {
  if (input.candidate.personId) {
    return input.candidate.personId;
  }

  const methodFingerprint = candidateMethodFingerprint(input.candidate);
  const existingPerson = input.appleContactLinks
    .filter((link) => link.userId === input.candidate.userId && link.methodFingerprint === methodFingerprint)
    .map((link) => input.personIdentities.find((person) => person.id === link.personId))
    .find((person) => person && person.userId === input.candidate.userId && !person.mergedIntoPersonId);

  if (existingPerson) {
    return existingPerson.id;
  }

  const person: PersonIdentity = {
    id: `person_${randomUUID()}`,
    userId: input.candidate.userId,
    canonicalDisplayName: input.candidate.displayName,
    createdAt: input.now,
    updatedAt: input.now
  };
  input.personIdentities.push(person);
  input.appleContactLinks.push({
    id: `apple_contact_link_${randomUUID()}`,
    personId: person.id,
    userId: input.candidate.userId,
    contactIdentifier: input.candidate.contactIdentifier,
    unifiedContactIdentifier: input.candidate.unifiedContactIdentifier,
    containerIdentifier: input.candidate.containerIdentifier,
    methodFingerprint,
    displayNameSnapshot: input.candidate.displayName,
    sensorEventId: input.candidate.sensorEventId,
    linkedAt: input.now
  });
  return person.id;
}

function eventMatchContact(contact: ContactCandidateDetected): ContactCandidateDetected {
  return {
    ...contact,
    detectedAt: contact.eventMatchAnchorAt ?? contact.observedAt ?? contact.detectedAt
  };
}

function assertMemoryHasConfirmedCandidate(memory: RelationshipMemory, candidates: ContactCandidate[]): void {
  const candidate = memory.candidateId ? candidates.find((item) => item.id === memory.candidateId) : undefined;
  if (!candidate || candidate.userId !== memory.userId || candidate.status !== "confirmed") {
    throw new Error("Memory requires a confirmed candidate");
  }
}

function assertCandidateHasNoMemory(memory: RelationshipMemory, memories: RelationshipMemory[]): void {
  if (memory.candidateId && memories.some((existing) => existing.candidateId === memory.candidateId)) {
    throw new Error("Memory already exists for candidate");
  }
}

function createCreatedMemoryRevision(memory: RelationshipMemory): MemoryRevision {
  return {
    revisionId: createMemoryRevisionId(memory.id, "created", memory.createdAt, 1),
    memoryId: memory.id,
    createdAt: memory.createdAt,
    reason: "created",
    nextValue: memoryRevisionValue(memory)
  };
}

function createUpdatedMemoryRevision(
  previous: RelationshipMemory,
  next: RelationshipMemory,
  updates: UpdateMemoryInput,
  sequence: number
): MemoryRevision {
  return {
    revisionId: createMemoryRevisionId(next.id, updates.reason, updates.updatedAt, sequence),
    memoryId: next.id,
    createdAt: updates.updatedAt,
    reason: updates.reason,
    previousValue: memoryRevisionValue(previous),
    nextValue: memoryRevisionValue(next),
    userText: updates.userText
  };
}

function createDeletedMemoryRevision(
  previous: RelationshipMemory,
  next: RelationshipMemory,
  input: DeleteMemoryInput,
  sequence: number
): MemoryRevision {
  return {
    revisionId: createMemoryRevisionId(next.id, "deleted", input.deletedAt, sequence),
    memoryId: next.id,
    createdAt: input.deletedAt,
    reason: "deleted",
    previousValue: memoryRevisionValue(previous),
    nextValue: memoryRevisionValue(next),
    userText: input.userText
  };
}

function memoryRevisionValue(memory: RelationshipMemory): Partial<RelationshipMemory> {
  return {
    displayName: memory.displayName,
    primaryContactLabel: memory.primaryContactLabel,
    eventId: memory.eventId,
    eventTitle: memory.eventTitle,
    contextNote: memory.contextNote,
    relationshipContext: memory.relationshipContext,
    tags: memory.tags,
    confidence: memory.confidence,
    updatedAt: memory.updatedAt,
    deletedAt: memory.deletedAt
  };
}

function createMemoryRevisionId(memoryId: string, reason: MemoryRevisionReason, createdAt: string, sequence: number): string {
  return `memory_revision_${memoryId}_${reason}_${createdAt.replace(/[^0-9a-z]/gi, "")}_${sequence}`;
}

/** Computes the ISO expiry timestamp from a contact detection time. */
export function calculateCandidateExpiresAt(detectedAt: string): string {
  return new Date(Date.parse(detectedAt) + CANDIDATE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Mutates reviewable candidates to `expired` when past {@link CANDIDATE_EXPIRATION_DAYS}.
 *
 * Called lazily on read so callers do not need a background sweeper in the MVP store.
 */
export function expireCandidateIfStale(candidate: ContactCandidate, now = new Date()): ContactCandidate {
  if (
    isReviewableCandidateStatus(candidate.status) &&
    candidate.expiresAt &&
    Date.parse(candidate.expiresAt) <= now.getTime()
  ) {
    candidate.status = "expired";
  }

  return candidate;
}

function isReviewableCandidateStatus(status: ContactCandidate["status"]): boolean {
  return status === "pending" || status === "prompted";
}

function isReintakeEligibleCandidateStatus(status: ContactCandidate["status"]): boolean {
  return status === "ignored" || status === "expired";
}

function reactivateCandidateForIntakeIfEligible(
  candidate: ContactCandidate,
  detectedAt?: string
): ContactCandidate {
  if (!isReintakeEligibleCandidateStatus(candidate.status)) {
    return candidate;
  }

  candidate.status = "pending";
  delete candidate.statusReason;
  delete candidate.promptInteractionId;
  delete candidate.promptSpaceId;
  delete candidate.promptedAt;
  if (detectedAt) {
    candidate.detectedAt = detectedAt;
    candidate.expiresAt = calculateCandidateExpiresAt(detectedAt);
  }

  return candidate;
}

/**
 * Extracts low-cost keyword tags for the first search version.
 *
 * This is deliberately transparent and deterministic; embeddings can be layered in only after
 * we know lexical search is the bottleneck.
 */
export function extractTags(text: string): string[] {
  const stopWords = new Set([
    "about",
    "also",
    "and",
    "are",
    "did",
    "for",
    "from",
    "have",
    "her",
    "him",
    "his",
    "i",
    "in",
    "into",
    "me",
    "of",
    "ok",
    "on",
    "person",
    "same",
    "she",
    "should",
    "that",
    "the",
    "their",
    "there",
    "this",
    "through",
    "to",
    "was",
    "we",
    "who",
    "with",
    "you",
    "your"
  ]);
  const tags = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));

  return Array.from(new Set(tags));
}

function selectEventMatch(matches: EventContextMatch[], candidateId: string, eventId?: string) {
  const candidateMatches = matches.filter((match) => match.candidateId === candidateId);
  if (eventId) {
    return candidateMatches.find((match) => match.calendarEventId === eventId);
  }
  // Default to the highest-ranked event guess when the user confirms without correcting the event.
  return candidateMatches.sort((a, b) => a.rank - b.rank)[0];
}
