import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { formTurnCitations } from "@/lib/ai/form-card-slots";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { describedAttendanceKeys } from "./ca-policy";
import type { ManualChunk } from "./official-policy-manual";

/**
 * ============================================================================
 * TWO INCIDENTS, BOTH POLICIES, IN THE ORDER SAID (POLICY_TWO_INCIDENTS_ENABLED)
 * ============================================================================
 *
 * QA, 26 Oct 2026, in the manager's words (name invented): "ca for <name> not
 * opening salon on time and no call no show" cited Attendance only. Rule
 * (approved by QA): both policies, one card line each, in the order the
 * manager said them (Late Opening p.15, then Attendance p.14); boxes
 * Tardiness and Absenteeism; never a third.
 *
 * Run against the production manual rows, with no flags and with the flags
 * production has on (Vercel, 26 Oct 2026), so the pins hold either way.
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

const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);
const card = (text: string) =>
  formTurnCitations({ notes: text, chunks: CHUNKS, documentId: "manual", documentTitle: "JBA Policy Manual" }).map((citation) => citation.locator);

const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const registers = (text: string) => [text, lower(text), sentence(text), text.toUpperCase()];

const BOTH = "ca for marlo quint not opening salon on time and no call no show";
const BOTH_REVERSED = "ca for marlo quint no call no show and not opening salon on time";
/** Other ways managers say it. */
const ALSO_LATE_OPENING = [
  "ca for marlo quint didn't open the salon on time",
  "ca for marlo quint did not open on time",
  "ca for marlo quint failed to open the store",
];

describe.each([
  ["no other flags", [] as readonly string[]],
  ["the live flags", LIVE],
])("with %s", (_label, flags) => {
  const on = (two: boolean) => {
    for (const name of flags) vi.stubEnv(name, "true");
    if (two) vi.stubEnv("POLICY_TWO_INCIDENTS_ENABLED", "true");
  };

  it("flag off: Attendance only (the bug)", () => {
    on(false);
    expect(cited(BOTH)).toEqual(["Attendance p.14"]);
    expect(describedAttendanceKeys(BOTH)).toEqual(["absenteeism"]);
  });

  it.each(registers(BOTH))("flag on: %s -> Late Opening p.15, then Attendance p.14; Tardiness + Absenteeism", (text) => {
    on(true);
    expect(cited(text)).toEqual(["Late Opening p.15", "Attendance p.14"]);
    expect(card(text)).toEqual(["Page 15", "Page 14"]);
    expect(describedAttendanceKeys(text)).toEqual(["tardiness", "absenteeism"]);
  });

  it.each(registers(BOTH_REVERSED))("flag on: %s -> in the order said: Attendance, then Late Opening", (text) => {
    on(true);
    expect(cited(text)).toEqual(["Attendance p.14", "Late Opening p.15"]);
    expect(describedAttendanceKeys(text)).toEqual(["tardiness", "absenteeism"]);
  });

  it.each(ALSO_LATE_OPENING.flatMap(registers))("flag on: %s is a late opening", (text) => {
    on(true);
    expect(cited(text)[0]).toBe("Late Opening p.15");
    expect(describedAttendanceKeys(text)).toEqual(["tardiness"]);
  });

  describe("NEVER-BREAK, flag on", () => {
    it.each(registers("ca for marlo quint not opening salon on time"))("a late opening alone is one policy: %s", (text) => {
      on(true);
      const sections = cited(text);
      expect(sections[0]).toBe("Late Opening p.15");
      // Live, LATE_OPEN_DATE_ENABLED leaves Late Opening alone (confirmed live row).
      if (flags.length > 0) expect(sections).toEqual(["Late Opening p.15"]);
      expect(describedAttendanceKeys(text)).toEqual(["tardiness"]);
    });

    it.each([...registers("ca for marlo quint no call no show"), ...registers("Marlo Quint was 20 minutes late to her shift on 10-2-26")])(
      "a single attendance incident is Attendance only: %s",
      (text) => {
        on(true);
        expect(cited(text)).toEqual(["Attendance p.14"]);
      },
    );

    it("a late opening with the word late is unchanged", () => {
      on(true);
      const text = "Marlo Quint opened the salon late on 10-1-26";
      for (const typed of registers(text)) expect(cited(typed)[0]).toBe("Late Opening p.15");
    });

    it.each([
      "she was rude to a guest during her opening shift",
      "Marlo is our opener and she was rude to a guest",
      "she didn't open the email from her district manager",
      "she failed to open the new product boxes",
    ])(
      "an opener who was rude is not a late opening: %s",
      (text) => {
        on(true);
        expect(describedAttendanceKeys(text)).toBeNull();
        expect(cited(text)).not.toContain("Late Opening p.15");
      },
    );

    it("the second person of a pair keeps only their own policy", () => {
      on(true);
      // The second form's own account, after a first form about a late opening.
      expect(cited("ca for devon harlan no call no show on 10-4-26")).toEqual(["Attendance p.14"]);
    });

    it("never a third section", () => {
      on(true);
      for (const text of [BOTH, BOTH_REVERSED]) expect(cited(text)).toHaveLength(2);
    });
  });
});
