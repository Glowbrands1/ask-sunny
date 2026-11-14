import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { formTurnCitations } from "@/lib/ai/form-card-slots";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { readCaPolicy } from "./ca-policy";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * THE SAME CONDUCT ACCOUNT, CA OR COACHING (POLICY_CONDUCT_WORDING_ENABLED)
 * ============================================================================
 *
 * QA's live policy map, 26 Oct 2026 (name invented): "talking bad about
 * coworkers" gave Sexual and Other Forms of Harassment p.9 on a CA typed in
 * lowercase and We Speak Up p.7 on a coaching form; "didn't complete policy
 * acknowledgements in woven during onboarding" gave Orientation p.33. Both are
 * the Standards of Conduct p.12, on a Corrective Action card and on a
 * coaching card, in the managers' framings, whatever heading the model offers.
 * Run with the flags Ask Sunny production has on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);

/** The flags on in Ask Sunny production, 26 Oct 2026. */
const LIVE = [
  "ACTION_PLAN_MANAGER_ONLY_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "APP_PASSWORD_HELP_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "CHAT_STYLE_RULES_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
  "CURRENT_MANUAL_SCOPE_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "HYBRID_SEARCH_ENABLED",
  "INTENT_EXTRACTION_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "MANUAL_NEGATED_LIST_NOTE_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "PRIOR_COACHING_OPTIONAL_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "RETRIEVAL_RECALL_ENABLED",
  "SECOND_FORM_ENABLED",
  "SELF_CHECK_ENABLED",
  "SEND_AFTER_HYDRATE_ENABLED",
  "SENSITIVE_DEFAULTS_REDACT_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
] as const;

afterEach(() => vi.unstubAllEnvs());
// Flag-off pins hold whatever the environment has on; flag-on tests set it.
beforeEach(() => vi.stubEnv("POLICY_CONDUCT_WORDING_ENABLED", ""));

const ACCOUNTS = ["talking bad about coworkers", "didn't complete policy acknowledgements in woven during onboarding"];
const FRAMINGS = [
  (account: string) => `ca for devon harlan ${account}`,
  (account: string) => `coaching form for devon harlan ${account}`,
  (account: string) => `Create a corrective action for Devon Harlan, ${account}`,
  (account: string) => `Create a coaching form for Devon Harlan, ${account}`,
];
const TURNS = ACCOUNTS.flatMap((account) => FRAMINGS.map((frame) => frame(account))).flatMap((text) => [text, text.toUpperCase()]);
const MODEL_HEADINGS = [undefined, "Sexual and Other Forms of Harassment", "We Speak Up", "Orientation"];

function card(notes: string, modelHeading?: string) {
  return formTurnCitations({ notes, chunks: CHUNKS, documentId: "manual", documentTitle: "JBA Policy Manual", modelHeading }).map(
    (citation) => citation.locator,
  );
}

describe("live flags + POLICY_CONDUCT_WORDING_ENABLED", () => {
  const on = () => {
    for (const name of LIVE) vi.stubEnv(name, "true");
    vi.stubEnv("POLICY_CONDUCT_WORDING_ENABLED", "true");
  };

  it.each(TURNS)("%s reads as the Standards of Conduct p.12", (text) => {
    on();
    expect(readCaPolicy(text).suggestion).toBe("standards_of_conduct");
    expect(accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`)).toEqual(["Standards of Conduct p.12"]);
  });

  it.each(TURNS.flatMap((text) => MODEL_HEADINGS.map((heading) => [text, heading] as const)))(
    "%s: the card is p.12 whatever the model offers (%s)",
    (text, heading) => {
      on();
      expect(card(text, heading)).toEqual(["Page 12"]);
    },
  );

  it("flag off, with the live flags: no Standards of Conduct section on the card (the bug)", () => {
    for (const name of LIVE) vi.stubEnv(name, "true");
    expect(accountManualSections(TURNS[0]!, CHUNKS)).toEqual([]);
  });
});
