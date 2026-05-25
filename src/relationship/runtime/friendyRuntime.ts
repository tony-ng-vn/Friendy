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
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RelationshipRepository } from "../repository";
import { isContactAutomationActive, type OnboardingState } from "../onboardingState";
import type { CalendarEvent, ContactCandidate, ContactCandidateDetected } from "../types";
import { composeDuplicateResolutionPrompt } from "../responseComposer";

const AGENT_DEBUG_LOG_PATH = resolve(process.cwd(), ".cursor/debug-ca2a75.log");

function emitAgentDebugLog(payload: Record<string, unknown>): void {
  if (process.env.VITEST === "true") {
    return;
  }

  const line = JSON.stringify({ sessionId: "ca2a75", timestamp: Date.now(), ...payload });
  try {
    appendFileSync(AGENT_DEBUG_LOG_PATH, `${line}\n`, "utf8");
  } catch {
    // ignore missing log directory
  }

  fetch("http://127.0.0.1:7405/ingest/fb43d96c-a8d2-4696-9276-2b1b2d2ceca0", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ca2a75" },
    body: line
  }).catch(() => {});
}
import { scoreCalendarContext, type ScoredCalendarEvent } from "./calendarScorer";
import { planCandidatePrompt, type CandidatePromptPlan } from "./promptPlanner";
import { parseSensorEventLineWithMeta, type MacosSensorEvent } from "./sensorEvents";

/** Spectrum (or console mock) identifiers returned after a prompt is delivered. */
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
  validationStatus?: "ok" | "normalized" | "failed";
  errorCode?: string;
  processedAt: string;
};

/** Per-warning notification cooldown persisted across sensor restarts. */
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

/** Per-device sensor cursor, permission snapshot, and baseline markers. */
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
  clearProcessedEventsForCandidateIds(candidateIds: string[]): void;
  runTransaction?<T>(callback: () => T): T;
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

/** Dependencies for `createFriendySensorRuntime`; onboarding gate controls pre-start queuing. */
export type FriendySensorRuntimeInput = {
  userId: string;
  repo: RelationshipRepository;
  state: RuntimeStateStore;
  sender: RuntimePromptSender;
  ackWriter: RuntimeAckWriter;
  logger?: RuntimeLogger;
  getOnboardingState?: () => OnboardingState;
  getContactIntakeStartedAt?: () => string | undefined;
  sqlitePath?: string;
  now?: () => string;
};

type FriendySensorRuntimeContext = Omit<
  FriendySensorRuntimeInput,
  "logger" | "now" | "getOnboardingState" | "getContactIntakeStartedAt"
> & {
  logger: RuntimeLogger;
  getOnboardingState: () => OnboardingState;
  getContactIntakeStartedAt?: () => string | undefined;
  now: () => string;
  preStartNotice: { sent: boolean };
  /** Ignored/expired candidates deferred during pre-start duplicate replay; re-queued on `start`. */
  deferredReintakeCandidateIds: Set<string>;
  /** ISO timestamp when this foreground runtime instance started. */
  runtimeStartedAt: string;
  /** Resolved SQLite path for agent-visible logging (undefined in in-memory tests). */
  sqlitePath?: string;
};

export type FriendySensorRuntime = {
  processLine(line: string): Promise<void>;
  requeueDeferredReintakeCandidatesOnStart(): Promise<void>;
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
  getContactIntakeStartedAt,
  sqlitePath,
  now = () => new Date().toISOString()
}: FriendySensorRuntimeInput): FriendySensorRuntime {
  const runtimeStartedAt = now();
  const context: FriendySensorRuntimeContext = {
    userId,
    repo,
    state,
    sender,
    ackWriter,
    logger,
    getOnboardingState,
    getContactIntakeStartedAt,
    now,
    preStartNotice: { sent: false },
    deferredReintakeCandidateIds: new Set(),
    runtimeStartedAt,
    sqlitePath
  };

  return {
    async requeueDeferredReintakeCandidatesOnStart(): Promise<void> {
      await requeueDeferredReintakeCandidatesOnStart(context);
    },
    async processLine(line: string): Promise<void> {
      const eventNow = now();
      let event: MacosSensorEvent;
      let didNormalize = false;
      try {
        const parsed = parseSensorEventLineWithMeta(line);
        event = parsed.event;
        didNormalize = parsed.didNormalize;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const partial = readPartialSensorPayload(line);
        const eventId = partial?.eventId;
        const errorCode = validationErrorCode(message);
        recordValidationFailure({
          state,
          partial,
          errorCode,
          processedAt: eventNow
        });
        logger.warn(
          `sensor_event_validation_failed code=${errorCode}${eventId ? ` eventId=${eventId}` : ""}: ${message}`
        );
        return;
      }

      if (didNormalize && event.type === "contact_added") {
        logger.info(`sensor_event_normalized label=unknown eventId=${event.eventId}`);
      }

      await processEvent({ event, ...context, eventNow, validationStatus: didNormalize ? "normalized" : "ok" });
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
    clearProcessedEventsForCandidateIds(candidateIds) {
      const candidateIdSet = new Set(candidateIds);
      for (const [idempotencyKey, event] of processedByIdempotencyKey.entries()) {
        if (!event.candidateId || !candidateIdSet.has(event.candidateId)) {
          continue;
        }
        processedByIdempotencyKey.delete(idempotencyKey);
        if (event.sensorEventId) {
          processedBySensorEventId.delete(event.sensorEventId);
        }
      }
    },
    runTransaction(callback) {
      return callback();
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
  getContactIntakeStartedAt,
  now,
  preStartNotice,
  deferredReintakeCandidateIds,
  runtimeStartedAt,
  eventNow,
  validationStatus = "ok"
}: FriendySensorRuntimeContext & {
  event: MacosSensorEvent;
  eventNow?: string;
  validationStatus?: ProcessedSensorEvent["validationStatus"];
}): Promise<void> {
  const processedAt = eventNow ?? now();
  const processed = "idempotencyKey" in event ? state.getProcessedEvent(event.idempotencyKey) : undefined;
  if (processed) {
    if (event.type === "contact_added") {
      if (
        await reintakeDuplicateContactIfEligible({
          event,
          processed,
          userId,
          repo,
          state,
          sender,
          logger,
          now,
          getOnboardingState,
          getContactIntakeStartedAt,
          validationStatus,
          processedAt
        })
      ) {
        return;
      }

      if (processed.candidateId) {
        if (
          shouldDeferDuplicateReintake(event, getOnboardingState, getContactIntakeStartedAt)
        ) {
          trackDeferredReintakeCandidate({
            repo,
            userId,
            candidateId: processed.candidateId,
            deferredReintakeCandidateIds
          });
          if (isContactAutomationActive(getOnboardingState())) {
            await requeueDeferredReintakeCandidatesOnStart({
              userId,
              repo,
              state,
              sender,
              ackWriter,
              logger,
              getOnboardingState,
              getContactIntakeStartedAt,
              now,
              preStartNotice,
              deferredReintakeCandidateIds,
              runtimeStartedAt
            });
          }
        }
        await retryPromptForDuplicateContact({ event, processed, userId, repo, sender, logger, now });
        recordDuplicateSensorEventAlias(state, event, processed, processedAt);
        return;
      }

      recordDuplicateSensorEventAlias(state, event, processed, processedAt);
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

  if (event.type === "sensor_diagnostic") {
    logger.info(formatSensorDiagnosticLog(event));
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
    const missingEventIds = event.contactEventIds.filter((eventId) => {
      const processedEvent = state.getProcessedEventBySensorEventId(eventId);
      return !processedEvent || processedEvent.status === "failed";
    });

    if (missingEventIds.length === 0) {
      await ackWriter.writeAck(event.ackPath);
      logger.info(`history_batch_ack_written batchId=${event.historyBatchId}`);
    } else {
      logger.info(
        `history_batch_ack_deferred batchId=${event.historyBatchId} missing=[${missingEventIds.join(",")}]`
      );
    }
    return;
  }

  if (event.type === "contact_added") {
    const scoredEvents = scoreCalendarContext({
      detectedAt: event.detectedAt,
      calendarMatches: event.calendarMatches
    });
    const persistContactAdded = (): ContactCandidate => {
      repo.addCalendarEvents(scoredEvents.map((scoredEvent) => toCalendarEvent(userId, scoredEvent)));
      const candidate = repo.createCandidateFromDetectedContact(toDetectedContact(userId, event));
      recordContactAddedSensorState({ userId, state, event, now: processedAt });
      recordProcessed(state, event, "candidate_created", processedAt, {
        candidateId: candidate.id,
        validationStatus
      });
      return candidate;
    };

    const onboardingState = getOnboardingState();
    if (!isContactAutomationActive(onboardingState)) {
      const eventNow = now();
      // Before first `start`, queue the contact and record the event so history can ack without losing the prompt.
      if (onboardingState === "ready_pending_user_start") {
        const candidate = state.runTransaction?.(() => persistContactAdded()) ?? persistContactAdded();
        logger.info(
          `Contact automation paused (ready_pending_user_start); queued pre-start contact event ${event.eventId} as ${candidate.id} so history can ack. Text start to review it.`
        );
        if (!preStartNotice.sent) {
          try {
            await sender.sendPrompt({
              userId,
              text:
                "I saw a contact change before you started Friendy, so I queued it. Text start and I'll ask about it before saving anything."
            });
            preStartNotice.sent = true;
            logger.info("[friendy:pre_start_contact_notice] sent");
          } catch (error) {
            logger.warn(
              `Failed to send pre-start contact notice: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      } else {
        logger.info(`Contact automation paused (${onboardingState}); holding sensor event: ${event.eventId}`);
      }
      return;
    }

    const candidate = state.runTransaction?.(() => persistContactAdded()) ?? persistContactAdded();

    await sendCandidatePrompt({ userId, repo, sender, logger, candidate, scoredEvents, promptedAt: processedAt });
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

function formatSensorDiagnosticLog(event: Extract<MacosSensorEvent, { type: "sensor_diagnostic" }>): string {
  const fields: string[] = [];
  if (event.pendingContactCount !== undefined) {
    fields.push(`pending=${event.pendingContactCount}`);
  }
  if (event.nextCheckInSeconds !== undefined) {
    fields.push(`nextCheckInSeconds=${event.nextCheckInSeconds}`);
  }

  return `macOS sensor diagnostic: ${event.code}${fields.length ? ` ${fields.join(" ")}` : ""}`;
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

function shouldDeferDuplicateReintake(
  event: Extract<MacosSensorEvent, { type: "contact_added" }>,
  getOnboardingState: () => OnboardingState,
  getContactIntakeStartedAt?: () => string | undefined
): boolean {
  if (!isContactAutomationActive(getOnboardingState())) {
    return true;
  }

  const intakeStartedAt = getContactIntakeStartedAt?.();
  if (!intakeStartedAt) {
    return false;
  }

  return !isDetectedAtOrAfterIntakeStart(event.detectedAt, intakeStartedAt);
}

/** Earliest ISO timestamp so durable re-intake includes contacts processed before this runtime boot. */
function earliestSensorActivitySinceForReintake(context: FriendySensorRuntimeContext): string {
  const nowMs = Date.parse(context.now());
  const lookbackMs = Number.isNaN(nowMs) ? Date.now() - 24 * 60 * 60 * 1000 : nowMs - 24 * 60 * 60 * 1000;
  const lookbackIso = new Date(lookbackMs).toISOString();
  const runtimeMs = Date.parse(context.runtimeStartedAt);
  if (Number.isNaN(runtimeMs)) {
    return lookbackIso;
  }

  return runtimeMs < lookbackMs ? context.runtimeStartedAt : lookbackIso;
}

function isDetectedAtOrAfterIntakeStart(detectedAt: string, intakeStartedAt: string): boolean {
  const detectedAtMs = Date.parse(detectedAt);
  const intakeStartedAtMs = Date.parse(intakeStartedAt);
  if (Number.isNaN(detectedAtMs) || Number.isNaN(intakeStartedAtMs)) {
    return detectedAt >= intakeStartedAt;
  }

  return detectedAtMs >= intakeStartedAtMs;
}

function duplicateSensorEventAliasKey(sensorEventId: string): string {
  return `sensor_event_alias:${sensorEventId}`;
}

function recordDuplicateSensorEventAlias(
  state: RuntimeStateStore,
  event: Extract<MacosSensorEvent, { type: "contact_added" }>,
  processed: ProcessedSensorEvent,
  processedAt: string
): void {
  state.recordProcessedEvent({
    idempotencyKey: duplicateSensorEventAliasKey(event.eventId),
    sensorEventId: event.eventId,
    sensorName: event.sensorName,
    eventType: event.type,
    status: "duplicate",
    candidateId: processed.candidateId,
    validationStatus: processed.validationStatus,
    processedAt
  });
}

function candidateHasMemory(repo: RelationshipRepository, userId: string, candidateId: string): boolean {
  return repo.listMemories(userId).some((memory) => memory.candidateId === candidateId);
}

function trackDeferredReintakeCandidate({
  repo,
  userId,
  candidateId,
  deferredReintakeCandidateIds
}: {
  repo: RelationshipRepository;
  userId: string;
  candidateId: string;
  deferredReintakeCandidateIds: Set<string>;
}): void {
  const candidate = repo.getCandidate(candidateId);
  if (!candidate || (candidate.status !== "ignored" && candidate.status !== "expired")) {
    return;
  }
  if (candidateHasMemory(repo, userId, candidateId)) {
    return;
  }

  deferredReintakeCandidateIds.add(candidateId);
  // #region agent log
  fetch("http://127.0.0.1:7405/ingest/fb43d96c-a8d2-4696-9276-2b1b2d2ceca0", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ca2a75" },
    body: JSON.stringify({
      sessionId: "ca2a75",
      location: "friendyRuntime.ts:trackDeferredReintakeCandidate",
      message: "deferred ignored candidate for intake start requeue",
      data: { candidateId, displayName: candidate.displayName, status: candidate.status },
      timestamp: Date.now(),
      hypothesisId: "C"
    })
  }).catch(() => {});
  // #endregion
}

async function requeueDeferredReintakeCandidatesOnStart(context: FriendySensorRuntimeContext): Promise<void> {
  if (!isContactAutomationActive(context.getOnboardingState())) {
    context.logger.info(`[friendy:reintake] skipped: onboarding=${context.getOnboardingState()}`);
    emitAgentDebugLog({
      location: "friendyRuntime.ts:requeueDeferredReintakeCandidatesOnStart:skipped",
      message: "requeue skipped because contact automation is inactive",
      data: { onboardingState: context.getOnboardingState(), sqlitePath: context.sqlitePath ?? null },
      runId: "post-fix",
      hypothesisId: "G"
    });
    return;
  }

  const intakeStartedAt = context.getContactIntakeStartedAt?.() ?? context.now();
  const sessionDeferred = [...context.deferredReintakeCandidateIds];
  context.deferredReintakeCandidateIds.clear();
  const durableDeferred = context.repo.listIgnoredCandidateIdsForReintake(context.userId, {
    sensorActivitySince: earliestSensorActivitySinceForReintake(context)
  });
  const candidateIds = [...new Set([...sessionDeferred, ...durableDeferred])];

  if (candidateIds.length > 0) {
    context.logger.info(
      `[friendy:reintake] requeue ${candidateIds.length} ignored contact(s) db=${context.sqlitePath ?? "unknown"} session=${sessionDeferred.length} durable=${durableDeferred.length}`
    );
  }

  // #region agent log
  emitAgentDebugLog({
    location: "friendyRuntime.ts:requeueDeferredReintakeCandidatesOnStart:plan",
    message: "requeue candidate plan",
    data: {
      sessionDeferred,
      durableDeferred,
      candidateIds,
      runSource: process.env.VITEST === "true" ? "vitest" : "agent",
      sqlitePath: context.sqlitePath ?? process.env.FRIENDY_SQLITE_PATH ?? null
    },
    runId: "post-fix",
    hypothesisId: "F"
  });
  // #endregion

  for (const candidateId of candidateIds) {
    const candidate = context.repo.getCandidate(candidateId);
    if (!candidate || (candidate.status !== "ignored" && candidate.status !== "expired")) {
      continue;
    }
    if (candidateHasMemory(context.repo, context.userId, candidateId)) {
      continue;
    }

    const reactivated = context.repo.reactivateCandidateForIntake(candidateId, { detectedAt: intakeStartedAt });
    const persistedAfterReactivate = context.repo.getCandidate(candidateId);
    // #region agent log
    fetch("http://127.0.0.1:7405/ingest/fb43d96c-a8d2-4696-9276-2b1b2d2ceca0", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ca2a75" },
      body: JSON.stringify({
        sessionId: "ca2a75",
        location: "friendyRuntime.ts:requeueDeferredReintakeCandidatesOnStart:reactivated",
        message: "candidate reactivated before start prompt",
        data: {
          candidateId,
          status: reactivated.status,
          persistedStatus: persistedAfterReactivate?.status,
          displayName: reactivated.displayName
        },
        timestamp: Date.now(),
        runId: "post-fix",
        hypothesisId: "D"
      })
    }).catch(() => {});
    // #endregion
    const scoredEvents = scoreCalendarContext({ detectedAt: intakeStartedAt, calendarMatches: [] });
    await sendCandidatePrompt({
      userId: context.userId,
      repo: context.repo,
      sender: context.sender,
      logger: context.logger,
      candidate: reactivated,
      scoredEvents,
      promptedAt: context.now()
    });
    const afterPrompt = context.repo.getCandidate(candidateId);
    // #region agent log
    fetch("http://127.0.0.1:7405/ingest/fb43d96c-a8d2-4696-9276-2b1b2d2ceca0", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ca2a75" },
      body: JSON.stringify({
        sessionId: "ca2a75",
        location: "friendyRuntime.ts:requeueDeferredReintakeCandidatesOnStart:afterPrompt",
        message: "candidate state after start requeue prompt",
        data: {
          candidateId,
          status: afterPrompt?.status,
          promptInteractionId: afterPrompt?.promptInteractionId ?? null
        },
        timestamp: Date.now(),
        runId: "post-fix",
        hypothesisId: "E"
      })
    }).catch(() => {});
    // #endregion
    context.logger.info(
      `[friendy:reintake] Re-queued ${reactivated.displayName ?? candidateId} at intake start (status=${afterPrompt?.status ?? "unknown"})`
    );
    // #region agent log
    fetch("http://127.0.0.1:7405/ingest/fb43d96c-a8d2-4696-9276-2b1b2d2ceca0", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "ca2a75" },
      body: JSON.stringify({
        sessionId: "ca2a75",
        location: "friendyRuntime.ts:requeueDeferredReintakeCandidatesOnStart",
        message: "requeued deferred ignored candidate on start",
        data: { candidateId, displayName: reactivated.displayName },
        timestamp: Date.now(),
        runId: "post-fix",
        hypothesisId: "C"
      })
    }).catch(() => {});
    // #endregion
  }
}

async function reintakeDuplicateContactIfEligible({
  event,
  processed,
  userId,
  repo,
  state,
  sender,
  logger,
  now,
  getOnboardingState,
  getContactIntakeStartedAt,
  validationStatus,
  processedAt
}: {
  event: Extract<MacosSensorEvent, { type: "contact_added" }>;
  processed: ProcessedSensorEvent;
  userId: string;
  repo: RelationshipRepository;
  state: RuntimeStateStore;
  sender: RuntimePromptSender;
  logger: RuntimeLogger;
  now: () => string;
  getOnboardingState: () => OnboardingState;
  getContactIntakeStartedAt?: () => string | undefined;
  validationStatus?: ProcessedSensorEvent["validationStatus"];
  processedAt: string;
}): Promise<boolean> {
  if (!processed.candidateId || !isContactAutomationActive(getOnboardingState())) {
    return false;
  }

  const intakeStartedAt = getContactIntakeStartedAt?.();
  if (!intakeStartedAt || !isDetectedAtOrAfterIntakeStart(event.detectedAt, intakeStartedAt)) {
    return false;
  }

  const candidate = repo.getCandidate(processed.candidateId);
  if (!candidate || (candidate.status !== "ignored" && candidate.status !== "expired")) {
    return false;
  }

  const reactivated = repo.reactivateCandidateForIntake(candidate.id, { detectedAt: event.detectedAt });
  const scoredEvents = scoreCalendarContext({
    detectedAt: event.detectedAt,
    calendarMatches: event.calendarMatches
  });
  recordContactAddedSensorState({ userId, state, event, now: processedAt });
  recordProcessed(state, event, "candidate_created", processedAt, {
    candidateId: reactivated.id,
    validationStatus
  });
  await sendCandidatePrompt({ userId, repo, sender, logger, candidate: reactivated, scoredEvents, promptedAt: processedAt });
  logger.info(`Re-queued ignored contact after post-start detection: ${event.idempotencyKey}`);
  return true;
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
  const prompt =
    planDuplicateResolutionPrompt({ userId, repo, candidate }) ??
    planCandidatePrompt({ displayName: candidate.displayName, scoredEvents });
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

function planDuplicateResolutionPrompt({
  userId,
  repo,
  candidate
}: {
  userId: string;
  repo: RelationshipRepository;
  candidate: ContactCandidate;
}): CandidatePromptPlan | undefined {
  if (
    candidate.duplicateResolutionStatus &&
    candidate.duplicateResolutionStatus !== "pending" &&
    candidate.duplicateResolutionStatus !== "not_sure"
  ) {
    return undefined;
  }

  const sameNamePeople = repo.findPeopleByDisplayNameNormalized(userId, candidate.displayName);
  if (sameNamePeople.length === 0) {
    return undefined;
  }

  const sameNamePersonIds = new Set(sameNamePeople.map((person) => person.id));
  const existingMemory = repo
    .listMemories(userId)
    .find((memory) => memory.personId && sameNamePersonIds.has(memory.personId));
  const suspectedDuplicatePersonId = existingMemory?.personId ?? sameNamePeople[0]?.id;
  if (!suspectedDuplicatePersonId || !existingMemory) {
    return undefined;
  }

  repo.resolveDuplicateCandidate(candidate.id, {
    resolution: "pending",
    suspectedDuplicatePersonId
  });

  return {
    route: "duplicate_resolution",
    suspectedDuplicatePersonId,
    text: composeDuplicateResolutionPrompt({ displayName: candidate.displayName })
  };
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
  extra: Pick<ProcessedSensorEvent, "candidateId" | "warningCode" | "validationStatus" | "errorCode"> = {}
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

type PartialSensorPayload = {
  eventId?: string;
  idempotencyKey?: string;
  sensorName?: string;
  eventType?: string;
};

function readPartialSensorPayload(line: string): PartialSensorPayload | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const payload = parsed as Record<string, unknown>;
    return {
      eventId: typeof payload.eventId === "string" ? payload.eventId : undefined,
      idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : undefined,
      sensorName: typeof payload.sensorName === "string" ? payload.sensorName : undefined,
      eventType: typeof payload.type === "string" ? payload.type : undefined
    };
  } catch {
    return undefined;
  }
}

function recordValidationFailure({
  state,
  partial,
  errorCode,
  processedAt
}: {
  state: RuntimeStateStore;
  partial: PartialSensorPayload | undefined;
  errorCode: string;
  processedAt: string;
}): void {
  if (!partial?.eventId) {
    return;
  }

  const idempotencyKey = partial.idempotencyKey ?? `failed:${partial.eventId}`;
  state.recordProcessedEvent({
    idempotencyKey,
    sensorEventId: partial.eventId,
    sensorName: partial.sensorName ?? "macos_contacts_calendar",
    eventType: partial.eventType ?? "unknown",
    status: "failed",
    validationStatus: "failed",
    errorCode,
    processedAt
  });
}

function validationErrorCode(message: string): string {
  if (message.includes("Malformed sensor JSON")) {
    return "malformed_json";
  }
  if (message.includes("raw contact method")) {
    return "raw_contact_method";
  }
  if (message.includes("schemaVersion")) {
    return "schema_version";
  }
  if (message.includes("sensorName")) {
    return "sensor_name";
  }
  return "schema_validation";
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
