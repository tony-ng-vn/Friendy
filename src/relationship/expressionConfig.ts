import { DEFAULT_OPENROUTER_MODEL } from "./openRouterInterpreter";

export type ExpressionConfig = {
  enabled: boolean;
  model: string;
  maxLength: number;
  apiKey: string;
};

/** Reads expression LLM config from environment with safe defaults (disabled). */
export function readExpressionConfig(
  env: Partial<
    Pick<
      NodeJS.ProcessEnv,
      "FRIENDY_EXPRESSION_LLM" | "FRIENDY_EXPRESSION_MODEL" | "FRIENDY_EXPRESSION_MAX_LENGTH" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL"
    >
  > = process.env
): ExpressionConfig {
  const enabled = env.FRIENDY_EXPRESSION_LLM === "1" || env.FRIENDY_EXPRESSION_LLM === "true";
  const maxLength = Number.parseInt(env.FRIENDY_EXPRESSION_MAX_LENGTH ?? "280", 10);

  return {
    enabled,
    model: env.FRIENDY_EXPRESSION_MODEL || env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
    maxLength: Number.isFinite(maxLength) ? maxLength : 280,
    apiKey: env.OPENROUTER_API_KEY ?? ""
  };
}
