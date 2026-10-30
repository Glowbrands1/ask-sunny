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
 * The Corrective Action form's shortcuts fill their fields: "no PD", "PD
 * applies", "deduct 25" the payroll deduction (Pau, 29 Oct 2026: "recognize
 * all form wording … so when manager type shortcuts, it can understand it";
 * same flag in both apps). Read inline by `forms/payroll-deduct-answer.ts`,
 * which imports nothing. Off, as before.
 */
export function caShortcutWordsEnabled(): boolean {
  return envFlag("CA_SHORTCUT_WORDS_ENABLED");
}
