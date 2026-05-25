import { describe, expect, it } from "vitest";
import { buildAppleContactSnapshotFields, summarizeAppleContactSnapshotFields } from "./appleContactSnapshot";
import type { AppleContact } from "./contacts/macContactsAdapter";

describe("Apple Contact snapshot helpers", () => {
  it("extracts supported card fields without inventing unsupported fields", () => {
    const contact: AppleContact = {
      identifier: "apple_contact_julie",
      givenName: "Julie",
      familyName: "Benson",
      organizationName: "Host Family",
      jobTitle: "Minnesota host mom",
      note: "Host mom during the Minnesota exchange program.",
      phoneNumbers: [{ label: "mobile", value: "+14155551234" }],
      emailAddresses: [{ label: "home", value: "julie@example.com" }],
      postalAddresses: []
    };

    expect(buildAppleContactSnapshotFields(contact)).toEqual({
      givenName: "Julie",
      familyName: "Benson",
      organizationName: "Host Family",
      jobTitle: "Minnesota host mom",
      note: "Host mom during the Minnesota exchange program.",
      phoneNumbers: [{ label: "mobile", value: "+14155551234" }],
      emailAddresses: [{ label: "home", value: "julie@example.com" }],
      postalAddresses: []
    });
  });

  it("summarizes card context while avoiding raw phone and email values", () => {
    const summary = summarizeAppleContactSnapshotFields({
      organizationName: "Tesla",
      departmentName: "AI",
      jobTitle: "Intern",
      note: "UT Austin | Tesla intern Fall 2026",
      phoneNumbers: [{ label: "mobile", value: "+17136585593" }],
      emailAddresses: [{ label: "home", value: "austin@example.com" }],
      postalAddresses: []
    });

    expect(summary).toBe("Tesla, AI, Intern, note: UT Austin | Tesla intern Fall 2026");
    expect(summary).not.toContain("+17136585593");
    expect(summary).not.toContain("austin@example.com");
  });

  it("returns an empty summary when the card has no rich context", () => {
    expect(
      summarizeAppleContactSnapshotFields({
        givenName: "Testing",
        familyName: "500",
        phoneNumbers: [{ label: "mobile", value: "+14156056081" }],
        emailAddresses: [],
        postalAddresses: []
      })
    ).toBe("");
  });
});
