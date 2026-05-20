import {
  fixtureDetectedContact,
  fixtureLongEvent,
  fixtureShortEvent,
  fixtureUser
} from "./fixtures";

describe("relationship fixtures", () => {
  it("models the Iteration 2 fixture contact and overlapping calendar context", () => {
    expect(fixtureUser.phoneNumber).toBe("+14156056081");
    expect(fixtureDetectedContact.displayName).toBe("Maya Chen");
    expect(fixtureDetectedContact.source).toBe("simulated");
    expect(fixtureShortEvent.title).toBe("Photon Residency Dinner");
    expect(fixtureShortEvent.eventKind).toBe("short");
    expect(fixtureLongEvent.title).toBe("Photon Residency");
    expect(fixtureLongEvent.eventKind).toBe("long");
  });
});
