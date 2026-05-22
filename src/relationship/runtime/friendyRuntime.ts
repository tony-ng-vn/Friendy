/**
 * Friendy macOS sensor runtime orchestrator.
 *
 * Consumes validated NDJSON events, writes candidates and calendar context into
 * the relationship repository, and sends deterministic prompts. Key protocols:
 *
 * - Idempotency: events with an `idempotencyKey` are processed once; duplicate
 *   `contact_added` events may retry prompt delivery for pending candidates only.
 * - Ack: `history_batch_complete` writes an ack file only after every listed
 *   contact event has been recorded in runtime state.
 * - Warning cooldown: owner warnings fire at most three times with a 24-hour gap
 *   between notifications for the same warning code.
 * - Privacy: contact methods are mapped to hashed values and redacted hints
 *   before entering repository types; raw phone/email never leave the sensor.
 */
import type { RelationshipRepository } from "../repository";
import { isContactAutomationActive, type OnboardingState } from "../onboardingState";
import type { CalendarEvent, ContactCandidate, ContactCandidateDetected } from "../types";
import { scoreCalendarContext, type ScoredCalendarEvent } from "./calendarScorer";
import { planCandidatePrompt } from "./promptPlanner";
import { parseSensorEventLine, type MacosSensorEvent } from "./sensorEvents";

export type RuntimePromptSendResult = {
  interactionId?: string;
  spaceId?: string;
};

/** Transport hook used to deliver candidate prompts and owner warnings. */
export type RuntimePromptSender = {
  sendPrompt(input: { userId: string; candidateId?: string; text: string }): Promise<RuntimePromptSendResult> | RuntimePromptSendResult;
};

/** Writes sensor history-batch ack files so the native sensor can advance its outbox. */
export type RuntimeAckWriter = {
  writeAck(path: string): Promise<void> | void;
};

export type RuntimeLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

/** Audit record for a processed sensor event; backs idempotent ingestion. */
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

export type RuntimeSensorState = {
  userId: string;
  sensorName: string;
  deviceId: string;
  stateJson: Record<string, unknown>;
  historyTokenBlob?: Uint8Array;
  baselineCompletedAt?: string;
  lastSuccessAt?: string;
  lastErrorCode?: string;
  lastPermissionStatus?: string;
  createdAt: string;
  updatedAt: string;
};

/** Durable store for processed events, per-device sensor state, and warning cooldowns. */
export type RuntimeStateStore = {
  getProcessedEvent(idempotencyKey: string): ProcessedSensorEvent | undefined;
  getProcessedEventBySensorEventId(sensorEventId: string): ProcessedSensorEvent | undefined;
  recordProcessedEvent(event: ProcessedSensorEvent): void;
  getSensorState(userId: string, sensorName: string, deviceId: string): RuntimeSensorState | undefined;
  upsertSensorState(input: {
    userId: string;
    sensorName: string;
    deviceId: string;
    stateJson: Record<string, unknown>;
    historyTokenBlob?: Uint8Array;
    baselineCompletedAt?: string;
    lastSuccessAt?: string;
    lastErrorCode?: string;
    lastPermissionStatus?: string;
    now: string;
  }): RuntimeSensorState;
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
  getOnboardingState?: () => OnboardingState;
  now?: () => string;
};

type FriendySensorRuntimeContext = Omit<FriendySensorRuntimeInput, "logger" | "now" | "getOnboardingState"> & {
  logger: RuntimeLogger;
  getOnboardingState: () => OnboardingState;
  now: () => string;
};

/** Creates the runtime line processor wired to repository, state, prompts, and acks. */
export function createFriendySensorRuntime({
  userId,
  repo,
  state,
  sender,
  ackWriter,
  logger = console,
  getOnboardingState = () => "active",
  now = () => new Date().toISOString()
}: FriendySensorRuntimeInput) {
  const context: FriendySensorRuntimeContext = { userId, repo, state, sender, ackWriter, logger, getOnboardingState, now };

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

/** In-memory `RuntimeStateStore` for tests and local smoke checks. */
export function createInMemoryRuntimeStateStore(): RuntimeStateStore {
  const processedByIdempotencyKey = new Map<string, ProcessedSensorEvent>();
  const processedBySensorEventId = new Map<string, ProcessedSensorEvent>();
  const sensorStates = new Map<string, RuntimeSensorState>();
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
    getSensorState(userId, sensorName, deviceId) {
      return sensorStates.get(sensorStateKey(userId, sensorName, deviceId));
    },
    upsertSensorState(input) {
      const key = sensorStateKey(input.userId, input.sensorName, input.deviceId);
      const existing = sensorStates.get(key);
      const state: RuntimeSensorState = {
        userId: input.userId,
        sensorName: input.sensorName,
        deviceId: input.deviceId,
        stateJson: input.stateJson,
        historyTokenBlob: input.historyTokenBlob ?? existing?.historyTokenBlob,
        baselineCompletedAt: input.baselineCompletedAt ?? existing?.baselineCompletedAt,
        lastSuccessAt: input.lastSuccessAt ?? existing?.lastSuccessAt,
        lastErrorCode: input.lastErrorCode ?? existing?.lastErrorCode,
        lastPermissionStatus: input.lastPermissionStatus ?? existing?.lastPermissionStatus,
        createdAt: existing?.createdAt ?? input.now,
        updatedAt: input.now
      };
      sensorStates.set(key, state);
      return state;
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
  getOnboardingState,
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
    const eventNow = now();
    recordReadySensorState({ userId, state, event, now: eventNow });
    if (!isCalendarAccessGranted(event.calendarPermissionStatus)) {
      await warnOwner({
        userId,
        state,
        sender,
        logger,
        sensorName: event.sensorName,
        warningCode: `calendar_permission_${event.calendarPermissionStatus}`,
        permissionStatus: event.calendarPermissionStatus,
        now: eventNow
      });
    }
    logger.info(`macOS sensor ready: baselineCreated=${event.baselineCreated}`);
    return;
  }

  if (event.type === "contact_pending") {
    logger.info(formatContactPendingLog(event));
    return;
  }

  if (event.type === "history_reset") {
    const eventNow = now();
    recordHistoryResetSensorState({ userId, state, event, now: eventNow });
    recordProcessed(state, event, "ignored", eventNow);
    logger.info(`macOS sensor history reset: ${event.reason}`);
    return;
  }

  if (event.type === "permission_error" || event.type === "fatal_error") {
    const eventNow = now();
    recordSensorErrorState({ userId, state, event, now: eventNow });
    const notified = await warnOwner({
      userId,
      state,
      sender,
      logger,
      sensorName: event.sensorName,
      warningCode: event.code,
      permissionStatus: event.code,
      now: eventNow
    });
    recordProcessed(state, event, notified ? "warning" : "ignored", eventNow, { warningCode: event.code });
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
    const onboardingState = getOnboardingState();
    if (!isContactAutomationActive(onboardingState)) {
      const eventNow = now();
      // Before first `start`, mark ignored so the sensor history batch can ack and stop re-emitting backlog.
      if (onboardingState === "ready_pending_user_start") {
        logger.info(
          "Contact automation paused (ready_pending_user_start); ignoring pre-start contact event so history can ack. Text start, then add a new contact."
        );
        recordProcessed(state, event, "ignored", eventNow);
      } else {
        logger.info(`Contact automation paused (${onboardingState}); holding sensor event: ${event.eventId}`);
      }
      return;
    }

    const eventNow = now();
    const scoredEvents = scoreCalendarContext({
      detectedAt: event.detectedAt,
      calendarMatches: event.calendarMatches
    });
    repo.addCalendarEvents(scoredEvents.map((scoredEvent) => toCalendarEvent(userId, scoredEvent)));
    const candidate = repo.createCandidateFromDetectedContact(toDetectedContact(userId, event));
    recordContactAddedSensorState({ userId, state, event, now: eventNow });
    recordProcessed(state, event, "candidate_created", eventNow, { candidateId: candidate.id });

    await sendCandidatePrompt({ userId, repo, sender, logger, candidate, scoredEvents, promptedAt: eventNow });
    return;
  }
}

function formatContactPendingLog(event: Extract<MacosSensorEvent, { type: "contact_pending" }>): string {
  const fields = [`pending=${event.pendingContactCount}`];
  if (event.readyContactCount !== undefined) {
    fields.push(`ready=${event.readyContactCount}`);
  }
  if (event.nextCheckInSeconds !== undefined) {
    fields.push(`nextCheckInSeconds=${event.nextCheckInSeconds}`);
  }

  return `macOS sensor contact pending: ${event.reason} ${fields.join(" ")}`;
}

function recordReadySensorState({
  userId,
  state,
  event,
  now
}: {
  userId: string;
  state: RuntimeStateStore;
  event: Extract<MacosSensorEvent, { type: "ready" }>;
  now: string;
}): void {
  state.upsertSensorState({
    userId,
    sensorName: event.sensorName,
    deviceId: event.deviceId,
    stateJson: {
      lastEventType: event.type,
      runId: event.runId,
      sensorVersion: event.sensorVersion,
      contactsPermissionStatus: event.contactsPermissionStatus,
      calendarPermissionStatus: event.calendarPermissionStatus,
      baselineCreated: event.baselineCreated
    },
    baselineCompletedAt: event.baselineCreated ? now : undefined,
    lastSuccessAt: now,
    lastPermissionStatus: formatPermissionStatus(event.contactsPermissionStatus, event.calendarPermissionStatus),
    now
  });
}

function recordHistoryResetSensorState({
  userId,
  state,
  event,
  now
}: {
  userId: string;
  state: RuntimeStateStore;
  event: Extract<MacosSensorEvent, { type: "history_reset" }>;
  now: string;
}): void {
  state.upsertSensorState({
    userId,
    sensorName: event.sensorName,
    deviceId: event.deviceId,
    stateJson: {
      lastEventType: event.type,
      runId: event.runId,
      reason: event.reason,
      detectedAt: event.detectedAt
    },
    lastErrorCode: `history_reset:${event.reason}`,
    now
  });
}

function recordSensorErrorState({
  userId,
  state,
  event,
  now
}: {
  userId: string;
  state: RuntimeStateStore;
  event: Extract<MacosSensorEvent, { type: "permission_error" | "fatal_error" }>;
  now: string;
}): void {
  state.upsertSensorState({
    userId,
    sensorName: event.sensorName,
    deviceId: event.deviceId,
    stateJson: {
      lastEventType: event.type,
      runId: event.runId,
      code: event.code,
      retryable: event.retryable
    },
    lastErrorCode: event.code,
    lastPermissionStatus: event.type === "permission_error" ? event.code : undefined,
    now
  });
}

function recordContactAddedSensorState({
  userId,
  state,
  event,
  now
}: {
  userId: string;
  state: RuntimeStateStore;
  event: Extract<MacosSensorEvent, { type: "contact_added" }>;
  now: string;
}): void {
  state.upsertSensorState({
    userId,
    sensorName: event.sensorName,
    deviceId: event.deviceId,
    stateJson: {
      lastEventType: event.type,
      runId: event.runId,
      historyBatchId: event.historyBatchId,
      historyBatchIndex: event.historyBatchIndex,
      historyBatchSize: event.historyBatchSize,
      lastContactEventId: event.eventId,
      calendarPermissionStatus: event.calendarQuery.permissionStatus
    },
    lastSuccessAt: now,
    now
  });
}

function formatPermissionStatus(contactsStatus: string, calendarStatus: string): string {
  return `contacts:${contactsStatus};calendar:${calendarStatus}`;
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
  repo.recordPromptAttempt({
    id: createPromptAttemptId(candidate.id, "send_started", promptedAt),
    candidateId: candidate.id,
    status: "send_started",
    rawJson: {
      prompt
    },
    createdAt: promptedAt
  });
  try {
    const result = await sender.sendPrompt({ userId, candidateId: candidate.id, text: prompt.text });
    const interactionId = result.interactionId ?? `prompt_${candidate.id}`;
    repo.recordPromptAttempt({
      id: createPromptAttemptId(candidate.id, "send_succeeded", promptedAt),
      candidateId: candidate.id,
      interactionId,
      spectrumSpaceId: result.spaceId,
      status: "send_succeeded",
      rawJson: {
        prompt
      },
      createdAt: promptedAt
    });
    repo.markCandidatePrompted(candidate.id, interactionId, {
      spaceId: result.spaceId,
      promptedAt
    });
  } catch (error) {
    repo.recordPromptAttempt({
      id: createPromptAttemptId(candidate.id, "send_failed", promptedAt),
      candidateId: candidate.id,
      status: "send_failed",
      errorCode: "prompt_send_failed",
      rawJson: {
        prompt,
        error: errorMessage(error)
      },
      createdAt: promptedAt
    });
    repo.markCandidatePromptFailed(candidate.id, "prompt_send_failed");
    logger.warn(`Failed to send candidate prompt for ${candidate.id}: ${errorMessage(error)}`);
  }
}

function createPromptAttemptId(candidateId: string, status: string, createdAt: string): string {
  return `prompt_attempt_${candidateId}_${status}_${createdAt.replace(/[^0-9a-z]/gi, "")}`;
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
    contactUpdatedAt: event.detectedAt,
    eventMatchAnchorAt: event.detectedAt,
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

/** EventKit on macOS 14+ reports calendar access as `fullAccess` instead of `authorized`. */
function isCalendarAccessGranted(status: string): boolean {
  return status === "authorized" || status === "fullAccess";
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

function sensorStateKey(userId: string, sensorName: string, deviceId: string): string {
  return `${userId}:${sensorName}:${deviceId}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
