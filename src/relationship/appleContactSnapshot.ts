/**
 * Helpers for summarizing Apple Contact card data before it is sent to routing context.
 *
 * These snapshots intentionally keep rich non-secret card fields while avoiding raw phone and
 * email values in summaries that may be logged or shown to the model.
 */
import type { AppleContact, AppleContactFields } from "./contacts/macContactsAdapter";

/** Returns the Apple Contact fields Friendy currently understands for card context. */
export function buildAppleContactSnapshotFields(contact: AppleContact): AppleContactFields {
  return {
    givenName: emptyToUndefined(contact.givenName),
    familyName: emptyToUndefined(contact.familyName),
    middleName: emptyToUndefined(contact.middleName),
    nickname: emptyToUndefined(contact.nickname),
    organizationName: emptyToUndefined(contact.organizationName),
    departmentName: emptyToUndefined(contact.departmentName),
    jobTitle: emptyToUndefined(contact.jobTitle),
    note: emptyToUndefined(contact.note),
    phoneNumbers: contact.phoneNumbers ?? [],
    emailAddresses: contact.emailAddresses ?? [],
    postalAddresses: contact.postalAddresses ?? []
  };
}

/** Summarizes non-address contact-card context without including raw phone or email values. */
export function summarizeAppleContactSnapshotFields(fields: AppleContactFields): string {
  return [
    fields.organizationName,
    fields.departmentName,
    fields.jobTitle,
    fields.nickname ? `nickname: ${fields.nickname}` : undefined,
    fields.note ? `note: ${fields.note}` : undefined,
    summarizePostalAddresses(fields.postalAddresses)
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

function summarizePostalAddresses(addresses: AppleContactFields["postalAddresses"]): string | undefined {
  const addressSummaries = (addresses ?? [])
    .map((address) => [address.label, address.city, address.state, address.country].filter(Boolean).join(" "))
    .filter((summary) => summary.trim().length > 0);

  return addressSummaries.length > 0 ? `addresses: ${addressSummaries.join("; ")}` : undefined;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}
