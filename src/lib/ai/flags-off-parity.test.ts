import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  actionPlanManagerOnlyEnabled,
  actionPlanSentencesEnabled,
  chatMemoryEnabled,
  intentExtractionEnabled,
  draftDedupeEnabled,
  draftMergeEnabled,
  fewShotExamplesEnabled,
  fieldAccuracyEnabled,
  formStateEnabled,
  groundedEntitiesEnabled,
  policyCitationEnabled,
  reportBreakdownEnabled,
  secondFormEnabled,
  citationVerifyEnabled,
  conversationProposalDedupeEnabled,
  attendancePolicyCitationEnabled,
  currentManualScopeEnabled,
  modelRetryEnabled,
  promptCacheEnabled,
  policyPageRequiredEnabled,
  requiredFieldCheckEnabled,
  selfCheckEnabled,
  typedNameProceedsEnabled,
  unifiedAuthorityOrderEnabled,
  managerPayrollAmountOnlyEnabled,
  manualSectionDedupeEnabled,
  payrollAmountFieldEnabled,
  codeSlotsEnabled,
  globalSalonAskEnabled,
  manualTopicPinEnabled,
  fullManualContextEnabled,
  formFullRemapEnabled,
  warningLevelManagerOnlyEnabled,
  managerWordsOnlyEnabled,
  intentPayrollManagerOnlyEnabled,
  conversationDraftReuseEnabled,
  crossChatReplyGuardEnabled,
  draftActionsEnabled,
  lateOpenDateEnabled,
  caTemplateMapEnabled,
  formChoiceStatedEnabled,
  remapIncidentFixEnabled,
  placeSpanGuardEnabled,
  notANameGuardEnabled,
  exitIntakeFixEnabled,
  manualNegatedListNoteEnabled,
  policyGateNonblockingEnabled,
  printedPageCitationEnabled,
  slotRetentionEnabled,
  priorActionsParseEnabled,
  keepFormEmployeeEnabled,
  titleWholeWordEnabled,
  reformatKeepsSourcesEnabled,
  frameworkGeneralSectionsEnabled,
  newestPlaceTurnEnabled,
  questionNotFormEnabled,
  formEditDateRulesEnabled,
  followupNewTopicRetrievalEnabled,
  draftReuseSameChatOnlyEnabled,
  resignMethodFollowupEnabled,
  chatLongMessageEnabled,
  namedFormExactEnabled,
  terseSlotReadEnabled,
  remapDraftSourcesClientEnabled,
  remapDraftSourcesEnabled,
  reopenVerbGuardEnabled,
  formRevisionsEnabled,
  formRevisionsUiEnabled,
  sensitiveDefaultsRedactEnabled,
  appPasswordHelpEnabled,
  followUpNotPriorEnabled,
  stateCodeNotAPersonEnabled,
  googleReviewsInChatEnabled,
  draftNeverBlankEnabled,
  lateOpenPlaceEnabled,
} from "@/lib/config/chat-quality-flags";

import { augmentIntakeQuestion } from "./intake-augment";
import { flaggedCitationWrite } from "./policy-citation-fields";

/**
 * Flags off must match the path main already ships.
 *
 * New flags default off. The wrappers return the input they were given.
 * Pau's modules are untouched. The existing chat and form suites are run
 * in a child process with every new flag forced off; their expectations
 * are main's, and a failure here is a behavior change that leaked through.
 * The child is the `flags-off-parity` Vitest project, which starts only
 * after the unit project finishes, and it stays on `--project unit` so it
 * does not start another copy of itself. `--maxWorkers=2` keeps that
 * second copy from running about 188 files at once, which was pushing
 * two 5s tests just over their limit.
 */

const NEW_FLAGS = [
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "SECOND_FORM_ENABLED",
  "POLICY_CITATION_ENABLED",
  "CHAT_MEMORY_ENABLED",
  "REPORT_BREAKDOWN_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "FORM_STATE_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "INTENT_EXTRACTION_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SELF_CHECK_ENABLED",
  "PROMPT_CACHE_ENABLED",
  "MODEL_RETRY_ENABLED",
  "REQUIRED_FIELD_CHECK_ENABLED",
  "CONVERSATION_PROPOSAL_DEDUPE_ENABLED",
  "CITATION_VERIFY_ENABLED",
  "CURRENT_MANUAL_SCOPE_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "UNIFIED_AUTHORITY_ORDER_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "POLICY_GATE_NONBLOCKING_ENABLED",
  "NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "CODE_SLOTS_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "MANUAL_TOPIC_PIN_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
  "FORM_FULL_REMAP_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
  "CONVERSATION_DRAFT_REUSE_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
  "DRAFT_ACTIONS_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "REMAP_INCIDENT_FIX_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "MANUAL_NEGATED_LIST_NOTE_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "ACTION_PLAN_MANAGER_ONLY_ENABLED",
  "EXIT_INTAKE_FIX_ENABLED",
  "REFORMAT_KEEPS_SOURCES_ENABLED",
  "FRAMEWORK_GENERAL_SECTIONS_ENABLED",
  "NEWEST_PLACE_TURN_ENABLED",
  "QUESTION_NOT_FORM_ENABLED",
  "FORM_EDIT_DATE_RULES_ENABLED",
  "FOLLOWUP_NEW_TOPIC_RETRIEVAL_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "RESIGN_METHOD_FOLLOWUP_ENABLED",
  "CHAT_LONG_MESSAGE_ENABLED",
  "NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED",
  "NAMED_FORM_EXACT_ENABLED",
  "TERSE_SLOT_READ_ENABLED",
  "REMAP_DRAFT_SOURCES_ENABLED",
  "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "FORM_REVISIONS_ENABLED",
  "NEXT_PUBLIC_FORM_REVISIONS_ENABLED",
  "SENSITIVE_DEFAULTS_REDACT_ENABLED",
  "APP_PASSWORD_HELP_ENABLED",
  "FOLLOW_UP_NOT_PRIOR_ENABLED",
  "STATE_CODE_NOT_A_PERSON_ENABLED",
  "GOOGLE_REVIEWS_IN_CHAT_ENABLED",
  "DRAFT_NEVER_BLANK_ENABLED",
  "LATE_OPEN_PLACE_ENABLED",
] as const;

const PROTECTED = [
  "src/lib/ai/form-proposal.ts",
  "src/lib/ai/violation-policy.ts",
  "src/lib/ai/prior-coaching-optional.ts",
  "src/lib/ai/glossary.ts",
  "src/lib/ai/form-field-state.ts",
  "src/lib/ai/chat-data-plan.ts",
  "src/lib/forms/salon-mention.ts",
  "src/lib/forms/salon-text.ts",
  "src/lib/forms/location-scope.ts",
  "src/lib/forms/proposal.ts",
  "src/lib/forms/form-date-answer.ts",
  "src/lib/forms/payroll-deduct.ts",
  "src/lib/forms/ca-action-plan.ts",
  "src/lib/forms/required-closing.ts",
  "src/lib/forms/chat-revision.ts",
  "src/lib/forms/revision.ts",
  "src/lib/forms/policy-citation.ts",
  "src/lib/forms/instances.ts",
];

/*
 * The user (Pau) approved, via QA on 25 Oct 2026, editing
 * src/lib/forms/form-date-answer.ts to fix prior-action parsing behind
 * PRIOR_ACTIONS_PARSE_ENABLED, with the flag-off reading unchanged. It stays
 * on the PROTECTED list; only the diff check leaves it out. No other
 * protected file is excepted.
 */
const APPROVED_PROTECTED_EDITS = [":(exclude)src/lib/forms/form-date-answer.ts"];

const UI_PATHS = ["src/app/**/*.tsx", "src/components/**", "src/features/**/*.tsx", "**/*.css"];

/*
 * The user (Pau) approved, via QA on 25 Oct 2026, the forms list's Edit and
 * History mount for form revisions in both apps: exactly these two added
 * lines in monitoring-table.tsx, rendering nothing with
 * NEXT_PUBLIC_FORM_REVISIONS_ENABLED off. Any other change to the file fails.
 */
const MONITORING_TABLE = "src/features/forms/monitoring-table.tsx";
const MONITORING_MOUNT = [
  '+import { RegisterRowActions } from "@/form-revisions/register-row-actions";',
  "+                            <RegisterRowActions form={form} />",
];

function changedLines(patch: string): string[] {
  return patch.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line));
}

function diff(ref: string, args: string[]): string {
  return execFileSync("git", ["diff", ref, "--", ...args], { encoding: "utf8" });
}

function hasRef(ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * The Actions checkout is often a single commit, so `origin/main` is absent.
 * Use it when it is already there, fetch it when the remote can provide it,
 * otherwise diff against the merge-base with a local main. Null means this
 * checkout cannot see main at all, and only the UI diff is skipped.
 */
function uiDiffBase(): string | null {
  if (!hasRef("origin/main")) {
    try {
      execFileSync("git", ["fetch", "--depth=1", "origin", "main:refs/remotes/origin/main"], {
        stdio: "pipe",
        timeout: 20_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
    } catch {
      // The remote ref is unavailable. Fall through to a local main.
    }
  }
  if (hasRef("origin/main")) return "origin/main";
  if (!hasRef("main")) return null;
  try {
    const base = execFileSync("git", ["merge-base", "HEAD", "main"], { encoding: "utf8", stdio: "pipe" }).trim();
    return base || null;
  } catch {
    return null;
  }
}

describe("new flags default off and wrappers are inert", () => {
  it("treats unset flags as off and returns the caller's own values", () => {
    const previous = Object.fromEntries(NEW_FLAGS.map((name) => [name, process.env[name]]));
    for (const name of NEW_FLAGS) delete process.env[name];
    expect(slotRetentionEnabled()).toBe(false);
    expect(fieldAccuracyEnabled()).toBe(false);
    expect(draftDedupeEnabled()).toBe(false);
    expect(secondFormEnabled()).toBe(false);
    expect(policyCitationEnabled()).toBe(false);
    expect(chatMemoryEnabled()).toBe(false);
    expect(reportBreakdownEnabled()).toBe(false);
    expect(groundedEntitiesEnabled()).toBe(false);
    expect(formStateEnabled()).toBe(false);
    expect(draftMergeEnabled()).toBe(false);
    expect(actionPlanSentencesEnabled()).toBe(false);
    expect(intentExtractionEnabled()).toBe(false);
    expect(fewShotExamplesEnabled()).toBe(false);
    expect(selfCheckEnabled()).toBe(false);
    expect(promptCacheEnabled()).toBe(false);
    expect(modelRetryEnabled()).toBe(false);
    expect(requiredFieldCheckEnabled()).toBe(false);
    expect(conversationProposalDedupeEnabled()).toBe(false);
    expect(citationVerifyEnabled()).toBe(false);
    expect(currentManualScopeEnabled()).toBe(false);
    expect(typedNameProceedsEnabled()).toBe(false);
    expect(attendancePolicyCitationEnabled()).toBe(false);
    expect(policyPageRequiredEnabled()).toBe(false);
    expect(unifiedAuthorityOrderEnabled()).toBe(false);
    expect(managerPayrollAmountOnlyEnabled()).toBe(false);
    expect(policyGateNonblockingEnabled()).toBe(false);
    expect(manualSectionDedupeEnabled()).toBe(false);
    expect(printedPageCitationEnabled()).toBe(false);
    expect(payrollAmountFieldEnabled()).toBe(false);
    expect(codeSlotsEnabled()).toBe(false);
    expect(globalSalonAskEnabled()).toBe(false);
    expect(manualTopicPinEnabled()).toBe(false);
    expect(fullManualContextEnabled()).toBe(false);
    expect(formFullRemapEnabled()).toBe(false);
    expect(warningLevelManagerOnlyEnabled()).toBe(false);
    expect(managerWordsOnlyEnabled()).toBe(false);
    expect(intentPayrollManagerOnlyEnabled()).toBe(false);
    expect(conversationDraftReuseEnabled()).toBe(false);
    expect(crossChatReplyGuardEnabled()).toBe(false);
    expect(draftActionsEnabled()).toBe(false);
    expect(lateOpenDateEnabled()).toBe(false);
    expect(caTemplateMapEnabled()).toBe(false);
    expect(formChoiceStatedEnabled()).toBe(false);
    expect(remapIncidentFixEnabled()).toBe(false);
    expect(placeSpanGuardEnabled()).toBe(false);
    expect(priorActionsParseEnabled()).toBe(false);
    expect(notANameGuardEnabled()).toBe(false);
    expect(manualNegatedListNoteEnabled()).toBe(false);
    expect(keepFormEmployeeEnabled()).toBe(false);
    expect(titleWholeWordEnabled()).toBe(false);
    expect(actionPlanManagerOnlyEnabled()).toBe(false);
    expect(exitIntakeFixEnabled()).toBe(false);
    expect(reformatKeepsSourcesEnabled()).toBe(false);
    expect(frameworkGeneralSectionsEnabled()).toBe(false);
    expect(newestPlaceTurnEnabled()).toBe(false);
    expect(questionNotFormEnabled()).toBe(false);
    expect(formEditDateRulesEnabled()).toBe(false);
    expect(followupNewTopicRetrievalEnabled()).toBe(false);
    expect(draftReuseSameChatOnlyEnabled()).toBe(false);
    expect(resignMethodFollowupEnabled()).toBe(false);
    expect(chatLongMessageEnabled()).toBe(false);
    expect(namedFormExactEnabled()).toBe(false);
    expect(terseSlotReadEnabled()).toBe(false);
    expect(remapDraftSourcesEnabled()).toBe(false);
    expect(remapDraftSourcesClientEnabled()).toBe(false);
    expect(reopenVerbGuardEnabled()).toBe(false);
    expect(formRevisionsEnabled()).toBe(false);
    expect(formRevisionsUiEnabled()).toBe(false);
    expect(sensitiveDefaultsRedactEnabled()).toBe(false);
    expect(appPasswordHelpEnabled()).toBe(false);
    expect(followUpNotPriorEnabled()).toBe(false);
    expect(stateCodeNotAPersonEnabled()).toBe(false);
    expect(googleReviewsInChatEnabled()).toBe(false);
    expect(draftNeverBlankEnabled()).toBe(false);
    expect(lateOpenPlaceEnabled()).toBe(false);

    const question = "create a verbal corrective action for Avery Holt at Lawrence on 10-1";
    expect(
      augmentIntakeQuestion({
        slots: false,
        fields: false,
        question,
        history: [{ role: "user", content: "The employee is Avery Holt. Salon Director at Lawrence." }],
        today: "2026-10-23",
      }),
    ).toBe(question);

    const values = { policy_language: "", coaching_details: "Opened late." };
    expect(
      flaggedCitationWrite({
        enabled: false,
        templateKey: "coaching",
        values,
        notes: "late opening",
        chunks: [],
      }).values,
    ).toBe(values);

    for (const name of NEW_FLAGS) {
      const saved = previous[name];
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  });

  it("does not edit Pau's modules or any UI file", () => {
    expect(diff("HEAD", [...PROTECTED, ...APPROVED_PROTECTED_EDITS])).toBe("");
    const uiBase = uiDiffBase();
    if (uiBase) {
      // Test files may change an expectation when Pau changes the wording.
      // Component, style, and page files stay untouched, except the chat
      // bubble: Pau asked for the close-match note under the card.
      // And except chat-screen.tsx: SEND_AFTER_HYDRATE_ENABLED queues a typed
      // send until the store is ready. The composer is not disabled and no
      // control is added. The diff is that queue.
      // And except composer.tsx: QA approved on 25 Oct 2026, behind
      // CHAT_LONG_MESSAGE_ENABLED, the character-count line under the field
      // and send disabled over the limit. Off, it renders as before.
      expect(
        diff(uiBase, [
          ...UI_PATHS,
          ":(exclude)**/*.test.tsx",
          ":(exclude)**/*.dom.test.tsx",
          ":(exclude)src/features/chat/message-bubble.tsx",
          ":(exclude)src/features/chat/chat-screen.tsx",
          ":(exclude)src/features/chat/composer.tsx",
          `:(exclude)${MONITORING_TABLE}`,
        ]),
      ).toBe("");
      expect(changedLines(diff(uiBase, [MONITORING_TABLE])).filter((line) => !MONITORING_MOUNT.includes(line))).toEqual([]);
    } else {
      console.warn(
        "Skipping the UI git-diff assertion: origin/main is not in this checkout, fetching it failed, and no merge-base with main is available.",
      );
    }
    const ask = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    const code = ask.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("process.env");
    expect(code).not.toContain(".catch(");
    expect(ask).toContain("question: request.question");
    expect(ask).toContain("slotRetentionEnabled()");
    expect(ask).toContain("fieldAccuracyEnabled()");
  }, 60_000);
});

const CHILD = process.env.FLAGS_OFF_PARITY_CHILD === "1";

describe("existing chat and form suites with every new flag off", () => {
  it.skipIf(CHILD)(
    "passes the suites whose expectations are already on main",
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env, FLAGS_OFF_PARITY_CHILD: "1" };
      delete env.VITEST;
      delete env.VITEST_WORKER_ID;
      delete env.VITEST_POOL_ID;
      for (const name of NEW_FLAGS) env[name] = "off";
      const output = execFileSync(
        process.execPath,
        [
          "node_modules/vitest/vitest.mjs",
          "run",
          "--project",
          "unit",
          "--maxWorkers=2",
          "--exclude",
          "src/lib/ai/flags-off-parity.test.ts",
          "src/lib/ai",
          "src/lib/forms",
          "src/app/api/chat",
          "src/app/api/forms",
        ],
        // The child's output (every suite's logs) passed Node's 1 MB default
        // buffer on CI and failed with ENOBUFS before any test failed.
        { env, encoding: "utf8", timeout: 540_000, stdio: "pipe", maxBuffer: 256 * 1024 * 1024 },
      );
      expect(output).toMatch(/Test Files[\s\S]*passed/);
    },
    560_000,
  );
});
