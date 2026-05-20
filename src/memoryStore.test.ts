import { fixtureCalendarEvent, fixtureContactDelta, fixtureUser } from "./mockData";
import {
  approveSession,
  confirmCandidate,
  createInitialState,
  ignoreCandidate,
  loadContactDelta
} from "./memoryStore";

describe("memory store", () => {
  it("approves a calendar-backed memory session", () => {
    const state = createInitialState(fixtureUser, fixtureCalendarEvent);
    const next = approveSession(state, fixtureCalendarEvent.id);

    expect(next.sessions[0].status).toBe("active");
    expect(next.sessions[0].title).toBe("Photon Residency Dinner");
  });

  it("loads contact deltas into the approved session", () => {
    const state = approveSession(createInitialState(fixtureUser, fixtureCalendarEvent), fixtureCalendarEvent.id);
    const next = loadContactDelta(state, fixtureContactDelta);

    expect(next.candidates).toHaveLength(3);
    expect(next.candidates.every((candidate) => candidate.memorySessionId === "session_event_photon_dinner")).toBe(true);
  });

  it("confirms a candidate into a relationship memory with extracted tags", () => {
    const state = loadContactDelta(
      approveSession(createInitialState(fixtureUser, fixtureCalendarEvent), fixtureCalendarEvent.id),
      fixtureContactDelta
    );

    const next = confirmCandidate(state, "candidate_maya", "played piano, AI recruiting founder, follow up about fixture");

    expect(next.candidates.find((candidate) => candidate.id === "candidate_maya")?.status).toBe("confirmed");
    expect(next.memories).toHaveLength(1);
    expect(next.memories[0].displayName).toBe("Maya Chen");
    expect(next.memories[0].tags).toEqual(["played", "piano", "ai", "recruiting", "founder", "follow", "fixture"]);
  });

  it("ignores a candidate without creating a memory", () => {
    const state = loadContactDelta(
      approveSession(createInitialState(fixtureUser, fixtureCalendarEvent), fixtureCalendarEvent.id),
      fixtureContactDelta
    );

    const next = ignoreCandidate(state, "candidate_alex");

    expect(next.candidates.find((candidate) => candidate.id === "candidate_alex")?.status).toBe("ignored");
    expect(next.memories).toHaveLength(0);
  });
});
