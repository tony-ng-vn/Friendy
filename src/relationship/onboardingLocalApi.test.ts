import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSqliteRelationshipRepository,
  openSqliteRuntimeDatabase,
  type SqliteRelationshipRepository
} from "./sqliteRepository";
import {
  createOnboardingLocalApi,
  createOnboardingLocalHttpServer,
  createPhotonSharedUserClient,
  type OnboardingLocalApi,
  type PhotonSharedUserClient
} from "./onboardingLocalApi";

const tempDirs: string[] = [];
const repositories: SqliteRelationshipRepository[] = [];
const closeables: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    repository.close();
  }

  for (const item of closeables.splice(0)) {
    item.close();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Friendy local onboarding API", () => {
  it("waitlists a non-allowed phone and does not call Photon", async () => {
    const photon = fakePhotonClient();
    const api = createTestApi({ photon });

    const response = await api.connect({ phoneNumber: "415-555-0130", email: "wait@example.com" });

    expect(response.statusCode).toBe(202);
    expect(response.body).toEqual({
      error: "private_beta",
      message:
        "Friendy is currently in beta demo and will be rolling out to users one by one. Until then, please give Friendy some time."
    });
    expect(photon.createSharedUser).not.toHaveBeenCalled();
  });

  it("stores waitlist email addresses in SQLite", async () => {
    const photon = fakePhotonClient();
    const dir = mkdtempSync(join(tmpdir(), "friendy-waitlist-email-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "friendy.sqlite");
    const api = createOnboardingLocalApi({
      env: {
        FRIENDY_SQLITE_PATH: dbPath,
        SPECTRUM_PROJECT_ID: "project_test",
        SPECTRUM_PROJECT_SECRET: "secret_test"
      },
      photon
    });

    await api.connect({ phoneNumber: "415-555-0130", email: "Wait.Person@Gmail.com" });

    const db = trackCloseable(openSqliteRuntimeDatabase(dbPath));
    const row = db
      .prepare("SELECT phone_number, email FROM friendy_onboarding_waitlist WHERE phone_number = ?")
      .get("+14155550130") as { phone_number: string; email: string };

    expect(row).toEqual({
      phone_number: "+14155550130",
      email: "wait.person@gmail.com"
    });
    api.close();
  });

  it("rejects connect without a valid email", async () => {
    const api = createTestApi();

    await expect(api.connect({ phoneNumber: "+14155550130", email: "not-an-email" })).resolves.toMatchObject({
      statusCode: 400,
      body: {
        error: "invalid_email",
        message: "Enter a valid email address."
      }
    });
  });

  it("creates a Friendy user, Photon mapping, and redirect URL for an allowed owner", async () => {
    const photon = fakePhotonClient({ photonUserId: "photon_owner_1", assignedPhoneNumber: "+14156056081" });
    const api = createTestApi({
      photon,
      env: {
        FRIENDY_OWNER_PHONE: "+14155550123"
      }
    });

    const response = await api.connect({ phoneNumber: "(415) 555-0123", email: "owner@example.com" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: "verification_sent",
      assignedPhoneNumber: "+14156056081",
      redirectUrl: "https://spectrum.photon.codes/users/photon_owner_1/redirect?msg=start"
    });
    expect(response.body.friendyUserId).toMatch(/^friendy_user_/);
    expect(photon.createSharedUser).toHaveBeenCalledExactlyOnceWith("+14155550123");
  });

  it("reuses an existing Photon mapping for repeated allowed connects", async () => {
    const photon = fakePhotonClient({ photonUserId: "photon_owner_1" });
    const api = createTestApi({
      photon,
      env: {
        FRIENDY_OWNER_PHONE: "+14155550123"
      }
    });

    const first = await api.connect({ phoneNumber: "+14155550123", email: "owner@example.com" });
    const second = await api.connect({ phoneNumber: "4155550123", email: "owner@example.com" });

    expect(first.body).toMatchObject(second.body);
    expect(photon.createSharedUser).toHaveBeenCalledTimes(1);
  });

  it("reports owner status and private beta waitlist status", async () => {
    const photon = fakePhotonClient({ photonUserId: "photon_owner_1" });
    const api = createTestApi({
      photon,
      env: {
        FRIENDY_OWNER_PHONE: "+14155550123"
      }
    });

    await api.connect({ phoneNumber: "+14155550123", email: "owner@example.com" });
    await api.connect({ phoneNumber: "+14155550130", email: "wait@example.com" });

    await expect(api.status({ phoneNumber: "+14155550123" })).resolves.toMatchObject({
      statusCode: 200,
      body: {
        status: "verification_sent",
        assignedPhoneNumber: "+14156056081",
        redirectUrl: "https://spectrum.photon.codes/users/photon_owner_1/redirect?msg=start"
      }
    });
    await expect(api.status({ phoneNumber: "+14155550130" })).resolves.toMatchObject({
      statusCode: 202,
      body: {
        error: "private_beta",
        status: "waitlisted"
      }
    });
  });

  it("allows CORS preflight from the deployed Friendy UI origin", async () => {
    const api = createTestApi();
    const server = createOnboardingLocalHttpServer({ api });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local test server address.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/onboarding/connect`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://friendy-ui.vercel.app",
          "Access-Control-Request-Method": "POST"
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://friendy-ui.vercel.app");
      expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("rejects state-changing requests from untrusted browser origins before calling connect", async () => {
    const api: Pick<OnboardingLocalApi, "connect" | "status"> = {
      connect: vi.fn(async () => ({ statusCode: 200, body: { ok: true } })),
      status: vi.fn(async () => ({ statusCode: 200, body: { ok: true } }))
    };
    const server = createOnboardingLocalHttpServer({ api });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local test server address.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/onboarding/connect`, {
        method: "POST",
        headers: {
          Origin: "https://attacker.example",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ phoneNumber: "+14155550123" })
      });

      expect(response.status).toBe(403);
      expect(api.connect).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("does not trust broad Vercel preview origins unless explicitly allowed", async () => {
    const api: Pick<OnboardingLocalApi, "connect" | "status"> = {
      connect: vi.fn(async () => ({ statusCode: 200, body: { ok: true } })),
      status: vi.fn(async () => ({ statusCode: 200, body: { ok: true } }))
    };
    const server = createOnboardingLocalHttpServer({ api });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local test server address.");
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/onboarding/connect`, {
        method: "POST",
        headers: {
          Origin: "https://friendy-ui-attacker.vercel.app",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ phoneNumber: "+14155550123" })
      });

      expect(response.status).toBe(403);
      expect(api.connect).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("reuses one Photon creation when two allowed connects happen concurrently", async () => {
    const photon = fakePhotonClient({ photonUserId: "photon_owner_1", assignedPhoneNumber: "+14156056081", delayMs: 25 });
    const api = createTestApi({
      photon,
      env: {
        FRIENDY_OWNER_PHONE: "+14155550123"
      }
    });

    const [first, second] = await Promise.all([
      api.connect({ phoneNumber: "+14155550123", email: "owner@example.com" }),
      api.connect({ phoneNumber: "4155550123", email: "owner@example.com" })
    ]);

    expect(first.body).toMatchObject(second.body);
    expect(photon.createSharedUser).toHaveBeenCalledTimes(1);
  });

  it("does not report an allowed user as ready when Photon creation fails", async () => {
    const photon: PhotonSharedUserClient = {
      createSharedUser: vi.fn(async () => {
        throw new Error("Photon unavailable");
      })
    };
    const api = createTestApi({
      photon,
      env: {
        FRIENDY_OWNER_PHONE: "+14155550123"
      }
    });

    await expect(
      api.connect({ phoneNumber: "+14155550123", email: "owner@example.com" })
    ).rejects.toThrow("Photon unavailable");
    await expect(api.status({ phoneNumber: "+14155550123" })).resolves.toMatchObject({
      statusCode: 409,
      body: {
        error: "verification_not_ready",
        status: "verification_pending"
      }
    });
  });

  it("keeps the onboarding migration version after later SQLite repository opens", () => {
    const dir = mkdtempSync(join(tmpdir(), "friendy-onboarding-version-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "friendy.sqlite");
    const api = createOnboardingLocalApi({
      env: {
        FRIENDY_SQLITE_PATH: dbPath,
        SPECTRUM_PROJECT_ID: "project_test",
        SPECTRUM_PROJECT_SECRET: "secret_test"
      },
      photon: fakePhotonClient()
    });
    api.close();

    repositories.push(createSqliteRelationshipRepository({ path: dbPath }));
    const db = trackCloseable(openSqliteRuntimeDatabase(dbPath));

    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(4);
    expect(db.prepare("SELECT name FROM schema_migrations WHERE version = 4").get()).toEqual({
      name: "4_local_onboarding"
    });
  });

  it("calls Photon shared-user API with Basic project credentials and reads nested response data", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      succeed: true,
      data: {
        id: "photon_user_nested",
        assignedPhoneNumber: "+14156056081"
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = createPhotonSharedUserClient({
        SPECTRUM_PROJECT_ID: "project_123",
        SPECTRUM_PROJECT_SECRET: "secret_456"
      });

      await expect(client.createSharedUser("+14155550123")).resolves.toEqual({
        photonUserId: "photon_user_nested",
        assignedPhoneNumber: "+14156056081"
      });
      expect(fetchMock).toHaveBeenCalledWith("https://spectrum.photon.codes/projects/project_123/users", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from("project_123:secret_456").toString("base64")}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ type: "shared", phoneNumber: "+14155550123" })
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function createTestApi({
  photon = fakePhotonClient(),
  env = {}
}: {
  photon?: PhotonSharedUserClient;
  env?: Record<string, string>;
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "friendy-onboarding-api-"));
  tempDirs.push(dir);

  return createOnboardingLocalApi({
    env: {
      FRIENDY_SQLITE_PATH: join(dir, "friendy.sqlite"),
      SPECTRUM_PROJECT_ID: "project_test",
      SPECTRUM_PROJECT_SECRET: "secret_test",
      ...env
    },
    photon
  });
}

function fakePhotonClient({
  photonUserId = "photon_user_1",
  assignedPhoneNumber = "+14156056081",
  delayMs = 0
}: {
  photonUserId?: string;
  assignedPhoneNumber?: string;
  delayMs?: number;
} = {}): PhotonSharedUserClient {
  return {
    createSharedUser: vi.fn(async () => {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return { photonUserId, assignedPhoneNumber };
    })
  };
}

function trackCloseable<T extends { close: () => void }>(closeable: T): T {
  closeables.push(closeable);
  return closeable;
}
