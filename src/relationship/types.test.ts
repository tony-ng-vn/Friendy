import {
  demoDetectedContact,
  demoLongEvent,
  demoShortEvent,
  demoUser
} from "./fixtures";

describe("relationship fixtures", () => {
  it("models the Iteration 2 demo contact and overlapping calendar context", () => {
    expect(demoUser.phoneNumber).toBe("+14156056081");
    expect(demoDetectedContact.displayName).toBe("Maya Chen");
    expect(demoDetectedContact.source).toBe("simulated");
    expect(demoShortEvent.title).toBe("Photon Residency Dinner");
    expect(demoShortEvent.eventKind).toBe("short");
    expect(demoLongEvent.title).toBe("Photon Residency");
    expect(demoLongEvent.eventKind).toBe("long");
  });
});
