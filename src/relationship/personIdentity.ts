/**
 * Person identity types and deterministic helpers for contact-method fingerprints
 * and display-name collision detection.
 *
 * Display names are presentation-only; method fingerprints and person ids are identity.
 */
import { createHash } from "node:crypto";
import { normalizeContactMethod } from "./ingestion/contactSnapshot";

/** Stable person record scoped to one Friendy user. */
export type PersonIdentity = {
  id: string;
  userId: string;
  canonicalDisplayName: string;
  createdAt: string;
  updatedAt: string;
  mergedIntoPersonId?: string;
};

/** Link from a person to Apple contact identifiers and normalized method fingerprints. */
export type AppleContactLink = {
  id: string;
  personId: string;
  userId: string;
  contactIdentifier?: string;
  unifiedContactIdentifier?: string;
  containerIdentifier?: string;
  methodFingerprint: string;
  displayNameSnapshot: string;
  sensorEventId?: string;
  linkedAt: string;
};

export type MethodFingerprintInput = {
  phoneNumbers?: string[];
  emails?: string[];
};

/**
 * Normalizes a display name for collision checks: trim, lowercase, collapse whitespace.
 */
export function normalizeDisplayNameForIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Returns true when two display names collide after normalization.
 */
export function displayNamesCollide(left: string, right: string): boolean {
  const normalizedLeft = normalizeDisplayNameForIdentity(left);
  const normalizedRight = normalizeDisplayNameForIdentity(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

/**
 * Returns saved display names that collide with the candidate display name.
 */
export function findDisplayNameCollisions(candidateDisplayName: string, existingDisplayNames: string[]): string[] {
  return existingDisplayNames.filter((existingDisplayName) =>
    displayNamesCollide(candidateDisplayName, existingDisplayName)
  );
}

/**
 * Computes a stable SHA-256 fingerprint from normalized phone numbers and emails.
 *
 * Reuses contact snapshot normalization so ingestion and identity layers agree on method keys.
 */
export function computeMethodFingerprint(input: MethodFingerprintInput): string {
  const methodKeys = new Set<string>();

  for (const phone of input.phoneNumbers ?? []) {
    const normalized = normalizeContactMethod("phone", phone);
    if (normalized) {
      methodKeys.add(`phone:${normalized}`);
    }
  }

  for (const email of input.emails ?? []) {
    const normalized = normalizeContactMethod("email", email);
    if (normalized) {
      methodKeys.add(`email:${normalized}`);
    }
  }

  const payload = [...methodKeys].sort().join("|");
  return createHash("sha256").update(payload).digest("hex");
}
