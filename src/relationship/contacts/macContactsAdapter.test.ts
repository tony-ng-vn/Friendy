import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createMacContactsAdapter,
  runMacContactsCommand,
  type MacContactsCommand,
  type SpawnedMacContactsProcess
} from "./macContactsAdapter";

describe("macOS Contacts adapter", () => {
  it("sends READ, CREATE, UPDATE, and DELETE command envelopes to the Swift actuator", async () => {
    const commands: MacContactsCommand[] = [];
    const adapter = createMacContactsAdapter({
      runCommand: async (command) => {
        commands.push(command);
        if (command.action === "READ") {
          return {
            ok: true,
            contacts: [
              {
                identifier: "apple_contact_1",
                givenName: "Anna",
                familyName: "Lee",
                organizationName: "Photon",
                phoneNumbers: [],
                emailAddresses: [],
                postalAddresses: []
              }
            ]
          };
        }
        if (command.action === "DELETE") {
          return { ok: true, identifier: command.id, deleted: true };
        }
        return { ok: true, identifier: "apple_contact_1" };
      }
    });

    await expect(adapter.getAppleContact({ id: "apple_contact_1" })).resolves.toMatchObject({
      contacts: [{ identifier: "apple_contact_1", givenName: "Anna" }]
    });
    await expect(
      adapter.createAppleContact({ givenName: "Anna", phoneNumbers: [{ label: "mobile", value: "+14155551234" }] })
    ).resolves.toEqual({ identifier: "apple_contact_1" });
    await expect(adapter.updateAppleContact("apple_contact_1", { jobTitle: "Founder" })).resolves.toEqual({
      identifier: "apple_contact_1"
    });
    await expect(adapter.deleteAppleContact("apple_contact_1")).resolves.toEqual({
      identifier: "apple_contact_1",
      deleted: true
    });

    expect(commands).toEqual([
      { action: "READ", id: "apple_contact_1" },
      {
        action: "CREATE",
        fields: { givenName: "Anna", phoneNumbers: [{ label: "mobile", value: "+14155551234" }] }
      },
      { action: "UPDATE", id: "apple_contact_1", patch: { jobTitle: "Founder" } },
      { action: "DELETE", id: "apple_contact_1" }
    ]);
  });

  it("spawns the Swift actuator flag, writes JSON to stdin, and parses one JSON stdout result", async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn(() => child.process as unknown as SpawnedMacContactsProcess);
    const command: MacContactsCommand = { action: "READ", query: "Anna" };

    const resultPromise = runMacContactsCommand(command, {
      binaryPath: "/tmp/friendy-macos-sensor",
      spawnProcess
    });
    child.stdout.write('{"ok":true,"contacts":[]}\n');
    child.process.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({ ok: true, contacts: [] });
    expect(spawnProcess).toHaveBeenCalledWith("/tmp/friendy-macos-sensor", ["--contacts-actuator-stdin"]);
    expect(child.stdinText()).toBe(`${JSON.stringify(command)}\n`);
  });

  it("rejects failed actuator results without leaking raw Contacts access into tests", async () => {
    const child = fakeChildProcess();
    const spawnProcess = vi.fn(() => child.process as unknown as SpawnedMacContactsProcess);

    const resultPromise = runMacContactsCommand(
      { action: "UPDATE", id: "apple_contact_1", patch: { note: "met at AI dinner" } },
      { binaryPath: "/tmp/friendy-macos-sensor", spawnProcess }
    );
    child.stdout.write('{"ok":false,"error":"permissionDenied"}\n');
    child.process.emit("close", 1);

    await expect(resultPromise).rejects.toThrow("permissionDenied");
  });
});

function fakeChildProcess() {
  const process = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  const stdinChunks: string[] = [];
  process.stdin = new Writable({
    write(chunk, _encoding, callback) {
      stdinChunks.push(chunk.toString());
      callback();
    }
  });
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();

  return {
    process,
    stdout: process.stdout,
    stdinText: () => stdinChunks.join("")
  };
}
