/**
 * Legacy Vite demo fixtures.
 *
 * Production fixtures and test data live under `src/relationship/`. Domain types are
 * in `src/relationship/types.ts`; agent behavior is in `src/relationship/agentCore.ts`
 * and `src/relationship/interpretedAgent.ts`.
 */
import type { CalendarEvent, CandidateConnection, User } from "./types";

/** Demo user that owns the seeded calendar event and contact delta. */
export const fixtureUser: User = {
  id: "user_thien",
  name: "Thien",
  phoneNumber: "+15550101010",
  createdAt: "2026-05-19T09:00:00.000Z"
};

/** Calendar event used to bootstrap the demo memory session. */
export const fixtureCalendarEvent: CalendarEvent = {
  id: "event_photon_dinner",
  userId: fixtureUser.id,
  title: "Photon Residency Dinner",
  startsAt: "2026-05-15T19:00:00.000Z",
  endsAt: "2026-05-15T23:00:00.000Z",
  location: "San Francisco",
  source: "mock_calendar"
};

/** Mock contact deltas loaded after the user approves event tracking. */
export const fixtureContactDelta: CandidateConnection[] = [
  {
    id: "candidate_maya",
    userId: fixtureUser.id,
    displayName: "Maya Chen",
    phoneNumber: "+15550101020",
    source: "mock_contact_delta",
    detectedAt: "2026-05-15T23:20:00.000Z",
    status: "pending"
  },
  {
    id: "candidate_alex",
    userId: fixtureUser.id,
    displayName: "Alex Rivera",
    phoneNumber: "+15550101021",
    source: "mock_contact_delta",
    detectedAt: "2026-05-15T23:25:00.000Z",
    status: "pending"
  },
  {
    id: "candidate_priya",
    userId: fixtureUser.id,
    displayName: "Priya Shah",
    email: "priya@example.com",
    source: "mock_contact_delta",
    detectedAt: "2026-05-15T23:31:00.000Z",
    status: "pending"
  }
];
