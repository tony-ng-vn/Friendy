/**
 * Golden good/bad examples for expression tone review and eval fixtures.
 *
 * Pairs with `expressionPrompt.ts` system examples; `hasCasualToneHeuristic` is a soft check only.
 */
import {
  buildClarificationBundle,
  buildConversationRepairBundle,
  buildSaveConfirmationBundle,
  buildSearchAmbiguousMatchesBundle,
  buildSearchNoMatchBundle,
  buildSearchSingleMatchBundle,
  type ExpressionFactBundle
} from "./expressionFacts";

/** Fixture for manual or eval review of expression tone without calling the LLM. */
export type ExpressionGoldenCase = {
  id: string;
  draft: string;
  bundle: ExpressionFactBundle;
  goodExamples: string[];
  badExamples: string[];
};

/** Canonical good/bad pairs aligned with `buildExpressionSystemPrompt` examples. */
export const EXPRESSION_GOLDEN_CASES: ExpressionGoldenCase[] = [
  {
    id: "expression-save-confirmation-grounded",
    draft: "Got it, saved Maya Chen from Photon dinner. I'll remember she is building recruiting agents.",
    bundle: buildSaveConfirmationBundle({
      draft: "Got it, saved Maya Chen from Photon dinner. I'll remember she is building recruiting agents.",
      savedPeople: [
        {
          displayName: "Maya Chen",
          event: "Photon dinner",
          noteSnippet: "building recruiting agents"
        }
      ]
    }),
    goodExamples: ["Got it — I'll remember Maya Chen from Photon dinner, building recruiting agents."],
    badExamples: ["Memory object persisted for Maya Chen successfully."]
  },
  {
    id: "expression-search-single-grounded",
    draft:
      "I think that was Sarah Fan. You told me you met them at Photon Residency II, and the clue was community lead.",
    bundle: buildSearchSingleMatchBundle({
      draft:
        "I think that was Sarah Fan. You told me you met them at Photon Residency II, and the clue was community lead.",
      match: {
        displayName: "Sarah Fan",
        event: "Photon Residency II",
        noteSnippet: "community lead"
      }
    }),
    goodExamples: ["Yeah, I think that was Sarah Fan — Photon Residency II, community lead."],
    badExamples: ["High-confidence match located in your memory database."]
  },
  {
    id: "expression-search-ambiguous-no-pick",
    draft:
      "I found 2 possible matches: Maya Chen from Photon dinner; Maya Patel from Agents meetup. Which person do you mean?",
    bundle: buildSearchAmbiguousMatchesBundle({
      draft:
        "I found 2 possible matches: Maya Chen from Photon dinner; Maya Patel from Agents meetup. Which person do you mean?",
      matches: [
        { displayName: "Maya Chen", event: "Photon dinner" },
        { displayName: "Maya Patel", event: "Agents meetup" }
      ]
    }),
    goodExamples: ["Could be Maya Chen from Photon dinner or Maya Patel from the agents meetup — which one?"],
    badExamples: ["Definitely Maya Chen from Photon dinner."]
  },
  {
    id: "expression-search-no-match-clue",
    draft:
      "I don't have enough to confidently find them yet. Give me a name, event, date, project, school, or another clue.",
    bundle: buildSearchNoMatchBundle({
      draft:
        "I don't have enough to confidently find them yet. Give me a name, event, date, project, school, or another clue.",
      suggestedClueTypes: ["name", "event", "project", "school", "date"]
    }),
    goodExamples: ["Hmm, I don't have enough yet — toss me a name, event, project, school, or date."],
    badExamples: ["No database records matched your query."]
  },
  {
    id: "expression-clarification-question",
    draft: "What do you remember about them?",
    bundle: buildClarificationBundle({
      draft: "What do you remember about them?",
      questionIntent: "search_clue"
    }),
    goodExamples: ["What should I search for — name, event, project, school, or something like that?"],
    badExamples: ["Please provide additional structured input."]
  },
  {
    id: "expression-repair-no-invention",
    draft:
      "You're right — I shouldn't still be asking about Testing 3 the same way. You already saved context for that name.",
    bundle: buildConversationRepairBundle({
      draft:
        "You're right — I shouldn't still be asking about Testing 3 the same way. You already saved context for that name.",
      repairTopic: "stale_prompt"
    }),
    goodExamples: ["Yeah, fair — you've already got Testing 3 saved. I shouldn't be nagging you the same way."],
    badExamples: ["Your boyfriend Testing 3 is already saved in the repository."]
  }
];

const CASUAL_TEXTURE_PATTERN = /\b(yeah|hmm|oh wait|got it|don't|can't|won't|I'm|could|—)\b/i;

/** Soft heuristic for buddy-like texture in golden good examples. */
export function hasCasualToneHeuristic(text: string): boolean {
  return CASUAL_TEXTURE_PATTERN.test(text) || text.includes("—");
}
