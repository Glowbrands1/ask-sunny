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
 * Time off, sick days, W-2 and direct deposit.
 *
 * On, a chat question pins those JBA sections by heading. A policy question
 * whose top results contain no current JBA Policy Manual chunk continues
 * into the heading scan instead of stopping at the similarity floor. A
 * pinned topic that did not name the manual still gets the manual note, so
 * the answer is not "I don't have that" while the section is in the sources.
 * A form or a corrective action does not take these pins.
 *
 * Off, retrieval is unchanged: those sections stay wherever vector search
 * ranked them, and a score at the floor still returns immediately.
 */
export function manualTopicPinEnabled(): boolean {
  return envFlag("MANUAL_TOPIC_PIN_ENABLED");
}

/**
 * Put the whole current policy manual in the prompt for a policy question,
 * cached with Anthropic's ephemeral cache. Off, the answer still comes from
 * the retrieved chunks.
 */
export function fullManualContextEnabled(): boolean {
  return envFlag("FULL_MANUAL_CONTEXT_ENABLED");
}

/**
 * One read of the whole conversation fills the form. A field is kept only
 * when this chat stated it. A later turn replaces that field. A blank read
 * does not erase one. Off, the card is filled exactly as it is today.
 */
export function formFullRemapEnabled(): boolean {
  return envFlag("FORM_FULL_REMAP_ENABLED");
}

/**
 * The warning level kept for a Corrective Action is only one the manager
 * stated: read from their own turns, never from Ask Sunny's ("You'll set the
 * verbal/written warning level" is not "written"), never from the slot
 * model's guess, and a bare "Yes" only where Ask Sunny's turn just before it
 * asked one yes/no question about that exact level. Off, the intent reading
 * grounds the level as it does today.
 */
export function warningLevelManagerOnlyEnabled(): boolean {
  return envFlag("WARNING_LEVEL_MANAGER_ONLY_ENABLED");
}

/**
 * The Job title and the Observation of Offense read only the manager's own
 * words. The lines the app writes onto the question ("Job title: CA. It
 * happened at KS Lawrence.", "It happened on 9/28/2026.") are not read as
 * what the manager said, and a turn that only says where the employee
 * works is not an offense. Off, both readers are unchanged.
 */
export function managerWordsOnlyEnabled(): boolean {
  return envFlag("MANAGER_WORDS_ONLY_ENABLED");
}

/**
 * The remap path's What happened, prior actions and policy, read from the
 * manager's words and the manual. The request ("create a corrective action
 * form for …") is not the incident and not the action plan. "previous
 * coaching: …" is the prior-action list. A policy is "as you said" only
 * when the manager named it; otherwise the manual section and printed page
 * the account resolves are cited on the card. Off, the remap reads these
 * fields as before.
 */
export function remapIncidentFixEnabled(): boolean {
  return envFlag("REMAP_INCIDENT_FIX_ENABLED");
}

/**
 * The intent read takes a payroll amount and the Yes/No only from the
 * manager's own turns. A figure the assistant quoted from policy ("reimburse
 * the company $25 via payroll deduction") is not an amount, and "verbal, no
 * payroll" is No (ported from Ask Bubbles, conv_mvmf4x1i2qxha7u). Off, every
 * turn is read for an amount, as before.
 */
export function intentPayrollManagerOnlyEnabled(): boolean {
  return envFlag("INTENT_PAYROLL_MANAGER_ONLY_ENABLED");
}

/**
 * One draft per form in a conversation. A new card for the same form and
 * employee in the same chat opens the draft this chat already made, unless a
 * manager turn since that draft asked for another document. Off, every new
 * card creates as it does today.
 */
export function conversationDraftReuseEnabled(): boolean {
  return envFlag("CONVERSATION_DRAFT_REUSE_ENABLED");
}

/**
 * Keep other conversations out of the reply text. The person-memory recall
 * quotes another chat only when the manager refers back to it ("again", "last
 * time", "like before", "same as …"); a name read from a turn that is only
 * that name ("asdasd") is recalled only when it is on the roster; the prompt
 * labels the block as records from other conversations; and a reply sentence
 * that still says the manager raised or sent something in another chat or on
 * another date is taken out (QA, conv_mvmtj8ia2qwr8pu and conv_mvmvugx525mtd2v).
 * Off, recall and the reply are exactly as before.
 */
export function crossChatReplyGuardEnabled(): boolean {
  return envFlag("CROSS_CHAT_REPLY_GUARD_ENABLED");
}

/**
 * "Delete that draft" deletes the draft on screen where the manager may
 * delete forms (the forms API's own rule), and says truthfully who can where
 * they may not; "same incident", answering "is this the same incident as the
 * <form> for <name>?", opens that form instead of asking for a phrase to type
 * (QA F8, 21–22 Oct 2026). Off, both turns are answered as before.
 */
export function draftActionsEnabled(): boolean {
  return envFlag("DRAFT_ACTIONS_ENABLED");
}

/**
 * A late opening, read as one (QA, 24 Oct 2026). "late to open 10-19" is the
 * manual's Late Opening section and is dated 19 October: a yearless dashed
 * month-day after a date cue is a date, the newest one the manager states
 * dates the form, a late opening cites Late Opening only, and "payroll deduct
 * is not applicable" is No in the saved state. Off, as before.
 */
export function lateOpenDateEnabled(): boolean {
  return envFlag("LATE_OPEN_DATE_ENABLED");
}

/**
 * A request to start a corrective action ("create a Verbal CA for …", "I need
 * a CA for someone opening the salon late") is the Corrective Action Form
 * when the intent read has no model reading. The template reader calls that
 * request the progression, and the intent slots used to keep no form for it,
 * so the next answer ("verbal", "no payroll") was not a form turn (QA F4,
 * 24 Oct 2026). A metric with no behaviour stays the progression, as in the
 * form proposal. Off, the form slot is left as before.
 */
export function caTemplateMapEnabled(): boolean {
  return envFlag("CA_TEMPLATE_MAP_ENABLED");
}

/**
 * The form is the one the manager named in their own words, newest turn
 * first. The model's formType, the assistant's "**Corrective Action Form**"
 * and the state lines never pick it, and a "Policy reference:" line is not a
 * form request. "Disciplinary Action" (the discipline procedure) is never the
 * violated policy, so the card's source follows the policy the reply names
 * (QA, 24 Oct 2026: coaching and Policy Review requests became a Corrective
 * Action). Off, the form is read as before.
 */
export function formChoiceStatedEnabled(): boolean {
  return envFlag("FORM_CHOICE_STATED_ENABLED");
}

/**
 * A policy or document phrase is not a place (ported from Ask Bubbles,
 * conv_mvmcetjw2i4vtwz). Off, the salon readers are unchanged. On, the
 * "<place>, <state>" reader reads each manager turn on its own and skips a
 * span that names a policy, manual, section or similar document, so "cite
 * animals in the workplace policy" followed by "at Kearney, NE" is not read
 * as a place called "the workplace policy at Kearney"; and a labelled
 * current or new location that names a document ("per the new salon
 * policy") is not kept as the salon. Also on, a field label is a place cue
 * and the newest turn's salon replaces the saved one: "location st joe"
 * after "salon is wornall" is St Joseph (QA Round 4).
 */
export function placeSpanGuardEnabled(): boolean {
  return envFlag("PLACE_SPAN_GUARD_ENABLED");
}

/**
 * Prior actions read the way managers write them. A list after "received …
 * coaching 9/8" keeps its later comma items that name a step; "prior verbal
 * 9-1-26" and "Her prior coaching is her policy manual acknowledgement on
 * 9/01" are earlier steps; a date governed by "previous / prior / coached /
 * jba manual / policy manual acknowledgement" never dates the form; and an
 * action plan that is only the history label is dropped. Off, the readers
 * are unchanged.
 */
export function priorActionsParseEnabled(): boolean {
  return envFlag("PRIOR_ACTIONS_PARSE_ENABLED");
}

/**
 * Words that are not a person never become the employee: a placeholder
 * ("blank", "n/a", "unknown"), a phrase that starts with a verb ("require
 * practice"), a product or service this business sells, a place on the
 * salon roster, and the app's own lines and lists (the stored "Policy
 * reference: …" line, an assistant reply, a bulleted or priced offer list).
 * Off, the readers take names as they do today.
 */
export function notANameGuardEnabled(): boolean {
  return envFlag("NOT_A_NAME_GUARD_ENABLED");
}

/**
 * The form's employee stays the employee. A person the manager's account
 * mentions ("onboarding with new hire Test Newhire") does not replace them on
 * a later turn (QA round 10, conv_mvnjix4r2wm7u7r). Here: "Which date goes on
 * the form?" is answered in the manager's words; the lines the app writes
 * onto the question ("The employee is test employee. It happened on
 * 10/16/2026.") are not an answer, so "create the ca" after that question is
 * not dropped from the name readers. Off, a turn is a date answer as before.
 */
export function keepFormEmployeeEnabled(): boolean {
  return envFlag("KEEP_FORM_EMPLOYEE_ENABLED");
}

/**
 * A directory title counts as stated only as a whole word, and a short
 * all-capitals title ("HR") only as the manager typed it. "throught the
 * rest" is not "HR", and neither is "1 hr late" (QA round 10,
 * conv_mvnjo8k22hy75ii). A title the slot model typed is kept only when the
 * manager's words carry it. Off, the title is grounded as before.
 */
export function titleWholeWordEnabled(): boolean {
  return envFlag("TITLE_WHOLE_WORD_ENABLED");
}

/**
 * An incident date after today is asked about once ("That date is in the
 * future — is 12-20-26 right?") and never changed. A "yes", a restatement or
 * any other answer keeps it and the question is not asked again for that date
 * in the conversation; a corrected date is used instead. Only the incident
 * date the form carries, not a follow-up or review date. Same flag in the
 * sibling app (QA history, 21 Oct 2026). Off, a future date is accepted
 * without a question, as before.
 */
export function futureIncidentDateConfirmEnabled(): boolean {
  return envFlag("FUTURE_INCIDENT_DATE_CONFIRM_ENABLED");
}

/**
 * The job title the manager states for the employee is the form's. The intent
 * reading keeps the title the manager's turns state — one on the title list,
 * or one stated as what the employee is ("she is an HR assistant") — ahead of
 * the directory's title for the matched person, which used to replace it
 * without a word. Same flag in the sibling app (QA history, 22 and 25 Oct
 * 2026). Off, the title is read as before.
 */
export function statedTitleWinsEnabled(): boolean {
  return envFlag("STATED_TITLE_WINS_ENABLED");
}

function flagOn(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  return ON.has(value.trim().toLowerCase());
}

/**
 * A typed question waits until stored history has loaded, and a conversation
 * created during that wait is kept.
 *
 * Off (the default) leaves hydration and send exactly as they are.
 *
 * The chat screen and the store are client components. Next inlines a
 * statically written `process.env.NEXT_PUBLIC_*` name into that bundle and
 * does not expose any other name there, so the browser reads
 * `NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED` that way. The server and the
 * tests read `SEND_AFTER_HYDRATE_ENABLED`. Either spelling turns it on.
 */
export function sendAfterHydrateEnabled(): boolean {
  return (
    envFlag("SEND_AFTER_HYDRATE_ENABLED") ||
    envFlag("NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED") ||
    flagOn(process.env.NEXT_PUBLIC_SEND_AFTER_HYDRATE_ENABLED)
  );
}
