import { describe, expect, it } from "vitest";
import { DEFAULT_OPENAI_MODEL } from "./openAIInterpreter";
import { readExpressionConfig } from "./expressionConfig";

describe("readExpressionConfig", () => {
  it("defaults to disabled with safe limits", () => {
    const config = readExpressionConfig({});
    expect(config.enabled).toBe(false);
    expect(config.maxLength).toBe(280);
    expect(config.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(config.apiKey).toBe("");
    expect(config.provider).toBe("openai");
  });

  it("enables when FRIENDY_EXPRESSION_LLM=1", () => {
    const config = readExpressionConfig({ FRIENDY_EXPRESSION_LLM: "1" });
    expect(config.enabled).toBe(true);
  });

  it("prefers FRIENDY_EXPRESSION_MODEL over OPENAI_MODEL", () => {
    const config = readExpressionConfig({
      FRIENDY_EXPRESSION_MODEL: "voice/model",
      OPENAI_MODEL: "gpt-4.1-mini"
    });
    expect(config.model).toBe("voice/model");
  });

  it("uses OpenAI expression config when OPENAI_API_KEY is set", () => {
    const config = readExpressionConfig({
      OPENAI_API_KEY: "openai-key"
    });

    expect(config.apiKey).toBe("openai-key");
    expect(config.model).toBe(DEFAULT_OPENAI_MODEL);
    expect(config.provider).toBe("openai");
  });

  it("parses custom max length", () => {
    const config = readExpressionConfig({ FRIENDY_EXPRESSION_MAX_LENGTH: "320" });
    expect(config.maxLength).toBe(320);
  });
});
