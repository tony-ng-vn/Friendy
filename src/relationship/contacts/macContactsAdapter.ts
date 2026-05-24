import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveMacosSensorBinaryPath } from "../runtime/macosSensorBinaryPath";

export type MacContactsAction = "READ" | "CREATE" | "UPDATE" | "DELETE";

export type AppleContactLabeledValue = {
  label?: string;
  value: string;
};

export type ApplePostalAddress = {
  label?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type AppleContactFields = {
  givenName?: string;
  familyName?: string;
  middleName?: string;
  nickname?: string;
  organizationName?: string;
  departmentName?: string;
  jobTitle?: string;
  note?: string;
  phoneNumbers?: AppleContactLabeledValue[];
  emailAddresses?: AppleContactLabeledValue[];
  postalAddresses?: ApplePostalAddress[];
};

export type AppleContact = Required<Pick<AppleContactFields, "phoneNumbers" | "emailAddresses" | "postalAddresses">> &
  Omit<AppleContactFields, "phoneNumbers" | "emailAddresses" | "postalAddresses"> & {
    identifier: string;
  };

export type MacContactsCommand =
  | { action: "READ"; id?: string; query?: string }
  | { action: "CREATE"; fields: AppleContactFields }
  | { action: "UPDATE"; id: string; patch: AppleContactFields }
  | { action: "DELETE"; id: string };

export type MacContactsReadResult = {
  ok: true;
  contacts: AppleContact[];
};

export type MacContactsMutationResult = {
  ok: true;
  identifier: string;
  deleted?: boolean;
};

export type MacContactsErrorResult = {
  ok: false;
  error: string;
};

export type MacContactsResult = MacContactsReadResult | MacContactsMutationResult | MacContactsErrorResult;

type SpawnedMacContactsProcess = Pick<ChildProcessWithoutNullStreams, "stdin" | "stdout" | "stderr" | "on">;

export type MacContactsCommandRunner = (command: MacContactsCommand) => Promise<MacContactsResult>;

type MacContactsAdapterOptions = {
  binaryPath?: string;
  cwd?: string;
  runCommand?: MacContactsCommandRunner;
  spawnProcess?: (command: string, args: string[]) => SpawnedMacContactsProcess;
};

export type MacContactsAdapter = ReturnType<typeof createMacContactsAdapter>;

export function createMacContactsAdapter(options: MacContactsAdapterOptions = {}) {
  const runCommand =
    options.runCommand ??
    ((command: MacContactsCommand) =>
      runMacContactsCommand(command, {
        binaryPath: options.binaryPath,
        cwd: options.cwd,
        spawnProcess: options.spawnProcess
      }));

  return {
    async getAppleContact(input: { id?: string; query?: string }): Promise<MacContactsReadResult> {
      const result = await runCommand(compactCommand({ action: "READ", id: input.id, query: input.query }));
      return expectReadResult(result);
    },

    async createAppleContact(fields: AppleContactFields): Promise<Omit<MacContactsMutationResult, "ok" | "deleted">> {
      const result = await runCommand({ action: "CREATE", fields });
      return identifierResult(result);
    },

    async updateAppleContact(
      id: string,
      patch: AppleContactFields
    ): Promise<Omit<MacContactsMutationResult, "ok" | "deleted">> {
      requireAppleContactIdentifier(id);
      const result = await runCommand({ action: "UPDATE", id, patch });
      return identifierResult(result);
    },

    async deleteAppleContact(id: string): Promise<Omit<MacContactsMutationResult, "ok">> {
      requireAppleContactIdentifier(id);
      const result = await runCommand({ action: "DELETE", id });
      const mutation = expectMutationResult(result);
      return { identifier: mutation.identifier, deleted: mutation.deleted };
    }
  };
}

export const defaultMacContactsAdapter = createMacContactsAdapter();

export const getAppleContact = defaultMacContactsAdapter.getAppleContact;
export const createAppleContact = defaultMacContactsAdapter.createAppleContact;
export const updateAppleContact = defaultMacContactsAdapter.updateAppleContact;
export const deleteAppleContact = defaultMacContactsAdapter.deleteAppleContact;

export function runMacContactsCommand(
  command: MacContactsCommand,
  options: Omit<MacContactsAdapterOptions, "runCommand"> = {}
): Promise<MacContactsResult> {
  const binaryPath = options.binaryPath ?? resolveMacosSensorBinaryPath(options.cwd ?? process.cwd());
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;

  return new Promise((resolve, reject) => {
    const child = spawnProcess(binaryPath, ["--contacts-actuator-stdin"]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;

      const result = parseMacContactsResult(stdout, stderr, code);
      if (!result.ok) {
        reject(new Error(result.error));
        return;
      }
      resolve(result);
    });

    child.stdin.write(`${JSON.stringify(command)}\n`);
    child.stdin.end();
  });
}

function defaultSpawnProcess(command: string, args: string[]): SpawnedMacContactsProcess {
  return spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function parseMacContactsResult(stdout: string, stderr: string, code: number | null): MacContactsResult {
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .at(-1);
  if (!line) {
    return { ok: false, error: stderr.trim() || `Apple Contacts actuator exited without JSON output (code ${code}).` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: `Apple Contacts actuator returned invalid JSON: ${line}` };
  }

  if (!isRecord(parsed) || typeof parsed.ok !== "boolean") {
    return { ok: false, error: "Apple Contacts actuator returned an invalid result shape." };
  }

  if (!parsed.ok) {
    return { ok: false, error: typeof parsed.error === "string" ? parsed.error : "Apple Contacts actuator failed." };
  }

  if (Array.isArray(parsed.contacts)) {
    return { ok: true, contacts: parsed.contacts.map(parseAppleContact) };
  }

  if (typeof parsed.identifier === "string" && parsed.identifier.trim()) {
    return { ok: true, identifier: parsed.identifier, deleted: parsed.deleted === true };
  }

  return { ok: false, error: "Apple Contacts actuator success result is missing contacts or identifier." };
}

function compactCommand(command: { action: "READ"; id?: string; query?: string }): MacContactsCommand {
  return {
    action: command.action,
    ...(command.id ? { id: command.id } : {}),
    ...(command.query ? { query: command.query } : {})
  };
}

function identifierResult(result: MacContactsResult): { identifier: string } {
  const mutation = expectMutationResult(result);
  return { identifier: mutation.identifier };
}

function expectReadResult(result: MacContactsResult): MacContactsReadResult {
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (!("contacts" in result)) {
    throw new Error("Apple Contacts actuator did not return contacts for READ.");
  }
  return result;
}

function expectMutationResult(result: MacContactsResult): MacContactsMutationResult {
  if (!result.ok) {
    throw new Error(result.error);
  }
  if (!("identifier" in result)) {
    throw new Error("Apple Contacts actuator did not return an identifier for mutation.");
  }
  return result;
}

function requireAppleContactIdentifier(id: string): void {
  if (!id.trim()) {
    throw new Error("Apple Contact identifier is required for mutation.");
  }
}

function parseAppleContact(value: unknown): AppleContact {
  if (!isRecord(value) || typeof value.identifier !== "string") {
    throw new Error("Apple Contacts actuator returned a contact without identifier.");
  }

  return {
    identifier: value.identifier,
    givenName: readOptionalString(value.givenName),
    familyName: readOptionalString(value.familyName),
    middleName: readOptionalString(value.middleName),
    nickname: readOptionalString(value.nickname),
    organizationName: readOptionalString(value.organizationName),
    departmentName: readOptionalString(value.departmentName),
    jobTitle: readOptionalString(value.jobTitle),
    note: readOptionalString(value.note),
    phoneNumbers: readLabeledValues(value.phoneNumbers),
    emailAddresses: readLabeledValues(value.emailAddresses),
    postalAddresses: readPostalAddresses(value.postalAddresses)
  };
}

function readLabeledValues(value: unknown): AppleContactLabeledValue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).flatMap((item) => {
    if (typeof item.value !== "string") {
      return [];
    }
    return [{ label: readOptionalString(item.label), value: item.value }];
  });
}

function readPostalAddresses(value: unknown): ApplePostalAddress[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((item) => ({
    label: readOptionalString(item.label),
    street: readOptionalString(item.street),
    city: readOptionalString(item.city),
    state: readOptionalString(item.state),
    postalCode: readOptionalString(item.postalCode),
    country: readOptionalString(item.country)
  }));
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
