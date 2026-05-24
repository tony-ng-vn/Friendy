import { describe, expect, it } from "vitest";
import { normalizeSensorEventPayload } from "./normalizeSensorEvent";

describe("normalizeSensorEventPayload", () => {
  it("defaults empty phone and email labels to unknown", () => {
    const { payload, didNormalize } = normalizeSensorEventPayload({
      type: "contact_added",
      contact: {
        displayName: "Maya",
        phoneNumberHints: [{ last4: "4567", label: "" }],
        emailHints: [{ domain: "example.com", label: "" }]
      }
    });

    expect(didNormalize).toBe(true);
    expect(payload.contact).toMatchObject({
      phoneNumberHints: [{ last4: "4567", label: "unknown" }],
      emailHints: [{ domain: "example.com", label: "unknown" }]
    });
  });

  it("trims whitespace labels and defaults blank labels to unknown", () => {
    const { payload, didNormalize } = normalizeSensorEventPayload({
      type: "contact_added",
      contact: {
        displayName: "Maya",
        phoneNumberHints: [{ last4: "4567", label: "  mobile  " }, { last4: "8901", label: "   " }],
        emailHints: [{ domain: "example.com", label: "\t" }]
      }
    });

    expect(didNormalize).toBe(true);
    expect(payload.contact).toMatchObject({
      phoneNumberHints: [
        { last4: "4567", label: "mobile" },
        { last4: "8901", label: "unknown" }
      ],
      emailHints: [{ domain: "example.com", label: "unknown" }]
    });
  });

  it("leaves missing labels untouched", () => {
    const { payload, didNormalize } = normalizeSensorEventPayload({
      type: "contact_added",
      contact: {
        displayName: "Maya",
        phoneNumberHints: [{ last4: "4567" }],
        emailHints: [{ domain: "example.com" }]
      }
    });

    expect(didNormalize).toBe(false);
    expect(payload.contact).toMatchObject({
      phoneNumberHints: [{ last4: "4567" }],
      emailHints: [{ domain: "example.com" }]
    });
  });

  it("trims last4 and domain and omits empty values", () => {
    const { payload, didNormalize } = normalizeSensorEventPayload({
      type: "contact_added",
      contact: {
        displayName: "Maya",
        phoneNumberHints: [{ last4: " 4567 ", domain: " ", label: "mobile" }],
        emailHints: [{ domain: " example.com ", last4: "", label: "work" }]
      }
    });

    expect(didNormalize).toBe(true);
    expect(payload.contact).toMatchObject({
      phoneNumberHints: [{ last4: "4567", label: "mobile" }],
      emailHints: [{ domain: "example.com", label: "work" }]
    });
  });

  it("leaves valid hints unchanged", () => {
    const input = {
      type: "contact_added",
      contact: {
        displayName: "Maya",
        phoneNumberHints: [{ last4: "4567", label: "mobile" }],
        emailHints: [{ domain: "example.com", label: "work" }]
      }
    };

    const { payload, didNormalize } = normalizeSensorEventPayload(input);

    expect(didNormalize).toBe(false);
    expect(payload).toEqual(input);
  });

  it("does not mutate unrelated fields", () => {
    const input = {
      type: "ready",
      contactsPermissionStatus: "authorized",
      extra: { nested: true }
    };

    const { payload, didNormalize } = normalizeSensorEventPayload(input);

    expect(didNormalize).toBe(false);
    expect(payload).toEqual(input);
  });
});
