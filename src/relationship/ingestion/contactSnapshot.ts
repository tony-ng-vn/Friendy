/**
 * Contact snapshot types and method-centric diffing for ingestion.
 *
 * Diffing is method-centric, not contact-row-centric: a newly normalized phone or email can create
 * a candidate. Name-only edits and duplicate normalized methods are intentionally ignored.
 */
import { fixtureUser } from "../fixtures";
import type { ContactCandidateDetected } from "../types";

/** One contact row captured in a snapshot. */
export type ContactSnapshotContact = {
  stableId: string;
  displayName: string;
  phoneNumbers: string[];
  emails: string[];
  updatedAt: string;
};

/** Point-in-time Contacts export for a single Friendy user. */
export type ContactSnapshot = {
  userId: string;
  capturedAt: string;
  contacts: ContactSnapshotContact[];
};

type ContactMethodKind = "phone" | "email";

type ContactMethodRecord = {
  kind: ContactMethodKind;
  value: string;
};

/** Fixture snapshot before new contact methods appear. */
export const fixtureBeforeContactSnapshot: ContactSnapshot = {
  userId: fixtureUser.id,
  capturedAt: "2026-05-15T19:00:00-07:00",
  contacts: [
    {
      stableId: "contact_alex",
      displayName: "Alex",
      phoneNumbers: ["+15550101001"],
      emails: ["alex@example.com"],
      updatedAt: "2026-05-15T19:00:00-07:00"
    }
  ]
};

/** Fixture snapshot after new phones, emails, and name edits. */
export const fixtureAfterContactSnapshot: ContactSnapshot = {
  userId: fixtureUser.id,
  capturedAt: "2026-06-01T12:00:00-07:00",
  contacts: [
    {
      stableId: "contact_alex",
      displayName: "Alex Lee",
      phoneNumbers: ["+15550101001"],
      emails: ["alex@example.com"],
      updatedAt: "2026-05-15T21:00:00-07:00"
    },
    {
      stableId: "contact_maya",
      displayName: "Maya Chen",
      phoneNumbers: ["+15550101020"],
      emails: [],
      updatedAt: "2026-05-15T21:42:00-07:00"
    },
    {
      stableId: "contact_nina",
      displayName: "Nina Park",
      phoneNumbers: [],
      emails: ["nina@example.com"],
      updatedAt: "2026-06-01T12:00:00-07:00"
    },
    {
      stableId: "contact_priya_duplicate",
      displayName: "Priya Duplicate",
      phoneNumbers: ["+1 (555) 010-1001"],
      emails: ["ALEX@EXAMPLE.COM"],
      updatedAt: "2026-05-15T21:30:00-07:00"
    }
  ]
};

/**
 * Finds newly added contact methods between two snapshots.
 *
 * The diff is method-centric, not contact-row-centric, because the MVP should react when a new
 * phone/email appears. Name-only edits and duplicate rows for known methods are intentionally ignored.
 */
export function detectNewContactMethods(
  before: ContactSnapshot,
  after: ContactSnapshot
): ContactCandidateDetected[] {
  const knownMethods = new Set(before.contacts.flatMap(methodKeysForContact));

  return after.contacts
    .map((contact) => {
      const newMethods = uniqueMethods(contact).filter((method) => !knownMethods.has(methodKey(method)));
      if (newMethods.length === 0) {
        return undefined;
      }

      const detectedContact: ContactCandidateDetected = {
        userId: after.userId,
        displayName: contact.displayName,
        phoneNumbers: newMethods.filter((method) => method.kind === "phone").map((method) => method.value),
        emails: newMethods.filter((method) => method.kind === "email").map((method) => method.value),
        detectedAt: contact.updatedAt || after.capturedAt,
        source: "contacts_delta"
      };

      return detectedContact;
    })
    .filter((item): item is ContactCandidateDetected => Boolean(item));
}

/** Normalizes a phone or email so method-centric diffing can compare stable keys. */
export function normalizeContactMethod(kind: ContactMethodKind, value: string): string {
  if (kind === "email") {
    return value.trim().toLowerCase();
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function methodKeysForContact(contact: ContactSnapshotContact): string[] {
  return uniqueMethods(contact).map(methodKey);
}

function uniqueMethods(contact: ContactSnapshotContact): ContactMethodRecord[] {
  const byKey = new Map<string, ContactMethodRecord>();

  for (const phone of contact.phoneNumbers) {
    const method = { kind: "phone" as const, value: normalizeContactMethod("phone", phone) };
    byKey.set(methodKey(method), method);
  }

  for (const email of contact.emails) {
    const method = { kind: "email" as const, value: normalizeContactMethod("email", email) };
    byKey.set(methodKey(method), method);
  }

  return [...byKey.values()];
}

function methodKey(method: ContactMethodRecord): string {
  return `${method.kind}:${method.value}`;
}
