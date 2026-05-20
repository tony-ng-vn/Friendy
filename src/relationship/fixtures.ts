import type { CalendarEvent, ContactCandidateDetected, RelationshipMemory, User } from "./types";

/** Stable demo user for the first Photon/Friendy relationship-agent walkthrough. */
export const demoUser: User = {
  id: "user_demo",
  phoneNumber: "+14156056081",
  displayName: "Friendy Demo User",
  createdAt: "2026-05-20T09:00:00.000Z"
};

/** Simulated contact delta that stands in for "user added someone to Contacts during an event." */
export const demoDetectedContact: ContactCandidateDetected = {
  userId: demoUser.id,
  displayName: "Maya Chen",
  phoneNumbers: ["+15550101020"],
  emails: [],
  detectedAt: "2026-05-15T21:42:00-07:00",
  source: "simulated"
};

/** Specific event that should outrank the longer residency when both overlap. */
export const demoShortEvent: CalendarEvent = {
  id: "event_photon_residency_dinner",
  userId: demoUser.id,
  title: "Photon Residency Dinner",
  startsAt: "2026-05-15T19:00:00-07:00",
  endsAt: "2026-05-15T22:00:00-07:00",
  timezone: "America/Los_Angeles",
  location: "San Francisco",
  calendarSource: "simulated",
  eventKind: "short"
};

/** Long background event used to prove overlap ranking does not lose residency context. */
export const demoLongEvent: CalendarEvent = {
  id: "event_photon_residency",
  userId: demoUser.id,
  title: "Photon Residency",
  startsAt: "2026-05-11T16:00:00-07:00",
  endsAt: "2026-05-18T10:00:00-07:00",
  timezone: "America/Los_Angeles",
  location: "San Francisco",
  calendarSource: "simulated",
  eventKind: "long"
};

/** Second dinner memory used to force a clarification path instead of overconfident search results. */
export const ambiguousDinnerMemory: RelationshipMemory = {
  id: "memory_sarah_founders_dinner",
  userId: demoUser.id,
  displayName: "Sarah Lee",
  primaryContactLabel: "+15550101030",
  eventId: "event_founders_dinner",
  eventTitle: "Founders Dinner",
  contextNote: "hardware founder, dinner table",
  tags: ["hardware", "founder", "dinner", "table"],
  confidence: 0.9,
  createdAt: "2026-05-14T23:00:00-07:00",
  updatedAt: "2026-05-14T23:00:00-07:00"
};
