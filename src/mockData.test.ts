import { demoCalendarEvent, demoContactDelta, demoUser } from "./mockData";

describe("mock data", () => {
  it("contains a Photon dinner and at least one new contact candidate", () => {
    expect(demoUser.name).toBe("Thien");
    expect(demoCalendarEvent.title).toBe("Photon Residency Dinner");
    expect(demoContactDelta).toHaveLength(3);
    expect(demoContactDelta[0].displayName).toBe("Maya Chen");
  });
});
