import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { loadFriendyEnv } from "../env";
import { parseSensorEventLine, type MacosContactAddedEvent, type MacosSensorEvent } from "../runtime/sensorEvents";

type RawJsonRow = {
  raw_json: string;
};

export type MacMvpE2eStateCheckReport = {
  ok: boolean;
  latestContactName?: string;
  latestHistoryBatchId?: string;
  latestAckPresent: boolean;
  memoryCount: number;
  confirmedCandidateForLatestContact: boolean;
  candidateSummaries: string[];
  diagnosticCodes: string[];
  lines: string[];
};

export type MacMvpE2eStateCheckInput = {
  cwd?: string;
  sensorEventsPath?: string;
  sqlitePath?: string;
};

/** Reads live Mac MVP artifacts and summarizes whether the manual E2E proof is present. */
export function runMacMvpE2eStateCheck({
  cwd = process.cwd(),
  sensorEventsPath = join(cwd, ".friendy/macos-sensor-state/sensor-events.ndjson"),
  sqlitePath = join(cwd, ".friendy/friendy.sqlite")
}: MacMvpE2eStateCheckInput = {}): MacMvpE2eStateCheckReport {
  const events = readSensorEvents(sensorEventsPath);
  const latestContact = lastOf(events.filter((event): event is MacosContactAddedEvent => event.type === "contact_added"));
  const latestBatch = latestContact
    ? lastOf(
        events.filter(
          (event): event is Extract<MacosSensorEvent, { type: "history_batch_complete" }> =>
            event.type === "history_batch_complete" && event.historyBatchId === latestContact.historyBatchId
        )
      )
    : undefined;
  const latestAckPath = latestBatch ? resolveArtifactPath(cwd, latestBatch.ackPath) : undefined;
  const latestAckPresent = latestAckPath ? existsSync(latestAckPath) : false;
  const diagnostics = events.filter((event): event is Extract<MacosSensorEvent, { type: "sensor_diagnostic" }> => {
    return event.type === "sensor_diagnostic";
  });
  const contactPending = events.filter((event): event is Extract<MacosSensorEvent, { type: "contact_pending" }> => {
    return event.type === "contact_pending";
  });
  const sqlite = readSqliteSummary(sqlitePath);
  const latestContactName = latestContact?.contact.displayName;
  const hasNamedContact = Boolean(latestContactName && latestContactName !== "Unnamed Contact");
  const latestCandidate = latestContact
    ? sqlite.candidates.find((candidate) => {
        return candidate.contactIdentifier === latestContact.contact.stableId && candidate.status === "confirmed";
      })
    : undefined;
  const hasMemoryForLatestContact = Boolean(
    latestCandidate && sqlite.memories.some((memory) => memory.candidateId === latestCandidate.id)
  );
  const ok = hasNamedContact && latestAckPresent && Boolean(latestCandidate) && hasMemoryForLatestContact;
  const lines = renderLines({
    sensorEventsPath,
    sqlitePath,
    latestContact,
    latestAckPath,
    latestAckPresent,
    diagnostics,
    contactPending,
    sqlite,
    hasNamedContact,
    hasConfirmedCandidateForLatestContact: Boolean(latestCandidate),
    hasMemoryForLatestContact,
    ok
  });

  return {
    ok,
    latestContactName,
    latestHistoryBatchId: latestContact?.historyBatchId,
    latestAckPresent,
    memoryCount: sqlite.memoryCount,
    confirmedCandidateForLatestContact: Boolean(latestCandidate),
    candidateSummaries: sqlite.candidateSummaries,
    diagnosticCodes: diagnostics.map((event) => event.code),
    lines
  };
}

function readSensorEvents(sensorEventsPath: string): MacosSensorEvent[] {
  if (!existsSync(sensorEventsPath)) {
    return [];
  }

  return readFileSync(sensorEventsPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [parseSensorEventLine(line)];
      } catch {
        return [];
      }
    });
}

function readSqliteSummary(sqlitePath: string): {
  memoryCount: number;
  memories: Array<{ candidateId?: string; displayName: string }>;
  candidates: Array<{ id?: string; contactIdentifier?: string; displayName: string; status: string }>;
  candidateSummaries: string[];
} {
  if (!existsSync(sqlitePath)) {
    return { memoryCount: 0, memories: [], candidates: [], candidateSummaries: [] };
  }

  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const memories = readJsonRows(db, "SELECT raw_json FROM memories ORDER BY insert_order DESC LIMIT 10").map((memory) => ({
      candidateId: stringField(memory, "candidateId"),
      displayName: displayNameOf(memory)
    }));
    const candidates = readJsonRows(db, "SELECT raw_json FROM candidates ORDER BY insert_order DESC LIMIT 10").map((candidate) => ({
      id: stringField(candidate, "id"),
      contactIdentifier: stringField(candidate, "contactIdentifier"),
      displayName: displayNameOf(candidate),
      status: statusOf(candidate)
    }));

    return {
      memoryCount: countRows(db, "memories"),
      memories,
      candidates,
      candidateSummaries: candidates.slice(0, 5).map((candidate) => `${candidate.displayName} (${candidate.status})`)
    };
  } catch {
    return { memoryCount: 0, memories: [], candidates: [], candidateSummaries: [] };
  } finally {
    db.close();
  }
}

function countRows(db: DatabaseSync, tableName: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: unknown } | undefined;
  return typeof row?.count === "number" ? row.count : 0;
}

function readJsonRows(db: DatabaseSync, sql: string): Array<Record<string, unknown>> {
  return (db.prepare(sql).all() as RawJsonRow[]).flatMap((row) => {
    try {
      const parsed = JSON.parse(row.raw_json);
      return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function renderLines({
  sensorEventsPath,
  sqlitePath,
  latestContact,
  latestAckPath,
  latestAckPresent,
  diagnostics,
  contactPending,
  sqlite,
  hasNamedContact,
  hasConfirmedCandidateForLatestContact,
  hasMemoryForLatestContact,
  ok
}: {
  sensorEventsPath: string;
  sqlitePath: string;
  latestContact?: MacosContactAddedEvent;
  latestAckPath?: string;
  latestAckPresent: boolean;
  diagnostics: Array<Extract<MacosSensorEvent, { type: "sensor_diagnostic" }>>;
  contactPending: Array<Extract<MacosSensorEvent, { type: "contact_pending" }>>;
  sqlite: {
    memoryCount: number;
    memories: Array<{ candidateId?: string; displayName: string }>;
    candidateSummaries: string[];
  };
  hasNamedContact: boolean;
  hasConfirmedCandidateForLatestContact: boolean;
  hasMemoryForLatestContact: boolean;
  ok: boolean;
}): string[] {
  const latestDiagnostic = lastOf(diagnostics);
  const latestPending = lastOf(contactPending);
  const lines = [
    "Friendy Mac MVP E2E state check",
    `Sensor events: ${sensorEventsPath}`,
    `SQLite: ${sqlitePath}`
  ];

  if (latestContact) {
    lines.push(`Latest contact_added: ${latestContact.contact.displayName}`);
    lines.push(`Latest history batch: ${latestContact.historyBatchId}`);
  } else {
    lines.push("No contact_added event found after start");
  }
  lines.push(`Named post-start contact: ${hasNamedContact ? "present" : "missing"}`);
  lines.push(`History batch ack: ${latestAckPresent ? "present" : "missing"}${latestAckPath ? ` (${latestAckPath})` : ""}`);
  lines.push(`Saved memories: ${sqlite.memoryCount}`);
  if (sqlite.memories.length > 0) {
    lines.push(`Latest memories: ${sqlite.memories.slice(0, 3).map((memory) => memory.displayName).join(", ")}`);
  }
  lines.push(`Confirmed candidate for latest contact: ${hasConfirmedCandidateForLatestContact ? "present" : "missing"}`);
  lines.push(`Memory for latest contact: ${hasMemoryForLatestContact ? "present" : "missing"}`);
  if (sqlite.candidateSummaries.length > 0) {
    lines.push(`Latest candidates: ${sqlite.candidateSummaries.join(", ")}`);
  }
  if (latestPending) {
    lines.push(`Latest contact pending: ${latestPending.reason}`);
  }
  if (latestDiagnostic) {
    lines.push(`Latest sensor diagnostic: ${latestDiagnostic.code}`);
  }
  lines.push(ok ? "Mac MVP E2E state evidence is present." : "Mac MVP E2E state evidence is incomplete.");
  return lines;
}

function displayNameOf(value: Record<string, unknown>): string {
  return typeof value.displayName === "string" ? value.displayName : "unknown";
}

function statusOf(value: Record<string, unknown>): string {
  return typeof value.status === "string" ? value.status : "unknown";
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

function resolveArtifactPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function lastOf<T>(values: T[]): T | undefined {
  return values[values.length - 1];
}

export function main(): void {
  loadFriendyEnv();
  const report = runMacMvpE2eStateCheck();
  for (const line of report.lines) {
    console.info(line);
  }
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
