import type { CalendarEvent, CandidateConnection, User } from "./types";

export const fixtureUser: User = {
  id: "user_thien",
  name: "Thien",
  phoneNumber: "+15550101010",
  createdAt: "2026-05-19T09:00:00.000Z"
};

export const fixtureCalendarEvent: CalendarEvent = {
  id: "event_photon_dinner",
  userId: fixtureUser.id,
  title: "Photon Residency Dinner",
  startsAt: "2026-05-15T19:00:00.000Z",
  endsAt: "2026-05-15T23:00:00.000Z",
  location: "San Francisco",
  source: "mock_calendar"
};

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
