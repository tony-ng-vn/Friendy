import { isListPeopleRecall } from "./listPeopleRecall";

export type HardSafetyDecision =
  | { decision: "allow"; reason: string }
  | { decision: "reject"; reason: string; redirect: string };

const ADVERSARIAL_REDIRECT =
  "I can't follow requests to ignore or override Friendy's instructions. Ask me about a specific person, contact, or relationship memory instead.";
const GENERAL_TASK_REDIRECT =
  "I am not the right tool for general tasks like that. I can help if it connects to someone you know or something you want to remember about them.";
const CODING_REDIRECT =
  "I cannot help with coding tasks. I can help you draft a reply to the person asking, or remember context about them.";

/** Narrow pre-router safety gate before structured interpretation runs. */
export function decideHardSafety(text: string): HardSafetyDecision {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();

  if (lower.length === 0) {
    return reject("empty_message", "What should I help you remember about someone?");
  }

  if (isAdversarialGeneralAssistantRequest(lower)) {
    return reject("adversarial_general_assistant_request", ADVERSARIAL_REDIRECT);
  }

  if (isCodingTask(lower) && !looksLikePeopleMemoryQuery(lower)) {
    return reject("coding_task", CODING_REDIRECT);
  }

  if (isMathTask(lower)) {
    return reject("math_task", GENERAL_TASK_REDIRECT);
  }

  if (isGeneralKnowledgeTask(lower) || isGenericAdviceTask(lower)) {
    return reject("general_assistant_task", GENERAL_TASK_REDIRECT);
  }

  return allow("passed_hard_safety");
}

function allow(reason: string): HardSafetyDecision {
  return { decision: "allow", reason };
}

function reject(reason: string, redirect: string): HardSafetyDecision {
  return { decision: "reject", reason, redirect };
}

function isAdversarialGeneralAssistantRequest(text: string): boolean {
  return /\b(ignore|forget|disregard)\b.*\b(instruction|previous|system|rules?)\b/.test(text);
}

function isCodingTask(text: string): boolean {
  return /\b(write|debug|fix|build|code|implement|generate)\b.*\b(sql|python|react|javascript|typescript|app|script|function|bug|code)\b/.test(
    text
  );
}

function isMathTask(text: string): boolean {
  return (
    /\b(calculate|solve|what is|what's)\b.*\d+\s*([*x×+\-/]|percent|%)\s*\d+/.test(text) ||
    /\d+\s*([*x×+\-/])\s*\d+/.test(text)
  );
}

function isGeneralKnowledgeTask(text: string): boolean {
  return /\b(explain|summarize|research|who is the president|what is quantum|quantum mechanics)\b/.test(text);
}

function isGenericAdviceTask(text: string): boolean {
  return /\b(how do i|how can i|tips for)\b.*\b(charismatic|make friends|be popular|people like me)\b/.test(text);
}

function looksLikePeopleMemoryQuery(text: string): boolean {
  return (
    isListPeopleRecall(text) ||
    /\b(who|where|when|what)\b.*\b(met|meet|know|relationship|remember|saved|contact|contacts|add|added)\b/.test(text) ||
    /\bdo i know\b/.test(text) ||
    /\b(duplicate|delete|remove|forget)\b.*\b(contact|person|people|memory|memories)\b/.test(text) ||
    /\bwhy\b.*\b(ask|asking|still)\b/.test(text) ||
    /\b(you already know|already have it)\b/.test(text) ||
    /\bwho\b.*\b(you|friendy)\b.*\b(ask|asking|mean)\b/.test(text) ||
    /\b(help|draft|write|compose)\b.*\btell\b\s+\w+/.test(text) ||
    /\btell\s+\w+\b.*\b(i can'?t|i cannot|sorry|thanks|thank you|follow up|follow-up)\b/.test(text)
  );
}
