/** Pre-Zod normalization for macOS sensor `contact_added` hint fields. */
const UNKNOWN_LABEL = "unknown";

type ContactMethodHint = {
  last4?: string;
  domain?: string;
  label?: string;
};

/** Payload after hint cleanup; `didNormalize` drives runtime audit logging. */
export type NormalizeSensorEventResult = {
  payload: Record<string, unknown>;
  didNormalize: boolean;
};

/**
 * Normalizes contact method hints on macOS sensor payloads before Zod validation.
 *
 * Empty or whitespace labels become `"unknown"`; empty last4/domain keys are omitted.
 */
export function normalizeSensorEventPayload(payload: Record<string, unknown>): NormalizeSensorEventResult {
  if (payload.type !== "contact_added" || !isRecord(payload.contact)) {
    return { payload, didNormalize: false };
  }

  const contact = payload.contact;
  const phoneNumberHints = normalizeHintArray(contact.phoneNumberHints);
  const emailHints = normalizeHintArray(contact.emailHints);
  const didNormalize = phoneNumberHints.changed || emailHints.changed;

  if (!didNormalize) {
    return { payload, didNormalize: false };
  }

  return {
    payload: {
      ...payload,
      contact: {
        ...contact,
        phoneNumberHints: phoneNumberHints.hints,
        emailHints: emailHints.hints
      }
    },
    didNormalize: true
  };
}

function normalizeHintArray(value: unknown): { hints: ContactMethodHint[]; changed: boolean } {
  if (!Array.isArray(value)) {
    return { hints: [], changed: false };
  }

  let changed = false;
  const hints = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return undefined;
      }

      const normalized = normalizeHint(entry);
      changed ||= normalized.changed;
      return normalized.hint;
    })
    .filter((hint): hint is ContactMethodHint => hint !== undefined);

  return { hints, changed };
}

function normalizeHint(entry: Record<string, unknown>): { hint: ContactMethodHint; changed: boolean } {
  const hint: ContactMethodHint = {};
  let changed = false;

  if (typeof entry.last4 === "string") {
    const last4 = entry.last4.trim();
    if (last4) {
      hint.last4 = last4;
    }
    changed ||= last4 !== entry.last4;
  }

  if (typeof entry.domain === "string") {
    const domain = entry.domain.trim();
    if (domain) {
      hint.domain = domain;
    }
    changed ||= domain !== entry.domain;
  }

  if (typeof entry.label === "string") {
    const trimmed = entry.label.trim();
    const label = trimmed || UNKNOWN_LABEL;
    hint.label = label;
    changed ||= label !== entry.label;
  }

  return { hint, changed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
