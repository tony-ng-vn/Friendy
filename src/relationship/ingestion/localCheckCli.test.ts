import { describe, expect, it } from "vitest";
import { assertLivePromptSharedRuntimeState } from "./localCheckCli";

describe("local check CLI live prompt setup", () => {
  it("requires shared sqlite runtime state before live prompt sending", () => {
    expect(() =>
      assertLivePromptSharedRuntimeState({
        FRIENDY_LOCAL_CHECK_SEND: "1",
        FRIENDY_LOCAL_CHECK_TO_PHONE: "+15550100000"
      })
    ).toThrow("FRIENDY_LOCAL_CHECK_SEND=1 requires FRIENDY_RUNTIME_STORE=sqlite");
  });

  it("requires a sqlite path before live prompt sending", () => {
    expect(() =>
      assertLivePromptSharedRuntimeState({
        FRIENDY_LOCAL_CHECK_SEND: "1",
        FRIENDY_RUNTIME_STORE: "sqlite",
        FRIENDY_LOCAL_CHECK_TO_PHONE: "+15550100000"
      })
    ).toThrow("FRIENDY_LOCAL_CHECK_SEND=1 requires FRIENDY_SQLITE_PATH");
  });

  it("accepts live prompt sending when shared sqlite runtime state is configured", () => {
    expect(() =>
      assertLivePromptSharedRuntimeState({
        FRIENDY_LOCAL_CHECK_SEND: "1",
        FRIENDY_RUNTIME_STORE: "sqlite",
        FRIENDY_SQLITE_PATH: ".friendy/friendy.sqlite",
        FRIENDY_LOCAL_CHECK_TO_PHONE: "+15550100000"
      })
    ).not.toThrow();
  });
});
