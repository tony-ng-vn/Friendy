import { fixtureCalendarEvent, fixtureContactDelta, fixtureUser } from "./mockData";

describe("mock data", () => {
  it("contains a Photon dinner and at least one new contact candidate", () => {
    expect(fixtureUser.name).toBe("Thien");
    expect(fixtureCalendarEvent.title).toBe("Photon Residency Dinner");
    expect(fixtureContactDelta).toHaveLength(3);
    expect(fixtureContactDelta[0].displayName).toBe("Maya Chen");
  });
});
