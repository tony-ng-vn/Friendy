import { describe, expect, it } from "vitest";
import { parseDuplicateResolutionReply } from "./duplicateResolution";

describe("duplicate resolution parsing", () => {
  it("parses same-person replies", () => {
    expect(parseDuplicateResolutionReply("same")).toBe("same");
    expect(parseDuplicateResolutionReply("same person")).toBe("same");
    expect(parseDuplicateResolutionReply("yes same")).toBe("same");
    expect(parseDuplicateResolutionReply("yes, same person")).toBe("same");
    expect(parseDuplicateResolutionReply("it's the same person")).toBe("same");
  });

  it("parses different-person replies", () => {
    expect(parseDuplicateResolutionReply("different")).toBe("different");
    expect(parseDuplicateResolutionReply("different person")).toBe("different");
    expect(parseDuplicateResolutionReply("no different")).toBe("different");
    expect(parseDuplicateResolutionReply("no, different person")).toBe("different");
    expect(parseDuplicateResolutionReply("someone new")).toBe("different");
  });

  it("parses ignore replies", () => {
    expect(parseDuplicateResolutionReply("ignore")).toBe("ignore");
    expect(parseDuplicateResolutionReply("skip")).toBe("ignore");
    expect(parseDuplicateResolutionReply("no thanks")).toBe("ignore");
  });

  it("parses not-sure replies", () => {
    expect(parseDuplicateResolutionReply("not sure")).toBe("not_sure");
    expect(parseDuplicateResolutionReply("unsure")).toBe("not_sure");
    expect(parseDuplicateResolutionReply("idk")).toBe("not_sure");
    expect(parseDuplicateResolutionReply("i don't know")).toBe("not_sure");
  });

  it("returns undefined for unrelated confirmation text", () => {
    expect(parseDuplicateResolutionReply("yes, AI infra founder")).toBeUndefined();
    expect(parseDuplicateResolutionReply("Who did I meet at Photon?")).toBeUndefined();
  });
});
