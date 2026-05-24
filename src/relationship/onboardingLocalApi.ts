import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { loadFriendyEnv } from "./env";
import { openSqliteRuntimeDatabase } from "./sqliteRepository";

const PRIVATE_BETA_MESSAGE =
  "Friendy is currently in beta demo and will be rolling out to users one by one. Until then, please give Friendy some time.";

const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "https://friendy-ui.vercel.app",
  "https://friedy-ui.vercel.app"
];

const DEFAULT_ALLOWED_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/i, /^http:\/\/127\.0\.0\.1:\d+$/i] as const;

export type PhotonSharedUserClient = {
  createSharedUser(phoneNumber: string): Promise<{ photonUserId: string; assignedPhoneNumber: string }>;
};

export type OnboardingLocalApiOptions = {
  env?: Partial<NodeJS.ProcessEnv>;
  photon?: PhotonSharedUserClient;
  now?: () => string;
};

export type OnboardingConnectInput = {
  phoneNumber?: string;
  email?: string;
};

export type OnboardingStatusInput = {
  phoneNumber?: string;
};

export type OnboardingApiResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

export type OnboardingLocalApi = {
  connect(input: OnboardingConnectInput): Promise<OnboardingApiResponse>;
  status(input: OnboardingStatusInput): Promise<OnboardingApiResponse>;
  close(): void;
};

export type OnboardingLocalHttpServerOptions = {
  api: Pick<OnboardingLocalApi, "connect" | "status">;
  allowedOrigins?: readonly string[];
  allowedOriginPatterns?: readonly RegExp[];
};

type OnboardingUserRow = {
  id: string;
  phone_number: string;
  status: string;
};

type PhotonMappingRow = {
  photon_user_id: string;
  assigned_phone_number: string;
};

type WaitlistRow = {
  phone_number: string;
};

const connectLocks = new Map<string, Promise<OnboardingApiResponse>>();

/** Creates the local-first onboarding API used by the browser-facing HTTP server. */
export function createOnboardingLocalApi({
  env = process.env,
  photon = createPhotonSharedUserClient(env),
  now = () => new Date().toISOString()
}: OnboardingLocalApiOptions = {}): OnboardingLocalApi {
  const sqlitePath = resolve(process.cwd(), env.FRIENDY_SQLITE_PATH || ".friendy/friendy.sqlite");
  const db = openSqliteRuntimeDatabase(sqlitePath);
  setupOnboardingSchema(db);

  return {
    async connect(input: OnboardingConnectInput): Promise<OnboardingApiResponse> {
      const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
      if (!normalizedPhone) {
        return invalidPhoneResponse();
      }

      const normalizedEmail = normalizeEmail(input.email);
      if (!normalizedEmail) {
        return invalidEmailResponse();
      }

      if (!isAllowedPhone(normalizedPhone, env)) {
        upsertWaitlist(db, normalizedPhone, normalizedEmail, now());
        return privateBetaResponse({ statusCode: 202 });
      }

      return withConnectLock(normalizedPhone, async () => {
        const user = upsertOnboardingUser(db, normalizedPhone, now());
        const existingMapping = getPhotonMapping(db, user.id);
        let photonUser: PhotonMappingRow | undefined = existingMapping;
        if (!photonUser) {
          const created = await photon.createSharedUser(normalizedPhone);
          photonUser = {
            photon_user_id: created.photonUserId,
            assigned_phone_number: created.assignedPhoneNumber
          };
        }
        if (!existingMapping) {
          upsertPhotonMapping(db, {
            friendyUserId: user.id,
            phoneNumber: normalizedPhone,
            photonUserId: photonUser.photon_user_id,
            assignedPhoneNumber: photonUser.assigned_phone_number,
            now: now()
          });
        }

        return allowedUserResponse({
          friendyUserId: user.id,
          assignedPhoneNumber: photonUser.assigned_phone_number,
          photonUserId: photonUser.photon_user_id,
          status: user.status
        });
      });
    },

    async status(input: OnboardingStatusInput): Promise<OnboardingApiResponse> {
      const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
      if (!normalizedPhone) {
        return invalidPhoneResponse();
      }

      const user = getOnboardingUserByPhone(db, normalizedPhone);
      if (user) {
        const mapping = getPhotonMapping(db, user.id);
        if (!mapping) {
          return {
            statusCode: 409,
            body: {
              error: "verification_not_ready",
              status: "verification_pending"
            }
          };
        }
        return allowedUserResponse({
          friendyUserId: user.id,
          assignedPhoneNumber: mapping?.assigned_phone_number,
          photonUserId: mapping?.photon_user_id,
          status: user.status
        });
      }

      if (getWaitlistRow(db, normalizedPhone) || !isAllowedPhone(normalizedPhone, env)) {
        return privateBetaResponse({ statusCode: 202, extra: { status: "waitlisted" } });
      }

      return {
        statusCode: 404,
        body: {
          error: "not_connected",
          status: "not_connected"
        }
      };
    },

    close(): void {
      db.close();
    }
  };
}

/** Creates a Node HTTP server around the composable onboarding API. */
export function createOnboardingLocalHttpServer({
  api,
  allowedOrigins = readAllowedBrowserOrigins(process.env),
  allowedOriginPatterns = DEFAULT_ALLOWED_ORIGIN_PATTERNS
}: OnboardingLocalHttpServerOptions): Server {
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    const allowedOrigin =
      typeof origin === "string" ? matchAllowedOrigin(origin, allowedOrigins, allowedOriginPatterns) : undefined;
    if (origin && !allowedOrigin) {
      writeJson(response, { statusCode: 403, body: { error: "origin_not_allowed" } });
      return;
    }
    if (allowedOrigin) {
      writeCorsHeaders(response, allowedOrigin);
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/api/onboarding/connect") {
        if (!isJsonRequest(request)) {
          writeJson(response, { statusCode: 415, body: { error: "unsupported_media_type" } }, allowedOrigin);
          return;
        }
        const body = await readJsonBody(request);
        writeJson(
          response,
          await api.connect({
            phoneNumber: typeof body.phoneNumber === "string" ? body.phoneNumber : undefined,
            email: typeof body.email === "string" ? body.email : undefined
          }),
          allowedOrigin
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/onboarding/status") {
        writeJson(response, await api.status({ phoneNumber: url.searchParams.get("phoneNumber") ?? undefined }), allowedOrigin);
        return;
      }

      writeJson(response, { statusCode: 404, body: { error: "not_found" } }, allowedOrigin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, { statusCode: 400, body: { error: "bad_request", message } }, allowedOrigin);
    }
  });
}

async function withConnectLock(phoneNumber: string, callback: () => Promise<OnboardingApiResponse>): Promise<OnboardingApiResponse> {
  const existing = connectLocks.get(phoneNumber);
  if (existing) {
    return existing;
  }

  const promise = callback().finally(() => {
    connectLocks.delete(phoneNumber);
  });
  connectLocks.set(phoneNumber, promise);
  return promise;
}

/** Production Photon HTTP client; tests inject a fake client. */
export function createPhotonSharedUserClient(env: Partial<NodeJS.ProcessEnv> = process.env): PhotonSharedUserClient {
  const projectId = env.SPECTRUM_PROJECT_ID;
  const projectSecret = env.SPECTRUM_PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    throw new Error("Missing SPECTRUM_PROJECT_ID or SPECTRUM_PROJECT_SECRET.");
  }

  return {
    async createSharedUser(phoneNumber: string): Promise<{ photonUserId: string; assignedPhoneNumber: string }> {
      const response = await fetch(`https://spectrum.photon.codes/projects/${projectId}/users`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ type: "shared", phoneNumber })
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(`Photon shared user creation failed with HTTP ${response.status}.`);
      }

      const payload =
        typeof body.data === "object" && body.data !== null ? (body.data as Record<string, unknown>) : body;
      const photonUserId =
        typeof payload.id === "string" ? payload.id : typeof payload.userId === "string" ? payload.userId : undefined;
      const assignedPhoneNumber =
        typeof payload.assignedPhoneNumber === "string"
          ? normalizePhoneNumber(payload.assignedPhoneNumber)
          : undefined;
      if (!photonUserId) {
        throw new Error("Photon shared user response did not include a user id.");
      }
      if (!assignedPhoneNumber) {
        throw new Error("Photon shared user response did not include an assigned phone number.");
      }

      return { photonUserId, assignedPhoneNumber };
    }
  };
}

function setupOnboardingSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friendy_onboarding_users (
      id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendy_photon_user_mappings (
      friendy_user_id TEXT PRIMARY KEY,
      phone_number TEXT NOT NULL UNIQUE,
      photon_user_id TEXT NOT NULL UNIQUE,
      assigned_phone_number TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friendy_onboarding_waitlist (
      phone_number TEXT PRIMARY KEY,
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO schema_migrations (version, name, applied_at)
    VALUES (4, '4_local_onboarding', '2026-05-24T00:00:00.000Z');
  `);
  const currentVersion = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (currentVersion < 4) {
    db.exec("PRAGMA user_version = 4");
  }

  const waitlistColumns = db.prepare("PRAGMA table_info(friendy_onboarding_waitlist)").all() as Array<{ name: string }>;
  if (!waitlistColumns.some((column) => column.name === "email")) {
    db.exec("ALTER TABLE friendy_onboarding_waitlist ADD COLUMN email TEXT");
  }
}

function normalizePhoneNumber(phoneNumber: string | undefined): string | undefined {
  if (!phoneNumber) {
    return undefined;
  }

  const trimmed = phoneNumber.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 11 && digits.length <= 15 ? `+${digits}` : undefined;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return undefined;
}

function isAllowedPhone(phoneNumber: string, env: Partial<NodeJS.ProcessEnv>): boolean {
  return readAllowedPhones(env).has(phoneNumber);
}

function readAllowedPhones(env: Partial<NodeJS.ProcessEnv>): Set<string> {
  const rawPhones = [env.FRIENDY_OWNER_PHONE, ...(env.FRIENDY_BETA_ALLOWED_PHONES ?? "").split(",")];
  return new Set(rawPhones.map((phone) => normalizePhoneNumber(phone)).filter((phone): phone is string => Boolean(phone)));
}

function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) {
    return undefined;
  }

  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function upsertWaitlist(db: DatabaseSync, phoneNumber: string, email: string, timestamp: string): void {
  db.prepare(
    `
      INSERT INTO friendy_onboarding_waitlist (phone_number, email, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(phone_number) DO UPDATE SET
        email = excluded.email,
        updated_at = excluded.updated_at
    `
  ).run(phoneNumber, email, timestamp, timestamp);
}

function upsertOnboardingUser(db: DatabaseSync, phoneNumber: string, timestamp: string): OnboardingUserRow {
  const existing = getOnboardingUserByPhone(db, phoneNumber);
  if (existing) {
    return existing;
  }

  const user: OnboardingUserRow = {
    id: `friendy_user_${randomUUID()}`,
    phone_number: phoneNumber,
    status: "verification_sent"
  };
  db.prepare(
    `
      INSERT INTO friendy_onboarding_users (id, phone_number, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(user.id, user.phone_number, user.status, timestamp, timestamp);
  return user;
}

function getOnboardingUserByPhone(db: DatabaseSync, phoneNumber: string): OnboardingUserRow | undefined {
  return db.prepare("SELECT id, phone_number, status FROM friendy_onboarding_users WHERE phone_number = ?").get(phoneNumber) as
    | OnboardingUserRow
    | undefined;
}

function getPhotonMapping(db: DatabaseSync, friendyUserId: string): PhotonMappingRow | undefined {
  return db
    .prepare("SELECT photon_user_id, assigned_phone_number FROM friendy_photon_user_mappings WHERE friendy_user_id = ?")
    .get(friendyUserId) as PhotonMappingRow | undefined;
}

function upsertPhotonMapping(
  db: DatabaseSync,
  input: { friendyUserId: string; phoneNumber: string; photonUserId: string; assignedPhoneNumber: string; now: string }
): void {
  db.prepare(
    `
      INSERT INTO friendy_photon_user_mappings (
        friendy_user_id, phone_number, photon_user_id, assigned_phone_number, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(friendy_user_id) DO UPDATE SET
        phone_number = excluded.phone_number,
        photon_user_id = excluded.photon_user_id,
        assigned_phone_number = excluded.assigned_phone_number,
        updated_at = excluded.updated_at
    `
  ).run(input.friendyUserId, input.phoneNumber, input.photonUserId, input.assignedPhoneNumber, input.now, input.now);
}

function getWaitlistRow(db: DatabaseSync, phoneNumber: string): WaitlistRow | undefined {
  return db
    .prepare("SELECT phone_number FROM friendy_onboarding_waitlist WHERE phone_number = ?")
    .get(phoneNumber) as WaitlistRow | undefined;
}

function allowedUserResponse(input: {
  friendyUserId: string;
  assignedPhoneNumber?: string;
  photonUserId?: string;
  status: string;
}): OnboardingApiResponse {
  return {
    statusCode: 200,
    body: {
      friendyUserId: input.friendyUserId,
      status: input.status,
      assignedPhoneNumber: input.assignedPhoneNumber,
      redirectUrl: input.photonUserId
        ? `https://spectrum.photon.codes/users/${input.photonUserId}/redirect?msg=start`
        : undefined
    }
  };
}

function privateBetaResponse({
  statusCode,
  extra = {}
}: {
  statusCode: number;
  extra?: Record<string, unknown>;
}): OnboardingApiResponse {
  return {
    statusCode,
    body: {
      ...extra,
      error: "private_beta",
      message: PRIVATE_BETA_MESSAGE
    }
  };
}

function invalidPhoneResponse(): OnboardingApiResponse {
  return {
    statusCode: 400,
    body: {
      error: "invalid_phone"
    }
  };
}

function invalidEmailResponse(): OnboardingApiResponse {
  return {
    statusCode: 400,
    body: {
      error: "invalid_email",
      message: "Enter a valid email address."
    }
  };
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function isJsonRequest(request: IncomingMessage): boolean {
  return String(request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() === "application/json";
}

function writeJson(response: ServerResponse, apiResponse: OnboardingApiResponse, allowedOrigin?: string): void {
  if (allowedOrigin) {
    writeCorsHeaders(response, allowedOrigin);
  }
  response.writeHead(apiResponse.statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(apiResponse.body));
}

function writeCorsHeaders(response: ServerResponse, origin: string): void {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Vary", "Origin");
}

function readAllowedBrowserOrigins(env: Partial<NodeJS.ProcessEnv>): readonly string[] {
  return [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(env.FRIENDY_LOCAL_API_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean)
  ];
}

function matchAllowedOrigin(
  origin: string,
  allowedOrigins: readonly string[],
  allowedOriginPatterns: readonly RegExp[]
): string | undefined {
  return allowedOrigins.includes(origin) || allowedOriginPatterns.some((pattern) => pattern.test(origin)) ? origin : undefined;
}

async function main(): Promise<void> {
  loadFriendyEnv();
  const api = createOnboardingLocalApi();
  const port = Number(process.env.FRIENDY_LOCAL_API_PORT || 8788);
  const server = createOnboardingLocalHttpServer({ api });
  server.listen(port, "127.0.0.1", () => {
    console.info(`[friendy:onboarding] local API listening on http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
