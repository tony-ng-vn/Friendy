import { buildExpressionSystemPrompt, buildExpressionUserMessage } from "./expressionPrompt";
import { readExpressionConfig, type ExpressionConfig } from "./expressionConfig";
import type { ExpressionFactBundle } from "./expressionFacts";
import { validateExpressionReply } from "./expressionValidator";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const EXPRESSION_FETCH_TIMEOUT_MS = 8_000;

export type ExpressionComposerResult = {
  text: string;
  expressionUsed: boolean;
  validationPassed: boolean;
  fallbackReason?: "disabled" | "unsupported_kind" | "api_error" | "validation_failed";
  expressionModel?: string;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Calls the expression LLM to rewrite a deterministic draft, falling back on any failure. */
export async function composeExpressionReply(input: {
  draft: string;
  bundle: ExpressionFactBundle;
  config?: ExpressionConfig;
  fetchImpl?: FetchLike;
}): Promise<ExpressionComposerResult> {
  const config = input.config ?? readExpressionConfig();
  const draft = input.draft.trim();

  if (!config.enabled) {
    return { text: draft, expressionUsed: false, validationPassed: false, fallbackReason: "disabled" };
  }

  if (!draft) {
    return { text: draft, expressionUsed: false, validationPassed: false, fallbackReason: "unsupported_kind" };
  }

  if (!config.apiKey) {
    return { text: draft, expressionUsed: false, validationPassed: false, fallbackReason: "api_error" };
  }

  try {
    const response = await (input.fetchImpl ?? fetch)(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: buildExpressionSystemPrompt() },
          { role: "user", content: buildExpressionUserMessage({ draft, bundle: input.bundle }) }
        ],
        max_tokens: 120,
        temperature: 0.4
      }),
      signal: AbortSignal.timeout(EXPRESSION_FETCH_TIMEOUT_MS)
    });

    if (!response.ok) {
      return {
        text: draft,
        expressionUsed: true,
        validationPassed: false,
        fallbackReason: "api_error",
        expressionModel: config.model
      };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const output = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const validation = validateExpressionReply({ draft, bundle: input.bundle, output });

    if (!validation.ok) {
      return {
        text: draft,
        expressionUsed: true,
        validationPassed: false,
        fallbackReason: "validation_failed",
        expressionModel: config.model
      };
    }

    return {
      text: output,
      expressionUsed: true,
      validationPassed: true,
      expressionModel: config.model
    };
  } catch {
    return {
      text: draft,
      expressionUsed: true,
      validationPassed: false,
      fallbackReason: "api_error",
      expressionModel: config.model
    };
  }
}

/** Polishes outbound text when a fact bundle is available; otherwise returns the draft unchanged. */
export async function polishOutboundText(input: {
  draft: string;
  bundle?: ExpressionFactBundle;
  config?: ExpressionConfig;
  fetchImpl?: FetchLike;
}): Promise<ExpressionComposerResult> {
  if (!input.bundle) {
    return { text: input.draft, expressionUsed: false, validationPassed: false, fallbackReason: "unsupported_kind" };
  }

  return composeExpressionReply({
    draft: input.draft,
    bundle: input.bundle,
    config: input.config,
    fetchImpl: input.fetchImpl
  });
}
