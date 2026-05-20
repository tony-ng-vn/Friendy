import { buildSearchQueryFromInterpretation, type MessageInterpretation } from "./interpretation";
import type { MessageInterpreter } from "./openRouterInterpreter";
import type { RelationshipRepository } from "./repository";
import type { MemorySearchResult, createRelationshipTools } from "./tools";
import type { AgentCoreResult, AgentInteraction, AgentToolCall, InboundAgentMessage } from "./types";

type RelationshipTools = ReturnType<typeof createRelationshipTools>;

type InterpretedRelationshipAgentOptions = {
  repo: RelationshipRepository;
  tools: RelationshipTools;
  interpreter: MessageInterpreter;
  now?: () => string;
};

type InterpretedAgentResult = AgentCoreResult & {
  interaction: AgentInteraction;
};

/**
 * Creates the LLM-interpreted relationship agent.
 *
 * The interpreter can classify messy text, but deterministic tools remain the only layer that
 * creates, ignores, or searches memories. This keeps model mistakes observable and reversible.
 */
export function createInterpretedRelationshipAgent({
  repo,
  tools,
  interpreter,
  now = () => new Date().toISOString()
}: InterpretedRelationshipAgentOptions) {
  return {
    async handleMessage(message: InboundAgentMessage): Promise<InterpretedAgentResult> {
      const startedAt = Date.now();
      const interpreted = await interpreter.interpret(message);
      const interpretation = interpreted.interpretation;
      const toolCalls: AgentToolCall[] = [];
      const outboundText = executeInterpretation(message, interpretation, tools, toolCalls);

      const interaction = repo.addInteraction({
        id: `interaction_${now().replace(/[^0-9a-z]/gi, "")}_${repo.listInteractions().length + 1}`,
        userId: message.userId,
        platform: message.platform,
        spaceId: message.spaceId,
        inboundText: message.text,
        interpretedIntentJson: interpretation,
        outboundText,
        toolCalls,
        modelUsed: interpreted.modelUsed,
        confidence: interpretation.confidence,
        latencyMs: Date.now() - startedAt,
        error: interpreted.error,
        createdAt: now()
      });

      return {
        outbound: {
          userId: message.userId,
          platform: message.platform,
          spaceId: message.spaceId,
          text: outboundText
        },
        toolCalls,
        interaction
      };
    }
  };
}

function executeInterpretation(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  if (interpretation.needsClarification || interpretation.intent === "clarify") {
    return interpretation.clarificationQuestion || "What do you remember about them?";
  }

  if (interpretation.intent === "capture_memory") {
    return captureMemories(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "search_memory") {
    return searchMemories(message, interpretation, tools, toolCalls);
  }

  if (interpretation.intent === "ignore_candidate") {
    return ignorePendingCandidate(message, tools, toolCalls);
  }

  return "I need a name, event, date, or context before I can save or search that.";
}

function captureMemories(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  const memories = interpretation.people.map((person) => {
    const note = buildMemoryNote(interpretation, person);
    toolCalls.push("create_manual_memory");
    return tools.create_manual_memory(message.userId, person.name, note, "manual contact");
  });

  if (memories.length === 1) {
    const memory = memories[0];
    return `Saved. I'll remember ${memory.displayName} as "${memory.contextNote}".`;
  }

  return `Saved ${memories.length} people: ${memories.map((memory) => memory.displayName).join(", ")}.`;
}

function searchMemories(
  message: InboundAgentMessage,
  interpretation: MessageInterpretation,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("search_memories");
  const query = buildSearchQueryFromInterpretation(interpretation) || message.text;
  const matches = tools.search_memories(message.userId, query);

  if (matches.length === 0) {
    return "I do not have a confident match yet. Give me a name, event, date, or context you remember.";
  }

  if (matches.length > 1) {
    return `I found ${matches.length} likely matches: ${matches.map(summarizeMatch).join("; ")}.`;
  }

  const top = matches[0];
  return `Likely ${top.memory.displayName}. ${top.reason} Contact: ${top.memory.primaryContactLabel}.`;
}

function ignorePendingCandidate(
  message: InboundAgentMessage,
  tools: RelationshipTools,
  toolCalls: AgentToolCall[]
): string {
  toolCalls.push("list_pending_candidates");
  const candidate = tools.list_pending_candidates(message.userId)[0];

  if (!candidate) {
    return "I do not see a pending contact to ignore.";
  }

  toolCalls.push("ignore_candidate");
  tools.ignore_candidate(message.userId, candidate.id);
  return `Ignored ${candidate.displayName}.`;
}

function summarizeMatch(match: MemorySearchResult): string {
  return `${match.memory.displayName} (${match.reason} Contact: ${match.memory.primaryContactLabel})`;
}

function buildMemoryNote(
  interpretation: MessageInterpretation,
  person: MessageInterpretation["people"][number]
): string {
  const details = [
    interpretation.event.name ? `event: ${interpretation.event.name}` : "",
    interpretation.contextNote,
    person.aliases.length > 0 ? `alias: ${person.aliases.join(", ")}` : "",
    person.companyOrSchool ? `school/company: ${person.companyOrSchool}` : "",
    person.classYear ? `class year: ${person.classYear}` : "",
    person.project ? `project: ${person.project}` : "",
    person.role ? `role: ${person.role}` : ""
  ];

  return details.map((detail) => detail.trim()).filter(Boolean).join(" | ");
}
