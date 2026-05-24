import { DEFAULT_OPENAI_MODEL, type ModelProvider } from "./openAIInterpreter";

/** Runtime knobs for the optional expression LLM (`FRIENDY_EXPRESSION_LLM=1`). */
export type ExpressionConfig = {
  enabled: boolean;
  provider: ModelProvider;
  model: string;
  maxLength: number;
  apiKey: string;
};

/** Reads expression LLM config from environment with safe defaults (disabled). */
export function readExpressionConfig(
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      | "FRIENDY_EXPRESSION_LLM"
      | "FRIENDY_EXPRESSION_MODEL"
      | "FRIENDY_EXPRESSION_MAX_LENGTH"
      | "OPENAI_API_KEY"
      | "OPENAI_MODEL"
    >
  > = process.env
): ExpressionConfig {
  const enabled = env.FRIENDY_EXPRESSION_LLM === "1" || env.FRIENDY_EXPRESSION_LLM === "true";
  const maxLength = Number.parseInt(env.FRIENDY_EXPRESSION_MAX_LENGTH ?? "280", 10);
  const provider: ModelProvider = "openai";

  return {
    enabled,
    provider,
    model: env.FRIENDY_EXPRESSION_MODEL || env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    maxLength: Number.isFinite(maxLength) ? maxLength : 280,
    apiKey: env.OPENAI_API_KEY ?? ""
  };
}
