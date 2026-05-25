import { describe, expect, it } from "vitest";
import {
  extractFilteredPersonListCommand,
  extractNamedPersonFromListCommand,
  extractPersonFromDetailListCommand,
  isBroadPeopleInventoryRequest,
  isEventRecallQuestion
} from "./listPeopleRecall";

describe("extractNamedPersonFromListCommand", () => {
  it.each([
    ["List Nathan", "Nathan"],
    ["List Nathan Chen", "Nathan Chen"],
    ["Show me Kenneth", "Kenneth"],
    ["Tell me Julie", "Julie"]
  ])("extracts person from %s", (text, expected) => {
    expect(extractNamedPersonFromListCommand(text)).toBe(expected);
  });

  it.each(["List everyone", "List all people I know", "Show everyone I remember", "List all contacts"])(
    "returns undefined for broad inventory: %s",
    (text) => {
      expect(extractNamedPersonFromListCommand(text)).toBeUndefined();
      expect(isBroadPeopleInventoryRequest(text)).toBe(true);
    }
  );
});

describe("extractFilteredPersonListCommand", () => {
  it.each([
    ["Can you list me all the Daniel?", "Daniel"],
    ["List me all memory you have for Daniel", "Daniel"],
    ["list all the Daniels", "Daniels"],
    ["Can you list the 2 Daniel you are talking about?", "Daniel"],
    ["Show me everyone named Sarah Fan", "Sarah Fan"]
  ])("extracts filtered roster name from %s", (text, expected) => {
    expect(extractFilteredPersonListCommand(text)).toBe(expected);
  });

  it.each(["List everyone", "List all people I know", "Can you list me everyone I met"])(
    "returns undefined for broad inventory: %s",
    (text) => {
      expect(extractFilteredPersonListCommand(text)).toBeUndefined();
    }
  );
});

describe("extractPersonFromDetailListCommand", () => {
  it.each([
    ["List me detail about chị Bông", "chị Bông"],
    ["List detail about Nathan Chen", "Nathan Chen"],
    ["What do you know about Kenneth?", "Kenneth"]
  ])("extracts person from %s", (text, expected) => {
    expect(extractPersonFromDetailListCommand(text)).toBe(expected);
  });
});

describe("isEventRecallQuestion", () => {
  it.each([
    "What are the people I met during Photon Residency?",
    "What people did I meet during Photon Residency?",
    "Which contacts did I meet at AI dinner?"
  ])("detects event-scoped people recall: %s", (text) => {
    expect(isEventRecallQuestion(text)).toBe(true);
    expect(isBroadPeopleInventoryRequest(text)).toBe(false);
  });
});
