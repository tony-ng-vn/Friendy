import { createHash } from "node:crypto";
import { normalizeContactMethod } from "./contactSnapshot";

type ContactMethodKind = "phone" | "email";

export type RedactedPhoneMethod = {
  hash: string;
  hint: { last4?: string; label?: string };
  label: string;
};

export type RedactedEmailMethod = {
  hash: string;
  hint: { domain?: string; label?: string };
  label: string;
};

/** Stable SHA-256 fingerprint for a normalized contact method. */
export function hashNormalizedContactMethod(kind: ContactMethodKind, normalized: string): string {
  return createHash("sha256").update(`${kind}:${normalized}`).digest("hex");
}

/** Redacts one phone value into hash, hint, and display label. */
export function redactPhoneMethod(rawPhone: string): RedactedPhoneMethod {
  const normalized = normalizeContactMethod("phone", rawPhone);
  const digits = normalized.replace(/\D/g, "");
  const last4 = digits.slice(-4);

  return {
    hash: hashNormalizedContactMethod("phone", normalized),
    hint: last4 ? { last4, label: "unknown" } : { label: "unknown" },
    label: last4 ? `ending in ${last4}` : "phone contact"
  };
}

/** Redacts one email value into hash, hint, and display label. */
export function redactEmailMethod(rawEmail: string): RedactedEmailMethod {
  const normalized = normalizeContactMethod("email", rawEmail);
  const domain = normalized.split("@")[1] ?? "";

  return {
    hash: hashNormalizedContactMethod("email", normalized),
    hint: domain ? { domain, label: "unknown" } : { label: "unknown" },
    label: domain ? `email at ${domain}` : "email contact"
  };
}
