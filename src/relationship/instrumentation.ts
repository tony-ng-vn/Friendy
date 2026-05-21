import { SpanKind, SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { IntrospectionSpanProcessor } from "@introspection-sdk/introspection-node";
import type { InboundAgentMessage } from "./types";

const SERVICE_NAME = "friendy-relationship-agent";
export const RELATIONSHIP_AGENT_NAME = "Relationship Memory Agent";
const TRACER_NAME = "friendy.relationship";

let provider: BasicTracerProvider | undefined;
let setupAttempted = false;

export function setupRelationshipInstrumentation(): void {
  if (setupAttempted) {
    return;
  }

  setupAttempted = true;

  if (!process.env.INTROSPECTION_TOKEN) {
    return;
  }

  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    spanProcessors: [new IntrospectionSpanProcessor({ serviceName: SERVICE_NAME })]
  });
  trace.setGlobalTracerProvider(provider);
}

export function getRelationshipTracer() {
  setupRelationshipInstrumentation();
  return trace.getTracer(TRACER_NAME);
}

export function getConversationId(message: InboundAgentMessage): string {
  return message.spaceId || `${message.platform}:${message.userId}`;
}

export function inputMessages(message: InboundAgentMessage) {
  return [{ role: "user", parts: [{ type: "text", content: message.text }] }];
}

export function outputMessages(text: string) {
  return [{ role: "assistant", parts: [{ type: "text", content: text }], finish_reason: "stop" }];
}

export function recordSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : new Error(String(error)));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
}

export function shutdownRelationshipInstrumentation(): Promise<void> {
  return provider?.shutdown() ?? Promise.resolve();
}

export { SpanKind, SpanStatusCode };
