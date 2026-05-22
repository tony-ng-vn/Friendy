import type { RelationshipRepository } from "../repository";
import type { CalendarEvent, ContactCandidate, ContactCandidateDetected } from "../types";
import { scoreCalendarContext, type ScoredCalendarEvent } from "./calendarScorer";
import { planCandidatePrompt } from "./promptPlanner";
import { parseSensorEventLine, type MacosSensorEvent } from "./sensorEvents";

export type RuntimePromptSendResult = {
  interactionId?: string;
  spaceId?: string;
};

export type RuntimePromptSender = {
  sendPrompt(input: { userId: string; candidateId?: string; text: string }): Promise<RuntimePromptSendResult> | RuntimePromptSendResult;
};

export type RuntimeAckWriter = {
  writeAck(path: string): Promise<void> | void;
};

export type RuntimeLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export type ProcessedSensorEvent = {
  idempotencyKey: string;
  sensorEventId?: string;
  sensorName: string;
  eventType: string;
  status: "candidate_created" | "duplicate" | "ignored" | "baselined" | "warning" | "failed";
  candidateId?: string;
  warningCode?: string;
  processedAt: string;
};

export type RuntimeWarningState = {
  userId: string;
  sensorName: string;
  warningCode: string;
  permissionStatus?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastNotifiedAt?: string;
  notificationCount: number;
};

export type RuntimeStateStore = {
  getProcessedEvent(idempotencyKey: string): ProcessedSensorEvent | undefined;
  getProcessedEventBySensorEventId(sensorEventId: string): ProcessedSensorEvent | undefined;
  recordProcessedEvent(event: ProcessedSensorEvent): void;
  getWarning(userId: string, sensorName: string, warningCode: string): RuntimeWarningState | undefined;
  upsertWarning(input: {
    userId: string;
    sensorName: string;
    warningCode: string;
    permissionStatus?: string;
    now: string;
    notified: boolean;
  }): RuntimeWarningState;
};

export type FriendySensorRuntimeInput = {
  userId: string;
  repo: RelationshipRepository;
  state: RuntimeStateStore;
  sender: RuntimePromptSender;
  ackWriter: RuntimeAckWriter;
  logger?: RuntimeLogger;
  now?: () => string;
};

type FriendySensorRuntimeContext = Omit<FriendySensorRuntimeInput, "logger" | "now"> & {
  logger: RuntimeLogger;
  now: () => string;
};

export function createFriendySensorRuntime({
  userId,
  repo,
  state,
  sender,
  ackWriter,
  logger = console,
  now = () => new Date().toISOString()
}: FriendySensorRuntimeInput) {
  const context: FriendySensorRuntimeContext = { userId, repo, state, sender, ackWriter, logger, now };

  return {
    async processLine(line: string): Promise<void> {
      let event: MacosSensorEvent;
      try {
        event = parseSensorEventLine(line);
      } catch (error) {
        logger.warn(error instanceof Error ? error.message : String(error));
        return;
      }

      await processEvent({ event, ...context });
    }
  };
}

export function createInMemoryRuntimeStateStore(): RuntimeStateStore {
  const processedByIdempotencyKey = new Map<string, ProcessedSensorEvent>();
  const processedBySensorEventId = new Map<string, ProcessedSensorEvent>();
  const warnings = new Map<string, RuntimeWarningState>();

  return {
    getProcessedEvent(idempotencyKey) {
      return processedByIdempotencyKey.get(idempotencyKey);
    },
    getProcessedEventBySensorEventId(sensorEventId) {
      return processedBySensorEventId.get(sensorEventId);
    },
    recordProcessedEvent(event) {
      processedByIdempotencyKey.set(event.idempotencyKey, event);
      if (event.sensorEventId) {
        processedBySensorEventId.set(event.sensorEventId, event);
      }
    },
    getWarning(userId, sensorName, warningCode) {
      return warnings.get(warningKey(userId, sensorName, warningCode));
    },
    upsertWarning({ userId, sensorName, warningCode, permissionStatus, now, notified }) {
      const key = warningKey(userId, sensorName, warningCode);
      const existing = warnings.get(key);
      const warning: RuntimeWarningState = existing
        ? {
            ...existing,
            permissionStatus,
            lastSeenAt: now,
            lastNotifiedAt: notified ? now : existing.lastNotifiedAt,
            notificationCount: existing.notificationCount + (notified ? 1 : 0)
          }
        : {
            userId,
            sensorName,
            warningCode,
            permissionStatus,
            firstSeenAt: now,
            lastSeenAt: now,
            lastNotifiedAt: notified ? now : undefined,
            notificationCount: notified ? 1 : 0
          };
      warnings.set(key, warning);
      return warning;
    }
  };
}

async function processEvent({
  event,
  userId,
  repo,
  state,
  sender,
  ackWriter,
  logger,
  now
}: FriendySensorRuntimeContext & { event: MacosSensorEvent }): Promise<void> {
  const processed = "idempotencyKey" in event ? state.getProcessedEvent(event.idempotencyKey) : undefined;
  if (processed) {
    if (event.type === "contact_added" && processed.candidateId) {
      await retryPromptForDuplicateContact({ event, processed, userId, repo, sender, logger, now });
      return;
    }

    logger.info(`Duplicate sensor event ignored: ${processed.idempotencyKey}`);
    return;
  }

  if (event.type === "ready") {
    if (event.calendarPermissionStatus !== "authorized") {
      await warnOwner({
        userId,
        state,
        sender,
        logger,
        sensorName: event.sensorName,
        warningCode: `calendar_permission_${event.calendarPermissionStatus}`,
        permissionStatus: event.calendarPermissionStatus,
        now: now()
      });
    }
    logger.info(`macOS sensor ready: baselineCreated=${event.baselineCreated}`);
    return;
  }

  if (event.type === "history_reset") {
    recordProcessed(state, event, "ignored", now());
    logger.info(`macOS sensor history reset: ${event.reason}`);
    return;
  }

  if (event.type === "permission_error" || event.type === "fatal_error") {
    const notified = await warnOwner({
      userId,
      state,
      sender,
      logger,
      sensorName: event.sensorName,
      warningCode: event.code,
      permissionStatus: event.code,
      now: now()
    });
    recordProcessed(state, event, notified ? "warning" : "ignored", now(), { warningCode: event.code });
    logger.warn(`macOS sensor ${event.type}: ${event.code}`);
    return;
  }

  if (event.type === "history_batch_complete") {
    if (event.contactEventIds.every((eventId) => state.getProcessedEventBySensorEventId(eventId))) {
      await ackWriter.writeAck(event.ackPath);
      logger.info(`Acked macOS sensor history batch: ${event.historyBatchId}`);
    } else {
      logger.info(`History batch not ready for ack: ${event.historyBatchId}`);
    }
    return;
  }

  if (event.type === "contact_added") {
    const scoredEvents = scoreCalendarContext({
      detectedAt: event.detectedAt,
      calendarMatches: event.calendarMatches
    });
    repo.addCalendarEvents(scoredEvents.map((scoredEvent) => toCalendarEvent(userId, scoredEvent)));
    const candidate = repo.createCandidateFromDetectedContact(toDetectedContact(userId, event));
    recordProcessed(state, event, "candidate_created", now(), { candidateId: candidate.id });

    await sendCandidatePrompt({ userId, repo, sender, logger, candidate, scoredEvents, promptedAt: now() });
    return;
  }
}

async function retryPromptForDuplicateContact({
  event,
  processed,
  userId,
  repo,
  sender,
  logger,
  now
}: {
  event: Extract<MacosSensorEvent, { type: "contact_added" }>;
  processed: ProcessedSensorEvent;
  userId: string;
  repo: RelationshipRepository;
  sender: RuntimePromptSender;
  logger: RuntimeLogger;
  now: () => string;
}): Promise<void> {
  const candidate = repo.getCandidate(processed.candidateId!);
  if (!candidate || candidate.status !== "pending") {
    logger.info(`Duplicate sensor event ignored: ${event.idempotencyKey}`);
    return;
  }

  logger.info(`Retrying prompt delivery for duplicate sensor event: ${event.idempotencyKey}`);
  const scoredEvents = scoreCalendarContext({
    detectedAt: event.detectedAt,
    calendarMatches: event.calendarMatches
  });
  await sendCandidatePrompt({ userId, repo, sender, logger, candidate, scoredEvents, promptedAt: now() });
}

async function sendCandidatePrompt({
  userId,
  repo,
  sender,
  logger,
  candidate,
  scoredEvents,
  promptedAt
}: {
  userId: string;
  repo: RelationshipRepository;
  sender: RuntimePromptSender;
  logger: RuntimeLogger;
  candidate: ContactCandidate;
  scoredEvents: ScoredCalendarEvent[];
  promptedAt: string;
}): Promise<void> {
  const prompt = planCandidatePrompt({ displayName: candidate.displayName, scoredEvents });
  try {
    const result = await sender.sendPrompt({ userId, candidateId: candidate.id, text: prompt.text });
    repo.markCandidatePrompted(candidate.id, result.interactionId ?? `prompt_${candidate.id}`, {
      spaceId: result.spaceId,
      promptedAt
    });
  } catch (error) {
    repo.markCandidatePromptFailed(candidate.id, "prompt_send_failed");
    logger.warn(`Failed to send candidate prompt for ${candidate.id}: ${errorMessage(error)}`);
  }
}

async function warnOwner({
  userId,
  state,
  sender,
  logger,
  sensorName,
  warningCode,
  permissionStatus,
  now
}: {
  userId: string;
  state: RuntimeStateStore;
  sender: RuntimePromptSender;
  logger: RuntimeLogger;
  sensorName: string;
  warningCode: string;
  permissionStatus?: string;
  now: string;
}): Promise<boolean> {
  const existing = state.getWarning(userId, sensorName, warningCode);
  const shouldNotify = !existing || (existing.notificationCount < 3 && isPastCooldown(existing.lastNotifiedAt, now));
  let notified = false;
  if (shouldNotify) {
    try {
      await sender.sendPrompt({ userId, text: warningText(warningCode) });
      notified = true;
    } catch (error) {
      logger.warn(`Failed to send sensor warning ${warningCode}: ${errorMessage(error)}`);
    }
  }
  state.upsertWarning({ userId, sensorName, warningCode, permissionStatus, now, notified });
  return notified;
}

function recordProcessed(
  state: RuntimeStateStore,
  event: Extract<MacosSensorEvent, { idempotencyKey: string }>,
  status: ProcessedSensorEvent["status"],
  processedAt: string,
  extra: Pick<ProcessedSensorEvent, "candidateId" | "warningCode"> = {}
): void {
  state.recordProcessedEvent({
    idempotencyKey: event.idempotencyKey,
    sensorEventId: event.eventId,
    sensorName: event.sensorName,
    eventType: event.type,
    status,
    processedAt,
    ...extra
  });
}

function toDetectedContact(userId: string, event: Extract<MacosSensorEvent, { type: "contact_added" }>): ContactCandidateDetected {
  return {
    userId,
    displayName: event.contact.displayName,
    phoneNumbers: event.contact.phoneNumberHints.map((hint) => (hint.last4 ? `ending in ${hint.last4}` : "")).filter(Boolean),
    emails: event.contact.emailHints.map((hint) => (hint.domain ? `email at ${hint.domain}` : "")).filter(Boolean),
    detectedAt: event.detectedAt,
    source: "contacts_delta",
    sensorEventId: event.eventId,
    contactIdentifier: event.contact.stableId,
    unifiedContactIdentifier: event.contact.unifiedStableId,
    containerIdentifier: event.contact.containerId,
    observedAt: event.observedAt,
    contactMethodHashes: {
      phoneNumberHashes: event.contact.phoneNumberHashes,
      emailHashes: event.contact.emailHashes
    },
    contactMethodHints: {
      phoneNumberHints: event.contact.phoneNumberHints,
      emailHints: event.contact.emailHints
    }
  };
}

function toCalendarEvent(userId: string, scoredEvent: ScoredCalendarEvent): CalendarEvent {
  const durationMs = new Date(scoredEvent.snapshot.endsAt).getTime() - new Date(scoredEvent.snapshot.startsAt).getTime();
  return {
    id: scoredEvent.eventId,
    userId,
    title: scoredEvent.title,
    startsAt: scoredEvent.snapshot.startsAt,
    endsAt: scoredEvent.snapshot.endsAt,
    timezone: "UTC",
    location: scoredEvent.snapshot.location,
    calendarSource: "apple_calendar",
    eventKind: scoredEvent.snapshot.isAllDay ? "all_day" : durationMs > 6 * 60 * 60 * 1000 ? "long" : "short"
  };
}

function warningText(warningCode: string): string {
  if (warningCode === "contacts_permission_denied") {
    return "Friendy is running, but I need Contacts permission before I can notice new contacts.";
  }

  if (warningCode.startsWith("calendar_permission_")) {
    return "Friendy can still notice new contacts, but I need Calendar permission to guess where you met them.";
  }

  return "Friendy is running, but the macOS contact sensor needs attention.";
}

function isPastCooldown(lastNotifiedAt: string | undefined, now: string): boolean {
  if (!lastNotifiedAt) {
    return true;
  }

  return new Date(now).getTime() - new Date(lastNotifiedAt).getTime() >= 24 * 60 * 60 * 1000;
}

function warningKey(userId: string, sensorName: string, warningCode: string): string {
  return `${userId}:${sensorName}:${warningCode}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
