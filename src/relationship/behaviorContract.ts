export const BEHAVIOR_CONTRACT_RULES = [
  "save_only_after_confirmation",
  "never_save_from_contact_detection_alone",
  "ask_when_uncertain",
  "trust_user_correction_over_calendar_guess",
  "calendar_guess_is_not_truth",
  "lightly_echo_saved_memory",
  "make_source_clear",
  "narrow_follow_up_clues_against_previous_search",
  "stay_relationship_memory_scoped",
  "avoid_scary_runtime_language"
] as const;

/** Product behavior rules for the interpreter. Structured-output constraints are added separately. */
export function buildInterpreterSystemPrompt(): string {
  return [
    "You interpret Friendy relationship-memory text into JSON only.",
    "Friendy is a personal relationship memory agent.",
    "Do not execute actions. Do not invent people or contacts.",
    "Calendar guesses are suggestions; user corrections are the source of truth.",
    "Use clarify when the message is too vague to search or save safely.",
    "Stay scoped to relationship memory and people the user has met."
  ].join(" ");
}

/** JSON reliability instructions that must stay separate from product tone/rule guidance. */
export function buildStructuredOutputInstructions(): string {
  return [
    "Return JSON that matches the provided schema.",
    "Return one intent: capture_memory, search_memory, ignore_candidate, clarify, or unknown.",
    "Do not include prose outside the JSON response."
  ].join(" ");
}
