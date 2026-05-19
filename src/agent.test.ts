import { demoCalendarEvent, demoUser } from "./mockData";
import { handleAgentMessage, searchMemories } from "./agent";
import { createInitialState } from "./memoryStore";

describe("Friendy agent", () => {
  it("asks to start a memory session for the calendar event", () => {
    const state = createInitialState(demoUser, demoCalendarEvent);
    const result = handleAgentMessage(state, "start");

    expect(result.reply).toContain("Photon Residency Dinner");
    expect(result.reply).toContain("Want me to remember");
  });

  it("approves the session and loads the contact review queue", () => {
    const state = createInitialState(demoUser, demoCalendarEvent);
    const result = handleAgentMessage(state, "yes");

    expect(result.state.sessions[0].status).toBe("review_ready");
    expect(result.state.candidates).toHaveLength(3);
    expect(result.reply).toContain("I found 3 new contacts");
  });

  it("confirms Maya and captures context", () => {
    const approved = handleAgentMessage(createInitialState(demoUser, demoCalendarEvent), "yes").state;
    const result = handleAgentMessage(approved, "save Maya: played piano, AI recruiting founder");

    expect(result.state.memories[0].displayName).toBe("Maya Chen");
    expect(result.reply).toContain("Saved Maya Chen");
  });

  it("recalls Maya from a vague query", () => {
    const approved = handleAgentMessage(createInitialState(demoUser, demoCalendarEvent), "yes").state;
    const saved = handleAgentMessage(approved, "save Maya: played piano, AI recruiting founder").state;

    const matches = searchMemories(saved, "who was the girl playing piano at dinner");

    expect(matches[0].memory.displayName).toBe("Maya Chen");
    expect(matches[0].reason).toContain("played piano");
  });
});
