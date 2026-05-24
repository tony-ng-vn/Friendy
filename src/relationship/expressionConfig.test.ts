import { describe, expect, it } from "vitest";
import { DEFAULT_OPENROUTER_MODEL } from "./openRouterInterpreter";
import { readExpressionConfig } from "./expressionConfig";

describe("readExpressionConfig", () => {
  it("defaults to disabled with safe limits", () => {
    const config = readExpressionConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxLength).toBe(280);
    expect(config.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(config.apiKey).toBe("");
  });

  it("enables when FRIENDY_EXPRESSION_LLM=1", () => {
    const config = readExpressionConfig({ FRIENDY_EXPRESSION_LLM: "1" });
    expect(config.enabled).toBe(true);
  });

  it("prefers FRIENDY_EXPRESSION_MODEL over OPENROUTER_MODEL", () => {
    const config = readExpressionConfig({
      FRIENDY_EXPRESSION_MODEL: "voice/model",
      OPENROUTER_MODEL: "router/model"
    });
    expect(config.model).toBe("voice/model");
  });

  it("parses custom max length", () => {
    const config = readExpressionConfig({ FRIENDY_EXPRESSION_MAX_LENGTH: "320" });
    expect(config.maxLength).toBe(320);
  });
});
