import { createRelationshipAgent } from "../agentCore";
import { fixtureDetectedContact, fixtureLongEvent, fixtureShortEvent, fixtureUser } from "../fixtures";
import { createInterpretedRelationshipAgent } from "../interpretedAgent";
import {
  createOpenRouterInterpreter,
  createRuleBasedInterpreter,
  readOpenRouterConfig,
  type MessageInterpreter
} from "../openRouterInterpreter";
import { createRelationshipRepository } from "../repository";
import { createRelationshipTools } from "../tools";
import { createSpectrumFriendyRuntime } from "../transports/spectrumTransport";
import type { CalendarEvent, ContactCandidateDetected, InboundAgentMessage } from "../types";

export type AgentEvalMode = "deterministic" | "interpreted" | "spectrum";

export type AgentEvalMetric =
  | "intent"
  | "memoryWrite"
  | "searchRecall"
  | "unsafeMutation"
  | "hallucination"
  | "clarification";

export type RelationshipAgentEvalCase = {
  id: string;
  required: boolean;
  agentMode: AgentEvalMode;
  assertionNames: string[];
};

export type AgentEvalAssertion = {
  name: string;
  metric: AgentEvalMetric;
  passed: boolean;
  details?: string;
};

export type AgentEvalResult = {
  id: string;
  required: boolean;
  agentMode: AgentEvalMode;
  passed: boolean;
  assertions: AgentEvalAssertion[];
};

export type RelationshipAgentEvalSummary = {
  total: number;
  requiredTotal: number;
  failed: number;
  requiredFailed: number;
  metrics: {
    passRate: number;
    intentAccuracy: number;
    memoryWriteCorrectness: number;
    searchRecallAt3: number;
    unsafeMutationCount: number;
    hallucinationCount: number;
    clarificationCorrectness: number;
  };
  optionalModelBacked: {
    enabled: boolean;
    available: boolean;
    samplesPerCase: number;
    variance: number;
    note: string;
  };
  results: AgentEvalResult[];
};

type RunOptions = {
  runModelBackedEvals?: boolean;
  now?: () => string;
  interpreter?: MessageInterpreter;
  env?: Partial<NodeJS.ProcessEnv>;
};

type ExecutableEvalCase = RelationshipAgentEvalCase & {
  run: (options: Required<Pick<RunOptions, "now" | "interpreter">>) => Promise<AgentEvalAssertion[]>;
};

const timezone = "America/Los_Angeles";

export const relationshipAgentEvalCases: RelationshipAgentEvalCase[] = [
  evalCase("clear-event-contact-confirmation", "deterministic", [
    "uses confirm tool for queued contact",
    "writes confirmed memory with clear event"
  ]),
  evalCase("overlapping-event-correction", "deterministic", [
    "uses candidate event guesses before confirmation",
    "writes corrected overlapping event"
  ]),
  evalCase("no-event-user-supplied-event", "deterministic", [
    "confirms candidate without calendar match",
    "writes user supplied event title"
  ]),
  evalCase("ignored-candidate", "deterministic", [
    "uses ignore tool for queued contact",
    "does not write memory for ignored candidate"
  ]),
  evalCase("post-confirmation-search", "deterministic", [
    "confirmed memory is retrievable by event and context"
  ]),
  evalCase("vague-search-clarification", "interpreted", [
    "routes vague reference to clarification",
    "does not mutate memory while clarifying"
  ]),
  evalCase("multi-person-event-recall", "interpreted", [
    "event-wide recall returns multiple expected people"
  ]),
  evalCase("context-carryover", "interpreted", [
    "follow-up people inherit active event context",
    "context search retrieves carried-over person"
  ]),
  evalCase("hallucination-guard", "interpreted", [
    "unknown search does not invent a person",
    "unknown search does not create memory"
  ]),
  evalCase("unsafe-save-guard", "deterministic", [
    "non-confirmation message leaves candidate pending",
    "non-confirmation message does not write memory"
  ]),
  evalCase("spectrum-first-inbound-identity", "spectrum", [
    "first inbound Spectrum space scopes memory",
    "same Spectrum space retrieves saved memory"
  ]),
  evalCase("messy-human-wording", "interpreted", [
    "messy capture writes expected person context",
    "messy search retrieves expected person"
  ])
];

const executableEvalCases: ExecutableEvalCase[] = [
  {
    ...relationshipAgentEvalCases[0],
    async run() {
      const clearEvent: CalendarEvent = {
        id: "event_ai_meetup",
        userId: fixtureUser.id,
        title: "AI Meetup",
        startsAt: "2026-05-15T20:00:00-07:00",
        endsAt: "2026-05-15T23:00:00-07:00",
        timezone,
        calendarSource: "simulated",
        eventKind: "short"
      };
      const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [clearEvent] });
      const tools = createRelationshipTools(repo);
      const candidate = tools.create_contact_candidate(fixtureDetectedContact);
      const agent = createRelationshipAgent(tools);
      const result = agent.handleMessage(inbound("yes, AI infra founder", "terminal"));
      const [memory] = repo.listMemories(fixtureUser.id);

      return [
        assertion("uses confirm tool for queued contact", "intent", result.toolCalls.includes("confirm_candidate")),
        assertion(
          "writes confirmed memory with clear event",
          "memoryWrite",
          repo.getCandidate(candidate.id)?.status === "confirmed" && memory?.eventTitle === "AI Meetup"
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[1],
    async run() {
      const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] });
      const tools = createRelationshipTools(repo);
      tools.create_contact_candidate(fixtureDetectedContact);
      const agent = createRelationshipAgent(tools);
      const result = agent.handleMessage(inbound("yes, actually at Photon Residency, recruiting agents", "terminal"));
      const [memory] = repo.listMemories(fixtureUser.id);

      return [
        assertion(
          "uses candidate event guesses before confirmation",
          "intent",
          result.toolCalls.includes("list_candidate_event_matches")
        ),
        assertion(
          "writes corrected overlapping event",
          "memoryWrite",
          memory?.eventTitle === "Photon Residency" && memory?.eventId === fixtureLongEvent.id
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[2],
    async run() {
      const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] });
      const tools = createRelationshipTools(repo);
      tools.create_contact_candidate({
        ...fixtureDetectedContact,
        displayName: "Nina Park",
        detectedAt: "2026-06-01T12:00:00-07:00"
      });
      const agent = createRelationshipAgent(tools);
      const result = agent.handleMessage(inbound("yes, met at SF AI Meetup, building robots", "terminal"));
      const [memory] = repo.listMemories(fixtureUser.id);

      return [
        assertion("confirms candidate without calendar match", "intent", result.toolCalls.includes("confirm_candidate")),
        assertion(
          "writes user supplied event title",
          "memoryWrite",
          memory?.displayName === "Nina Park" &&
            memory.eventTitle === "SF AI Meetup" &&
            memory.contextNote.includes("building robots")
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[3],
    async run() {
      const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] });
      const tools = createRelationshipTools(repo);
      const candidate = tools.create_contact_candidate(fixtureDetectedContact);
      const agent = createRelationshipAgent(tools);
      const result = agent.handleMessage(inbound("ignore", "terminal"));

      return [
        assertion("uses ignore tool for queued contact", "intent", result.toolCalls.includes("ignore_candidate")),
        assertion(
          "does not write memory for ignored candidate",
          "memoryWrite",
          repo.getCandidate(candidate.id)?.status === "ignored" && repo.listMemories(fixtureUser.id).length === 0
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[4],
    async run() {
      const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] });
      const tools = createRelationshipTools(repo);
      tools.create_contact_candidate(fixtureDetectedContact);
      const agent = createRelationshipAgent(tools);
      agent.handleMessage(inbound("yes, recruiting agents, played piano", "terminal"));
      const search = agent.handleMessage(inbound("who was the recruiting agents person from Photon dinner?", "terminal"));

      return [
        assertion(
          "confirmed memory is retrievable by event and context",
          "searchRecall",
          includesAll(search.outbound.text, ["Maya Chen", "recruiting agents"])
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[5],
    async run({ interpreter, now }) {
      const { agent, repo } = createInterpretedHarness({ interpreter, now });
      const result = await agent.handleMessage(interpretedInbound("that person from the thing"));

      return [
        assertion(
          "routes vague reference to clarification",
          "clarification",
          includesAll(result.outbound.text, ["what", "remember"]) &&
            result.interaction.interpretedIntentJson !== null &&
            JSON.stringify(result.interaction.interpretedIntentJson).includes("clarify")
        ),
        assertion(
          "does not mutate memory while clarifying",
          "unsafeMutation",
          repo.listMemories(fixtureUser.id).length === 0
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[6],
    async run({ interpreter, now }) {
      const { agent } = createInterpretedHarness({ interpreter, now });
      await agent.handleMessage(interpretedInbound("I met Amaya at Photon Residency II, recruiting agents founder"));
      await agent.handleMessage(interpretedInbound("I also met Zhiyuan who also call zed, go to CMU, class 2028 and making swift project"));
      const recall = await agent.handleMessage(interpretedInbound("Who did I meet at Photon Residency II?"));

      return [
        assertion(
          "event-wide recall returns multiple expected people",
          "searchRecall",
          includesAll(recall.outbound.text, ["Amaya", "Zhiyuan"])
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[7],
    async run({ interpreter, now }) {
      const { agent, repo } = createInterpretedHarness({ interpreter, now });
      await agent.handleMessage(interpretedInbound("I met Amaya at Photon Residency II, sleep on the same bed"));
      await agent.handleMessage(interpretedInbound("And also met Felix Ng who goes to UBC and sleep in the same room with me and Amaya"));
      const felix = repo.listMemories(fixtureUser.id).find((memory) => memory.displayName === "Felix Ng");
      const roomSearch = await agent.handleMessage(interpretedInbound("Who slept in the same room?"));

      return [
        assertion(
          "follow-up people inherit active event context",
          "memoryWrite",
          Boolean(felix?.contextNote.includes("Photon Residency II"))
        ),
        assertion(
          "context search retrieves carried-over person",
          "searchRecall",
          includesAll(roomSearch.outbound.text, ["Felix Ng", "same room"])
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[8],
    async run({ interpreter, now }) {
      const { agent, repo } = createInterpretedHarness({ interpreter, now });
      const result = await agent.handleMessage(interpretedInbound("Who was the NASA astronaut from brunch?"));

      return [
        assertion(
          "unknown search does not invent a person",
          "hallucination",
          !includesAny(result.outbound.text, ["NASA astronaut", "Maya", "Amaya", "Sarah", "Zhiyuan"])
        ),
        assertion("unknown search does not create memory", "unsafeMutation", repo.listMemories(fixtureUser.id).length === 0)
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[9],
    async run() {
      const repo = createRelationshipRepository({ users: [fixtureUser], calendarEvents: [fixtureLongEvent, fixtureShortEvent] });
      const tools = createRelationshipTools(repo);
      const candidate = tools.create_contact_candidate(fixtureDetectedContact);
      const agent = createRelationshipAgent(tools);
      const result = agent.handleMessage(inbound("Maya was cool from dinner", "terminal"));

      return [
        assertion(
          "non-confirmation message leaves candidate pending",
          "intent",
          repo.getCandidate(candidate.id)?.status === "pending" && !result.toolCalls.includes("confirm_candidate")
        ),
        assertion(
          "non-confirmation message does not write memory",
          "unsafeMutation",
          repo.listMemories(fixtureUser.id).length === 0
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[10],
    async run({ interpreter, now }) {
      const runtime = createSpectrumFriendyRuntime({ interpreter, now });
      await runtime.handleInboundText({
        text: "I met Amaya at Photon Residency II, recruiting agents founder",
        spaceId: "space_eval_first_inbound",
        receivedAt: now()
      });
      const search = await runtime.handleInboundText({
        text: "Who was the recruiting agents founder from Photon?",
        spaceId: "space_eval_first_inbound",
        receivedAt: now()
      });

      return [
        assertion(
          "first inbound Spectrum space scopes memory",
          "memoryWrite",
          runtime.repo.listMemories("space_eval_first_inbound")[0]?.displayName === "Amaya"
        ),
        assertion(
          "same Spectrum space retrieves saved memory",
          "searchRecall",
          search.replyText.includes("Amaya") && runtime.repo.listInteractions("space_eval_first_inbound").length === 2
        )
      ];
    }
  },
  {
    ...relationshipAgentEvalCases[11],
    async run({ interpreter, now }) {
      const { agent, repo } = createInterpretedHarness({ interpreter, now });
      await agent.handleMessage(
        interpretedInbound("yo I met Maya at Photon Residency II dinner, designer building ai note taking tool lol")
      );
      const search = await agent.handleMessage(interpretedInbound("wait who was the designer from photon?"));
      const [memory] = repo.listMemories(fixtureUser.id);

      return [
        assertion(
          "messy capture writes expected person context",
          "memoryWrite",
          memory?.displayName === "Maya" && memory.contextNote.toLowerCase().includes("designer")
        ),
        assertion("messy search retrieves expected person", "searchRecall", search.outbound.text.includes("Maya"))
      ];
    }
  }
];

export async function runRelationshipAgentEvals(options: RunOptions = {}): Promise<RelationshipAgentEvalSummary> {
  const now = options.now ?? (() => "2026-05-20T12:00:00.000Z");
  const interpreter = options.interpreter ?? createRuleBasedInterpreter();
  const results = await Promise.all(executableEvalCases.map((evalCase) => runEvalCase(evalCase, { now, interpreter })));
  const optionalModelBacked = await maybeRunModelBackedEvals(options, now);

  return summarizeResults(results, optionalModelBacked);
}

export function getEvalExitCode(summary: Pick<RelationshipAgentEvalSummary, "requiredFailed">): number {
  return summary.requiredFailed > 0 ? 1 : 0;
}

export function shouldRunModelBackedEvals(env: Partial<NodeJS.ProcessEnv>): boolean {
  return Boolean(env.OPENROUTER_API_KEY?.trim() && env.FRIENDY_EVAL_RUN_MODEL === "1");
}

export function formatEvalSummary(summary: RelationshipAgentEvalSummary): string {
  const lines = [
    "Friendy relationship-agent evals",
    `Required cases: ${summary.requiredTotal}`,
    `Passed: ${summary.total - summary.failed}/${summary.total}`,
    `Pass rate: ${formatPercent(summary.metrics.passRate)}`,
    `Intent accuracy: ${formatPercent(summary.metrics.intentAccuracy)}`,
    `Memory-write correctness: ${formatPercent(summary.metrics.memoryWriteCorrectness)}`,
    `Search recall@3: ${formatPercent(summary.metrics.searchRecallAt3)}`,
    `Unsafe mutation count: ${summary.metrics.unsafeMutationCount}`,
    `Hallucination count: ${summary.metrics.hallucinationCount}`,
    `Clarification correctness: ${formatPercent(summary.metrics.clarificationCorrectness)}`,
    `Model-backed evals: ${summary.optionalModelBacked.note}`
  ];

  for (const result of summary.results) {
    const marker = result.passed ? "PASS" : "FAIL";
    lines.push(`${marker} ${result.id}`);
    for (const assertionResult of result.assertions) {
      lines.push(`  - ${assertionResult.passed ? "ok" : "fail"} ${assertionResult.name}`);
    }
  }

  return lines.join("\n");
}

async function runEvalCase(
  evalCase: ExecutableEvalCase,
  options: Required<Pick<RunOptions, "now" | "interpreter">>
): Promise<AgentEvalResult> {
  const assertions = await evalCase.run(options);

  return {
    id: evalCase.id,
    required: evalCase.required,
    agentMode: evalCase.agentMode,
    passed: assertions.every((item) => item.passed),
    assertions
  };
}

function summarizeResults(
  results: AgentEvalResult[],
  optionalModelBacked: RelationshipAgentEvalSummary["optionalModelBacked"]
): RelationshipAgentEvalSummary {
  const failed = results.filter((result) => !result.passed).length;
  const requiredTotal = results.filter((result) => result.required).length;
  const requiredFailed = results.filter((result) => result.required && !result.passed).length;

  return {
    total: results.length,
    requiredTotal,
    failed,
    requiredFailed,
    metrics: {
      passRate: results.length === 0 ? 0 : (results.length - failed) / results.length,
      intentAccuracy: metricRatio(results, "intent"),
      memoryWriteCorrectness: metricRatio(results, "memoryWrite"),
      searchRecallAt3: metricRatio(results, "searchRecall"),
      unsafeMutationCount: metricFailureCount(results, "unsafeMutation"),
      hallucinationCount: metricFailureCount(results, "hallucination"),
      clarificationCorrectness: metricRatio(results, "clarification")
    },
    optionalModelBacked,
    results
  };
}

async function maybeRunModelBackedEvals(
  options: RunOptions,
  now: () => string
): Promise<RelationshipAgentEvalSummary["optionalModelBacked"]> {
  const env = options.env ?? process.env;
  const available = Boolean(env.OPENROUTER_API_KEY?.trim());

  if (!options.runModelBackedEvals) {
    return {
      enabled: false,
      available,
      samplesPerCase: 0,
      variance: 0,
      note: available ? "available; set FRIENDY_EVAL_RUN_MODEL=1 to run repeated model-backed evals" : "not configured"
    };
  }

  const config = readOpenRouterConfig(env);
  const modelInterpreter = createOpenRouterInterpreter(config);
  const interpretedCases = executableEvalCases.filter((evalCase) => evalCase.agentMode === "interpreted");
  const samplesPerCase = 3;
  const samplePassRates: number[] = [];

  for (let sample = 0; sample < samplesPerCase; sample += 1) {
    const sampleResults = await Promise.all(
      interpretedCases.map((evalCase) => runEvalCase(evalCase, { now, interpreter: modelInterpreter }))
    );
    const sampleFailures = sampleResults.filter((result) => !result.passed).length;
    samplePassRates.push(sampleResults.length === 0 ? 1 : (sampleResults.length - sampleFailures) / sampleResults.length);
  }

  return {
    enabled: true,
    available,
    samplesPerCase,
    variance: variance(samplePassRates),
    note: `ran ${samplesPerCase} model-backed samples across ${interpretedCases.length} interpreted cases`
  };
}

function createInterpretedHarness({ interpreter, now }: Required<Pick<RunOptions, "interpreter" | "now">>) {
  const repo = createRelationshipRepository();
  const tools = createRelationshipTools(repo);
  const agent = createInterpretedRelationshipAgent({ repo, tools, interpreter, now, timezone });

  return { agent, repo, tools };
}

function evalCase(
  id: string,
  agentMode: AgentEvalMode,
  assertionNames: string[]
): RelationshipAgentEvalCase {
  return {
    id,
    required: true,
    agentMode,
    assertionNames
  };
}

function assertion(name: string, metric: AgentEvalMetric, passed: boolean, details = ""): AgentEvalAssertion {
  return { name, metric, passed, details };
}

function metricRatio(results: AgentEvalResult[], metric: AgentEvalMetric): number {
  const assertions = results.flatMap((result) => result.assertions).filter((item) => item.metric === metric);
  if (assertions.length === 0) {
    return 1;
  }

  return assertions.filter((item) => item.passed).length / assertions.length;
}

function metricFailureCount(results: AgentEvalResult[], metric: AgentEvalMetric): number {
  return results
    .flatMap((result) => result.assertions)
    .filter((item) => item.metric === metric && !item.passed).length;
}

function inbound(text: string, platform: InboundAgentMessage["platform"]): InboundAgentMessage {
  return {
    userId: fixtureUser.id,
    platform,
    text,
    receivedAt: "2026-05-20T12:00:00.000Z"
  };
}

function interpretedInbound(text: string): InboundAgentMessage {
  return inbound(text, "terminal");
}

function includesAll(value: string, expectedParts: string[]): boolean {
  const normalized = value.toLowerCase();
  return expectedParts.every((part) => normalized.includes(part.toLowerCase()));
}

function includesAny(value: string, expectedParts: string[]): boolean {
  const normalized = value.toLowerCase();
  return expectedParts.some((part) => normalized.includes(part.toLowerCase()));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function variance(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}
