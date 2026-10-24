/**
 * Chat-quality flags. Each one defaults off.
 *
 * Unset, empty, "0", "false", and "off" leave the existing chat path
 * untouched. Only an explicit on-value turns a feature on, so a preview can
 * try one change without the others.
 */

const ON = new Set(["1", "true", "on", "yes"]);

export function envFlag(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;
  return ON.has(raw.trim().toLowerCase());
}

/** Claude tool-use reading of a form turn, and routing that reading off search. */
export function formToolsEnabled(): boolean {
  return envFlag("FORM_TOOLS_ENABLED");
}

/** Keyword + vector fusion via match_knowledge_chunks_hybrid. */
export function hybridSearchEnabled(): boolean {
  return envFlag("HYBRID_SEARCH_ENABLED");
}

/** Haiku reading of any manager message before routing and retrieval. */
export function queryRewriteEnabled(): boolean {
  return envFlag("QUERY_REWRITE_ENABLED");
}

/** Extra system-prompt rules for name, payroll, and a chosen corrective action. */
export function chatStyleRulesEnabled(): boolean {
  return envFlag("CHAT_STYLE_RULES_ENABLED");
}

/** Write one chat_traces row per turn. Off leaves the table untouched. */
export function chatTraceEnabled(): boolean {
  return envFlag("CHAT_TRACE_ENABLED");
}

/**
 * Top-N keyword and vector candidates with no similarity floor, fuzzy
 * section titles, and a Haiku pick. Off keeps the existing cutoff.
 */
export function retrievalRecallEnabled(): boolean {
  return envFlag("RETRIEVAL_RECALL_ENABLED");
}

/**
 * Send a longer history window plus a stored summary of older turns.
 * Off keeps the last 10 messages.
 */
export function longContextEnabled(): boolean {
  return envFlag("LONG_CONTEXT_ENABLED");
}

/**
 * Read-only review and sales tools, and the password-reset help text.
 * Off leaves both off the answer.
 */
export function chatDataToolsEnabled(): boolean {
  return envFlag("CHAT_DATA_TOOLS_ENABLED");
}

/**
 * A corrective action may be created when no prior coaching form is in the
 * app. Off, the existing intake still treats that history as required.
 */
export function priorCoachingOptionalEnabled(): boolean {
  return envFlag("PRIOR_COACHING_OPTIONAL_ENABLED");
}

/**
 * Carry a salon, employee name, or job title from anywhere in the
 * conversation onto the current turn. Off, the proposal reads the turn
 * exactly as it does today.
 */
export function slotRetentionEnabled(): boolean {
  return envFlag("SLOT_RETENTION_ENABLED");
}

/**
 * Restate a month-day the date reader skips, and a payroll amount it
 * skips, in a shape that reader already accepts. Off, those words are
 * left as typed.
 */
export function fieldAccuracyEnabled(): boolean {
  return envFlag("FIELD_ACCURACY_ENABLED");
}

/**
 * A resent create for the same employee and form reopens that draft.
 * Off, a new card still files a new draft.
 */
export function draftDedupeEnabled(): boolean {
  return envFlag("DRAFT_DEDUPE_ENABLED");
}

/**
 * A follow-up or second document is not revised into the form on screen.
 * Off, the open form keeps the revision path it has now.
 */
export function secondFormEnabled(): boolean {
  return envFlag("SECOND_FORM_ENABLED");
}

/**
 * Write a JBA Policy Manual name and printed page onto a coaching form
 * (and an empty Corrective Action policy line). Off, those fields are
 * written exactly as they are today.
 */
export function policyCitationEnabled(): boolean {
  return envFlag("POLICY_CITATION_ENABLED");
}

/**
 * Per-user memory tools and the recalled-memory prompt block.
 * Off, nothing is read or written and the prompt is unchanged.
 */
export function chatMemoryEnabled(): boolean {
  return envFlag("CHAT_MEMORY_ENABLED");
}

/**
 * Grouped Comp Report and Sales Totals breakdowns.
 * Off, chat keeps the existing one-block data read.
 */
export function reportBreakdownEnabled(): boolean {
  return envFlag("REPORT_BREAKDOWN_ENABLED");
}

/**
 * An employee, salon, or policy counts only when it resolves against the
 * Woven roster, the salon list, or the JBA manual. Off, a typed name is
 * accepted exactly as it is today.
 */
export function groundedEntitiesEnabled(): boolean {
  return envFlag("GROUNDED_ENTITIES_ENABLED");
}

/**
 * Read and write the per-conversation form state before asking again.
 * Off, nothing is read or written and the question is unchanged.
 */
export function formStateEnabled(): boolean {
  return envFlag("FORM_STATE_ENABLED");
}

/**
 * "Show draft with edits" merges into the open draft. Offense and Action
 * Plan are left as they are unless the manager named that field to clear.
 * Off, a show request still opens the draft and does not write it.
 */
export function draftMergeEnabled(): boolean {
  return envFlag("DRAFT_MERGE_ENABLED");
}

/**
 * The Corrective Action plan is the review sentence and the required
 * closing, and nothing else. Off, the plan Pau's module already builds
 * is written, including a payroll sentence when payroll applies.
 */
export function actionPlanSentencesEnabled(): boolean {
  return envFlag("ACTION_PLAN_SENTENCES_ENABLED");
}

/**
 * One Claude tool call reads the turn into slots, then each slot is checked
 * against the roster, the salon list, or the manual before it is kept.
 * Off, the question is answered exactly as it is today.
 */
export function intentExtractionEnabled(): boolean {
  return envFlag("INTENT_EXTRACTION_ENABLED");
}

/**
 * Similar highly rated past exchanges, this company only, as examples.
 * Off, nothing is read and the prompt is unchanged.
 */
export function fewShotExamplesEnabled(): boolean {
  return envFlag("FEWSHOT_EXAMPLES_ENABLED");
}

/**
 * Check a citation, the action plan, and the employee before the reply is sent.
 * Off, the reply is sent as it was written.
 */
export function selfCheckEnabled(): boolean {
  return envFlag("SELF_CHECK_ENABLED");
}

/**
 * Cache the static system prompt and the policy-manual block.
 * Off, both are sent exactly as they are today.
 */
export function promptCacheEnabled(): boolean {
  return envFlag("PROMPT_CACHE_ENABLED");
}

/**
 * A 45 second model timeout, two retries, and a plain message when the
 * model is overloaded. Off, the client keeps the SDK defaults and the
 * existing failure text.
 */
export function modelRetryEnabled(): boolean {
  return envFlag("MODEL_RETRY_ENABLED");
}

/**
 * The reply lists template fields the proposal has not filled yet.
 * Off, the reply is unchanged. A typed name fills Employee Name; not
 * being in Woven is not a missing field.
 */
export function requiredFieldCheckEnabled(): boolean {
  return envFlag("REQUIRED_FIELD_CHECK_ENABLED");
}

/**
 * A second create of the same conversation and proposal returns the draft.
 * Off, a repeated card is still matched the way it is today.
 */
export function conversationProposalDedupeEnabled(): boolean {
  return envFlag("CONVERSATION_PROPOSAL_DEDUPE_ENABLED");
}

/**
 * Drop a JBA Policy Manual citation whose heading or page is not in the
 * current manual chunks. Off, citations are left as they were written.
 */
export function citationVerifyEnabled(): boolean {
  return envFlag("CITATION_VERIFY_ENABLED");
}

/**
 * After a match, keep the current JBA Policy Manual edition and collapse
 * identical sections. Off, the rows the database returned are used as they
 * are. The 0.78 similarity floor is unchanged.
 */
export function currentManualScopeEnabled(): boolean {
  return envFlag("CURRENT_MANUAL_SCOPE_ENABLED");
}

/**
 * A name that is not in the roster stays as typed. "Who is this for?" does
 * not block the form. A close roster match is one note under the card —
 * "Woven has Jane Doe" — in the same turn. It is not a question and it does
 * not hold the card. No note when nothing is close. Off, a close match is
 * still a question that holds the card.
 */
export function typedNameProceedsEnabled(): boolean {
  return envFlag("TYPED_NAME_PROCEEDS_ENABLED");
}

/**
 * Tardiness cites the Attendance policy by name and page. Off, the ticked
 * box label is what Policy Violated carries.
 */
export function attendancePolicyCitationEnabled(): boolean {
  return envFlag("ATTENDANCE_POLICY_CITATION_ENABLED");
}

/**
 * A form that resolves a manual section cites that section's name and page.
 * Off, a citation can be only the offense box.
 */
export function policyPageRequiredEnabled(): boolean {
  return envFlag("POLICY_PAGE_REQUIRED_ENABLED");
}

/**
 * The employee-performance and daily-stats prompts share one order of
 * authority. Off, each block keeps its own list.
 */
export function unifiedAuthorityOrderEnabled(): boolean {
  return envFlag("UNIFIED_AUTHORITY_ORDER_ENABLED");
}

/**
 * The payroll amount on a corrective action is only an amount the manager
 * stated. Off, a Yes with no amount can still take the one figure Direct
 * policy quotes ("$25.00" under Late Opening) into the action-plan sentence.
 * The visible amount field is a separate flag.
 */
export function managerPayrollAmountOnlyEnabled(): boolean {
  return envFlag("MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED");
}

/**
 * The Corrective Action card and PDF show "Payroll deduction amount" after
 * the payroll Yes/No. The figure is one the manager stated. Off, that line
 * is not on the document, not asked, and not written.
 */
export function payrollAmountFieldEnabled(): boolean {
  return envFlag("PAYROLL_AMOUNT_FIELD_ENABLED");
}

/**
 * A blank Direct policy does not hold the card or the finalize. The field
 * stays empty. A value somebody typed that was never verified still asks
 * for an acknowledgement. Off, a blank policy field still blocks finalize.
 *
 * The browser reads `NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED` because
 * the form card is a client component. The server reads the name without
 * that prefix. Either one turns the gate off.
 */
export function policyGateNonblockingEnabled(): boolean {
  return (
    envFlag("POLICY_GATE_NONBLOCKING_ENABLED") ||
    envFlag("NEXT_PUBLIC_POLICY_GATE_NONBLOCKING_ENABLED")
  );
}

/**
 * One chunk per section heading among the current year's manuals. Off, two
 * copies of the same section with different text both stay.
 */
export function manualSectionDedupeEnabled(): boolean {
  return envFlag("MANUAL_SECTION_DEDUPE_ENABLED");
}

/**
 * A citation uses the printed page. The PDF sheet column (`page`, often
 * printed + 1) is not a citation. Off, a chunk with no printed page can
 * still be cited by that sheet column.
 */
export function printedPageCitationEnabled(): boolean {
  return envFlag("PRINTED_PAGE_CITATION_ENABLED");
}

/**
 * Slots, the employee name, the salon, a yes/no, the date, and the printed
 * page are decided in code. The model does not write Employee. Off, those
 * paths stay as they are.
 */
export function codeSlotsEnabled(): boolean {
  return envFlag("CODE_SLOTS_ENABLED");
}

/**
 * A global non-admin is asked which salon once. The draft is still built.
 * A salon they already named — this turn, an earlier turn, a short name, or
 * a one-character typo — is filled in and the question is not asked.
 * Off, a global account files with no salon, as it does today.
 */
export function globalSalonAskEnabled(): boolean {
  return envFlag("GLOBAL_SALON_ASK_ENABLED");
}

/**
 * Time off, sick days, W-2 and direct deposit pin the JBA sections that
 * answer them, read from the official manual by heading. Off, retrieval
 * is unchanged: those sections stay wherever vector search ranked them.
 */
export function manualTopicPinEnabled(): boolean {
  return envFlag("MANUAL_TOPIC_PIN_ENABLED");
}
