import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "./fixtures";
import { createRuntimeRelationshipRepository } from "./runtimeRepository";

const tempDirs: string[] = [];
const repositories: Array<{ close?: () => void }> = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.close?.();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime relationship repository factory", () => {
  it("uses in-memory repository when persistent runtime store is not configured", () => {
    const first = trackRepository(createRuntimeRelationshipRepository({
      env: {},
      seed: { users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] }
    }));
    const candidate = first.createCandidateFromDetectedContact(fixtureDetectedContact);

    const second = trackRepository(createRuntimeRelationshipRepository({ env: {} }));

    expect(first.getCandidate(candidate.id)?.displayName).toBe("Maya Chen");
    expect(second.getCandidate(candidate.id)).toBeUndefined();
  });

  it("uses sqlite when FRIENDY_RUNTIME_STORE=sqlite and shares state across instances", () => {
    const dbPath = tempDatabasePath();
    const env = {
      FRIENDY_RUNTIME_STORE: "sqlite",
      FRIENDY_SQLITE_PATH: dbPath
    };
    const first = trackRepository(createRuntimeRelationshipRepository({
      env,
      seed: { users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] }
    }));
    const candidate = first.createCandidateFromDetectedContact(fixtureDetectedContact);

    const second = trackRepository(createRuntimeRelationshipRepository({ env }));

    expect(second.getCandidate(candidate.id)?.displayName).toBe("Maya Chen");
  });

  it("fails clearly when sqlite is selected without FRIENDY_SQLITE_PATH", () => {
    expect(() => createRuntimeRelationshipRepository({ env: { FRIENDY_RUNTIME_STORE: "sqlite" } })).toThrow(
      "FRIENDY_RUNTIME_STORE=sqlite requires FRIENDY_SQLITE_PATH"
    );
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "friendy-runtime-"));
  tempDirs.push(dir);
  return join(dir, "friendy.sqlite");
}

function trackRepository<T extends object>(repository: T): T {
  repositories.push(repository);
  return repository;
}
