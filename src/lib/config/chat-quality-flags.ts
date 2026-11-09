/**
 * Chat-quality flags. Each one defaults off.
 *
 * Unset, empty, "0", "false", and "off" leave the existing chat path
 * untouched. Only an explicit on-value turns a feature on, so a preview can
 * try one change without the others.
 */

import { flagFromEnv } from "./default-on";

const ON = new Set(["1", "true", "on", "yes"]);

/**
 * A flag's value from the environment. A flag in `DEFAULT_ON` (Pau, 3 Nov
 * 2026, "(E) batch 1") is on unless its variable says "0"/"false"/"off"/"no";
 * every other flag is off unless its variable says on. See `default-on.ts`.
 */
export function envFlag(name: string): boolean {
  return flagFromEnv(name, process.env[name]);
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
 * SECOND_REQUEST_OWN_ACCOUNT_ENABLED (QA's audit, 7 Nov 2026; default off). With a Corrective Action for <A> already
 * created in a chat, a second request for <A> ("I need another corrective action for <A>, his cash drawer was short")
 * reopened the first draft (the reopen lookup read every turn of the chat as the incident), or its card carried the
 * first request's policy ("Late Opening, as you said"), Action Plan and, when not worded as a create request, its
 * account. On: a turn that starts a new form request does not carry the saved policy heading (`ai/form-state.ts`,
 * `ai/form-card-slots.ts`). Off, as before.
 */
export function secondRequestOwnAccountEnabled(): boolean {
  return envFlag("SECOND_REQUEST_OWN_ACCOUNT_ENABLED");
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
 * PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED (the sibling app's live chat, 5 Nov 2026; same flag in both apps; default
 * off). "…the register was off $20. which will be payroll deducted from <name>'s check. … payroll deduct applies"
 * still asked "**Payroll deduction amount**?". On: an amount followed by "which / that / this / it … (payroll)
 * deducted" is the stated amount (`forms/payroll-deduct-answer.ts` payrollAmountWording, which reads the env
 * itself because that file imports nothing). Off, as before.
 */
export function payrollAmountSameMessageEnabled(): boolean {
  return envFlag("PAYROLL_AMOUNT_SAME_MESSAGE_ENABLED");
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
 * POLITE_REQUEST_OWN_TURNS_ENABLED (Pau's scan, sf-s37, 7 Nov 2026; same flag in both apps; default off). Three
 * requests in one chat, each "Can you create me a coaching document for <name> for …": the second card's Observation
 * of Offense read back the first employee's request. A request opened with "can / could / would / will you" was not
 * read as a request, so a card read every earlier turn as its account. On: that lead is set aside before the request
 * is read (`ai/remap-incident.ts` currentRequestStart). Off, as before.
 */
export function politeRequestOwnTurnsEnabled(): boolean {
  return envFlag("POLITE_REQUEST_OWN_TURNS_ENABLED");
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
 * DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED: an open draft is reused only when this
 * chat made it, for the same employee, form and incident or date. A card
 * dated differently from the chat's own draft makes a new draft, and a reuse
 * says so on the card ("Updated your open draft from <date>"). A draft from
 * another chat is never reopened, so it is never overwritten (QA, B18–B20,
 * 25 Oct 2026). Off, every lookup is as it was.
 */
export function draftReuseSameChatOnlyEnabled(): boolean {
  return envFlag("DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED");
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
 * The salon the newest manager turn names is the card's salon, whichever turn
 * that is. "change salon location to <place>, <state>" and then "create a
 * Corrective Action Form for Test Employee"" kept the place the first turn
 * named (sibling app conv_mvnsstvq2cywp78 / conv_mvnu3j932gpohx4, 25 Oct
 * 2026). On, the intent reading looks at the manager's turns newest first and
 * takes the first that names exactly one salon, a field label or "<place>,
 * <state>" counting as a naming. Off, only this turn's labelled salon wins
 * (PLACE_SPAN_GUARD_ENABLED) and the salon is grounded as before.
 */
export function newestPlaceTurnEnabled(): boolean {
  return envFlag("NEWEST_PLACE_TURN_ENABLED");
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
 * The exit form's intake reads what the manager typed (ported from the
 * sibling app's live QA, 25 Oct 2026). A Details answer ("items returned") or
 * the Permanent Address the manager typed is never taken for the employee;
 * "change the reason for resignation to: …" replaces the reason; a yearless
 * "last day 10-24" is the most recent 24 October; "gave notice 9/25 –
 * fulfilled 10/9" fills the fulfilled date; the Permanent Address is read;
 * and "did not call in for her last two shifts" is No Call No Show. Same
 * name in the sibling app. Off, the exit readers read as before.
 */
export function exitIntakeFixEnabled(): boolean {
  return envFlag("EXIT_INTAKE_FIX_ENABLED");
}

/**
 * A reading note beside the JBA Policy Manual p.19 cell-phone sentence when
 * the grounding holds it: "not in back pockets, charging in the break room,
 * or sitting on top of a drawer till" lists three places the phone may NOT
 * be (sibling app conv_mvnoscyz200gtat, QA 25 Oct 2026). The note goes in the
 * per-turn grounding block, never in the manual text or a cached manual
 * block. Off, the grounding is exactly as before.
 */
export function manualNegatedListNoteEnabled(): boolean {
  return envFlag("MANUAL_NEGATED_LIST_NOTE_ENABLED");
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
 * The Corrective Action Form's Action Plan is the manager's, or blank (Pau,
 * 25 Oct 2026). A plan they typed ("action plan: …") goes on the card and the
 * form word for word. With none typed, nothing is written: no "Management
 * will review …" sentence, no closing, no model summary. Off, the plan is
 * built as it is today.
 */
export function actionPlanManagerOnlyEnabled(): boolean {
  return envFlag("ACTION_PLAN_MANAGER_ONLY_ENABLED");
}

/**
 * A reformat turn keeps the sources of the answer it reformats. "Make this a
 * downloadable document", "put that in a table", "summarize that" is searched
 * again with the question the previous answer was written for, and those rows
 * go first, so the reply does not "correct" claims whose sources it can no
 * longer see (QA, conv_mufp73ez8pl7992). Removing [S#] markers also never
 * leaves their grammar behind ("two markers, and, that"). Off, retrieval and
 * marker stripping are as before.
 */
export function reformatKeepsSourcesEnabled(): boolean {
  return envFlag("REFORMAT_KEEPS_SOURCES_ENABLED");
}

/**
 * The coaching framework covers an issue it does not name. With the framework
 * among the sources, the prompt tells the model to answer from its general
 * sections (root cause, performance vs behavior, conversation structure), cite
 * them, and say only that no section names this exact issue, instead of "the
 * knowledge base does not have it" (QA, sibling app conv_mvb28ztb85z53mc).
 * Off, the prompt is byte-for-byte as before.
 */
export function frameworkGeneralSectionsEnabled(): boolean {
  return envFlag("FRAMEWORK_GENERAL_SECTIONS_ENABLED");
}

/**
 * A question is answered, never routed into a form (P0, live replay 25 Oct
 * 2026: "how many hours is a part-time tanning consultant?" came back as
 * "Which form did you mean?", "smoking policy" as "Who is this Corrective
 * Action Form for?"). On, a turn `question-not-form.ts` reads as a question
 * skips the slot reader, the remap, the proposal and the open-form correction
 * and revision paths, and is answered. Off, every turn is routed as before.
 */
export function questionNotFormEnabled(): boolean {
  return envFlag("QUESTION_NOT_FORM_ENABLED");
}

/**
 * An edit typed in chat is applied to its field or answered, and dates follow
 * the incident (QA history replay, 25 Oct 2026). "change observation of
 * offense to: …" replaces that line with the manager's text; "add that …"
 * appends their clause; "clean up my grammar", "change the salon to …" and
 * "can you edit the form I already finalized" are never appended to the
 * Observation. "X instead of Y" names X. A prior action's date is never the
 * form's Date or its Follow-up, Follow-up comes only from a follow-up or
 * review phrase, and "today" dates the form today. Off, every reader is as
 * before.
 */
export function formEditDateRulesEnabled(): boolean {
  return envFlag("FORM_EDIT_DATE_RULES_ENABLED");
}

/**
 * A follow-up that names its own documents or nouns ("The NCR and
 * Fitzpatrick Skin Type Chart, EFT Agreements") is searched on them when the
 * retrieval rewrite kept none of them and searched only the earlier turn's
 * subject ("Employment Verification"). Off, the rewritten query is searched
 * as it is. Same name in both apps. Default off.
 */
export function followupNewTopicRetrievalEnabled(): boolean {
  return envFlag("FOLLOWUP_NEW_TOPIC_RETRIEVAL_ENABLED");
}

/**
 * The exit form's How Employee Resigned line also reads a resignation the
 * manager says was given verbally ("she told me verbally", "verbal notice"),
 * as "Verbal" (Pau's decision, 25 Oct 2026). A bare "she resigned" still
 * leaves the line blank, and "verbal warning" is never a method. Off, the
 * methods read are exactly as before.
 */
export function resignMethodFollowupEnabled(): boolean {
  return envFlag("RESIGN_METHOD_FOLLOWUP_ENABLED");
}

/**
 * A form the manager named is kept only as itself (QA, 25 Oct 2026, ported
 * from Ask Bubbles, which ships it unflagged). A named template that is not
 * published opens no card, and the slot model's or the saved form does not
 * stand in for it; a named kind of form ("… interview form") keeps only a
 * form of that kind. Off, the form is read as before.
 */
export function namedFormExactEnabled(): boolean {
  return envFlag("NAMED_FORM_EXACT_ENABLED");
}

/**
 * A full-remap card names the manager's turns it was read from (QA H1, 25 Oct
 * 2026, found in the sibling app), so Create draft prefills the form from them
 * instead of filing it blank. Off, the remap card names no turns, as before.
 * See `lib/ai/remap-draft-sources.ts`.
 */
export function remapDraftSourcesEnabled(): boolean {
  return envFlag("REMAP_DRAFT_SOURCES_ENABLED");
}

/**
 * The browser's reading of REMAP_DRAFT_SOURCES_ENABLED, for the Create step
 * (`chat/create-inline-form.ts`): a draft whose notes are empty is written
 * from the card's own lines only with this on. Only a statically written
 * `process.env.NEXT_PUBLIC_…` is inlined by Next, so it is read here, not
 * through `envFlag`. Off, a card with no usable turns files a blank draft and
 * says so, as before.
 */
export function remapDraftSourcesClientEnabled(): boolean {
  return flagOn(process.env.NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED);
}

/**
 * A new form asked for is never read as "show me the form on file" (QA B22,
 * 25 Oct 2026, both apps): "… for no call no show on 10/22" read "show" as
 * the verb and put another chat's corrective action back in the thread. On,
 * incident phrases that contain a reopen verb ("no call no show", "didn't
 * show up") are not read as one, and a turn that opens by asking for a
 * document ("Draft a …", "Write up …", "I need a …") is never a reopen. Off,
 * the reopen reading is exactly as before.
 */
export function reopenVerbGuardEnabled(): boolean {
  return envFlag("REOPEN_VERB_GUARD_ENABLED");
}

/**
 * A form on file is asked for with any verb that opens it, not only "edit"
 * (QA, 6 Nov 2026; QA's history review of a location manager's chats, 5 Nov
 * 2026: "bring up <name>'s corrective action", "bring up an old coaching form
 * for <first name>" started over). On, a request that leads with "bring up",
 * "pull up", "open" or "find" and names a person and a form opens that
 * person's form on file through the "edit" reopen path (a finalized one as a
 * new draft of it), or says none is on file; and a form named only as "CA" /
 * "corrective action" ("Change <name> CA") counts as named. A request to
 * create one ("write up", "create", "make") still creates. Off, the reopen
 * reading is exactly as before.
 */
export function reopenByAnyOpenVerbEnabled(): boolean {
  return envFlag("REOPEN_BY_ANY_OPEN_VERB_ENABLED");
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

/**
 * Finalized-form edits carry a reason and a revision number, and the
 * revision chain shows: "Revised <date> (supersedes <ref>)" on a revision and
 * "Superseded <date> by <ref>" on the original, on the PDF and the form view,
 * plus "Revision N of <ref>" with a link to the previous version.
 *
 * Off (the default) leaves the shipped revise flow exactly as it is: no
 * reason is asked for or recorded, the history route answers 404, and the
 * PDF footer is byte-identical. On, the server refuses an edit of a
 * finalized form that gives no reason.
 *
 * The browser reads `NEXT_PUBLIC_FORM_REVISIONS_ENABLED` (see
 * `formRevisionsUiEnabled`). Turn both on together: the server refuses an
 * edit without a reason, and only the browser flag shows the reason dialog.
 * Either spelling turns the server side on.
 */
export function formRevisionsEnabled(): boolean {
  return envFlag("FORM_REVISIONS_ENABLED") || envFlag("NEXT_PUBLIC_FORM_REVISIONS_ENABLED");
}

/**
 * The browser half of `formRevisionsEnabled`: the reason dialog, the marks
 * and the history on the form card, the form page and the register row.
 * Next inlines only a statically written `process.env.NEXT_PUBLIC_*` name
 * into a client bundle, so the name is written out here.
 */
export function formRevisionsUiEnabled(): boolean {
  return flagOn(process.env.NEXT_PUBLIC_FORM_REVISIONS_ENABLED);
}

/**
 * The composer's reading of CHAT_LONG_MESSAGE_ENABLED. Only a statically
 * written `process.env.NEXT_PUBLIC_*` name reaches a client bundle, so the
 * browser reads the public twin and nothing else. Off, the composer renders
 * and sends exactly as it did.
 */
export function chatLongMessageClientEnabled(): boolean {
  const inlined = process.env.NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED;
  return typeof inlined === "string" && ON.has(inlined.trim().toLowerCase());
}

/**
 * A chat message may be up to 12,000 characters instead of 4,000
 * (`LONG_MESSAGE_LIMIT` in `lib/chat/message-limit.ts`). Over the limit the
 * route returns a 400 that says how long the message is; nothing is cut.
 * Off (the default), the route keeps the 4,000-character check and its
 * wording exactly as they are.
 *
 * The composer is a client component, so the browser reads
 * `NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED`, written out statically for Next
 * to inline. The server reads either spelling, so a deployment that sets
 * only the public name never shows a 12,000 limit the route refuses.
 */
export function chatLongMessageEnabled(): boolean {
  return (
    envFlag("CHAT_LONG_MESSAGE_ENABLED") ||
    envFlag("NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED") ||
    flagOn(process.env.NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED)
  );
}

/**
 * The form's date is the incident date the manager stated, or the day the
 * form is created — never a deadline, due date, assignment date, prior-action
 * date or a "by <date>" (Pau's coordinator, 25 Oct 2026, D3). Off, the date
 * readers keep main's reading.
 */
export function formDateIncidentOnlyEnabled(): boolean {
  return envFlag("FORM_DATE_INCIDENT_ONLY_ENABLED");
}

/**
 * A terse "ca <name> <what happened> <date> verbal 25 deduct" line is written
 * out as the long form before it is read, so the name, salon, date, warning
 * level and payroll amount are read as they are from a full sentence (Ask
 * Sunny conv_mvoffldz24z2t0u, 25 Oct 2026). See `ai/terse-slots.ts`. Off, the
 * turn is read as typed.
 */
export function terseSlotReadEnabled(): boolean {
  return envFlag("TERSE_SLOT_READ_ENABLED");
}

/**
 * Chat answers never repeat a default-password format or Social Security
 * digits from the knowledge base (QA P0, 25 Oct 2026; same flag in both
 * apps). The sentence is taken out of the excerpts the model is given and of
 * the reply and its cited excerpts, and the person is told to ask their
 * manager or HR to reset it. Knowledge rows are not changed. Off, the text is
 * as retrieved.
 */
export function sensitiveDefaultsRedactEnabled(): boolean {
  return envFlag("SENSITIVE_DEFAULTS_REDACT_ENABLED");
}

/**
 * "I forgot my password" (any spelling) is answered about this app first:
 * click "Forgot your password?" on the log-in screen (QA and Pau, 25 Oct
 * 2026; same flag in both apps). Another system is talked about only when
 * the manager names it. Off, the turn is answered as before.
 */
export function appPasswordHelpEnabled(): boolean {
  return envFlag("APP_PASSWORD_HELP_ENABLED");
}

/**
 * Cleaning left undone cites the manual's Care and Cleaning of Equipment and
 * Facilities section, chosen by the code (Code 3, policy reading; QA T5,
 * 25 Oct 2026): "cleaning duties not being completed", "weren't done",
 * "didn't get done", "left dirty". Other duties left undone in those words are
 * the Standards of Conduct. Off, the policy is read exactly as before.
 */
export function policyCleaningIncidentEnabled(): boolean {
  return envFlag("POLICY_CLEANING_INCIDENT_ENABLED");
}

/**
 * Specific incidents cite their own manual section, chosen by the code (Code 9,
 * policy reading; QA, 26 Oct 2026): no wet floor sign -> Safety in the
 * Workplace, a long break -> Meal and Rest Policy, a social media post ->
 * Social Media Policy, sexual comments -> Sexual and Other Forms of
 * Harassment, a pet at work -> Animals in the Workplace, theft, cash
 * shortages, insubordination and talking badly about coworkers -> the page of
 * the Standards of Conduct that lists them. A coaching form's "other" topic
 * is no longer primed with "Punctuality". Off, the policy and the topic are
 * read exactly as before.
 */
export function policySpecificTopicsEnabled(): boolean {
  return envFlag("POLICY_SPECIFIC_TOPICS_ENABLED");
}

/**
 * A prior action's date is not a follow-up date (QA Sunny tester batch 13,
 * S16 and S19, 26 Oct 2026). "She already had a verbal on 06/25/2026 and a
 * written on 07/28/2026" listed both under Prior actions and also as
 * "Follow-up: 6/25/2026" and "Follow-up: 7/28/2026": the card counted every
 * date that was not the incident's as a follow-up, and PRIOR_ACTIONS_PARSE
 * takes the earlier steps' dates out of the incident dates. On, a date the
 * earlier-step reader lists is never a Follow-up line. Off, the card's
 * Follow-up lines are exactly as before.
 */
export function followUpNotPriorEnabled(): boolean {
  return envFlag("FOLLOW_UP_NOT_PRIOR_ENABLED");
}

/**
 * A US state code after a place ("Dodge, NE", "lawrence, ks") is never a
 * second person when a chat card is created (production, 26 Oct 2026: "…at
 * Dodge, NE. She did not clock in…" was refused as naming "Odalys
 * Merriweather, NE"; same flag in both apps). See
 * `forms/state-code-place.ts`. Off, the conversation is read as typed.
 */
export function stateCodeNotAPersonEnabled(): boolean {
  return envFlag("STATE_CODE_NOT_A_PERSON_ENABLED");
}

/**
 * A Google review question gets the Google Reviews page's month-to-date
 * figures, goal and pace for the caller's salons, and only with View Google
 * reviews. Off, review questions keep the existing path.
 */
export function googleReviewsInChatEnabled(): boolean {
  return envFlag("GOOGLE_REVIEWS_IN_CHAT_ENABLED");
}

/**
 * A Corrective Action or coaching draft is never filed blank (found in the
 * sibling app's production, 26 Oct 2026: `drafted` with no fields and nothing
 * rejected, from Create clicks fired several at once). The model's tool call
 * is read when its `values` / `checked` came back JSON-encoded, one object per
 * section, keyed by label, or with a single option as text; a model call that
 * threw (429, 529, overloaded), answered with no tool call, or left no
 * narrative although the notes hold an account is tried again up to twice
 * (after 1 s, then 3 s), as is a failed framework read; if it is still empty,
 * the Observation is the manager's own incident clause. Every reason goes on
 * a drafted event, with `{"fallback": "manager_words"}` where used. See
 * `forms/draft-never-blank.ts`. Off, the draft route is unchanged.
 */
export function draftNeverBlankEnabled(): boolean {
  return envFlag("DRAFT_NEVER_BLANK_ENABLED");
}

/**
 * NAME_BEFORE_TITLE_ENABLED (QA, 26 Oct 2026): "ca for <first> <last>, team member at
 * <salon>" in lowercase left the Employee unread, and "for <First> <Last> Team
 * Member at <salon>" dropped the surname. A two-word name right before a job
 * title is read as the name, with the title after a comma. See
 * `ai/name-before-title.ts`. Off, the turn is read as typed.
 */
export function nameBeforeTitleEnabled(): boolean {
  return envFlag("NAME_BEFORE_TITLE_ENABLED");
}

/**
 * With LATE_OPEN_DATE_ENABLED on, payroll deduct is read from this form only
 * (QA, 26 Oct 2026; same flag in both apps): what the manager's own turns
 * state, and a bare Yes/No only as the reply to the payroll question just
 * asked on a Corrective Action Form. A bare "Yes" after an exit form, a
 * resignation or a Coaching Form is never stored as payroll deduct. See
 * `latePayrollFromForm` in `ai/intent-slots.ts`. Off, exactly as before.
 */
export function latePayrollFromFormEnabled(): boolean {
  return envFlag("LATE_OPEN_PAYROLL_FROM_FORM_ENABLED");
}

/**
 * The stored-slot lines put ahead of a turn ("The form is the Corrective
 * Action Form. The employee is … Policy reference: …") are not a new request
 * for the form (Sunny tester, 26 Oct 2026: "no payroll deduct" restarted the
 * Corrective Action, and its card was drafted from that turn alone). On, the
 * proposal decides whether a turn starts a new form from the manager's own
 * words. Off, as before.
 */
export function storedSlotsNotARequestEnabled(): boolean {
  return envFlag("STORED_SLOTS_NOT_A_REQUEST_ENABLED");
}

/**
 * A coaching or prior step said as its own sentence on a Corrective Action
 * (QA, 26 Oct 2026, Ask Sunny production; same flag in both apps): "i coached
 * her on 10-16 about being late", "coached her 10-16, written warning on
 * 10-20" are Prior actions rows, never the form's Date, and never the
 * Observation of Offense in place of the incident ("she was late again
 * today" stays). See `heldStepSpans` in `forms/form-date-answer.ts` and
 * `withObservation` in `ai/keep-filled-slots.ts`. Off, read as before.
 */
export function priorSentenceFixEnabled(): boolean {
  return envFlag("PRIOR_SENTENCE_FIX_ENABLED");
}

/**
 * A Corrective Action whose policy is Attendance gets Pau's attendance Action
 * Plan, with no follow-up date (26 Oct 2026; same flag in both apps). See
 * `forms/attendance-action-plan.ts`. Off, the plan is built as before.
 */
export function attendanceActionPlanEnabled(): boolean {
  return envFlag("ATTENDANCE_ACTION_PLAN_ENABLED");
}

/**
 * The yellow note "Woven does not see a matching policy in the knowledge base,
 * so the policy fields are left for you to complete." is not shown on the form
 * (Pau, 26 Oct 2026; same flag in both apps). The policy fields still stay
 * blank for the manager as before; only the note goes. A real failure, such as
 * the manual not being searchable, still says so. Off, the note shows.
 */
export function hideNoPolicyMatchNoticeEnabled(): boolean {
  return envFlag("HIDE_NO_POLICY_MATCH_NOTICE_ENABLED");
}

/**
 * A payroll answer with typos ("yes payrol ldeduct") is never read as the
 * employee's name, so the card is not called out of date for "payrol ldeduct"
 * (manager, 26 Oct 2026; same flag in both apps). See `forms/payroll-words.ts`.
 * Off, names are read as before.
 */
export function payrollTypoNotANameEnabled(): boolean {
  return envFlag("PAYROLL_TYPO_NOT_A_NAME_ENABLED");
}

/**
 * The manager's answer to "Which date goes on the form?" sets the form's date
 * (QA, 26 Oct 2026; same flag in both apps): "10-15", "the 15th" and "most
 * recent" are answers, also after a turn in between ("She is at Kearney"),
 * and "most recent" is never read as a person. See `incident-dates.ts`. Off,
 * read as before.
 */
export function dateAnswerAppliedEnabled(): boolean {
  return envFlag("DATE_ANSWER_APPLIED_ENABLED");
}

/**
 * ANSWER_NOT_A_NAME_ENABLED (default off): the employee-name reader in
 * `proposal.ts` skips a payroll answer ("yes payrol ldeduct") and a date answer
 * ("most recent"), so the card's sources do not restart at it. Reads through
 * PAYROLL_TYPO_NOT_A_NAME_ENABLED and DATE_ANSWER_APPLIED_ENABLED, which must
 * also be on. See `forms/answer-not-a-name.ts`.
 */
export function answerNotANameEnabled(): boolean {
  return envFlag("ANSWER_NOT_A_NAME_ENABLED");
}

/**
 * A one-line request carries its own account (QA, 26 Oct 2026; same flag in
 * both apps): in "create a verbal ca for <name> at kearney ne, she was late on
 * 10-15-26" the clause after the comma is what happened, so a draft the model
 * left blank is retried and then written from it (DRAFT_NEVER_BLANK). See
 * `managerAccountClause` in `forms/draft-never-blank.ts`. Off, as before.
 */
export function requestLineAccountEnabled(): boolean {
  return envFlag("REQUEST_LINE_ACCOUNT_ENABLED");
}

/**
 * "not payroll deductible" is a No (manager, 26 Oct 2026): it was not read,
 * and "Is payroll deduct applicable?" was asked on every turn. The reader
 * (`forms/payroll-deduct-answer.ts`, which imports nothing) reads the same
 * variable itself. Off, as before.
 */
export function notDeductibleReadEnabled(): boolean {
  return envFlag("NOT_DEDUCTIBLE_READ_ENABLED");
}

/**
 * An earlier step told in a sentence is a Prior actions row (managers, 26 Oct
 * 2026): "note a verbal ca was given on 9-1-26" and "she was issued a verbal
 * ca on 10.1 for this same thing" listed none. See `sentenceSteps` in
 * `forms/prior-actions.ts`. Off, as before.
 */
export function priorStepSentenceEnabled(): boolean {
  return envFlag("PRIOR_STEP_SENTENCE_ENABLED");
}

/**
 * A notice worked to the last day was fulfilled on it (manager, 26 Oct 2026):
 * "her last day worked was 9-28-26" with "gave and worked 2 week notice" left
 * "Date that notice was fulfilled" blank. See `readExitFacts` in
 * `forms/exit-facts.ts`. Off, as before.
 */
export function exitFulfilledIsLastDayEnabled(): boolean {
  return envFlag("EXIT_FULFILLED_IS_LAST_DAY_ENABLED");
}

/**
 * A Prior actions row dated after today is never kept (QA LS-B11 in the
 * sibling app, 26 Oct 2026; same flag in both apps): a typo "11-1-26" the
 * manager corrected to "11-1-25" left "Coaching — signed 11/01/2026" on the
 * draft. See `groundPriorActions` in `forms/prior-actions.ts`. Off, as before.
 */
export function futurePriorRowDropEnabled(): boolean {
  return envFlag("FUTURE_PRIOR_ROW_DROP_ENABLED");
}

/**
 * With no employee named, the chat asks one plain question — "Who is this
 * form for? Tell me the employee's full name." — never a list of details
 * (Pau, 26 Oct 2026; same flag in both apps). This covers the Corrective
 * Action intake ("ca", "blank corrective action form"); the coaching card's
 * list in the protected `ai/form-proposal.ts` follows on Pau's approval. Off,
 * as before.
 */
export function nameQuestionOnlyEnabled(): boolean {
  return envFlag("NAME_QUESTION_ONLY_ENABLED");
}

/**
 * A missed meeting with no lateness keeps the general Action Plan, not the
 * attendance (lateness) wording (QA LS-B8 / SX1, 26 Oct 2026; same flag in
 * both apps). The policy pick is unchanged. See `missedMeetingNotLateness` in
 * `forms/attendance-action-plan.ts`. Off, as before.
 */
export function meetingNotLatenessPlanEnabled(): boolean {
  return envFlag("MEETING_NOT_LATENESS_PLAN_ENABLED");
}

/**
 * The Action Plan says the deduction: "<name> will be payroll deducted $3.25."
 * when payroll deduct is Yes and the manager stated an amount (QA SX2 / SX3,
 * 26 Oct 2026; same flag in both apps). See `forms/plan-payroll-sentence.ts`.
 * Off, as before.
 */
export function planPayrollSentenceEnabled(): boolean {
  return envFlag("PLAN_PAYROLL_SENTENCE_ENABLED");
}

/**
 * A job title is never the incident (manager, 26 Oct 2026): "create corrective
 * action form for <name>, Salon Director" filed "Observed: Salon Director."
 * With the flag on the manager's-words fallback skips a clause that is only a
 * job title. See `issueFromRequest` in `forms/draft-never-blank.ts`. Off, as
 * before.
 */
export function jobTitleNotIncidentEnabled(): boolean {
  return envFlag("JOB_TITLE_NOT_INCIDENT_ENABLED");
}

/**
 * A drafted Prior actions row dated on an incident date is invented (QA BT4,
 * 26 Oct 2026; same flag in both apps): "Verbal coaching on lateness —
 * 10/15/2026" from "verbal" and "10-15", when the manager named no step on
 * 10/15. Such a row is removed unless the manager named a step on that day or
 * a form on file has it. See `groundPriorActions` in `forms/prior-actions.ts`.
 * Off, as before.
 */
export function priorRowNotOnIncidentDateEnabled(): boolean {
  return envFlag("PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED");
}

/**
 * On top of DATE_ANSWER_APPLIED_ENABLED (QA BT4, 26 Oct 2026; same flag in both
 * apps): the date question stays on every card until answered, the answer
 * counts after other answers (the app's own lines around it are skipped), and
 * a reply with two dates picks neither. Off, the live date answer is unchanged.
 * See `incident-dates.ts`.
 */
export function dateAnswerKeepsOpenEnabled(): boolean {
  return envFlag("DATE_ANSWER_KEEPS_OPEN_ENABLED");
}

/**
 * An animal anywhere in a sentence about being at work is the Animals in the
 * Workplace incident, and "cite <policy>" names that policy (QA SX5, Pau 27 Oct
 * 2026; same flag in both apps): "came into the salon to show her team her
 * new puppy" cited Standards of Conduct. See `specific-policy-topics.ts` and
 * `named-policy-section.ts`. Off, as before.
 */
export function animalAnywhereEnabled(): boolean {
  return envFlag("ANIMAL_ANYWHERE_ENABLED");
}

/**
 * The job title the manager typed is the card's Job Title, as typed (ported
 * from Ask Bubbles, QA item 3, 27 Oct 2026; same flag in both apps): "<name>
 * was a <title> at <salon> location" left Job Title empty when the title is
 * not one of this company's. See `ai/job-title-from-words.ts`. Off, as before.
 */
export function jobTitleFromWordsEnabled(): boolean {
  return envFlag("JOB_TITLE_FROM_WORDS_ENABLED");
}

/**
 * A Corrective Action card with no account asks what happened (QA P1, 26 Oct
 * 2026; same flag in both apps): "create corrective action form for <name>,
 * Salon Director" drafted with no account and no question. See
 * `ai/ca-what-happened.ts`. Off, as before.
 */
export function caAsksWhatHappenedEnabled(): boolean {
  return envFlag("CA_ASKS_WHAT_HAPPENED_ENABLED");
}

/**
 * A duty not done is an account (Pau, sf-s28, 5 Nov 2026; same flag in both
 * apps): "can i give a ca for not signing off on the cleaning check list" then
 * "can you write me a ca for <name>" was answered "You haven't told me what
 * happened yet". See `ai/ca-what-happened.ts`. Off, as before.
 */
export function omissionIsAccountEnabled(): boolean {
  return envFlag("OMISSION_IS_ACCOUNT_ENABLED");
}

/**
 * The ask is not the account (Pau, sf-s28, 5 Nov 2026; same flag in both
 * apps): "can i give a ca for not signing off on the cleaning check list" was
 * the card's whole Observation of Offense. See `ai/remap-incident.ts`
 * managerAccount. Off, as before.
 */
export function observationWithoutAskEnabled(): boolean {
  return envFlag("OBSERVATION_WITHOUT_ASK_ENABLED");
}

/**
 * A step's date is not the incident date (QA SF4, 27 Oct 2026; same flag in
 * both apps): "for opening salon late on 9-28-26" / "note a verbal ca was given
 * on 9-1-26" left the card's Date blank and dated the form today. See
 * `forms/step-sentence-dates.ts`. Off, as before.
 */
export function stepDateNotIncidentEnabled(): boolean {
  return envFlag("STEP_DATE_NOT_INCIDENT_ENABLED");
}

/**
 * A warning level stated in an "and"-clause of its own is the card's level (QA
 * S12 / SF4, 27 Oct 2026; same flag in both apps): "this should be a written
 * and note a verbal ca was given on 9-1-26" left the level blank. See
 * `ai/warning-level-clause.ts`. Off, as before.
 */
export function warningLevelAndClauseEnabled(): boolean {
  return envFlag("WARNING_LEVEL_AND_CLAUSE_ENABLED");
}

/**
 * The title set off by a comma right after the name is the typed title (QA
 * S12, 27 Oct 2026; same flag in both apps): "<name>, tan consultant at
 * manhattan". On top of JOB_TITLE_FROM_WORDS_ENABLED, which fills an empty Job
 * Title only. See `ai/job-title-from-words.ts`. Off, as before.
 */
export function jobTitleAppositionEnabled(): boolean {
  return envFlag("JOB_TITLE_APPOSITION_ENABLED");
}

/**
 * The card's "Follow-up:" read-back lists only a date the manager gave a
 * follow-up word to (QA SF9, 27 Oct 2026; same flag in both apps): "jba manual
 * 11-1-25", a corrected prior coaching date, was read back as "Follow-up:
 * 11/1/2025" though the draft has no follow-up. See `ai/form-card-slots.ts`.
 * Off, as before.
 */
export function followUpReadbackCueEnabled(): boolean {
  return envFlag("FOLLOW_UP_READBACK_CUE_ENABLED");
}

/**
 * The exit form's read-back shows the Job Title the card and the draft have
 * (ported from Ask Bubbles, QA 27 Oct 2026; same flag in both apps): with
 * JOB_TITLE_FROM_WORDS it said "Left blank for you to review: Job Title" while
 * the draft had the typed title. See `ai/job-title-from-words.ts`. Off, as
 * before.
 */
export function exitReadbackJobTitleEnabled(): boolean {
  return envFlag("EXIT_READBACK_JOB_TITLE_ENABLED");
}

/**
 * The Follow-Up Coaching Form's policy citation goes with the Original
 * Expectation (QA P5, 27 Oct 2026; same flag in both apps): it went into
 * Follow-Up Observation, which stays blank until the follow-up has happened,
 * so that field read "Policy reference: …". See `ai/policy-citation-fields.ts`.
 * Off, as before.
 */
export function followUpCitationFieldEnabled(): boolean {
  return envFlag("FOLLOW_UP_CITATION_FIELD_ENABLED");
}

/**
 * A request to the app ("can you clean up my grammar and capitalizing on proper
 * nouns?") is not the account, and a grammar request is answered (QA P5, 27 Oct
 * 2026; same flag in both apps): it was added to the card's Observation word
 * for word and never answered. See `ai/keep-filled-slots.ts`. Off, as before.
 */
export function grammarAskNotAccountEnabled(): boolean {
  return envFlag("GRAMMAR_ASK_NOT_ACCOUNT_ENABLED");
}

/**
 * A Job Title read in lower case is written in title case (QA S1 live, 27 Oct
 * 2026; same flag in both apps): "tan consultant" was saved as typed. See
 * `ai/job-title-from-words.ts`. Off, as before.
 */
export function jobTitleCaseEnabled(): boolean {
  return envFlag("JOB_TITLE_CASE_ENABLED");
}

/**
 * A clause that only sets the warning level or only lists a prior step is not
 * the account (QA S12, 27 Oct 2026; same flag in both apps): "this should be a
 * written and note a verbal ca was given on 9-1-26" went into the card's
 * Observation of Offense. See `ai/account-clauses.ts`. Off, as before.
 */
export function levelStepNotAccountEnabled(): boolean {
  return envFlag("LEVEL_STEP_NOT_ACCOUNT_ENABLED");
}

/**
 * The reply's "Job title:" line says the card's title (QA live, 27 Oct 2026;
 * same flag in both apps): with JOB_TITLE_CASE the draft said "Tan
 * Consultant" and the read-back "tan consultant". See
 * `ai/job-title-from-words.ts`. Off, as before.
 */
export function jobTitleReadbackCaseEnabled(): boolean {
  return envFlag("JOB_TITLE_READBACK_CASE_ENABLED");
}

/**
 * A prior step's date is no candidate in the date question (QA live, 27 Oct
 * 2026; same flag in both apps): with STEP_DATE_NOT_INCIDENT on, "note a verbal
 * ca was given on 9-1-26" still made the reply ask "You mentioned more than one
 * date (9/1, 9/28)" although the card was 9/28. See `forms/incident-dates.ts`
 * (`incidentDates`). Off, as before.
 */
export function stepDateNoQuestionEnabled(): boolean {
  return envFlag("STEP_DATE_NO_QUESTION_ENABLED");
}

/**
 * The date reader also reads "2 october", "the 2nd of october", "on 10.2" and
 * "on the 2nd" (QA, 27 Oct 2026; same flag in both apps). See
 * `forms/wider-dates.ts`. Off, as before.
 */
export function widerDateReaderEnabled(): boolean {
  return envFlag("WIDER_DATE_READER_ENABLED");
}

/**
 * The name question uses the first name the manager gave, and is never asked
 * twice in the same words (QA S15, 27 Oct 2026; same flag in both apps): "I
 * have an employee ivy …" then "Yes" got "Who is this form for? Tell me the
 * employee's full name." twice. See `ai/first-name-ask.ts`. Off, as before.
 */
export function firstNameAskEnabled(): boolean {
  return envFlag("FIRST_NAME_ASK_ENABLED");
}

/**
 * The AI reads the form request, the code checks it (Pau, 27 Oct 2026; same
 * flag in both apps). One extra Haiku call per form turn returns each field
 * with the manager's own words it came from; a field is kept only when its
 * quote, the roster, the date readers and the manual agree, and it fills only
 * what today's readers left open, never what they settled. A failed or slow
 * call leaves the turn on today's readers. See `ai/reader/`. Off, as before.
 */
export function aiReadsCodeChecksEnabled(): boolean {
  return envFlag("AI_READS_CODE_CHECKS_ENABLED");
}

/**
 * "Marlowe, Quinn" is read as Quinn Marlowe without a model (QA, 27 Oct 2026;
 * same flag in both apps): the AI reader's one measured win, by the reader's own
 * checks alone. A "Last, First" pair in the manager's turns that fits exactly one
 * person on the scoped roster fills an employee today's readers left open, and
 * the Create check takes the part-of-name card. See `ai/reader/last-first.ts`.
 * Off, as before.
 */
export function lastFirstNameReadEnabled(): boolean {
  return envFlag("LAST_FIRST_NAME_READ_ENABLED");
}

/** A checked reading is merged into the turn: the AI reader's, or the Last, First one. */
export function checkedReadingEnabled(): boolean {
  return aiReadsCodeChecksEnabled() || lastFirstNameReadEnabled();
}

/**
 * A bare "$25" right after the payroll amount question is read back and put on
 * the card (QA, 27 Oct 2026; Sunny-only): the routed turn's slot lines hid it
 * from the bare-figure reader. See `ai/amount-answer-saved.ts`. Off, as before.
 */
export function amountAnswerSavedEnabled(): boolean {
  return envFlag("AMOUNT_ANSWER_SAVED_ENABLED");
}

/**
 * A turn that only answers the payroll amount ("i dont know the amount",
 * "$25") is not added to the Observation of Offense (QA, 27 Oct 2026; same
 * flag in both apps). See `forms/amount-answer.ts`. Off, as before.
 */
export function amountAnswerNotAccountEnabled(): boolean {
  return envFlag("AMOUNT_ANSWER_NOT_ACCOUNT_ENABLED");
}

/**
 * One user's traced model calls per UTC day are capped at MODEL_CALL_DAILY_CAP
 * (default 40); over it, the chat answers without calling the model (Pau,
 * 27 Oct 2026; same flag in both apps). See `ai/spend-guard.ts`. Off, as before.
 */
export function modelCallDailyCapEnabled(): boolean {
  return envFlag("MODEL_CALL_DAILY_CAP_ENABLED");
}

/**
 * This month's traced model spend, at list prices, is held under
 * MONTHLY_BUDGET_USD (default 10); at it, no question reaches the model (Pau,
 * 27 Oct 2026; same flag in both apps). See `ai/spend-guard.ts`. Off, as before.
 */
export function monthlyBudgetGuardEnabled(): boolean {
  return envFlag("MONTHLY_BUDGET_GUARD_ENABLED");
}

/**
 * A bare "the 2nd" in the manager's notes is read against today when a draft's
 * dates are checked (QA, 27 Oct 2026; same flag in both apps): the drafted
 * "December 2, 2025" was kept beside a form dated 10/02/2026. See
 * `forms/form-date-grounding.ts`. Off, as before.
 */
export function ordinalDateInDraftEnabled(): boolean {
  return envFlag("ORDINAL_DATE_IN_DRAFT_ENABLED");
}

/**
 * The draft's policy search reads the manager's account only, never a payroll
 * or amount answer, and the drafting rules forbid an opening, shift or role the
 * manager did not write (QA, 27 Oct 2026; same flag in both apps). See
 * `forms/account-only-policy-query.ts`. Off, as before.
 */
export function accountOnlyPolicyQueryEnabled(): boolean {
  return envFlag("ACCOUNT_ONLY_POLICY_QUERY_ENABLED");
}

/**
 * The date reader also reads "last tuesday", "this past monday", "on tuesday",
 * "yesterday" and "today" from the business date (QA, 27 Oct 2026; same flag
 * in both apps). See `forms/relative-dates.ts`. Off, as before.
 */
export function relativeDateReaderEnabled(): boolean {
  return envFlag("RELATIVE_DATE_READER_ENABLED");
}

/**
 * A card with no date says which of the manager's words it could not read as
 * one and asks for the date (QA, 27 Oct 2026; same flag in both apps). See
 * `ai/unread-date-ask.ts`. Off, as before.
 */
export function unreadDateAskEnabled(): boolean {
  return envFlag("UNREAD_DATE_ASK_ENABLED");
}

/**
 * "yesturday", "tuesdy" and "last tusday" are read by the relative date reader
 * as the day words they can only be (QA, 27 Oct 2026; same flag in both
 * apps). See `forms/typo-match.ts`. Off, as before.
 */
export function dayWordTyposEnabled(): boolean {
  return envFlag("DAY_WORD_TYPOS_ENABLED");
}

/**
 * The chat's readers see the manager's turns with each typo read as the one
 * known word it can only be; employee names never (QA, 27 Oct 2026; same flag
 * in both apps). See `ai/typo-reading-copy.ts`. Off, as before.
 */
export function typoReadingCopyEnabled(): boolean {
  return envFlag("TYPO_READING_COPY_ENABLED");
}

/**
 * The form routes' readers (the draft's notes; the create route's payroll
 * amount) see the manager's words with each typo read as the one known word it
 * can only be; stored text stays as typed (QA, 27 Oct 2026; same flag in both
 * apps). See `ai/typo-reading-copy.ts`. Off, as before.
 */
export function typoReadingRoutesEnabled(): boolean {
  return envFlag("TYPO_READING_ROUTES_ENABLED");
}

/**
 * "i dont know the amount", right after the amount question, is answered with
 * one line instead of the card alone (QA, 27 Oct 2026; same flag in both
 * apps). See `ai/amount-unknown-ack.ts`. Off, as before.
 */
export function amountUnknownAckEnabled(): boolean {
  return envFlag("AMOUNT_UNKNOWN_ACK_ENABLED");
}

/**
 * A salon-scoped manager who names a salon they are not assigned to is told
 * so in the reply (QA, 28 Oct 2026; same flag in both apps). See
 * `ai/out-of-scope-place.ts`. Off, as before.
 */
export function outOfScopePlaceSaidEnabled(): boolean {
  return envFlag("OUT_OF_SCOPE_PLACE_SAID_ENABLED");
}

/**
 * A card never holds a salon the manager is not assigned to: it goes back to
 * the manager's own, or asks which (Pau, 28 Oct 2026; same flag in both
 * apps). See `ai/keeps-own-place.ts`. Off, as before.
 */
export function outOfScopePlaceKeepsOwnEnabled(): boolean {
  return envFlag("OUT_OF_SCOPE_PLACE_KEEPS_OWN_ENABLED");
}

/**
 * While the card is open, "change to coaching" / "change to ca" switch it to
 * the other form (Pau, 28 Oct 2026; same flag in both apps). See
 * `ai/form-type-switch.ts`. Off, as before.
 */
export function formTypeSwitchEnabled(): boolean {
  return envFlag("FORM_TYPE_SWITCH_ENABLED");
}

/**
 * After the form was created, "change to coaching" starts the other form and
 * the reply says the existing one is left as it is (Pau, 28 Oct 2026; same
 * flag in both apps). See `ai/form-type-switch.ts`. Off, as before.
 */
export function formTypeSwitchAfterCreateNoteEnabled(): boolean {
  return envFlag("FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED");
}

/**
 * Payroll deduct changed in a finalized form's Change something panel rebuilds
 * the new draft's Action Plan (Pau, 28 Oct 2026; same flag in both apps). See
 * the forms instance route's PATCH. Off, the panel asks the manager to check
 * the plan, as before.
 */
export function cardChangePlanRebuildEnabled(): boolean {
  return envFlag("CARD_CHANGE_PLAN_REBUILD_ENABLED");
}

/**
 * Every Claude call is counted toward the monthly budget, not only the chat
 * answer and the reader: retries, helpers, form revision, the Create card's
 * draft, Sales Totals and template ingest (Pau and QA, 28 Oct 2026; same flag
 * in both apps). See `ai/spend-meter.ts`. Counting only — nothing is blocked
 * that was not before. Off, the guard counts as before.
 */
export function spendGuardAllCallsEnabled(): boolean {
  return envFlag("SPEND_GUARD_ALL_CALLS_ENABLED");
}

/**
 * A first name alone ("quinn") is asked about from the manager's own roster —
 * "Did you mean **Quinn Marlowe** or **Quinn Ashby**?" or "Is this for
 * **Quinn Marlowe**?" — instead of a card for the bare name or a plain "who is
 * this for" (QA and Pau, 28 Oct 2026; same flag in both apps). See
 * `ai/first-name-suggest.ts`. Off, as before.
 */
export function firstNameSuggestEnabled(): boolean {
  return envFlag("FIRST_NAME_SUGGEST_ENABLED");
}

/**
 * A ticked "Other" box is never left with its write-in empty: the write-in
 * gets what happened in the manager's words, else "Other" is unticked (QA,
 * 29 Oct 2026; same flag in both apps). See `forms/other-write-in.ts`. Off,
 * the draft as the model returned it.
 */
export function otherWriteInGuardEnabled(): boolean {
  return envFlag("OTHER_WRITE_IN_GUARD_ENABLED");
}

/**
 * The Other write-in is never a question the manager asked: "Which forms can I
 * create here?" a turn before the coaching request came back as the topic (QA,
 * 30 Oct 2026; same flag in both apps). See `forms/other-write-in.ts`. Off, as
 * before.
 */
export function otherWriteInNotAQuestionEnabled(): boolean {
  return envFlag("OTHER_WRITE_IN_NOT_A_QUESTION_ENABLED");
}

/**
 * The history-state read counts turns in batches of conversation ids, so an
 * account with thousands of chats no longer gets a 503 from
 * GET /api/chat/conversations/import (QA, 31 Oct 2026; same flag in both
 * apps). See `chat/store.ts` `ownHistoryState`. Off, as before.
 */
/**
 * A new request's card reads back as its Observation of Offense only the
 * turns of that request, never an earlier incident in the same chat (QA live
 * check, 3 Nov 2026: "…rugs untl 12;30pm <name> for being late to opening this
 * morning" on the late-opening card). See `ai/keep-filled-slots.ts`. Off, as
 * before.
 */
export function cardObservationOwnRequestEnabled(): boolean {
  return envFlag("CARD_OBSERVATION_OWN_REQUEST_ENABLED");
}

/**
 * "fix her last name …" on a Corrective Action changes the Employee Name on
 * the card and the draft, and says so (Pau, 3 Nov 2026) — only to a name that
 * shares a first or last name with the form's and that exactly one person on
 * the roster has. See `forms/ca-name-from-chat.ts`. Off, as before.
 */
export function caNameFromChatEnabled(): boolean {
  return envFlag("CA_NAME_FROM_CHAT_ENABLED");
}

/**
 * With the card's policy section in force (NEXT_PUBLIC_CARD_POLICY_TO_DRAFT),
 * the "Policy Violated" line cites the sections Direct policy quotes, the
 * card's first — not the box's own section (QA live check, 3 Nov 2026: the
 * quote was Late Opening p.15, the line "Attendance Policy, JBA Policy Manual
 * p.14"). See the draft route. Off, as before.
 */
export function cardPolicyLabelEnabled(): boolean {
  return envFlag("CARD_POLICY_LABEL_ENABLED");
}

/**
 * A card's name that follows a house number in the manager's turns ("coaching
 * form for 123 Main Street") is an address, not a person: the card asks who
 * the form is for, and the next request does not keep it (QA live check, 3 Nov
 * 2026). See `forms/person-guard.ts` `withAddressNotPerson`. Off, as before.
 */
export function addressNotPersonEnabled(): boolean {
  return envFlag("ADDRESS_NOT_PERSON_ENABLED");
}

/**
 * A card that still needs something never repeats the last reply word for
 * word: it says first that it is still waiting on the same answer (the team
 * card's salon/store question, asked twice; the replay pack, 3 Nov 2026).
 * Same flag in both apps. See `forms/reply-guards.ts` `withoutRepeatedAsk`.
 * Off, as before.
 */
export function sameAskNoRepeatEnabled(): boolean {
  return envFlag("SAME_ASK_NO_REPEAT_ENABLED");
}

export function chatHistoryStateChunkedEnabled(): boolean {
  return envFlag("CHAT_HISTORY_STATE_CHUNKED_ENABLED");
}

/**
 * A freshly signed-in browser shows the account's chats even when the
 * history-state read fails: the list the server returned is merged on its own
 * (QA, 31 Oct 2026; same flag in both apps). Read in the browser, so only a
 * statically written `process.env.NEXT_PUBLIC_…` is inlined, at build time.
 * See `store/app-store.tsx`. Off, as before.
 */
/**
 * The draft cites the policy the card cited (QA live check, 3 Nov 2026: the
 * card read "Late Opening p.15", the draft made from it "Attendance p.14").
 * The browser sends the card's heading with the draft request; the draft
 * route uses it where the pinned manual has it. Read on both sides, so a
 * statically written `process.env.NEXT_PUBLIC_…`, inlined at build time. See
 * `forms/card-policy.ts`. Off, as before.
 */
export function cardPolicyToDraftEnabled(): boolean {
  const inlined = process.env.NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED;
  return typeof inlined === "string" && ON.has(inlined.trim().toLowerCase());
}

export function chatHistoryTolerantEnabled(): boolean {
  const inlined = process.env.NEXT_PUBLIC_CHAT_HISTORY_TOLERANT_ENABLED;
  return typeof inlined === "string" && ON.has(inlined.trim().toLowerCase());
}

/**
 * An import of a chat this account does not hold yet must prove it is its
 * own: every answered turn recorded for this account; a chat with no turn on
 * record is declined (independent review, 31 Oct 2026; same flag in both
 * apps). The activity read is batched. See `chat/store.ts`. Off, as before.
 */
export function chatImportProvenOwnEnabled(): boolean {
  return envFlag("CHAT_IMPORT_PROVEN_OWN_ENABLED");
}

/**
 * With a Coaching Form draft open, details given in plain words, "make that
 * update", and "update the draft with these details" (the previous answer's)
 * are written into the draft by the open-form revision (ported from Ask
 * Bubbles, QA 30 Oct 2026; same flag in both apps). See
 * `forms/form-content-turn.ts`. Off, as before.
 */
export function formEditPlainWordsEnabled(): boolean {
  return envFlag("FORM_EDIT_PLAIN_WORDS_ENABLED");
}

/**
 * With a form open, an answer that changed nothing never says it updated the
 * form (ported from Ask Bubbles, QA 30 Oct 2026; same flag in both apps). See
 * `forms/form-content-turn.ts` `honestFormReply`. Off, as before.
 */
export function formEditHonestReplyEnabled(): boolean {
  return envFlag("FORM_EDIT_HONEST_REPLY_ENABLED");
}

/**
 * One answer to "is this a person?" for every reader of who a form is for:
 * somebody on the roster always is; a policy ("Must See Behaviors"), a
 * practice run ("Practice") or a metric ("Avg Club") never is (QA, 3 Nov
 * 2026; same flag in both apps). See `forms/person-guard.ts`. Off, as before.
 */
export function personGuardEnabled(): boolean {
  return envFlag("PERSON_GUARD_ENABLED");
}

/**
 * A reply that would open with the same paragraph as the one before it, with
 * no card, is not said again — one line says what moves it on ("It also gave
 * the same refusal 3 times", the 2 Nov 2026 scan; same flag in both apps). See
 * `forms/reply-guards.ts`. Off, as before.
 */
export function refusalNoRepeatEnabled(): boolean {
  return envFlag("REFUSAL_NO_REPEAT_ENABLED");
}

/**
 * "my DM told me …" is the manager's own District Manager, never the
 * employee's title on the card (the 2 Nov 2026 scan; same flag in both apps).
 * See `forms/reply-guards.ts`. Off, as before.
 */
export function titleNotSpeakersManagerEnabled(): boolean {
  return envFlag("TITLE_NOT_SPEAKERS_MANAGER_ENABLED");
}

/**
 * A new form request for a person already in the chat draws its card from its
 * own turns, not an earlier request's ("a new late-opening request reused an
 * older trash-and-rugs incident", the 2 Nov 2026 scan; same flag in both apps).
 * See `forms/this-persons-turns.ts`. Off, as before.
 */
export function newRequestOwnTurnsEnabled(): boolean {
  return envFlag("NEW_REQUEST_OWN_TURNS_ENABLED");
}

/**
 * With a draft open, a turn that names no form, no other person and is not a
 * question is content for that draft — never a new card (the 2 Nov 2026 scan:
 * a Corrective Action's next message started a new draft without what the
 * manager had typed, and that one was finalized; same flag in both apps). See
 * `forms/open-draft-turn.ts`. Off, as before.
 */
export function openDraftKeepsTurnsEnabled(): boolean {
  return envFlag("OPEN_DRAFT_KEEPS_TURNS_ENABLED");
}

/**
 * With a Coaching draft open, "yes, do that", "the details we just
 * discussed!!!" and "include the details of …" are written into the draft's
 * Details, and the answer's "Updating the draft now" / "That's on the card"
 * claims are caught too (ported from Ask Bubbles: a Location Manager, 30 Oct
 * 2026, 2 stars; same flag in both apps). See `forms/form-content-turn.ts`.
 * Off, as before.
 */
export function formEditRefersBackEnabled(): boolean {
  return envFlag("FORM_EDIT_REFERS_BACK_ENABLED");
}

/**
 * A policy named with more in the same message: the rest goes to the revision
 * of the same draft, and the reply never says "everything else is as it was"
 * over a sentence it dropped (the 2 Nov 2026 scan: "Previous Coaching is when
 * she signed the Policy manual May 2025" left Prior Actions empty; same flag
 * in both apps). See `forms/policy-rest-of-turn.ts`. Off, as before.
 */
export function policyChangeRestOfTurnEnabled(): boolean {
  return envFlag("POLICY_CHANGE_REST_OF_TURN_ENABLED");
}

/**
 * No reply says the form changed, or that something was checked against the
 * records, unless this turn changed the form: "now reads …", "Confirmed
 * against records … matching Woven" are caught on every line about the form,
 * the name or the record (the 2 Nov 2026 scan; same flag in both apps). See
 * `forms/form-content-turn.ts`. Off, as before.
 */
export function claimGuardEnabled(): boolean {
  return envFlag("CLAIM_GUARD_ENABLED");
}

/**
 * "fix her last name …", "the name is supposed to be …", "the correct way is
 * …" correct the name on the open draft, as "change her name to …" does (the
 * 2 Nov 2026 scan; same flag in both apps). See `forms/name-correction-words.ts`.
 * Off, as before.
 */
export function nameCorrectionWordsEnabled(): boolean {
  return envFlag("NAME_CORRECTION_WORDS_ENABLED");
}

/**
 * With a draft open, a reply never offers a form selection ("Based on what
 * you've described, I can prepare:") — that heading was all the manager saw
 * (the 2 Nov 2026 scan; same flag in both apps). Off, as before.
 */
export function openFormNoSelectionEnabled(): boolean {
  return envFlag("OPEN_FORM_NO_SELECTION_ENABLED");
}

/**
 * A revised or drafted field never keeps an all-caps angle-bracket token such
 * as "<UNKNOWN>" (Sunny live check, 31 Oct 2026; same flag in both apps). See
 * `forms/drafted-text.ts`. Off, as before.
 */
export function anglePlaceholderGuardEnabled(): boolean {
  return envFlag("ANGLE_PLACEHOLDER_GUARD_ENABLED");
}

/**
 * A chat revision whose value for a field is the text already there is not a
 * change, so the reply never says "Updated" for it (Sunny live check A3, 31
 * Oct 2026; same flag in both apps; protected-file edit approved by Pau in
 * writing). See `forms/chat-revision.ts`. Off, as before.
 */
export function revisionSameValueEnabled(): boolean {
  return envFlag("REVISION_SAME_VALUE_ENABLED");
}

/**
 * "Do the same coaching form for <another>": the new person's draft gets the
 * content of the manager's own earlier form of that template, name swapped
 * (ported from Ask Bubbles, QA 30 Oct 2026; same flag in both apps). See
 * `forms/same-form-copy.ts`. Off, as before.
 */
export function sameFormCopyEnabled(): boolean {
  return envFlag("SAME_FORM_COPY_ENABLED");
}

/**
 * SAME_FORM_COPY_NEW_PERSON_ENABLED (coding3, 5 Nov 2026; same flag in both
 * apps; default off). "can you create the same draft that we did with <C> by
 * changing the name and position?" with <C>'s own form open (or no form open
 * and <C>'s own form on file), the new person not named yet: asks who the new
 * form is for, leaves <C>'s form alone and makes no card for <C>. The reply
 * carries the form to copy from (`pendingCopy`); the next turn naming one
 * roster person starts that person's card with `copyFromInstanceId`, and
 * Create copies that form's content onto the new draft (creator and visibility
 * re-checked) — never re-read from the wording. Any other turn drops it. See
 * `forms/same-form-copy.ts`. Off, as before.
 */
export function sameFormCopyNewPersonEnabled(): boolean {
  return envFlag("SAME_FORM_COPY_NEW_PERSON_ENABLED");
}

/**
 * "A coaching form for my whole staff": no card for everyone. Several salons
 * in scope and none named → asks which; one → lists its staff from the scoped
 * Woven directory (name and position) and asks who the form is for (ported
 * from Ask Bubbles; Pau, 30 Oct 2026; same flag in both apps). See
 * `forms/staff-picker.ts`. Off, as before.
 */
export function staffPickerEnabled(): boolean {
  return envFlag("STAFF_PICKER_ENABLED");
}

/**
 * The whole-staff list shows the salon's staff only — salon titles, not the
 * office accounts the directory also affiliates with a salon (QA, 31 Oct 2026;
 * same flag in both apps). See `forms/staff-picker.ts`. Off, as before.
 */
export function staffPickerStoreTitlesEnabled(): boolean {
  return envFlag("STAFF_PICKER_STORE_TITLES_ENABLED");
}

/**
 * A card cites this person's own request turns, not the person before them
 * (QA, live check B2, 31 Oct 2026; same flag in both apps; protected-file edit
 * approved by Pau in writing). See `forms/this-persons-turns.ts`. Off, as before.
 */
export function thisPersonsTurnsEnabled(): boolean {
  return envFlag("THIS_PERSONS_TURNS_ENABLED");
}

/**
 * An Assistant Salon Director's Corrective Action counts the employee's
 * earlier warnings filed by anyone at their salons, shown by level and date
 * only (Pau, 31 Oct 2026, "Yes option A"; same flag in both apps). See
 * `forms/prior-forms.ts`. Off, only their own forms, as before.
 */
export function amPriorWarningsEnabled(): boolean {
  return envFlag("AM_PRIOR_WARNINGS_ENABLED");
}

/**
 * A chat answer cut off at max_tokens is asked once more with a larger budget,
 * and never shown cut off (QA, live, 1 Nov 2026; ported from Ask Bubbles, where
 * it is always on). See `ai/truncation.ts`. Off, as before.
 */
export function truncationRetryEnabled(): boolean {
  return envFlag("TRUNCATION_RETRY_ENABLED");
}

/**
 * With TRUNCATION_RETRY_ENABLED, a first attempt that took over 50 s starts no
 * retry, so a turn never stacks past the chat route's 120 s ceiling (QA, 1 Nov
 * 2026; same flag in both apps). See `ai/truncation.ts`. Off, as before.
 */
export function truncationRetryBudgetEnabled(): boolean {
  return envFlag("TRUNCATION_RETRY_BUDGET_ENABLED");
}

/**
 * The app's own report names ("Daily Stats", "Sales Totals") are never read as
 * an employee (QA, live, 1 Nov 2026; same flag in both apps). See
 * `ai/not-a-person.ts`. Off, as before.
 */
export function reportNameNotAPersonEnabled(): boolean {
  return envFlag("REPORT_NAME_NOT_A_PERSON_ENABLED");
}

/**
 * The manager's own name is only for addressing them, never an employee's in an
 * answer (QA, live, 1 Nov 2026; same flag in both apps). See
 * `ai/manager-name-guard.ts`. Off, as before.
 */
export function managerNameNotEmployeeEnabled(): boolean {
  return envFlag("MANAGER_NAME_NOT_EMPLOYEE_ENABLED");
}

/**
 * /api/chat streams a slow answer (a 200 with keep-alive bytes, then the
 * answer), so nothing between the browser and the function cuts it off at 30 s
 * (QA, live, 1 Nov 2026; same flag in both apps). See
 * `api/streamed-response.ts`. Off, as before.
 */
export function chatResponseStreamEnabled(): boolean {
  return envFlag("CHAT_RESPONSE_STREAM_ENABLED");
}

/**
 * With a draft open, a turn that is only "for whole staff" is the staff list,
 * not another card for the person the conversation last named (QA, live, 31 Oct
 * 2026; same flag in both apps). See `forms/staff-picker.ts`. Off, as before.
 */
export function staffPickerBareAnswerEnabled(): boolean {
  return envFlag("STAFF_PICKER_BARE_ANSWER_ENABLED");
}

/**
 * "coaching form for all team members" makes the team Coaching card ("All
 * team members", one salon) for every role that may create a coaching form,
 * in every chat — the staff picker no longer refuses it (ported from Ask
 * Bubbles: a Location Manager, 2 Nov 2026, rated 1 star; Pau, 3 Nov: "I need
 * all managers to have it"). Same flag in both apps. See
 * `forms/whole-team-coaching.ts`. Off, as before.
 */
export function wholeTeamCoachingEnabled(): boolean {
  return envFlag("WHOLE_TEAM_COACHING_ENABLED");
}

/**
 * With a draft open, "make me a CA for <the same person> for being late to
 * opening this morning" — a request for a form, for that person, mostly about
 * something not said before — is a new card, and the open draft is not
 * touched (QA live check, 3 Nov 2026: the open draft was redrafted from both
 * incidents). See `forms/new-request-open-draft.ts`. Off, as before.
 */
export function newRequestOpenDraftEnabled(): boolean {
  return envFlag("NEW_REQUEST_OPEN_DRAFT_ENABLED");
}

/**
 * Each line of a Corrective Action's "List previously received coaching
 * and/or corrective action with date signed" read from Form Monitoring names
 * the earlier form's policy: "Verbal corrective action (Attendance) — signed
 * 11/02/2026" (Pau, 3 Nov 2026). Coaching lines are unchanged: a Coaching Form
 * has no policy violated. Same flag in both apps. See `forms/prior-forms.ts`.
 * Off, as before.
 */
export function priorActionsPolicyEnabled(): boolean {
  return envFlag("PRIOR_ACTIONS_POLICY_ENABLED");
}

/**
 * PRIOR_ACTIONS_NO_SIGNED_ENABLED (QA, a location manager's chat in the sibling app, 5 Nov 2026; default off).
 * "this is a verbal warning. previous coaching policy manual 10-15-26" drafted Prior actions that said the
 * earlier steps were SIGNED; nothing was ever signed or given. Rule (Pau / QA): list only finalized forms, and
 * never say "signed" unless the record or the manager says so. On: the drafting prompt no longer asks for
 * "— signed <date>", `groundPriorActions` drops a "signed" the manager did not write for that date, and the
 * code's own lines read "<step> — finalized MM/DD/YYYY" for a form on file and "<step> — MM/DD/YYYY" for a step
 * the manager told ("signed" only when they said so). The list parsers read every format. Off, as before.
 */
export function priorActionsNoSignedEnabled(): boolean {
  return envFlag("PRIOR_ACTIONS_NO_SIGNED_ENABLED");
}

/**
 * PRIOR_COACHING_DENIAL_ENABLED (QA, 5 Nov 2026; default off): "There's no
 * prior coaching on file." was quoted back by PRIOR_COACHING_OPTIONAL_ENABLED
 * as "Prior coaching note: prior coaching on file." — the protected note
 * reader starts at "prior coaching" and drops the "no". With the flag on, the
 * caller hands it the manager's turns with each sentence that denies prior
 * coaching left out, unless it names a further step after "except", "other
 * than" or "but" ("no prior coaching except a verbal in July", "… except a
 * verbal warning"; Pau's decision B, 6 Nov 2026), which is kept as that step
 * (`ai/prior-coaching-denial.ts`). Off, the turns as before.
 */
export function priorCoachingDenialEnabled(): boolean {
  return envFlag("PRIOR_COACHING_DENIAL_ENABLED");
}

/**
 * Two more team-card wordings (QA live check, 3 Nov 2026), read only with
 * WHOLE_TEAM_COACHING on: "salon wide everyone needs the reminder to call a
 * manager for cash drawer shortages" — the team, then what it needs, with no
 * "coaching" in it — is the team Coaching card when no draft is open; and
 * words that only name the audience ("for the whole salon") are not handed on
 * as the card's content, so the Observation does not echo them. Same flag in
 * both apps. See `forms/whole-team-coaching.ts`. Off, as before.
 */
export function teamCardWordingEnabled(): boolean {
  return envFlag("TEAM_CARD_WORDING_ENABLED");
}

/**
 * Words that only name a policy ("must see behaviors") are not read back as
 * the Observation of Offense on the card (QA live check, 3 Nov 2026: "can you
 * create a CA for must see behaviors" → "**Observation of Offense:** must see
 * behaviors" under "Who is this form for?"). Same flag in both apps where the
 * read-back exists. See `forms/person-guard.ts` `namesOnlyAPolicy`. Off, as
 * before.
 */
export function observationNotPolicyNameEnabled(): boolean {
  return envFlag("OBSERVATION_NOT_POLICY_NAME_ENABLED");
}

/**
 * COMPLAINT_ACCOUNT_ENABLED (QA's audit, 7 Nov 2026; default off). "verbal warning The date she complained was Oct
 * 31st . The customer said …" made the Observation of Offense open "verbal warning The date she complained was …": the
 * warning level is the form's Type of Warning, never the account. On: a sentence that opens with the level the app
 * reads as this form's (`forms/warning-level.ts` statedWarningLevel) runs on without it (`ai/keep-filled-slots.ts`
 * withAccount). Off, as before.
 */
export function complaintAccountEnabled(): boolean {
  return envFlag("COMPLAINT_ACCOUNT_ENABLED");
}

/**
 * The staff picker reads a short salon name ("kearney") among the account's
 * own salons and reuses the salon this conversation already settled, instead
 * of asking "Which salon's staff…" again (same report; same flag in both
 * apps). See `forms/staff-picker.ts`. Off, as before.
 */
export function staffPickerRememberLocationEnabled(): boolean {
  return envFlag("STAFF_PICKER_REMEMBER_LOCATION_ENABLED");
}

/**
 * A directory row that is a shared or salon login ("<Salon> Account") is
 * never a team member: not listed, suggested or matched (same report; same
 * flag in both apps). See `forms/employee-match.ts`. Off, as before.
 */
export function sharedLoginNotStaffEnabled(): boolean {
  return envFlag("SHARED_LOGIN_NOT_STAFF_ENABLED");
}

/**
 * Once the staff picker has listed a salon's staff in this conversation,
 * another whole-staff turn is told what to do next in one line, never the
 * same refusal and list again (same report; same flag in both apps). See
 * `forms/staff-picker.ts`. Off, as before.
 */
export function staffPickerNoRepeatEnabled(): boolean {
  return envFlag("STAFF_PICKER_NO_REPEAT_ENABLED");
}

/**
 * "Create this coaching form for everyone on my team": one DRAFT Coaching Form
 * per person at the open draft's salon, each with the open draft's Details,
 * after one confirmation listing who (ported from Ask Bubbles; Pau, 3 Nov
 * 2026: "also having to replicate that coaching verbiage to all coaching forms
 * so she doesn't have to copy paste"; same flag in both apps). See
 * `forms/coaching-for-everyone.ts`. Off, as before.
 */
export function coachingForEveryoneEnabled(): boolean {
  return envFlag("COACHING_FOR_EVERYONE_ENABLED");
}

/**
 * A chat another account wrote is never saved to this one: in the sibling app
 * an Assistant Manager's Import on a Location Manager's browser copied the
 * manager's chats into their account (QA, 30 Oct 2026; same flag in both apps).
 * See `chat/store.ts` `saveOwnConversation`. Off, as before.
 */
export function chatImportOwnOnlyEnabled(): boolean {
  return envFlag("CHAT_IMPORT_OWN_ONLY_ENABLED");
}

/**
 * "She was late last week" with no date read and the form left at today: the
 * Corrective Action draft is told today is not the incident's date, today is
 * not treated as a date the manager gave, and the manager is told to set the
 * date (QA, 29 Oct 2026; same flag in both apps). See
 * `forms/unread-day-date.ts`. Off, as before.
 */
export function unreadDayNotIncidentDateEnabled(): boolean {
  return envFlag("UNREAD_DAY_NOT_INCIDENT_DATE_ENABLED");
}

/**
 * The card's question about a day it cannot read says plainly that it can't
 * guess, and shows the format to type: I can't guess "last week" - what date
 * was it? Type it like 9/11/26. (Pau, 29 Oct 2026; same flag in both apps.)
 * Only with UNREAD_DATE_ASK_ENABLED, which asks the question. Off, the
 * question reads as before.
 */
export function unreadDatePlainAskEnabled(): boolean {
  return envFlag("UNREAD_DATE_PLAIN_ASK_ENABLED");
}

/**
 * Create accepts a card whose roster name the manager typed in part ("katrin
 * dov" for Katrin Dovetail, filled by the AI reader): every word they typed
 * begins a word of the card's name. A later turn naming somebody else still
 * makes the card stale (QA and Pau, 29 Oct 2026; same flag in both apps). See
 * `forms/proposal-currency.ts`. Off, as before.
 */
export function partialNameCardCurrentEnabled(): boolean {
  return envFlag("PARTIAL_NAME_CARD_CURRENT_ENABLED");
}

/**
 * Create accepts a card whose roster person was typed by preferred name and
 * last name ("kit dovetail" for Katrin Dovetail, preferred name Kit) — the
 * creation check otherwise reads the typed name as somebody else (audit, 29
 * Oct 2026; same flag in both apps). See `forms/preferred-name-current.ts`.
 * Off, as before.
 */
export function preferredNameCardCurrentEnabled(): boolean {
  return envFlag("PREFERRED_NAME_CARD_CURRENT_ENABLED");
}

/**
 * A switch turn that names a form of its own ("make it a follow up coaching")
 * is read as typed, not as "change this to a coaching form" (audit, 29 Oct
 * 2026; same flag in both apps). See `ai/form-type-switch.ts`. Off, as
 * before.
 */
export function switchKeepsNamedFormEnabled(): boolean {
  return envFlag("SWITCH_KEEPS_NAMED_FORM_ENABLED");
}

/**
 * Each card from a message that asked for several forms ("a coaching form for
 * A and a CA for B") stays current at Create after later turns that name
 * nobody else, exclude nobody on it and ask for no other form (audit, 29 Oct
 * 2026; same flag in both apps). See `forms/proposal-currency.ts`. Off, as
 * before.
 */
export function severalFormsStayCurrentEnabled(): boolean {
  return envFlag("SEVERAL_FORMS_STAY_CURRENT_ENABLED");
}

/**
 * A card whose name, as typed, is a first or preferred name and the start of
 * a surname ("marisol co") is asked about from the manager's roster — "Is
 * this for **Marisol Corvane**?" or "Did you mean …" — in code, whatever the
 * AI reader read (QA and Pau, 29 Oct 2026; same flag in both apps). See
 * `ai/first-name-suggest.ts`. Needs FIRST_NAME_SUGGEST_ENABLED. Off, as before.
 */
export function partialSurnameAskEnabled(): boolean {
  return envFlag("PARTIAL_SURNAME_ASK_ENABLED");
}

/**
 * An answer to the first-name question ("no, jordan testperson") replaces
 * the whole name the manager typed ("marisol co"), not the first name alone
 * (QA live, 29 Oct 2026; same flag in both apps). See
 * `ai/first-name-suggest.ts`. Off, as before.
 */
export function suggestAnswerReplacesTypedEnabled(): boolean {
  return envFlag("SUGGEST_ANSWER_REPLACES_TYPED_ENABLED");
}

/**
 * At Create, a typed surname piece that does not begin the card's surname
 * but has its letters in order ("marisol co" for Marisol Camarillo,
 * "dovtail" for Dovetail) is the card's person when nobody else on the
 * manager's roster fits (QA and Pau, 29 Oct 2026; same flag in both apps).
 * See `forms/loose-name.ts`. Off, as before.
 */
export function partialNameLooseMatchEnabled(): boolean {
  return envFlag("PARTIAL_NAME_LOOSE_MATCH_ENABLED");
}

/**
 * At Create, a name in the conversation that is neither the card's person nor
 * anybody on the manager's roster ("drop wage", "forfeit bonus" in an exit
 * request) does not make the card name "more than one person" (a manager in
 * the sibling app, 29 Oct 2026; same flag in both apps). See
 * `forms/proposal-currency.ts`. Off, as before.
 */
export function staleNeedsRosterPersonEnabled(): boolean {
  return envFlag("STALE_NEEDS_ROSTER_PERSON_ENABLED");
}

/**
 * On an open card, "actually this is for <another person>" makes the card
 * that person: the intent slots and the card's name no longer fall back to
 * the first person named in the conversation (QA live, 29 Oct 2026; same
 * flag in both apps). See `ai/corrected-employee.ts`. Off, as before.
 */
export function correctedEmployeeSlotEnabled(): boolean {
  return envFlag("CORRECTED_EMPLOYEE_SLOT_ENABLED");
}

/**
 * A name candidate made only of the exit form's own words ("drop wage",
 * "forfeit bonus", "salon key not returned") is not a person: the chat does
 * not ask "Which of them … — <the person>, drop wage or forfeit bonus?" (a
 * manager in the sibling app, 29 Oct 2026; same flag in both apps). See
 * `forms/answer-not-a-name.ts`. Off, as before.
 */
export function exitTermsNotNamesEnabled(): boolean {
  return envFlag("EXIT_TERMS_NOT_NAMES_ENABLED");
}

/**
 * The exit form's shortcuts fill their fields: "drop wage" the minimum-wage
 * line, "deducted for salon key" the key line, "called to quit" How Employee
 * Resigned, "immediate voluntary term" / "quit, no notice given" the
 * Immediate Voluntary box, "abandoned job" / "job abandonment" No Call No
 * Show (Pau, 29 Oct 2026: "recognize all form wording … prioritize the exit form";
 * same flag in both apps). See `forms/exit-details.ts`, `forms/exit-facts.ts`.
 * Off, as before.
 */
export function exitShortcutWordsEnabled(): boolean {
  return envFlag("EXIT_SHORTCUT_WORDS_ENABLED");
}

/**
 * The Corrective Action form's shortcuts fill their fields: "no PD", "PD
 * applies", "deduct 25" the payroll deduction (Pau, 29 Oct 2026: "recognize
 * all form wording … so when manager type shortcuts, it can understand it";
 * same flag in both apps). Read inline by `forms/payroll-deduct-answer.ts`,
 * which imports nothing. Off, as before.
 */
export function caShortcutWordsEnabled(): boolean {
  return envFlag("CA_SHORTCUT_WORDS_ENABLED");
}

/**
 * CA_REQUEST_NOT_PRIOR_COACHING_ENABLED (Pau's scan, sf-s35, 7 Nov 2026; same flag in both apps; default off). "Can you
 * draw me up a CA for <name> for being late on 10/23/26. <first> has signed a coaching document for being late on
 * 10/14/26. …" opened a Coaching Form: the coaching named as history was read as the form asked for. On: a form named
 * after a Corrective Action request in the same message is a detail of that request, unless the manager switches to
 * it (`forms/template-intent.ts` requestedNaming). Off, as before.
 */
export function caRequestNotPriorCoachingEnabled(): boolean {
  return envFlag("CA_REQUEST_NOT_PRIOR_COACHING_ENABLED");
}

/**
 * A name candidate inside a street address ("Ne Oakfield Lane", "kearney ne"
 * in "125 Ne Oakfield Lane, kearney, NE. 68847") is not a person (QA, 29 Oct
 * 2026; same flag in both apps). See `forms/answer-not-a-name.ts`. Off, as
 * before.
 */
export function streetAddressNotANameEnabled(): boolean {
  return envFlag("STREET_ADDRESS_NOT_A_NAME_ENABLED");
}

/**
 * A job title the manager typed keeps a word that is also a field label:
 * "assistant salon manager" is not cut to "assistant" at "salon" (QA, Sunny
 * live, 30 Oct 2026; same flag in both apps). See `ai/form-card-slots.ts`.
 * Off, as before.
 */
export function titleKeepsLabelWordsEnabled(): boolean {
  return envFlag("TITLE_KEEPS_LABEL_WORDS_ENABLED");
}

/**
 * A directory title is not read from the first words of a different title
 * the manager typed: "assistant salon manager" is not "Assistant Salon" (the
 * start of "Assistant Salon Director") (QA, Sunny live, 30 Oct 2026). See
 * `ai/keep-filled-slots.ts`. Off, as before.
 */
export function spokenTitleWholeEnabled(): boolean {
  return envFlag("SPOKEN_TITLE_WHOLE_ENABLED");
}

/**
 * A level request with a date before "for" ("create a written on 10/20 for
 * <name>, she was late again") is the request, not the account: the card's
 * Observation and a draft written from the manager's words start with what
 * happened (QA, live, 30 Oct 2026; same flag in both apps). See
 * `ai/remap-incident.ts` and `forms/draft-never-blank.ts`. Off, as before.
 */
export function levelRequestDateEnabled(): boolean {
  return envFlag("LEVEL_REQUEST_DATE_ENABLED");
}

/**
 * A job title shortcut prints spelled out: "asd", "sdit", "tsd", "dmit" and
 * "fttc" are still read as the title, and the card and the reply say
 * "Assistant Salon Director", "Salon Director in Training", "Training Salon
 * Director", "District Manager in Training", "Full-Time Tanning Consultant"
 * (Pau, 30 Oct 2026; this app only). See `ai/job-title-from-words.ts`. Off,
 * the acronym as before.
 */
export function titleSpelledOutEnabled(): boolean {
  return envFlag("TITLE_SPELLED_OUT_ENABLED");
}

/**
 * With a card open, a turn that asks to create a form for one other named
 * person ("also create a ca for <another> …", "now create a coaching form for
 * <another> …") starts that person's form instead of asking "Which of them"
 * or keeping the first person (QA, 30 Oct 2026; Pau: "OK"; same flag in both
 * apps). See `ai/new-person-request.ts`. Off, as before.
 */
export function newPersonRequestEnabled(): boolean {
  return envFlag("NEW_PERSON_REQUEST_ENABLED");
}

/**
 * "also create a ca for <name>, he was late on 10/20" ("now", "and", "then"
 * too) is read as the request, so the card's Observation is what happened,
 * not the request (QA, live, 30 Oct 2026; this app only). See
 * `ai/remap-incident.ts`. Off, as before.
 */
export function requestLeadFillerEnabled(): boolean {
  return envFlag("REQUEST_LEAD_FILLER_ENABLED");
}

/**
 * A new create request that states its own date ("also create a ca for
 * <name>, she was late on 10/21") is dated by that date, not left blank by
 * the earlier form's date in the same chat (QA, live, 30 Oct 2026). See
 * `ai/edit-date-rules.ts`. Off, as before.
 */
export function newRequestOwnDateEnabled(): boolean {
  return envFlag("NEW_REQUEST_OWN_DATE_ENABLED");
}

/**
 * Name checks and the staff list read only the manager's own salons' active
 * people from the Woven-synced directory, paged under the database's 1,000-row
 * cap, minus the reviewed shared logins in `forms/roster-non-person.ts` (master
 * plan step 1, 3 Nov 2026; same flag in both apps). See `readStoreRoster` in
 * `forms/employee-roster.ts`. Off, as before: the whole directory is read and
 * scoped in memory.
 */
export function rosterStoreScopedEnabled(): boolean {
  return envFlag("ROSTER_STORE_SCOPED_ENABLED");
}

/**
 * With a form open, a capitalised word in the manager's edit is "another
 * person" only when it matches somebody active at the manager's own salons
 * (master plan step 2, 3 Nov 2026; same flag in both apps). See
 * `forms/roster-name-gate.ts`. Off, as before.
 */
export function formEditNameGateRosterEnabled(): boolean {
  return envFlag("FORM_EDIT_NAME_GATE_ROSTER_ENABLED");
}

/**
 * "TBD", "TBA", "TBC", "to be determined", "to be confirmed" in a drafted field
 * are placeholders like `[Follow-Up Date]`: the sentence carrying one is left
 * out, and a field that was only that is left empty for the manager (master
 * plan step 5, 3 Nov 2026; same flag in both apps). "N/A" is one only as the
 * whole value of a field the model wrote, never on a payroll or prior-actions
 * field. See `forms/drafted-text.ts`. Off, as before.
 */
export function formPlaceholderWordsEnabled(): boolean {
  return envFlag("FORM_PLACEHOLDER_WORDS_ENABLED");
}

/**
 * "primary salon is X" says where the employee usually works; it is not an
 * edit of the form's salon (replay set s21, 3 Nov 2026; same flag in both
 * apps). See `ai/edit-date-rules.ts`. Off, as before.
 */
export function primarySalonNotEditEnabled(): boolean {
  return envFlag("PRIMARY_SALON_NOT_EDIT_ENABLED");
}

/**
 * "Yes" to "Is this for <name>?" keeps the form request the manager made in a
 * later turn than the one that gave the first name (replay set b2, 3 Nov 2026;
 * same flag in both apps). See `ai/first-name-suggest.ts`. Off, as before.
 */
export function firstNameYesKeepsRequestEnabled(): boolean {
  return envFlag("FIRST_NAME_YES_KEEPS_REQUEST_ENABLED");
}

/**
 * QA live check, 3 Nov 2026 (16:27 UTC): "Corrective action for the primary
 * salon manager: on Monday 10/05/2026 <name> was working …", the name typed in
 * lower case and not on the roster, came back "Who is this Corrective Action
 * Form for?". The slot reading held the name, but on a turn it does not call a
 * form turn only a capitalised name the code reads was put in front of the
 * question, and the proposal reads capitalised names only. On, a name the slot
 * reading holds that the manager typed in this very request, and that the code
 * reads nobody else in, is put in front as "The employee is …". See
 * `ai/intent-slots.ts` `withSlotEmployeeLine`. Off, as before.
 */
export function slotNameOnFormRequestEnabled(): boolean {
  return envFlag("SLOT_NAME_ON_FORM_REQUEST_ENABLED");
}

/**
 * A chat edit or a redraft of an open form is read as a patch (field, value,
 * how, the manager's words it came from) and merged by code: typed fields are
 * never blanked, a "replace" on one needs the manager's own words, dates and
 * amounts must be ones the manager stated, prior actions are de-duplicated
 * (Step B, 3 Nov 2026; same flag in both apps). See `forms/form-reducer.ts`
 * and `forms/form-patch-model.ts`. Nothing reads it yet. Off, as before.
 */
export function formPatchReducerEnabled(): boolean {
  return envFlag("FORM_PATCH_REDUCER_ENABLED");
}

/**
 * The reply to a form edit says what the saved form now holds: "Changed
 * <Label> to <value>" per changed field, or that nothing changed — never
 * "Updated" without a change (Step B, 3 Nov 2026; same flag in both apps).
 * See `forms/form-diff-reply.ts`. Nothing reads it yet. Off, as before.
 */
export function formReplyFromDiffEnabled(): boolean {
  return envFlag("FORM_REPLY_FROM_DIFF_ENABLED");
}

/**
 * One writer for every form edit (Step 2a, 4 Nov 2026; ported from Ask
 * Bubbles, same flag in both apps): a chat correction, a redraft, a same-form
 * copy, a policy change, a reopen, the stated facts and the Action Plan's sync
 * hand their values to `writeFormEdits` (`forms/form-write.ts`), which runs
 * them through the form reducer — all or nothing, protected values and dropped
 * words refused — and saves through the existing writers. Independent of the
 * Step B flags. Off, every path calls its old writer and `form-write` is never
 * loaded.
 */
export function formEditSingleWriterEnabled(): boolean {
  return envFlag("FORM_EDIT_SINGLE_WRITER_ENABLED");
}

// --- coding 5 flags (Step B edit reader; placed after FORM_EDIT_SINGLE_WRITER, not at a block end, so merges do not collide) ---

/**
 * FORM_EDIT_SAID_REPLACEMENT_ENABLED (QA's Step B gate, 6 Nov 2026; default
 * off; only with FORM_EDIT_SINGLE_WRITER_ENABLED; ported from Ask Bubbles
 * #519 by coding 5, who owns Step B since 7 Nov). The single writer refused
 * "fix her last name, it is Laine" (drops_words) and an offense changed to
 * "absenteeism" (unknown_option). With this flag on, an old word the new text
 * replaces in place with a word the manager's latest message says may go, and
 * an old offense box is written as the box that replaced it; a word dropped
 * with nothing in its place is still refused (`forms/form-reducer.ts`). Off,
 * as before.
 */
export function formEditSaidReplacementEnabled(): boolean {
  return envFlag("FORM_EDIT_SAID_REPLACEMENT_ENABLED") && formEditSingleWriterEnabled();
}

/**
 * FORM_PATCH_READER_FIXES_ENABLED (coding 5, 7 Nov 2026; QA's Step B target, the real "I haven't changed the
 * <form>" refusals; same flag in both apps, ported from Ask Bubbles; default off). Step B's reader, fixed
 * where the real-AI trace (6 Nov) refused faithful edits. Active only with FORM_PATCH_REDUCER_ENABLED. On:
 *   (1) a patch whose values are already on the form answers "<Field> already says that" (never "Updated"); an
 *       empty or "other" reading goes to the old path, whose writes may not repeat the field, echo the instruction
 *       or (after an empty reading) add nothing new;
 *   (2) the evidence and word checks read the form's own employee name as said (a "<Name> must practice …"
 *       for "Add that she Must Practice …"), match a word by its stem ("missed" for "missing"), and hold every
 *       FACT word — a number, a date, a capitalised word inside a sentence — to the manager's words or the
 *       form; only a few other added words (at most 2, or 15% of them) may be unsaid;
 *   (3) Pau's "yes rewrite" (7 Nov 2026): the reader may answer how "reword" when the latest message asks for
 *       the wording to change; the field's text is rewritten in new words, every fact still the manager's or
 *       the form's, every protected value (name, date, amount) kept (prompt lines added, never edited);
 *   (4) the form's Job Title is a field the reader may set, only to words of the latest message ("change her
 *       position to Tanning Consultant"), written as the manager's own edit.
 * Off, the reader, the schema, the prompt and the reducer are byte for byte as before.
 */
export function formPatchReaderFixesEnabled(): boolean {
  return envFlag("FORM_PATCH_READER_FIXES_ENABLED") && formPatchReducerEnabled();
}

/**
 * EDIT_POLICY_ASK_ENABLED (QA's live run, 7 Nov 2026; coding 5; same flag in both apps; default off; only with
 * FORM_PATCH_REDUCER_ENABLED). "I need you to make it about showing up late and please list the policy make the
 * date for 10/14/26." on an open Coaching Form changed Details and said nothing about the policy. On: the patch
 * reader says whether the latest message asks for the policy (`policy_asked`, a prompt line added after the
 * approved text), and the app lists it the way a first draft does — the manual sections the account reads as, as
 * its own "Policy reference" line on the account field — or the reply says it found none and asks which applies
 * (`forms/edit-policy-ask.ts`). Off, as before.
 */
export function editPolicyAskEnabled(): boolean {
  return envFlag("EDIT_POLICY_ASK_ENABLED") && formPatchReducerEnabled();
}
/**
 * EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED (ported from the sibling app: QA's round-6 live test there, 9 Nov 2026; coding
 * 5; same flag in both apps; default off). A termination letter signed "<C>, District Manager'" offered <C> and
 * "District Manager'" as the exit form's person beside the one the manager named. On: when the turn names the form's
 * person, the proposal reads it without a letter's closing "<Name>, <Title>" sign-off of another person
 * (`ai/letter-signer.ts`). Off, as before.
 */
export function exitLetterSignerNotSubjectEnabled(): boolean {
  return envFlag("EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED");
}
/**
 * POSSESSIVE_PLACE_NOT_PERSON_ENABLED (ported from the sibling app: QA's round-6 live test there, 9 Nov 2026; coding 5;
 * same flag in both apps; default off). "create a CA for Hadley's Crossing Plaza, she was late on 10-20-26" made a card
 * for Employee "Hadley". On: a card whose person is only ever the possessive of a place ("<Name>'s … Plaza") loses that
 * name and asks who the form is for (`forms/possessive-place.ts`, after PERSON_GUARD in the chat route). Off, as before.
 */
export function possessivePlaceNotPersonEnabled(): boolean {
  return envFlag("POSSESSIVE_PLACE_NOT_PERSON_ENABLED");
}
/**
 * OFF_ROSTER_ASK_BEFORE_CARD_ENABLED (ported from the sibling app: QA's round-6 live test there, 9 Nov 2026; coding 5;
 * same flag in both apps; default off). "create a coaching form for <full name not on the roster>" gave a ready card
 * with no question. On: for a salon-scoped manager, such a card is held back once and the reply asks "I can't find
 * <name> on your roster — is that the right name, or are they at another salon?", with OFF_ROSTER_CONFIRM's "reply use
 * <name>" offer (`forms/off-roster-ask.ts`). District, region and global managers are never held up. Off, as before.
 */
export function offRosterAskBeforeCardEnabled(): boolean {
  return envFlag("OFF_ROSTER_ASK_BEFORE_CARD_ENABLED");
}
// --- end coding 5 flags ---

/**
 * The edit tool in the main call (Step 3, 4 Nov 2026; ported from Ask
 * Bubbles, same flag in both apps): with a draft form open and a turn that is
 * not a correction or a policy change (a question-phrased turn too, Pau's
 * ruling A3), the answering call is
 * offered one tool, `edit_form`, with the open form as JSON in one extra data
 * block. A tool call is written through `writeFormEdits` (path "tool", all or
 * nothing) and the reply is the saved diff; the model's text is not shown. No
 * call, a refusal or nothing changed: the turn goes to the redraft, the copy
 * and the revision as before. One model call, no tool result round trip. See
 * `forms/form-edit-tool.ts`. Needs FORM_EDIT_SINGLE_WRITER_ENABLED too: off
 * unless both are on. Off, the main request is byte for byte as before and the
 * Step B patch turn runs as it did.
 */
export function formEditToolInStreamEnabled(): boolean {
  return envFlag("FORM_EDIT_TOOL_IN_STREAM_ENABLED") && formEditSingleWriterEnabled();
}

/**
 * The abbreviation glossary (QA's overnight scan, 4 Nov 2026, sf-s12: "I need
 * to make a corrective action for msb"; ported from Ask Bubbles, 40146f84,
 * #419). The approved table, `CHAT_GLOSSARY` in `ai/chat-glossary.ts`, is sent
 * as one extra context block in the main answering call and in the
 * form-intake calls that read the employee from the manager's words, and a
 * name candidate that is a term in it ("msb") is never the employee: the
 * manager is asked who the form is for instead. Off, every request and every
 * reader is byte for byte as before.
 */
export function chatGlossaryEnabled(): boolean {
  return envFlag("CHAT_GLOSSARY_ENABLED");
}

/**
 * Sales and MSB corrective actions cite the Standards of Conduct (client
 * request relayed by Pau, 4 Nov 2026; ported from Ask Bubbles #422, same flag
 * in both apps). A Corrective Action whose account reads as the Under
 * Performance offense type (results against a sales or performance target, the
 * reading `ca-policy.ts` already makes) or uses a term from the approved chat
 * glossary (MSB, Must See Behaviors) is read as the Standards of Conduct: the
 * card says so, the draft ticks that box and Direct policy cites the manual's
 * section by heading and page. The drafting model is also told so, in one
 * added line. The glossary is `ai/chat-glossary.ts`, read through
 * `foldsToGlossaryTerm` (which ignores CHAT_GLOSSARY_ENABLED, as in Ask
 * Bubbles). Off, every reading, card line, prompt and draft is byte for byte as before.
 * See `forms/ca-sales-policy.ts`.
 */
export function caSalesPolicyEnabled(): boolean {
  return envFlag("CA_SALES_POLICY_ENABLED");
}

/**
 * CA_PERFORMANCE_REASON_ENABLED (QA, coding-3 item 5, 5 Nov 2026; default
 * off; same flag in both apps; only effective with CA_SALES_POLICY_ENABLED).
 * "can you write me a Ca for <name> for performance for october" got "You
 * haven't told me what happened yet": the bare "performance" is neither a
 * metric named and judged (`statesMetricShortfall`) nor the removed Under
 * Performance box's name. On, the sentence that asks for the Corrective
 * Action naming performance (the EPP reader's existing performance pattern,
 * `namesPerformance` in `forms/epp-policy.ts`), with nothing else read from
 * the account, is the sales-performance reading: the card cites the
 * Standards of Conduct and does not ask what happened. See `withSalesPolicy`
 * in `forms/ca-policy.ts`. Off, as before.
 */
export function caPerformanceReasonEnabled(): boolean {
  return envFlag("CA_PERFORMANCE_REASON_ENABLED");
}

/**
 * WOVEN_TRAINING_CONDUCT_ENABLED (Pau's ruling, 6 Nov 2026; default off). Three managers asking for a Corrective
 * Action for assigned Woven policy acknowledgements or training not completed by a deadline got three answers: a
 * tentative Standards of Conduct, "Woven does not see a section … for \"not signing the woven\" … so I won't cite
 * one", and no policy line at all, with "the applicable company policy" in the Action Plan. On: such an account is
 * the Standards of Conduct, said on the card with the manual's section and page, ticked and quoted on the draft
 * (`forms/ca-policy.ts` wovenWork, `forms/named-policy-section.ts`), and a section the manual lacks is said in
 * the app's own voice ("I don't see a section …"), not with the product as its subject. Off, as before.
 */
export function wovenTrainingConductEnabled(): boolean {
  return envFlag("WOVEN_TRAINING_CONDUCT_ENABLED");
}

/**
 * Step 5, names from the roster: first piece, the overnight scan's sf-s19
 * "metrics read as people". A metric is never read as a person (Pau, 4 Nov
 * 2026: "I need a corrective action verbal for <name>. This is for Under
 * Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.").
 *
 * When the message names somebody on the roster (an exact or close match, or
 * a roster first or preferred name typed in lowercase: "for perpetua"), a
 * name candidate that matches nobody exactly or closely and is not shaped
 * like anyone on the roster (`forms/roster-shape.ts`: a 2+ word candidate
 * whose first word is nobody's first name, one word that is nobody's first or
 * last name) is not put in the grounding step's unmatched list; with the
 * person guard's roster read this turn the name reader drops it too, so it is
 * never the card's employee (`forms/answer-not-a-name.ts`). A message that
 * names nobody on the roster is read as before, with one exception (QA for
 * Pau, 4 Nov 2026): one word typed all in lowercase that is nobody's first,
 * preferred or last name on the roster is never the employee ("CA for under
 * performance on Club Close % and Spa %" made the card "for **under**"); the
 * reply asks who the form is for.
 *
 * Works with CA_SALES_POLICY_ENABLED off too (QA, 4 Nov 2026). It used to
 * need the sales policy, on the reading that without it a message like Pau's
 * is answered as metric-only (no card). Production showed otherwise: with the
 * sales policy off, "I need a corrective action for Coaching Form. This is
 * for Under Performance on Club Close % and Spa %." (a form's name pasted
 * where the person's goes) made a Coaching Form card for "Club Close" — the
 * named form is not a Corrective Action, so the metric-only answer never
 * runs. The request slot and the list rule need no sales policy.
 *
 * Part 2 (QA for Pau, 5 Nov 2026), roster-free: when the message's first
 * sentence asks for a form "… for <Name>", that name is its only employee
 * candidate, and a capitalised item of a list of three or more is never one
 * (`forms/request-slot.ts`). A first name typed with a surname that is not
 * close to a roster person's is never offered as them ("Remy Fenn" is not
 * Remy Calder). Off, as before.
 */
export function formNameFromRosterEnabled(): boolean {
  return envFlag("FORM_NAME_FROM_ROSTER_ENABLED");
}

/**
 * No false "Updated" after a form edit (Step 4, 4 Nov 2026). The one writer
 * refuses, on the tool, patch, revision and correction paths, an op that sets
 * a field to the value it already has (`same_value`) and an op whose value
 * holds the manager's whole latest message of 3 words or more
 * (`copies_message`, the overnight scan's sf-s11); both hand the turn off as
 * any refusal does. On a turn the edit tool was offered, the reply about the
 * form comes only from the saved diff ("Updated: <label>: <value>"), and an
 * empty diff says "I didn't change anything on the form. Tell me which part
 * to change and what it should say." See `forms/form-noop-reply.ts`. Needs
 * FORM_EDIT_SINGLE_WRITER_ENABLED: off unless both are on. Off, nothing
 * changes.
 */
export function formEditNoopGuardEnabled(): boolean {
  return envFlag("FORM_EDIT_NOOP_GUARD_ENABLED") && formEditSingleWriterEnabled();
}

/**
 * KEEP_ROSTER_EXACT_NAME_ENABLED (QA, 4 Nov 2026, default off). Live, Pau's
 * message 1 for the QA test account's own roster entry (two short words, an
 * all-capitals word, "One"): the reply said "I'll draft a Corrective Action
 * Form for <that name>" and the card's Employee was empty. The slot keeper
 * (`ai/keep-filled-slots.ts` keptName) reads a name with a not-a-name word in
 * it ("one") as a fragment and drops it — after the reply sentence was
 * written from the name. On, a name that is somebody's exact roster name is
 * never a fragment: the card keeps it. Off, as before.
 */
export function keepRosterExactNameEnabled(): boolean {
  return envFlag("KEEP_ROSTER_EXACT_NAME_ENABLED");
}

/**
 * PAST_FORMS_BEFORE_LIBRARY_ENABLED (Pau, 5 Nov 2026; overnight scan sf-s29,
 * default off). "are there any coaching and ca's for <name>" was answered
 * from the forms library ("Yes. **Corrective Action Form** — …") instead of
 * the forms on file for that person. On: when the forms-library check
 * (`detectInventoryQuestion`) would answer a message that names a person or
 * asks about forms already on file, the past-forms lookup
 * (`chat-form-records.ts`) runs for it instead and the library answer steps
 * aside. "do we have a coaching form?" still gets the library answer. Off, as
 * before.
 */
export function pastFormsBeforeLibraryEnabled(): boolean {
  return envFlag("PAST_FORMS_BEFORE_LIBRARY_ENABLED");
}

/**
 * COACHING_ASKS_WHAT_HAPPENED_ENABLED (Pau, 5 Nov 2026, sf-s27; default off).
 * "Create a coaching form." → "<name>" answered "Everything I need is here …
 * I have the employee and the salon." with no incident and no draft. On: a
 * Coaching Form card for a person with no account in the manager's turns for
 * it does not say it has everything; it asks what happened, once per card
 * (`ai/ca-what-happened.ts`, the Corrective Action's same test). Off, as
 * before.
 */
export function coachingAsksWhatHappenedEnabled(): boolean {
  return envFlag("COACHING_ASKS_WHAT_HAPPENED_ENABLED");
}

/**
 * The turn that asked for the form stays in the bounded manager window when
 * later turns push it out (the coordinator's replays R6/R7, 5 Nov 2026; see
 * `forms/bounded-context.ts`). The window is computed on the server (the
 * card) and in the browser (the draft), so there are two variables:
 * REQUEST_KEPT_IN_WINDOW_ENABLED for the server and
 * NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED for the browser. FLIP BOTH
 * TOGETHER: with one on and the other off the card and the draft read
 * different turns. NEXT_PUBLIC_ is inlined at build time, so a flip needs a
 * redeploy. Off, the window is exactly as before.
 */
export function requestKeptInWindowEnabled(): boolean {
  if (typeof window === "undefined") return envFlag("REQUEST_KEPT_IN_WINDOW_ENABLED");
  const inlined = process.env.NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED;
  return typeof inlined === "string" && ON.has(inlined.trim().toLowerCase());
}

/**
 * ROSTER_NAME_IN_CANDIDATE_ENABLED (QA, 5 Nov 2026, R2 checked in this app;
 * default off). One employee's story that names their district manager in
 * passing ("When <employee> spoke with District manager <name> …"): with
 * FORM_NAME_FROM_ROSTER_ENABLED on, the candidate "When <employee>" is set
 * aside as shaped like nobody on the roster (its first word is nobody's first
 * name), and the card went to the district manager, the only other roster
 * person the turn names. On: a candidate whose last words are a roster
 * person's first name, or a roster-shaped name, could be that person
 * (`forms/roster-shape.ts` couldBeOnRoster). Off, as before.
 */
export function rosterNameInCandidateEnabled(): boolean {
  return envFlag("ROSTER_NAME_IN_CANDIDATE_ENABLED");
}

/**
 * TITLE_OF_THE_EMPLOYEE_ENABLED (port from the sibling app; QA, 5 Nov 2026,
 * R2; default off). One employee's story named their district manager in
 * passing, and the card's Job title was "District Manager", the other
 * person's. On: a title the manager's turns only ever attach to another named
 * person is not the employee's; the card has none
 * (`ai/title-of-the-employee.ts`). Off, as before.
 */
export function titleOfTheEmployeeEnabled(): boolean {
  return envFlag("TITLE_OF_THE_EMPLOYEE_ENABLED");
}

/**
 * ROSTER_NEAR_MISS_ENABLED (port from the sibling app; QA's testers, 5 Nov
 * 2026, R3/R5/R7; default off, on with FORM_NAME_FROM_ROSTER_ENABLED). A real,
 * active roster person's surname typed with one letter wrong: with FORM_NAME
 * on there, the card's Employee was "Not yet", the Action Plan still named the
 * person, and the reply asked "Who is this form for?"; here, with the flip's
 * flags, the empty card's reply names the person. On: (a) a near-miss of
 * exactly one roster name is asked "Is this for <roster full name>?" as a first
 * name typed alone is, and the card waits (`forms/roster-only-names.ts`); (b)
 * with no employee on the card, no reply text names the person who is not on
 * it. Off, as before.
 */
export function rosterNearMissEnabled(): boolean {
  return envFlag("ROSTER_NEAR_MISS_ENABLED");
}

/**
 * NEAR_MISS_DETAILS_ACCEPT_ENABLED (ported from the sibling app: QA's gate there on 4d42c342, 7 Nov 2026; default
 * off). With FORM_NAME on, a full name typed close to one roster person ("Corvina Ashdown Vellacot") got "Is this for
 * **<roster name>**? Tell me if that should change.", and the next turn ("verbal warning, no payroll deduct, …") got
 * the same question again: the answer reader took only "yes" or a name, the details were dropped and no card came.
 * On: a turn after that question that gives form details (a warning level or a payroll answer, by the app's own
 * readers) and does not turn the name down accepts the asked name, when the manager typed that person's first name and a
 * surname close to theirs (`ai/first-name-suggest.ts` chosenName). A first name typed alone is still asked, as
 * before. Off, as before.
 */
export function nearMissDetailsAcceptEnabled(): boolean {
  return envFlag("NEAR_MISS_DETAILS_ACCEPT_ENABLED");
}

/**
 * REPLY_MATCHES_CARD_ENABLED (port from the sibling app; QA for Pau, 5 Nov
 * 2026; default off). The last step of every chat turn compares the finished
 * reply with the finished card and makes the reply agree with it: no employee
 * on the card, no person named and "Who is this form for?"; an employee on the
 * card, never asked who; one policy, the card's; no removed Type of Offense
 * label; never "You haven't told me what happened yet" beside an account
 * (`ai/reply-matches-card.ts`). Off, as before.
 */
export function replyMatchesCardEnabled(): boolean {
  return envFlag("REPLY_MATCHES_CARD_ENABLED");
}

/**
 * CITATION_LINE_KEPT_ON_REVISION_ENABLED (QA's production-flags read and
 * bisect, 5 Nov 2026; default off): with POLICY_CITATION_ENABLED on in
 * production, the app appends "Policy reference: …, JBA Policy Manual p.N" to
 * a Coaching draft's Details. A chat edit ("fix her last name, it is Laine")
 * whose revision did not repeat that line was refused: keepsSubstance found
 * the line's page numbers missing, so nothing was written and the reply said
 * "I haven't changed the Coaching Form". With the flag on, a wording or
 * additive revision keeps the app's own trailing line (`forms/app-citation-line.ts`),
 * so the edit lands and the citation stays. Off, as before.
 */
export function citationLineKeptOnRevisionEnabled(): boolean {
  return envFlag("CITATION_LINE_KEPT_ON_REVISION_ENABLED");
}

/**
 * STALE_PROMPT_LINES_OFF_ENABLED (QA, 5 Nov 2026; default off). Two lines of
 * the Corrective Action draft's prompt describe boxes the current template no
 * longer has: "name the topic in the matching write-in field" (revision 7 has
 * no write-in beside Other) and "under_performance is for results against a
 * sales or performance target" (revision 7 has no Under Performance box). With
 * the flag on, each line is left out when the version being drafted lacks what
 * it describes, read from the version's own fields and options
 * (`ai/stale-prompt-lines.ts`). A version that still has them keeps the line.
 * Off, the prompt is byte for byte as before.
 */
export function stalePromptLinesOffEnabled(): boolean {
  return envFlag("STALE_PROMPT_LINES_OFF_ENABLED");
}

/**
 * METRIC_GUARD_ENABLED (the sibling app's LIVE=1, 5 Nov 2026; default off). With the smaller set
 * (CA_SALES + REPLY_MATCHES_CARD + TITLE, FORM_NAME off), a metrics CA for a person typed short was asked
 * "Which of them is this Corrective Action Form for — **Club Close**, **<first name>** or **Under**?": the
 * metric guards are all behind FORM_NAME_FROM_ROSTER_ENABLED. On: the final reply never offers a metric or
 * offense word as a choice (`forms/roster-only-names.ts` withoutMetricChoices). Off, as before.
 */
export function metricGuardEnabled(): boolean {
  return envFlag("METRIC_GUARD_ENABLED");
}

/**
 * METRIC_CHOICE_ONE_QUESTION_ENABLED (QA, 7 Nov 2026; default off). The same doubled ask as the sibling app's FORM_NAME
 * re-flip gate regression, under METRIC_GUARD_ENABLED: a choice question with its own "Tell me and I'll …" after it,
 * every choice a metric, became "Who is this form for? Tell me the employee's full name. Tell me and I'll fill in …".
 * On: the question's tail goes with a choice that is replaced, and stays with one still asked
 * (`forms/roster-only-names.ts` withoutMetricChoices). Off, as before.
 */
export function metricChoiceOneQuestionEnabled(): boolean {
  return envFlag("METRIC_CHOICE_ONE_QUESTION_ENABLED");
}

/**
 * COACHING_OBSERVED_KEPT_ENABLED (Pau's scan, sf-s37, 7 Nov 2026; same flag in both apps; default off). Three Coaching
 * Forms for "not hitting her numbers for the month of October" were saved with no "Observed:" section and with
 * Underperformance unticked: the framing guard (`forms/coaching-framing.ts`) did not read the account as a shortfall,
 * so it struck every "did not meet …" sentence and the label left empty. On: a metric named and judged — the reader
 * the progression already uses (`forms/metric-shortfall.ts` statesMetricShortfall) — is a shortfall too, and the
 * guard leaves the draft alone. Off, as before.
 */
export function coachingObservedKeptEnabled(): boolean {
  return envFlag("COACHING_OBSERVED_KEPT_ENABLED");
}

/**
 * CLEANING_OTHER_EVERY_WORDING_ENABLED (QA's live eval ca-sales-negative-cleaning-duties and replay, 6 Nov 2026;
 * same flag in both apps; default off; Pau's ruling: cleaning left undone is Other, never the Standards of
 * Conduct). With CA_SALES_POLICY_ENABLED on, "for not completing his daily cleaning duties" and "for not
 * completing closing cleaning tasks" got no Policy line and a draft ticked Standards of Conduct (the cleaning
 * reader missed "completing"), and the live model's own reply named the Standards of Conduct for "he did not
 * complete daily cleaning duties". On: the cleaning reader also reads "not completing / finishing / doing …
 * cleaning", an account that reads only as cleaning is Other (`forms/ca-policy.ts` withCleaningOther), and the
 * final reply's **Policy:** line is the Other line whenever the account reads so (`ai/reply-matches-card.ts`).
 * Off, as before.
 */
export function cleaningOtherEveryWordingEnabled(): boolean {
  return envFlag("CLEANING_OTHER_EVERY_WORDING_ENABLED");
}

/**
 * AS_YOU_SAID_MANAGER_WORDS_ENABLED (live chats, 4 Nov 2026; default off). "**Policy:** Late Opening, as you said"
 * for leaving early and taking the spray booths down early, and "Standards of Conduct, as you said" for "it should be
 * must see behaviors": the manager never named either. The intent reader's heading is written back onto the turn as
 * the app's own line ("Policy reference: <heading>, JBA Policy Manual p.N.", `ai/form-state.ts`), and the policy
 * reader took it as the manager naming that policy. On: the reader that decides "as you said"
 * (`forms/ca-policy.ts` readCaPolicy) reads without the app's lines (`ai/app-sentences.ts` withoutAppLines).
 * Off, as before.
 */
export function asYouSaidManagerWordsEnabled(): boolean {
  return envFlag("AS_YOU_SAID_MANAGER_WORDS_ENABLED");
}

/**
 * UNDER_PERFORMANCE_EXPLAINED_ENABLED (Pau, 6 Nov 2026; the Sunny tester
 * after the flip: "it should be under performance not standard of conduct";
 * default off). When the manager's message names Under Performance and the
 * card cites the Standards of Conduct, the reply says why, once: "Under
 * Performance isn't on the CA form. Sales performance CAs use the Standards
 * of Conduct." (`ai/under-performance-explained.ts`). Off, as before.
 */
export function underPerformanceExplainedEnabled(): boolean {
  return envFlag("UNDER_PERFORMANCE_EXPLAINED_ENABLED");
}

/**
 * SALES_SHORTFALL_OBJECT_ENABLED (QA, 6 Nov 2026, tester batch 1 after the
 * Sunny flip; default off). "Not meeting sales requirements for the month of
 * October" got a Corrective Action with no policy: the stated-shortfall reader
 * (`forms/metric-shortfall.ts`) named "sales" only as "sales are / is", so the
 * CA_SALES_POLICY_ENABLED reading never fired. With this flag on, "sales" is a
 * named metric where a shortfall verb of the reader's own judged list governs
 * it, with only determiners or possessives between ("not meeting her sales
 * goals"); "missing from the sales floor" is not. Off, as before.
 */
export function salesShortfallObjectEnabled(): boolean {
  return envFlag("SALES_SHORTFALL_OBJECT_ENABLED");
}

/**
 * TWO_FORMS_OWN_PERSON_ENABLED (QA, Sunny tester after the flip, 6 Nov 2026,
 * row 6; default off). "Coaching form for <R>. Also a CA for <R2>." gave one
 * Coaching card whose employee was R2, the other form's person. With this flag
 * on, when one message asks for two forms the card keeps its employee only
 * when its own clause names them, or it is emptied and asks who; the reply
 * names the other request back (`ai/two-forms-own-person.ts`). Off, as before.
 */
export function twoFormsOwnPersonEnabled(): boolean {
  return envFlag("TWO_FORMS_OWN_PERSON_ENABLED");
}

/**
 * PLACE_FROM_CUE_ENABLED (QA's Sunny gate, 6 Nov 2026, sf-s28; default off).
 * "can you write me a ca for <name> from o street", from a manager not
 * assigned to O Street: "from" was no place cue, so the salon was not read and
 * (with CA_SALES_POLICY_ENABLED on) the card silently took the employee's own
 * salon with no word about O Street. With this flag on, "for <name> from
 * <salon>" names the salon (`forms/location-scope.ts`), so a salon outside the
 * assignment gets the "isn't a salon on your assignment" question on every
 * path. Other "from"s ("transferred from", "a call from the salon", "from
 * 10/5") are left alone. Off, as before.
 */
export function placeFromCueEnabled(): boolean {
  return envFlag("PLACE_FROM_CUE_ENABLED");
}

/**
 * BARE_NOT_DENIAL_ENABLED (QA's Sunny gate, 6 Nov 2026; default off). With
 * CA_SALES_POLICY_ENABLED on, a clause is "only what did not happen" when it
 * denies a fault ("never late", "wasn't late"); a bare "not late" was missed,
 * so it was read as the account and a Corrective Action was drafted instead of
 * "You haven't told me what happened". With this flag on, a clause that starts
 * with a bare "not" before one of the same fault words is a denial too
 * (`forms/draft-never-blank.ts` deniesAFaultWithBareNot). "not meeting sales
 * requirements" stays an account. Off, as before.
 */
export function bareNotDenialEnabled(): boolean {
  return envFlag("BARE_NOT_DENIAL_ENABLED");
}

/**
 * TITLE_ENDS_AT_LINE_ENABLED (QA's Sunny gate, 6 Nov 2026, s16; default off).
 * With TITLE_OF_THE_EMPLOYEE_ENABLED on, an exit form typed as lines
 * ("<name>\nTanning Consultant \nNE Kearney\n…") lost the employee's own job
 * title: the capitalised words on the NEXT line (the salon) were read as
 * another person beside the title. With this flag on, the name after a title
 * must be on the title's own line (`forms/title-of-another-person.ts`); a
 * typed list's name on the line before still owns the title below it, and
 * "District manager <name>" on one line is still that person's. Off, as before.
 */
export function titleEndsAtLineEnabled(): boolean {
  return envFlag("TITLE_ENDS_AT_LINE_ENABLED");
}

/**

 * ROSTER_COMPOUND_SURNAME_ENABLED (the re-flip's rollback, 5 Nov 2026; default
 * off). The flip's live testers (R3/R5/R7): a real employee's surname is two
 * words, and the manager typed one with a transposed or swapped letter. The
 * matcher compared only the typed last word with the whole two-word surname,
 * so it was never close: with FORM_NAME + ROSTER_NEAR_MISS the card emptied and
 * asked who. On: a compound surname is compared word by word
 * (`forms/employee-match.ts` compoundSurnameScore). Off, as before.
 */
export function rosterCompoundSurnameEnabled(): boolean {
  return envFlag("ROSTER_COMPOUND_SURNAME_ENABLED");
}

/**
 * ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED (QA-A/QA-B, the re-flip's live testers, 5 Nov 2026; default off). With
 * FORM_NAME + ROSTER_NEAR_MISS on, an off-roster full name got no "I couldn't find **<name>** in the Woven roster"
 * note when the request did not put it straight after "for" with a comma or period ("i have an employee, <name>
 * that needs …", or "… for <name>" at the end). On: the note also reads "employee, <Name>" and "for <Name>" at the
 * end of the message, Title Case names only (`forms/roster-only-names.ts` notFoundName). Off, as before.
 */
export function rosterNotFoundAnyPhrasingEnabled(): boolean {
  return envFlag("ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED");
}

/**
 * EXIT_STATED_ONLY_ENABLED (QA, 5 Nov 2026, severe; default off). A salon director pasted a termination letter and
 * asked for an exit form: How Employee Resigned became "Text message" (the text that caused the termination), Salon
 * Key Returned "returned" (the letter told the employee to return them), and Last Day Worked the final paycheck's
 * "hours worked through" date. On: an Exit field is filled only from what the manager said happened — a termination
 * is not a resignation, an instruction or condition to return is not a return, a pay period is not a last day
 * (`forms/exit-details.ts`, `forms/exit-facts.ts`). Off, as before.
 */
export function exitStatedOnlyEnabled(): boolean {
  return envFlag("EXIT_STATED_ONLY_ENABLED");
}

/**
 * OFF_ROSTER_CONFIRM_ENABLED (port of the sibling app's flip-3 gate, QA, 6 Nov 2026; default off; ships with
 * FORM_NAME_FROM_ROSTER). With the name flags a card's employee comes from the roster only, so a form for somebody
 * not in Woven (an exit form for someone just removed) asked "Who is this form for?" on every answer and never made a
 * card. On: the not-found note offers "reply **use <name>**"; that, "yes", or the same name again puts the typed name
 * on the card, which says it is not from Woven. Another name is looked up as any name is
 * (`forms/off-roster-confirm.ts`). Off, as before.
 */
export function offRosterConfirmEnabled(): boolean {
  return envFlag("OFF_ROSTER_CONFIRM_ENABLED");
}

/**
 * POLICY_CHANGE_RELEVANT_ENABLED (ported from the sibling app: QA, 5 Nov 2026, severe; default off). There, a location manager's revision of a
 * Corrective Action ("in the previously recieved coaching include that <name> signed the jba policy manual on
 * 10-15-26") cited the manual's 401k sheet headed "Warning": the bare "that" read as a reference back, and the
 * app's own "**Verbal Warning** or **Written Warning**?" named the heading. On: a message whose only "policy" is
 * the manual's own name changes no policy; a reference back must refer to a policy; an earlier turn names a
 * section only as one (`forms/chat-policy-change.ts`). Off, as before.
 */
export function policyChangeRelevantEnabled(): boolean {
  return envFlag("POLICY_CHANGE_RELEVANT_ENABLED");
}

/**
 * CA_OFFER_KEEPS_ACCOUNT_ENABLED (QA's MSB case M5, 5 Nov 2026; same flag in
 * the sibling app; default off). "<name> did not follow must see behaviors
 * which violates standards of conduct policy" → the one Corrective Action
 * offer (CA_SALES_POLICY_ENABLED) → "yes": the card read "What happened: The
 * policy is Standards of Conduct", because "yes" was rewritten into the
 * request the offer accepts and the card read that sentence as her account.
 * With the flag on, the accepted yes is the turn the offer answered — her own
 * words — asked for as a Corrective Action Form, so the card's account is read
 * from what she said and never from the rewritten request (`ai/ca-offer.ts`
 * `acceptedCaOfferTurn`). Off, as before.
 */
export function caOfferKeepsAccountEnabled(): boolean {
  return envFlag("CA_OFFER_KEEPS_ACCOUNT_ENABLED");
}

/**
 * OWN_BRAND_ONLY_ENABLED (Pau, 6 Nov 2026, for the sibling app; same flag in both apps; default off). A reply quoting
 * the manual listed every brand ("across all brands — <this brand>, <other brands> — …"); each app names only its own.
 * On: the finished reply names only this company's brand — a list of brands holding it becomes it, a line headed by
 * another brand goes, any other sentence naming one goes; a quotation is kept or dropped whole, never reworded
 * (`ai/own-brand-only.ts`). The brands are read from existing config and patterns, not written anew; the JBA office is
 * not a brand and its sentences stay (Pau, answer "A"). Off, as before.
 */
export function ownBrandOnlyEnabled(): boolean {
  return envFlag("OWN_BRAND_ONLY_ENABLED");
}

/**
 * WOVEN_PDF_OCR_ENABLED (ported from the sibling app; QA's plan, approved by Pau, 7 Nov 2026; same flag in both apps;
 * default off). Scanned Woven PDFs have no text layer, so the sync left them in ERROR ("no_text") and their knowledge
 * never reached an answer. On: a Woven sync has a PDF with no text at all transcribed page by page by Claude
 * (`ingestion/extract/pdf-ocr.ts`), capped per document and per run, and indexes it like any PDF. Uploads, and PDFs
 * with any text, are unchanged. Off, as before.
 */
export function wovenPdfOcrEnabled(): boolean {
  return envFlag("WOVEN_PDF_OCR_ENABLED");
}

// --- coding 4 flags ---

/**
 * MSB_PHRASE_SOC_ENABLED (Pau via QA, 7 Nov 2026; same flag in both apps; default off). With CA_SALES_POLICY_ENABLED
 * on, "create a ca for MSB for <name>" cites the Standards of Conduct, and "create a ca for must see behaviors for
 * <name>" cited no policy: the glossary term was matched word by word. On: the phrase the approved glossary spells
 * the term out as counts as the term (`forms/ca-policy.ts` withSalesPolicy). Off, as before.
 */
export function msbPhraseSocEnabled(): boolean {
  return envFlag("MSB_PHRASE_SOC_ENABLED");
}

/**
 * AS_YOU_SAID_APP_READ_ENABLED (QA's Sunny gate, 7 Nov 2026: 45 regressions from AS_YOU_SAID_MANAGER_WORDS; ships
 * with it; same flag in both apps; default off). With AS_YOU_SAID on, an attendance or late-opening CA whose only
 * Policy line was "<policy>, as you said" (read from the app's own line) lost the line. On: the policy the app's own
 * lines named is kept as its reading and said as one ("**Policy:** Late Opening — read from this request …"),
 * never "as you said" and never nothing (`forms/ca-policy.ts` readCaPolicy, caPolicyProposalLine). Off, as before.
 */
export function asYouSaidAppReadEnabled(): boolean {
  return envFlag("AS_YOU_SAID_APP_READ_ENABLED");
}

/**
 * EDIT_MAKE_IT_ABOUT_ENABLED (Pau's scan, sf-s34, 7 Nov 2026; Pau-approved 7 Nov; same flag in both apps; default
 * off). On an open Coaching draft, "I need you to make it about showing up late and please list the policy make the
 * date for 10/14/26." was scoped to the date alone, so the Details rewrite was refused and the reply said nothing
 * changed. On: "make it / this / the form … about …" also allows the form's account (Coaching Details, or a CA's
 * Observation) in `forms/revision.ts` scopeRevision. Off, as before.
 */
export function editMakeItAboutEnabled(): boolean {
  return envFlag("EDIT_MAKE_IT_ABOUT_ENABLED");
}

// --- coding 2 flags ---

// coding 2: PRIOR_STEP_PREVIOUSLY
/**
 * PRIOR_STEP_PREVIOUSLY_ENABLED (port from the sibling app; A2, one of Pau's 7; QA 6 Nov 2026; default off).
 * "in the previously recieved coaching include that <name> signed the jba policy manual on 10-15-26" listed no
 * Prior actions row. With this flag on, a dated step that "previous(ly) / prior / earlier" leads is an earlier
 * step (`forms/prior-actions.ts`). Off, as before.
 */
export function priorStepPreviouslyEnabled(): boolean {
  return envFlag("PRIOR_STEP_PREVIOUSLY_ENABLED");
}

/**
 * NO_NOTICE_NO_DATE_ENABLED (port of the sibling app's, QA, 6 Nov 2026;
 * default off). "exit form for <X>, resigned 11-3-26 with no notice" printed
 * "Date that notice was given: November 3, 2026": "resigned" is a notice-given
 * cue. With this flag on, a stated "no notice" leaves the notice date empty,
 * and the date stays the resignation's (`forms/exit-facts.ts`). Off, as before.
 */
export function noNoticeNoDateEnabled(): boolean {
  return envFlag("NO_NOTICE_NO_DATE_ENABLED");
}

// coding 2: SALES_OBSERVATION_ACCOUNT
/**
 * SALES_OBSERVATION_ACCOUNT_ENABLED (QA's Sunny flip-4 gate, 7 Nov 2026;
 * default off; only with SALES_SHORTFALL_OBJECT_ENABLED). With "on
 * performance" read as the account, the card's Observation of Offense was the
 * request's own words: "<name> on performance", "performance for october not
 * pay roll deductable". With this flag on, an Observation sentence loses the
 * request head, the leading employee name, the request's reason and a payroll
 * answer (`forms/ca-policy.ts` observationAccount). Off, as before.
 */
export function salesObservationAccountEnabled(): boolean {
  return envFlag("SALES_OBSERVATION_ACCOUNT_ENABLED");
}

/**
 * BARE_NOT_AFTER_REQUEST_ENABLED (QA's live Sunny re-check, 6 Nov 2026;
 * default off). "ca for <A> not late" asked nothing: the clause starts with
 * the request, so BARE_NOT_DENIAL's clause-start "not" missed it. With this
 * flag on, the CA what-happened test also reads each clause without its
 * request head and the employee's name (`ai/ca-what-happened.ts`). Off, as
 * before.
 */
export function bareNotAfterRequestEnabled(): boolean {
  return envFlag("BARE_NOT_AFTER_REQUEST_ENABLED");
}

// coding 2: OBSERVATION_NO_LEVEL_LEAD
/**
 * OBSERVATION_NO_LEVEL_LEAD_ENABLED (the flip-3 tester's D, in this app; QA 6–7 Nov 2026; default off). "create a
 * CA for <name>, verbal, she was late on 10-20-26" made the Observation "verbal, she was late on 10-20-26". With
 * this flag on, a clause that is only a warning level is not part of the account (`ai/remap-incident.ts`
 * managerAccount). Off, as before.
 */
export function observationNoLevelLeadEnabled(): boolean {
  return envFlag("OBSERVATION_NO_LEVEL_LEAD_ENABLED");
}

/**
 * SOURCE_NOTE_GUARD_ENABLED (QA, 5 Nov 2026; default off). A reply reached a
 * manager with the model's own note about a source in it: "[S1 doesn't actually
 * cover general tardiness — it only covers failing to open the salon…]". The
 * marker stripping removes only a bare marker ("[S1]") or a group of them, so
 * a bracket that starts with a source tag and goes on in prose stayed. With the
 * flag on, the answer's last step removes such a bracket; a citation marker,
 * a group of markers, or a tag with only a page or section after it is kept
 * for the marker stripping as before (`ai/source-note.ts`). Off, as before.
 */
export function sourceNoteGuardEnabled(): boolean {
  return envFlag("SOURCE_NOTE_GUARD_ENABLED");
}

// coding 2: TWO_FORMS_EACH_PERSON
/**
 * TWO_FORMS_EACH_PERSON_ENABLED (QA, Sunny live tester after flip 7, 7 Nov 2026; default off). "Coaching form for <A>.
 * Also a CA for <B>." gave one Coaching card with no employee and "ask for <B>'s CA on its own". With this flag on,
 * the card is A's (answered again from A's own request if need be) and B's form is offered; "yes" starts it
 * (`ai/two-forms-own-person.ts`). Off, as before.
 */
export function twoFormsEachPersonEnabled(): boolean {
  return envFlag("TWO_FORMS_EACH_PERSON_ENABLED");
}

// coding 2: REMOVE_POLICY_NOT_NAMED
/**
 * REMOVE_POLICY_NOT_NAMED_ENABLED (port from the sibling app; A1, QA 6 Nov 2026; default off). "take the
 * attendance policy off the form" got "Policy: Attendance, as you said". With this flag on, a policy the turn
 * takes off ("take … off", "drop …") is not the one it names (`forms/ca-policy.ts` statedIn). Off, as before.
 */
export function removePolicyNotNamedEnabled(): boolean {
  return envFlag("REMOVE_POLICY_NOT_NAMED_ENABLED");
}

/**
 * CARD_POLICY_OWN_REQUEST_ENABLED (QA's live tester, flip 7, 7 Nov 2026; same flag in both apps; default off).
 * "Coaching form for <A> for being on her phone …", then "Coaching form for <B>": B's card cited Cell Phone/Smart
 * Watch from A's request, because the form answer's policy line is read over every manager turn of the chat. On: the
 * policy line and citations are read from the latest form request that names the card's employee, when no earlier
 * turn names them (`ai/card-policy-request.ts`). Off, as before.
 */
export function cardPolicyOwnRequestEnabled(): boolean {
  return envFlag("CARD_POLICY_OWN_REQUEST_ENABLED");
}

/**
 * REQUEST_PARTICIPLE_LEAD_ENABLED (QA's round-5 live Sunny check, 8 Nov 2026; default off). "I need a corrective
 * action made for under performance. <A> was below on PPTA, …" made the card's Observation of Offense start "made for
 * under performance.": "made / done / written up for" after the form was not read as the request. With the flag on it
 * is, and a request sentence whose rest is only a sales reason ("under performance") is left out of the Observation
 * when another sentence holds the account (`ai/remap-incident.ts` requestLead, accountSentences). Off, as before.
 */
export function requestParticipleLeadEnabled(): boolean {
  return envFlag("REQUEST_PARTICIPLE_LEAD_ENABLED");
}

/**
 * PRIOR_STEP_DATE_LIST_ENABLED (ported from the sibling app, QA round 5, 8 Nov 2026; same flag in both apps; default
 * off). "she already received a verbal warning and coaching on 9/8/2026, 9/15/2026 and 9/25/2026" listed only
 * "Coaching — 09/08/2026". On: a step told with a list of dates is one row per date, and a step named just before it
 * with "and" is listed with no date, since the manager tied no date to it (`forms/prior-actions.ts`). Off, as before.
 */
export function priorStepDateListEnabled(): boolean {
  return envFlag("PRIOR_STEP_DATE_LIST_ENABLED");
}

/**
 * PROPOSAL_MAKE_IT_ABOUT_ENABLED (coding 5, QA's Sunny flip-9 tester item 9, 8 Nov 2026; same flag in both apps;
 * default off). On a proposal card (no draft yet), "I need you to make it about showing up late and please list
 * the policy make the date for 10/14/26." was read as more account: the card's Observation and the drafting
 * model's notes at Create held the instruction word for word. On: a "make it / this / the form … about <X>"
 * sentence makes <X> the account from that turn on: the card's Observation (`ai/keep-filled-slots.ts`) and the
 * draft's notes (`forms/instances/[id]/draft/route.ts`) read <X>, never the instruction, and the account said
 * before it is set aside (`ai/make-it-about.ts`). The date and policy asks in the same sentence stay with their own
 * readers. Off, as before.
 */
export function proposalMakeItAboutEnabled(): boolean {
  return envFlag("PROPOSAL_MAKE_IT_ABOUT_ENABLED");
}

/**
 * PROPOSAL_POLICY_SET_ASIDE_ENABLED (coding 5; QA, 8 Nov 2026: live in both apps; same flag in both apps; default
 * off). On a proposal card, "take the attendance policy off the form", sent after the manager had named that policy,
 * left the Attendance citation and "Policy: Attendance, as you said" on the card, and the sentence was read back as
 * account. REMOVE_POLICY_NOT_NAMED covers only the take-off sentence naming the policy. On: a policy the manager took
 * off (named, or "the policy" for whatever the card cites) is set aside until named again: the card drops its policy
 * row and manual citations and says so (`ai/keep-filled-slots.ts`), the take-off sentence is no account, and at
 * Create the draft leaves it off its policy fields and "Policy reference" lines (`forms/instances/[id]/draft/
 * route.ts`). See `forms/policy-set-aside.ts`. Off, as before.
 */
export function proposalPolicySetAsideEnabled(): boolean {
  return envFlag("PROPOSAL_POLICY_SET_ASIDE_ENABLED");
}

/**
 * EXIT_DATE_LINE_AGREES_ENABLED (QA round 5, 8 Nov 2026; same flag in both apps; default off). "exit form for <name>,
 * last day 11/05, gave no notice": the reply listed "Date: the day the draft is created" above a card dated 11/5/2026,
 * and the form was created dated 11/5. On, with REPLY_MATCHES_CARD: an exit card's own date is the list's Date line
 * (`ai/reply-matches-card.ts`). Off, as before.
 */
export function exitDateLineAgreesEnabled(): boolean {
  return envFlag("EXIT_DATE_LINE_AGREES_ENABLED");
}

/**
 * CARD_POLICY_PLAN_ONLY_ENABLED (QA, 8 Nov 2026; default off). An under-performance Corrective Action whose Policy
 * line was Standards of Conduct sometimes planned to "review the Standards of Conduct and Evaluations and Raises
 * policies" with a second source, "Evaluations and Raises" p.34. With this flag on, on a Corrective Action card with a
 * Policy line, the Action Plan, the citation lines and the reply's citations keep only the policy that line names
 * (`ai/card-policy-plan-only.ts`). No Policy line, or nothing left: unchanged. Off, as before.
 */
export function cardPolicyPlanOnlyEnabled(): boolean {
  return envFlag("CARD_POLICY_PLAN_ONLY_ENABLED");
}

/**
 * LIST_POLICY_IS_EDIT_ENABLED (QA, 8 Nov 2026; default off; works with EDIT_POLICY_ASK_ENABLED). With a form open, a
 * turn that was only "please list the policy" read as a question and was answered as a general policy question, so
 * EDIT_POLICY_ASK never saw it. With this flag on, such a turn is not a question and the edit path takes it
 * (`ai/list-policy-ask.ts`); "what policy covers lateness?" is still a question. Off, as before.
 */
export function listPolicyIsEditEnabled(): boolean {
  return envFlag("LIST_POLICY_IS_EDIT_ENABLED");
}

/**
 * FORM_DATE_SAID_SETTLES_ENABLED (coding 5; QA, 8 Nov 2026; same flag in both apps; default off). "… make the date for
 * 10/14/26." on a card about a meeting missed on 10/10/26 still asked "You mentioned more than one date (10/10,
 * 10/14)". On: a date the manager says the form takes ("make / set / change the date to …", "date it …", "the date
 * should be …") is the form's Date, and the question is not asked (`forms/form-date-said.ts`, `forms/incident-dates.ts`
 * decideFormDate). Off, as before.
 */
export function formDateSaidSettlesEnabled(): boolean {
  return envFlag("FORM_DATE_SAID_SETTLES_ENABLED");
}

/**
 * CONDUCT_INCIDENT_CITES_PAGE_ENABLED (coding 5; QA's live tester, 8 Nov 2026, the managers' Woven wordings; same flag
 * in both apps; default off). "create a verbal corrective action for <A> for missing the 10-15-26 woven deadline" got
 * "Policy: this reads as Standards of Conduct …" with no section or page; "… a verbal due to not completing her woven
 * courses by the deadline" got no Policy line at all. WOVEN_TRAINING_CONDUCT (narrowed to acknowledgements) covers
 * neither. On: "not completing / not finishing <task>" is unfinished assigned work (`forms/ca-policy.ts`), and the
 * card keeps its "Standards of Conduct Policy, JBA Policy Manual p.12" line: REPLY_MATCHES_CARD's one-policy rule read
 * "this reads as **Standards of Conduct**" as another heading and dropped it (`ai/reply-matches-card.ts`). Off, as
 * before.
 */
export function conductIncidentCitesPageEnabled(): boolean {
  return envFlag("CONDUCT_INCIDENT_CITES_PAGE_ENABLED");
}

/**
 * REOPEN_NOT_OPEN_FORM_ENABLED (QA's Sunny round-4 gate, 8 Nov 2026; default off; same flag in both apps). With
 * REOPEN_BY_ANY_OPEN_VERB on, "I need the CA for the Must see behaviors … Make it in the format that I explained
 * above" with that CA open was answered "… is still a draft, so it's open to edit." with no edit ("see" read as a
 * show verb). With this flag on, a reopen of the form already open whose verb is not the request at the start of the
 * turn steps aside (`forms/chat-reopen.ts`); "show me the draft" still shows it. Off, as before.
 */
export function reopenNotOpenFormEnabled(): boolean {
  return envFlag("REOPEN_NOT_OPEN_FORM_ENABLED");
}

/**
 * NO_ACCOUNT_NO_APP_POLICY_ENABLED (QA's Sunny flip-9 live tester, 8 Nov 2026; default off). "ca for <A> not late"
 * asked "You haven't told me what happened yet" and, beside it, said "**Policy:** Attendance — read from this
 * request" (AS_YOU_SAID_APP_READ's reading of the app's own line, for a fault the manager denied), "Attendance Policy,
 * JBA Policy Manual p.14" and an Action Plan to "review the Attendance policy". QA's rule: no account, so no policy is
 * cited anywhere on that card; a policy the manager named stays. With this flag on, a Corrective Action card that asks
 * what happened, with no policy the manager named, loses that Policy line, its citation lines and citations, and its
 * Action Plan names "the applicable company policy" (`ai/no-account-policy-line.ts`). Off, as before.
 */
export function noAccountNoAppPolicyEnabled(): boolean {
  return envFlag("NO_ACCOUNT_NO_APP_POLICY_ENABLED");
}

/**
 * AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED (QA's Sunny flip-9 live tester, 8 Nov 2026; default off). "$20 payroll deduct
 * applies" read payroll deduct Yes and then asked "**Payroll deduction amount**?": the amount reader reads a figure
 * before "deducted" or "deduction", never before the bare "payroll deduct" the Yes reader reads. With this flag on, a
 * figure right before "payroll deduct" (or "payroll deduction") is the amount (`forms/payroll-deduct.ts`). The word
 * "payroll" is required: "$20 deduct" alone is not read. Off, as before.
 */
export function amountBeforePayrollDeductEnabled(): boolean {
  return envFlag("AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED");
}

/**
 * COPY_OWN_SALON_ENABLED (QA's Sunny flip-9 live tester, 8 Nov 2026; default off). "copy this form for <B>" — and
 * "the same draft that we did with <A> by changing the name and position?" → "<B>" (SAME_FORM_COPY_NEW_PERSON) —
 * gave B's card A's salon: the card took the salon the conversation named for A, though the ask says "Their own
 * position and location go on it". With this flag on, a card that copies another person's form takes the new
 * person's own salon when the roster gives them exactly one in the manager's scope (`forms/same-form-copy.ts`
 * withCopyOwnSalon). Several, or none: the card is left as it was. Off, as before.
 */
export function copyOwnSalonEnabled(): boolean {
  return envFlag("COPY_OWN_SALON_ENABLED");
}

/**
 * ACCOUNT_VERB_NOT_A_NAME_ENABLED (QA round 5, sf-s38, 8 Nov 2026; same flag in both apps; default off). "make me CA
 * for <first name> failing to complete shifts" made the card for "<First> Failing". On, with NOT_A_NAME_GUARD: a verb
 * that opens the account ("failing", "missing", "not", "being", …) is never part of a name, so the card goes to the
 * roster person already named in the chat (`forms/not-a-name.ts`). Off, as before.
 */
export function accountVerbNotANameEnabled(): boolean {
  return envFlag("ACCOUNT_VERB_NOT_A_NAME_ENABLED");
}

/**
 * OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED (QA round 5, sf-s38, 8 Nov 2026; default off). After Create refused a card as
 * "This proposal is out of date: …", "what does out of date mean" was answered from the knowledge base. On: a question
 * about "out of date" in a chat with a proposal card is answered about that card, with no retrieval
 * (`ai/out-of-date-is-the-proposal.ts`). Off, as before.
 */
export function outOfDateIsTheProposalEnabled(): boolean {
  return envFlag("OUT_OF_DATE_IS_THE_PROPOSAL_ENABLED");
}

/**
 * FINAL_REPLY_MARKER_GUARD_ENABLED (QA's live Sunny tester after round 4, 8 Nov 2026; default off). With
 * SOURCE_NOTE_GUARD on, a Corrective Action turn answered on the form path ("I need a corrective action for under
 * performance" → "must see behaviors", intent form|no_card) still reached the manager with "…their eyewear [S4][S3]."
 * and "…not an employee name [S1][S2]." — the guard never ran on that answer — and the bare-marker step itself left the
 * first of two side-by-side tags, or a tag followed by a dash ("…context [S1]- don't cover it.", coding 4's sf-s38).
 * With this flag on: the chat route runs the bare-marker step once more on the final reply, as the very last step on
 * every exit, whatever path made it; and the step takes a run of tags side by side as one, a dash after it no bar
 * (`ai/source-note.ts`). Off, as before.
 */
export function finalReplyMarkerGuardEnabled(): boolean {
  return envFlag("FINAL_REPLY_MARKER_GUARD_ENABLED");
}

/**
 * FORM_RECORDS_NO_JUDGEMENT_ENABLED (coding 5, port from the sibling app: QA's live test there, 8 Nov 2026; same flag in
 * both apps; default off). Listing someone's forms added "a notable number of Corrective Actions in under two weeks for
 * one person" and "worth reviewing … before deciding what comes next". On: the Form Monitoring block tells the model
 * to list each form with its date and status only, and `withoutRecordJudgement` drops such sentences from a records
 * answer (`forms/chat-form-records.ts`). Off, as before.
 */
export function formRecordsNoJudgementEnabled(): boolean {
  return envFlag("FORM_RECORDS_NO_JUDGEMENT_ENABLED");
}

/**
 * SIGNED_STEP_NOT_A_REQUEST_ENABLED (ported from the sibling app, QA's live tester there, round 4, 8 Nov 2026; same flag
 * in both apps; default off). "… <A> has signed a coaching document for being late on 10/14/26. …" beside a CA request
 * read as a second form request (here, with TWO_FORMS_EACH_PERSON, "Do you want a Coaching Form for <A> next?"). On: a
 * clause that tells a step already signed, given or received, and asks for nothing, is no form request
 * (`forms/form-requests.ts`); it stays the CA's Prior actions. Off, as before.
 */
export function signedStepNotARequestEnabled(): boolean {
  return envFlag("SIGNED_STEP_NOT_A_REQUEST_ENABLED");
}

/**
 * CREATE_COMMAND_POINTS_TO_CARD_ENABLED (QA's sf-s38, 8 Nov 2026; default off). With only a card open, "create it" and
 * "create  the draft" each sent the same proposal text again. With this flag on, such a turn keeps the card and says,
 * in one line, to press **Create draft** on it (`ai/card-meta-turn.ts`). Off, as before.
 */
export function createCommandPointsToCardEnabled(): boolean {
  return envFlag("CREATE_COMMAND_POINTS_TO_CARD_ENABLED");
}

/**
 * CARD_COMPLAINT_NOT_ACCOUNT_ENABLED (QA's sf-s38, 8 Nov 2026; default off). "this proposal is out od fate" with a card
 * open became the card's "**Observation of Offense:**". With this flag on, a complaint about the proposal, card or form
 * keeps the card as it was (its account unchanged) and asks what to change (`ai/card-meta-turn.ts`). Off, as before.
 */
export function cardComplaintNotAccountEnabled(): boolean {
  return envFlag("CARD_COMPLAINT_NOT_ACCOUNT_ENABLED");
}

/**
 * PROPOSAL_NAME_CORRECTION_ENABLED (QA, round 5, 8 Nov 2026; ported from Ask Bubbles; default off; reads with
 * NAME_CORRECTION_WORDS_ENABLED, live). On a card not yet created, "fix her last name <surname>" (and "her last name
 * is …", "it's spelled …") was not applied: the card kept the old name, and "it's spelled <surname>" put "Spelled
 * <surname>" on the card. With this flag on, the turn is read as "change her name to <the name>" against the card's
 * employee, and the roster decides as for any typed name (`forms/proposal-name-correction.ts`, called from the chat
 * route). Off, as before.
 */
export function proposalNameCorrectionEnabled(): boolean {
  return envFlag("PROPOSAL_NAME_CORRECTION_ENABLED");
}

/**
 * UNKNOWN_NAME_ASK_ENABLED (port of the sibling app's flag; QA's round-6 audit, 8 Nov 2026, ran its BF7 chain here;
 * default off). A typed name not on the directory was never read, and "Who is this **<form>** for? Give me their name
 * …" came back on every turn. On: the typed name is named back once and the question is never shown twice in a row
 * (`ai/unknown-name-ask.ts`). Off, as before.
 */
export function unknownNameAskEnabled(): boolean {
  return envFlag("UNKNOWN_NAME_ASK_ENABLED");
}

/**
 * CORRECTED_DATE_KEPT_ENABLED (QA's round-5 trace of corrective-action-conversation-qa Q6, 8 Nov 2026; coding 5;
 * default off). "the meeting was actually on 10-19-26" after a request dated 10-20-26: PRIOR_SENTENCE_FIX's date step
 * saw two incident dates and dated the card null, so Create saved today's date. On: the incident date the manager
 * corrected to is the card's date; a corrected prior step's date never is (`forms/corrected-incident-date.ts`). Off, as
 * before.
 */
export function correctedDateKeptEnabled(): boolean {
  return envFlag("CORRECTED_DATE_KEPT_ENABLED");
}

/**
 * DATE_QUESTION_KEPT_ENABLED (QA's round-5 trace of Q6, 8 Nov 2026; coding 5; default off). When PRIOR_SENTENCE_FIX's
 * date step (`ai/keep-filled-slots.ts`) left the card's date open between several dates, it dated the card null and
 * dropped its own "Which date goes on the form?", so the manager was never asked and Create dated the form the day it
 * was pressed. On: that question is added to the reply when the reply does not already ask it. Off, as before.
 */
export function dateQuestionKeptEnabled(): boolean {
  return envFlag("DATE_QUESTION_KEPT_ENABLED");
}

/**
 * POLICY_CORRECTION_NOT_ACCOUNT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 3; default off; same flag in
 * both apps). "it should be under performance not standard of conduct", turn 4 of a sales Corrective Action, was pasted
 * into the Observation of Offense. With this flag on, a short sentence that only says which policy or category applies
 * ("it should be X not Y", "it's X not Y", "wrong policy") is no account (`ai/policy-correction-turn.ts`); the turn
 * stays in the request for the policy readers. Off, as before.
 */
export function policyCorrectionNotAccountEnabled(): boolean {
  return envFlag("POLICY_CORRECTION_NOT_ACCOUNT_ENABLED");
}

/**
 * REVISION_EDIT_NEEDS_EDIT_ENABLED / NEXT_PUBLIC_REVISION_EDIT_NEEDS_EDIT_ENABLED (QA's Sunny round-5 live tester,
 * 8 Nov 2026, item 1; default off; same flags in both apps). "Change <A> CA" opened a new draft of the finalized form
 * whose banner said "You edited the policy wording: … was changed by hand" when nobody had edited anything: on a
 * revision, every carried policy field without verified provenance counted as an edit. With this flag on, a revision
 * counts as edited only once it has an edit of its own (`forms/policy-verification.ts`). The banner is shown in the
 * browser and Finalize reads the same rule on the server, so there are two variables: FLIP BOTH TOGETHER
 * (NEXT_PUBLIC_ is inlined at build time). Off, as before.
 */
export function revisionEditNeedsEditEnabled(): boolean {
  if (typeof window === "undefined") return envFlag("REVISION_EDIT_NEEDS_EDIT_ENABLED");
  const inlined = process.env.NEXT_PUBLIC_REVISION_EDIT_NEEDS_EDIT_ENABLED;
  return typeof inlined === "string" && ON.has(inlined.trim().toLowerCase());
}

/**
 * MISSED_SHIFT_NOT_LATENESS_ENABLED (QA's Sunny live Create test, round 5, 8 Nov 2026; sf-s38; coding 5; same flag in
 * both apps; default off). A Corrective Action for missed weekend shifts was saved with the Attendance lateness plan
 * ("expected to arrive on time … Continued lateness …"), not the plan the card showed. On: an account of a missed or
 * no-show shift, a call-out or an absence that says nothing about lateness keeps the general plan, as a missed meeting
 * does under MEETING_NOT_LATENESS_PLAN (`forms/attendance-action-plan.ts`). Off, as before.
 */
export function missedShiftNotLatenessEnabled(): boolean {
  return envFlag("MISSED_SHIFT_NOT_LATENESS_ENABLED");
}

/**
 * PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 2a; default off). "… she was
 * late today, $20 payroll deduct applies" kept "$20 payroll deduct applies Payroll deduction amount: $20." in the
 * Observation of Offense. With this flag on, the account loses the app's "Payroll deduction amount: $X." line and a bare
 * payroll answer clause; a payroll clause that says what it is for keeps its reason (`ai/payroll-clause-not-account.ts`).
 * Off, as before.
 */
export function payrollClauseNotAccountEnabled(): boolean {
  return envFlag("PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED");
}

/**
 * EXIT_TERMINATION_STATED_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 4; default off; only with
 * EXIT_STATED_ONLY for the reason). A termination letter pasted for an exit form: with EXIT_STATED_ONLY the card invented
 * nothing but also left the stated facts blank. With this flag on, "your employment … is terminated, effective
 * 11/06/2026" ticks the involuntary separation and is the Resignation Date, and the letter's stated reason ("This
 * decision follows …") is the Reason (`forms/exit-facts.ts`, `forms/exit-details.ts`). Keys or property "to return"
 * are still not returned, and "hours worked through" is still no last day. Off, as before.
 */
export function exitTerminationStatedEnabled(): boolean {
  return envFlag("EXIT_TERMINATION_STATED_ENABLED");
}

/**
 * UNDATED_ACCOUNT_BRIEF_ENABLED (QA's live Create test, 8 Nov 2026; coding 5; same flag in both apps; default off). An
 * account with no date ("missing her saturday and sunday shifts …") was saved as "… scheduled shifts on November 8,
 * 2026", the day the form was created: the draft brief told the model the form's date was the incident's. On: with no
 * date stated (a stated "today" is one), the brief says the form is dated the day it is created and no date goes into
 * the account (`forms/form-date-grounding.ts` formDateBrief). Off, as before.
 */
export function undatedAccountBriefEnabled(): boolean {
  return envFlag("UNDATED_ACCOUNT_BRIEF_ENABLED");
}

/**
 * TWO_FORMS_CARD_NOT_ASKED_ENABLED (QA, 8 Nov 2026, live check conv ef902fec; default off). A card that already names
 * its employee is never asked "Which of them is this <form> for — <that employee> or …?": the line is left out of the
 * final reply (`forms/card-not-asked.ts`). Off, as before.
 */
export function twoFormsCardNotAskedEnabled(): boolean {
  return envFlag("TWO_FORMS_CARD_NOT_ASKED_ENABLED");
}

/**
 * EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED (QA's Sunny round-5 live tester, 8 Nov 2026, item 4b; default off; same flag in
 * both apps). A termination letter naming "your Salon Director, <B>" was answered "Which of them is this
 * **Resignation/Exit Form** for — **<B>** or **<A>**?" with "**Job title:** Salon Director" under it. With this flag on, a
 * candidate named only right after a title is not offered as the subject, and that title line goes with them
 * (`ai/exit-other-person.ts`, one server-ask.ts step). Off, as before.
 */
export function exitOtherPersonNotSubjectEnabled(): boolean {
  return envFlag("EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED");
}

/**
 * POSSESSIVE_NO_APOSTROPHE_ENABLED (QA, 8 Nov 2026, from the sibling app's live tester with round 5; default off; same flag in both
 * apps; only with REOPEN_BY_ANY_OPEN_VERB). "bring up <first name>s corrective action" — the possessive typed without
 * its apostrophe, one roster person by that first name — asked "Who is this form for?" with a blank card, while
 * "<first name>'s" opened the form on file. With this flag on, a first name the roster does not have as typed is tried
 * without its final "s" ("ss" never), by the same one-person rule (`forms/chat-reopen.ts`). Off, as before.
 */
export function possessiveNoApostropheEnabled(): boolean {
  return envFlag("POSSESSIVE_NO_APOSTROPHE_ENABLED");
}

/**
 * KEPT_REQUEST_SAME_FORM_ENABLED / NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED (QA's round-6 item, 8 Nov 2026; default
 * off; only with REQUEST_KEPT_IN_WINDOW). "Create a Coaching Form from this conversation", asked well after "create
 * corrective action for <A> for Late Opening …", kept that Corrective Action request in the window, so the Coaching
 * card read <A> from the window and no longer said "I took <A> from earlier in this conversation — if this form is for
 * somebody else, tell me who." With this flag on, an earlier request is kept only when the current turn asks for the
 * same form or for none; a turn that asks for a different form keeps the window as it was without the flag, so the
 * person is carried from earlier turns with its notice (`forms/bounded-context.ts`). Same pair as
 * REQUEST_KEPT_IN_WINDOW: the server (the card) and the browser (the draft) read the window, so FLIP BOTH TOGETHER.
 * Off, as before.
 */
export function keptRequestSameFormEnabled(): boolean {
  if (typeof window === "undefined") return envFlag("KEPT_REQUEST_SAME_FORM_ENABLED");
  const inlined = process.env.NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED;
  return typeof inlined === "string" && ON.has(inlined.trim().toLowerCase());
}

/**
 * CARRIED_PERSON_NOTICE_ENABLED (QA's round-6 item, 8 Nov 2026; default off; same flag in both apps). On the route,
 * production's INTENT_EXTRACTION, SLOT_RETENTION and REQUEST_KEPT_IN_WINDOW each made a card that carried a person from
 * earlier turns drop "I took <A> from earlier in this conversation — if this form is for somebody else, tell me who."
 * With this flag on, a performance-form card whose person is not named in the manager's own last six turns, but is
 * named before them, says so (`ai/carried-person-notice.ts`, one server-ask.ts step). Off, as before.
 */
export function carriedPersonNoticeEnabled(): boolean {
  return envFlag("CARRIED_PERSON_NOTICE_ENABLED");
}

/**
 * FIELD_LABEL_NOT_A_QUESTION_ENABLED (QA, 8 Nov 2026, from the sibling app's live tester; the same here; default off;
 * same flag in both apps). On an open exit card, "how employee resigned - told management" was answered as a policy
 * question with no card: "how" read as a question. With this flag on, a clause that opens with one of the exit form's
 * field labels and gives its value is no question (`ai/question-not-form.ts`); with "?" it still is. Off, as before.
 */
export function fieldLabelNotAQuestionEnabled(): boolean {
  return envFlag("FIELD_LABEL_NOT_A_QUESTION_ENABLED");
}

/**
 * FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED (QA, Sunny live test, 8 Nov 2026; default off; same flag in both apps).
 * "make me CA for <first name> failing to complete shifts" → "Is this for **<full name>**?" → "make me CA for <full
 * name> failing to complete shifts 11/7 and 11/8" (or "<full name> 11/7 and 11/8") lost the dates: an answer that
 * named the person in full was read as the name alone. With this flag on, what the answer says besides the name is
 * kept (`ai/first-name-suggest.ts`). Off, as before.
 */
export function firstNameAnswerKeepsAccountEnabled(): boolean {
  return envFlag("FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED");
}

/**
 * SHIFT_ACCOUNT_IS_INCIDENT_ENABLED (QA, Sunny live test, 8 Nov 2026; default off; same flag in both apps). "make me CA
 * for <name> not showing up to her shifts on 11/7 and 11/8" had no Observation: a shift not shown up to, not completed
 * or missed, told with no subject and no "for", was read as the request alone. With this flag on it is an account
 * (`forms/corrective-action-intake.ts` describesIncident). Off, as before.
 */
export function shiftAccountIsIncidentEnabled(): boolean {
  return envFlag("SHIFT_ACCOUNT_IS_INCIDENT_ENABLED");
}

/**
 * MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED (QA, round-7c live test, 9 Nov 2026; default off; same flag in both apps). "I need
 * another corrective action for <P>, his cash drawer was short $20 on 11/3" cited theft and Handling Theft: the slot model's
 * policy heading ("Handling Theft") was written in front of the turn and read as the manager's. Where the manager's own
 * words name an incident the code reads, a model heading outside that incident's sections is not taken
 * (`ai/intent-slots.ts`). Off, as before.
 */
export function modelPolicyDefersToTopicEnabled(): boolean {
  return envFlag("MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED");
}
