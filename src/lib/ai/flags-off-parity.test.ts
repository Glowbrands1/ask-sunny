import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_ON } from "@/lib/config/default-on";

import { cardChangeEnabled, cardChangeFinalizedEnabled } from "@/lib/forms/card-change-flag";

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
  formDateIncidentOnlyEnabled,
  reopenVerbGuardEnabled,
  reopenByAnyOpenVerbEnabled,
  formRevisionsEnabled,
  formRevisionsUiEnabled,
  sensitiveDefaultsRedactEnabled,
  formPatchReducerEnabled,
  formReplyFromDiffEnabled,
  appPasswordHelpEnabled,
  policyCleaningIncidentEnabled,
  policySpecificTopicsEnabled,
  followUpNotPriorEnabled,
  stateCodeNotAPersonEnabled,
  googleReviewsInChatEnabled,
  draftNeverBlankEnabled,
  nameBeforeTitleEnabled,
  latePayrollFromFormEnabled,
  storedSlotsNotARequestEnabled,
  priorSentenceFixEnabled,
  attendanceActionPlanEnabled,
  hideNoPolicyMatchNoticeEnabled,
  payrollTypoNotANameEnabled,
  answerNotANameEnabled,
  dateAnswerAppliedEnabled,
  dateAnswerKeepsOpenEnabled,
  requestLineAccountEnabled,
  notDeductibleReadEnabled,
  priorStepSentenceEnabled,
  exitFulfilledIsLastDayEnabled,
  futurePriorRowDropEnabled,
  nameQuestionOnlyEnabled,
  animalAnywhereEnabled,
  meetingNotLatenessPlanEnabled,
  planPayrollSentenceEnabled,
  jobTitleNotIncidentEnabled,
  priorRowNotOnIncidentDateEnabled,
  jobTitleFromWordsEnabled,
  caAsksWhatHappenedEnabled,
  omissionIsAccountEnabled,
  observationWithoutAskEnabled,
  stepDateNotIncidentEnabled,
  warningLevelAndClauseEnabled,
  jobTitleAppositionEnabled,
  followUpReadbackCueEnabled,
  exitReadbackJobTitleEnabled,
  followUpCitationFieldEnabled,
  grammarAskNotAccountEnabled,
  jobTitleCaseEnabled,
  levelStepNotAccountEnabled,
  jobTitleReadbackCaseEnabled,
  stepDateNoQuestionEnabled,
  firstNameAskEnabled,
  typoReadingRoutesEnabled,
  typoReadingCopyEnabled,
  dayWordTyposEnabled,
  amountUnknownAckEnabled,
  outOfScopePlaceSaidEnabled,
  outOfScopePlaceKeepsOwnEnabled,
  formTypeSwitchEnabled,
  formTypeSwitchAfterCreateNoteEnabled,
  cardChangePlanRebuildEnabled,
  spendGuardAllCallsEnabled,
  firstNameSuggestEnabled,
  otherWriteInGuardEnabled,
  unreadDayNotIncidentDateEnabled,
  unreadDatePlainAskEnabled,
  partialNameCardCurrentEnabled,
  partialSurnameAskEnabled,
  suggestAnswerReplacesTypedEnabled,
  preferredNameCardCurrentEnabled,
  switchKeepsNamedFormEnabled,
  severalFormsStayCurrentEnabled,
  partialNameLooseMatchEnabled,
  staleNeedsRosterPersonEnabled,
  correctedEmployeeSlotEnabled,
  exitTermsNotNamesEnabled,
  exitShortcutWordsEnabled,
  caShortcutWordsEnabled,
  streetAddressNotANameEnabled,
  accountOnlyPolicyQueryEnabled,
  relativeDateReaderEnabled,
  unreadDateAskEnabled,
  amountAnswerSavedEnabled,
  amountAnswerNotAccountEnabled,
  modelCallDailyCapEnabled,
  monthlyBudgetGuardEnabled,
  ordinalDateInDraftEnabled,
  widerDateReaderEnabled,
  aiReadsCodeChecksEnabled,
  envFlag,
  draftNoInventedPlanEnabled,
} from "@/lib/config/chat-quality-flags";

import { augmentIntakeQuestion } from "./intake-augment";
import { flaggedCitationWrite } from "./policy-citation-fields";
import { privateCreatorFormsEnabled, privateCreatorsActive } from "@/lib/forms/private-creators";

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
  // coding 4: SALON_NAME_LETTER_WORD (Coding-4's finding, 13 Nov 2026; default off).
  "SALON_NAME_LETTER_WORD_ENABLED",
  // coding 4: SHARED_CITY_ASKS_SALON (QA, Sunny 38c live, 13 Nov 2026; default off).
  "SHARED_CITY_ASKS_SALON_ENABLED",
  // coding 2: OFF_ROSTER_PLACE_ANSWER (QA's Sunny 37b live bug, 12 Nov 2026; default off).
  "OFF_ROSTER_PLACE_ANSWER_ENABLED",
  // coding 2: OFFERED_NAME_ACCEPTED (QA, 12 Nov 2026: an admin's "use <C>" refused; default off).
  "OFFERED_NAME_ACCEPTED_ENABLED",
  // coding 4: FORM_DATE_BUSINESS_TODAY (live bug, QA, 13 Nov 2026; default off).
  "FORM_DATE_BUSINESS_TODAY_ENABLED",
  // coding 4: CLOSE_SPELLING_MATCH (Pau via QA, 13 Nov 2026; default off).
  "CLOSE_SPELLING_MATCH_ENABLED",
  // coding 6: CARD_CHECKED_AGAINST_WORDS (Pau's direction via QA, 13 Nov 2026; default off).
  "CARD_CHECKED_AGAINST_WORDS_ENABLED",
  // coding 6: EDIT_SEES_SAVED_FORM (Pau's direction via QA, 13 Nov 2026; default off).
  "EDIT_SEES_SAVED_FORM_ENABLED",
  // coding 4: FULL_MANUAL_KEEPS_RETRIEVAL (QA, 10 Nov 2026; default off).
  "FULL_MANUAL_KEEPS_RETRIEVAL_ENABLED",
  // coding 4: FORM_NAME_NOT_A_TITLE (QA's prod-env reading, D5, 11 Nov 2026; default off).
  "FORM_NAME_NOT_A_TITLE_ENABLED",
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
  // coding 2: CARD_POLICY_PLAN_ONLY (default off): forced off with the others in the child run.
  "CARD_POLICY_PLAN_ONLY_ENABLED",
  // coding 2: LIST_POLICY_IS_EDIT (default off): forced off with the others in the child run.
  "LIST_POLICY_IS_EDIT_ENABLED",
  // coding 2: NO_ACCOUNT_NO_APP_POLICY (default off): forced off with the others in the child run.
  "NO_ACCOUNT_NO_APP_POLICY_ENABLED",
  // coding 2: AMOUNT_BEFORE_PAYROLL_DEDUCT (default off): forced off with the others in the child run.
  "AMOUNT_BEFORE_PAYROLL_DEDUCT_ENABLED",
  // coding 2: COPY_OWN_SALON (default off): forced off with the others in the child run.
  "COPY_OWN_SALON_ENABLED",
  // coding 2: REMOVE_POLICY_NOT_NAMED (A1; default off): forced off with the others in the child run.
  "REMOVE_POLICY_NOT_NAMED_ENABLED",
  "FOLLOWUP_NEW_TOPIC_RETRIEVAL_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "DRAFT_REUSE_OWN_ONLY_ENABLED",
  "RESIGN_METHOD_FOLLOWUP_ENABLED",
  "CHAT_LONG_MESSAGE_ENABLED",
  "NEXT_PUBLIC_CHAT_LONG_MESSAGE_ENABLED",
  "NAMED_FORM_EXACT_ENABLED",
  "TERSE_SLOT_READ_ENABLED",
  "REMAP_DRAFT_SOURCES_ENABLED",
  "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED",
  "FORM_DATE_INCIDENT_ONLY_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "REOPEN_BY_ANY_OPEN_VERB_ENABLED",
  // coding 2: REOPEN_NOT_OPEN_FORM (default off): forced off with the others in the child run.
  "REOPEN_NOT_OPEN_FORM_ENABLED",
  "FORM_REVISIONS_ENABLED",
  "NEXT_PUBLIC_FORM_REVISIONS_ENABLED",
  "SENSITIVE_DEFAULTS_REDACT_ENABLED",
  "APP_PASSWORD_HELP_ENABLED",
  "POLICY_CLEANING_INCIDENT_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
  "FOLLOW_UP_NOT_PRIOR_ENABLED",
  "STATE_CODE_NOT_A_PERSON_ENABLED",
  "GOOGLE_REVIEWS_IN_CHAT_ENABLED",
  "DRAFT_NEVER_BLANK_ENABLED",
  // Missing from this list since its PR (QA, 7 Nov 2026): forced off with the others in the child run.
  "STALE_PROMPT_LINES_OFF_ENABLED",
  "NAME_BEFORE_TITLE_ENABLED",
  "LATE_OPEN_PAYROLL_FROM_FORM_ENABLED",
  "STORED_SLOTS_NOT_A_REQUEST_ENABLED",
  "PRIOR_SENTENCE_FIX_ENABLED",
  "ATTENDANCE_ACTION_PLAN_ENABLED",
  "HIDE_NO_POLICY_MATCH_NOTICE_ENABLED",
  "PAYROLL_TYPO_NOT_A_NAME_ENABLED",
  "ANSWER_NOT_A_NAME_ENABLED",
  "DATE_ANSWER_APPLIED_ENABLED",
  "DATE_ANSWER_KEEPS_OPEN_ENABLED",
  "REQUEST_LINE_ACCOUNT_ENABLED",
  "NOT_DEDUCTIBLE_READ_ENABLED",
  "PRIOR_STEP_SENTENCE_ENABLED",
  // coding 2: PRIOR_STEP_PREVIOUSLY (A2; default off): forced off with the others in the child run.
  "PRIOR_STEP_PREVIOUSLY_ENABLED",
  "EXIT_FULFILLED_IS_LAST_DAY_ENABLED",
  "FUTURE_PRIOR_ROW_DROP_ENABLED",
  "NAME_QUESTION_ONLY_ENABLED",
  "ANIMAL_ANYWHERE_ENABLED",
  "MEETING_NOT_LATENESS_PLAN_ENABLED",
  "PLAN_PAYROLL_SENTENCE_ENABLED",
  "JOB_TITLE_NOT_INCIDENT_ENABLED",
  "PRIOR_ROW_NOT_ON_INCIDENT_DATE_ENABLED",
  "NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED",
  "NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED",
  "NEXT_PUBLIC_CHAT_LOCAL_OWNER_ENABLED",
  "PRIVATE_CREATOR_FORMS_ENABLED",
  "JOB_TITLE_FROM_WORDS_ENABLED",
  "CA_ASKS_WHAT_HAPPENED_ENABLED",
  "OMISSION_IS_ACCOUNT_ENABLED",
  "OBSERVATION_WITHOUT_ASK_ENABLED",
  "STEP_DATE_NOT_INCIDENT_ENABLED",
  "WARNING_LEVEL_AND_CLAUSE_ENABLED",
  "JOB_TITLE_APPOSITION_ENABLED",
  "FOLLOW_UP_READBACK_CUE_ENABLED",
  "EXIT_READBACK_JOB_TITLE_ENABLED",
  "FOLLOW_UP_CITATION_FIELD_ENABLED",
  "GRAMMAR_ASK_NOT_ACCOUNT_ENABLED",
  "JOB_TITLE_CASE_ENABLED",
  "LEVEL_STEP_NOT_ACCOUNT_ENABLED",
  // coding 2: OBSERVATION_NO_LEVEL_LEAD (default off): forced off with the others in the child run.
  "OBSERVATION_NO_LEVEL_LEAD_ENABLED",
  "JOB_TITLE_READBACK_CASE_ENABLED",
  "STEP_DATE_NO_QUESTION_ENABLED",
  "FIRST_NAME_ASK_ENABLED",
  "TYPO_READING_ROUTES_ENABLED",
  "TYPO_READING_COPY_ENABLED",
  "DAY_WORD_TYPOS_ENABLED",
  "AMOUNT_UNKNOWN_ACK_ENABLED",
  "OUT_OF_SCOPE_PLACE_SAID_ENABLED",
  "OUT_OF_SCOPE_PLACE_KEEPS_OWN_ENABLED",
  "FORM_TYPE_SWITCH_ENABLED",
  "FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED",
  "CARD_CHANGE_PLAN_REBUILD_ENABLED",
  "SPEND_GUARD_ALL_CALLS_ENABLED",
  "FIRST_NAME_SUGGEST_ENABLED",
  "OTHER_WRITE_IN_GUARD_ENABLED",
  "OTHER_WRITE_IN_NOT_A_QUESTION_ENABLED",
  "ANGLE_PLACEHOLDER_GUARD_ENABLED",
  "REVISION_SAME_VALUE_ENABLED",
  "CHAT_HISTORY_STATE_CHUNKED_ENABLED",
  "NEXT_PUBLIC_CHAT_HISTORY_TOLERANT_ENABLED",
  "FORM_EDIT_PLAIN_WORDS_ENABLED",
  "FORM_EDIT_HONEST_REPLY_ENABLED",
  "CLAIM_GUARD_ENABLED",
  "NAME_CORRECTION_WORDS_ENABLED",
  // Coding: FINAL_REPLY_MARKER_GUARD (round 5, 8 Nov 2026; default off).
  "FINAL_REPLY_MARKER_GUARD_ENABLED",
  // Coding: PROPOSAL_NAME_CORRECTION (round 5, 8 Nov 2026; port from Ask Bubbles; default off).
  "PROPOSAL_NAME_CORRECTION_ENABLED",
  // Coding: NEAR_MISS_QUESTION_RULES (round 5, 8 Nov 2026; default off; ships with the name set).
  "NEAR_MISS_QUESTION_RULES_ENABLED",
  // Coding: FORM_NAME_OFF_ROSTER_ASK (QA, 10 Nov 2026; default off; ships with the name set).
  "FORM_NAME_OFF_ROSTER_ASK_ENABLED",
  "POLICY_CHANGE_REST_OF_TURN_ENABLED",
  "OPEN_FORM_NO_SELECTION_ENABLED",
  "PERSON_GUARD_ENABLED",
  "REFUSAL_NO_REPEAT_ENABLED",
  "TITLE_NOT_SPEAKERS_MANAGER_ENABLED",
  "NEW_REQUEST_OWN_TURNS_ENABLED",
  "OPEN_DRAFT_KEEPS_TURNS_ENABLED",
  "FORM_EDIT_REFERS_BACK_ENABLED",
  "SAME_FORM_COPY_ENABLED",
  "SAME_FORM_COPY_NEW_PERSON_ENABLED",
  // coding 6: GUEST_ATTITUDE_CONDUCT (default off): forced off with the others.
  "GUEST_ATTITUDE_CONDUCT_ENABLED",
  // coding 6: DRAFT_WRITE_NEVER_SILENT (default off): forced off with the others.
  "DRAFT_WRITE_NEVER_SILENT_ENABLED",
  // coding 6: CA_PROCEDURE_BASIS (default off; rebuilt from old S544): forced off with the others.
  "CA_PROCEDURE_BASIS_ENABLED",
  // coding 6: REGISTER_ACCURACY_CONDUCT (default off): forced off with the others.
  "REGISTER_ACCURACY_CONDUCT_ENABLED",
  // coding 6: DETAILS_FROM_EARLIER_ANSWER (default off): forced off with the others.
  "DETAILS_FROM_EARLIER_ANSWER_ENABLED",
  // coding 6: ACCOUNT_BEFORE_REQUEST (default off): forced off with the others.
  "ACCOUNT_BEFORE_REQUEST_ENABLED",
  // coding 6: SAME_REQUEST_CARRIES_ACCOUNT and SAME_REQUEST_KEEPS_EARLIER_CARD (default off): forced off with the others.
  "SAME_REQUEST_CARRIES_ACCOUNT_ENABLED",
  "SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED",
  // coding 6: TEMPLATE_OUTLINE_FIELDS (default off): forced off with the others.
  "TEMPLATE_OUTLINE_FIELDS_ENABLED",
  // coding 6: POLICY_REFERENCE_NOT_ACCOUNT (default off): forced off with the others.
  "POLICY_REFERENCE_NOT_ACCOUNT_ENABLED",
  // coding 6: LEVEL_AFTER_FORM_NAME (default off): forced off with the others.
  "LEVEL_AFTER_FORM_NAME_ENABLED",
  // coding 6: TEAM_CARD_NOT_PRODUCT (default off): forced off with the others.
  "TEAM_CARD_NOT_PRODUCT_ENABLED",
  // coding 6: REOPEN_CLOSE_SPELLING (default off): forced off with the others.
  "REOPEN_CLOSE_SPELLING_ENABLED",
  // coding 6: PAYROLL_SPLIT_WORDS (default off): forced off with the others.
  "PAYROLL_SPLIT_WORDS_ENABLED",
  // coding 6: SAME_REQUEST_OTHER_PERSON (default off): forced off with the others.
  "SAME_REQUEST_OTHER_PERSON_ENABLED",
  // coding 6: MAKE_THAT_UPDATE_ACCOUNT (default off; QA's 10 Nov audit, copy-paste case): forced off with the others.
  "MAKE_THAT_UPDATE_ACCOUNT_ENABLED",
  // coding 6: SAME_REQUEST_OFF_ROSTER (default off; QA's r23 live test, #779 off roster): forced off with the others.
  "SAME_REQUEST_OFF_ROSTER_ENABLED",
  // coding 6: PASTED_OUTLINE_TO_OPEN_DRAFT (default off; QA's r23 live test of sf-s21): forced off with the others.
  "PASTED_OUTLINE_TO_OPEN_DRAFT_ENABLED",
  // coding 6: COACHING_OBSERVED_SAVED (default off): forced off with the others.
  "COACHING_OBSERVED_SAVED_ENABLED",
  // coding 6: APP_INSTRUCTIONS_NOT_ACCOUNT (default off): forced off with the others.
  "APP_INSTRUCTIONS_NOT_ACCOUNT_ENABLED",
  // coding 5: SPELLING_CLEANUP (default off; Pau via QA, 13 Nov 2026): forced off with the others.
  "SPELLING_CLEANUP_ENABLED",
  // coding 6: FAILURE_TO_OPEN_IS_LATE_OPENING (default off): forced off with the others.
  "FAILURE_TO_OPEN_IS_LATE_OPENING_ENABLED",
  // coding 6: TERMINATION_STATED_TICKS (default off): forced off with the others.
  "TERMINATION_STATED_TICKS_ENABLED",
  // coding 6: PAYROLL_BARE_SENTENCE (default off): forced off with the others.
  "PAYROLL_BARE_SENTENCE_ENABLED",
  // coding 6: ADVICE_ASK_NOT_ACCOUNT (default off): forced off with the others.
  "ADVICE_ASK_NOT_ACCOUNT_ENABLED",
  // coding 6: DRAFT_WROTE_NOTHING_NOTICE (default off): forced off with the others.
  "DRAFT_WROTE_NOTHING_NOTICE_ENABLED",
  "STAFF_PICKER_ENABLED",
  "STAFF_PICKER_STORE_TITLES_ENABLED",
  "STAFF_PICKER_BARE_ANSWER_ENABLED",
  "WHOLE_TEAM_COACHING_ENABLED",
  "SAME_ASK_NO_REPEAT_ENABLED",
  "CARD_POLICY_LABEL_ENABLED",
  "ADDRESS_NOT_PERSON_ENABLED",
  "SLOT_NAME_ON_FORM_REQUEST_ENABLED",
  "FIRST_NAME_YES_KEEPS_REQUEST_ENABLED",
  "FORM_PATCH_REDUCER_ENABLED",
  "FORM_REPLY_FROM_DIFF_ENABLED",
  // coding 5, 7 Nov 2026 (default off; only with FORM_PATCH_REDUCER).
  "EDIT_POLICY_ASK_ENABLED",
  "CARD_OBSERVATION_OWN_REQUEST_ENABLED",
  "CA_NAME_FROM_CHAT_ENABLED",
  "NEW_REQUEST_OPEN_DRAFT_ENABLED",
  "PRIOR_ACTIONS_POLICY_ENABLED",
  "PRIOR_ACTIONS_NO_SIGNED_ENABLED",
  "PRIOR_COACHING_DENIAL_ENABLED",
  "NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED",
  "TEAM_CARD_WORDING_ENABLED",
  "OBSERVATION_NOT_POLICY_NAME_ENABLED",
  "STAFF_PICKER_REMEMBER_LOCATION_ENABLED",
  "SHARED_LOGIN_NOT_STAFF_ENABLED",
  "STAFF_PICKER_NO_REPEAT_ENABLED",
  "COACHING_FOR_EVERYONE_ENABLED",
  "THIS_PERSONS_TURNS_ENABLED",
  // Missing from this list since its PR (QA, 7 Nov 2026): forced off with the others in the child run.
  "REQUEST_KEPT_IN_WINDOW_ENABLED",
  "NEXT_PUBLIC_REQUEST_KEPT_IN_WINDOW_ENABLED",
  // coding 2: POLICY_CORRECTION_NOT_ACCOUNT (default off): forced off with the others.
  "POLICY_CORRECTION_NOT_ACCOUNT_ENABLED",
  // coding 2: REVISION_EDIT_NEEDS_EDIT (default off): forced off with the others.
  "REVISION_EDIT_NEEDS_EDIT_ENABLED",
  "NEXT_PUBLIC_REVISION_EDIT_NEEDS_EDIT_ENABLED",
  // coding 2: PAYROLL_CLAUSE_NOT_ACCOUNT (default off): forced off with the others.
  "PAYROLL_CLAUSE_NOT_ACCOUNT_ENABLED",
  // coding 2: EXIT_TERMINATION_STATED (default off): forced off with the others.
  "EXIT_TERMINATION_STATED_ENABLED",
  // coding 2: EXIT_OTHER_PERSON_NOT_SUBJECT (default off): forced off with the others.
  "EXIT_OTHER_PERSON_NOT_SUBJECT_ENABLED",
  // coding 2: POSSESSIVE_NO_APOSTROPHE (default off): forced off with the others.
  "POSSESSIVE_NO_APOSTROPHE_ENABLED",
  // coding 2: KEPT_REQUEST_SAME_FORM (default off): forced off with the others.
  "KEPT_REQUEST_SAME_FORM_ENABLED",
  "NEXT_PUBLIC_KEPT_REQUEST_SAME_FORM_ENABLED",
  // coding 2: CARRIED_PERSON_NOTICE (default off): forced off with the others.
  "CARRIED_PERSON_NOTICE_ENABLED",
  // coding 2: FIELD_LABEL_NOT_A_QUESTION (default off): forced off with the others.
  "FIELD_LABEL_NOT_A_QUESTION_ENABLED",
  "AM_PRIOR_WARNINGS_ENABLED",
  "TRUNCATION_RETRY_ENABLED",
  "CHAT_RESPONSE_STREAM_ENABLED",
  "TRUNCATION_RETRY_BUDGET_ENABLED",
  "REPORT_NAME_NOT_A_PERSON_ENABLED",
  "MANAGER_NAME_NOT_EMPLOYEE_ENABLED",
  "CHAT_IMPORT_OWN_ONLY_ENABLED",
  "CHAT_IMPORT_PROVEN_OWN_ENABLED",
  "UNREAD_DAY_NOT_INCIDENT_DATE_ENABLED",
  "UNREAD_DATE_PLAIN_ASK_ENABLED",
  "PARTIAL_NAME_CARD_CURRENT_ENABLED",
  "PARTIAL_SURNAME_ASK_ENABLED",
  "SUGGEST_ANSWER_REPLACES_TYPED_ENABLED",
  "PREFERRED_NAME_CARD_CURRENT_ENABLED",
  "SWITCH_KEEPS_NAMED_FORM_ENABLED",
  "SEVERAL_FORMS_STAY_CURRENT_ENABLED",
  "PARTIAL_NAME_LOOSE_MATCH_ENABLED",
  "STALE_NEEDS_ROSTER_PERSON_ENABLED",
  "CORRECTED_EMPLOYEE_SLOT_ENABLED",
  "EXIT_TERMS_NOT_NAMES_ENABLED",
  "EXIT_SHORTCUT_WORDS_ENABLED",
  "CA_SHORTCUT_WORDS_ENABLED",
  "STREET_ADDRESS_NOT_A_NAME_ENABLED",
  "TITLE_KEEPS_LABEL_WORDS_ENABLED",
  "SPOKEN_TITLE_WHOLE_ENABLED",
  "LEVEL_REQUEST_DATE_ENABLED",
  "TITLE_SPELLED_OUT_ENABLED",
  "REQUEST_LEAD_FILLER_ENABLED",
  "NEW_PERSON_REQUEST_ENABLED",
  "NEW_REQUEST_OWN_DATE_ENABLED",
  "NEXT_PUBLIC_CARD_CHANGE_ENABLED",
  "NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED",
  "ACCOUNT_ONLY_POLICY_QUERY_ENABLED",
  "RELATIVE_DATE_READER_ENABLED",
  "UNREAD_DATE_ASK_ENABLED",
  "AMOUNT_ANSWER_SAVED_ENABLED",
  "AMOUNT_ANSWER_NOT_ACCOUNT_ENABLED",
  "MODEL_CALL_DAILY_CAP_ENABLED",
  "MONTHLY_BUDGET_GUARD_ENABLED",
  "ORDINAL_DATE_IN_DRAFT_ENABLED",
  "WIDER_DATE_READER_ENABLED",
  "AI_READS_CODE_CHECKS_ENABLED",
  "LAST_FIRST_NAME_READ_ENABLED",
  "ROSTER_STORE_SCOPED_ENABLED",
  "FORM_EDIT_NAME_GATE_ROSTER_ENABLED",
  "FORM_PLACEHOLDER_WORDS_ENABLED",
  "PRIMARY_SALON_NOT_EDIT_ENABLED",
  "CA_SALES_POLICY_ENABLED",
  "CA_PERFORMANCE_REASON_ENABLED",
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "PAST_FORMS_BEFORE_LIBRARY_ENABLED",
  "COACHING_ASKS_WHAT_HAPPENED_ENABLED",
  "KEEP_ROSTER_EXACT_NAME_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "TITLE_OF_THE_EMPLOYEE_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "REPLY_MATCHES_CARD_ENABLED",
  "METRIC_GUARD_ENABLED",
  // QA, 7 Nov 2026 (default off).
  "METRIC_CHOICE_ONE_QUESTION_ENABLED",
  // The second Sunny gate's fix flags (6 Nov 2026): forced off with the others in the child run.
  "TITLE_ENDS_AT_LINE_ENABLED",
  "FULL_POSITION_TITLE_ENABLED",
  // QA, 10 Nov 2026 (default off): "not following the dress code" names the policy as broken.
  "NOT_FOLLOWING_IS_VIOLATION_ENABLED",
  "BARE_NOT_DENIAL_ENABLED",
  "PLACE_FROM_CUE_ENABLED",
  // Port of the sibling app's flip-3 fix (6 Nov 2026): forced off with the others in the child run.
  "NO_NOTICE_NO_DATE_ENABLED",
  // QA's live Sunny re-check (6 Nov 2026): forced off with the others in the child run.
  "BARE_NOT_AFTER_REQUEST_ENABLED",
  // #571 (default off): forced off with the others in the child run.
  "SOURCE_NOTE_GUARD_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
  "ROSTER_NOT_FOUND_ANY_PHRASING_ENABLED",
  "EXIT_STATED_ONLY_ENABLED",
  // Ported from the sibling app's flip-3 gate (6 Nov 2026).
  "OFF_ROSTER_CONFIRM_ENABLED",
  // QA's audit, 7 Nov 2026 (default off).
  "COMPLAINT_ACCOUNT_ENABLED",
  "POLICY_CHANGE_RELEVANT_ENABLED",
  "CA_OFFER_KEEPS_ACCOUNT_ENABLED",
  // After the Sunny flip (6 Nov 2026): forced off with the others in the child run.
  "SALES_SHORTFALL_OBJECT_ENABLED",
  "SALES_OBSERVATION_ACCOUNT_ENABLED",
  // Coding: REQUEST_PARTICIPLE_LEAD (round-5, 8 Nov 2026; default off).
  "REQUEST_PARTICIPLE_LEAD_ENABLED",
  "UNDER_PERFORMANCE_EXPLAINED_ENABLED",
  // After the Sunny flip (6 Nov 2026, row 6): forced off with the others in the child run.
  "TWO_FORMS_OWN_PERSON_ENABLED",
  // coding 2: TWO_FORMS_EACH_PERSON (default off): forced off with the others in the child run.
  "TWO_FORMS_EACH_PERSON_ENABLED",
  "TWO_FORMS_CARD_NOT_ASKED_ENABLED",
  // coding 2: CREATE_COMMAND_POINTS_TO_CARD and CARD_COMPLAINT_NOT_ACCOUNT (default off): forced off with the others.
  "CREATE_COMMAND_POINTS_TO_CARD_ENABLED",
  "CARD_COMPLAINT_NOT_ACCOUNT_ENABLED",
  // coding 5: UNKNOWN_NAME_ASK (port of the sibling app's flag, default off): forced off with the others in the child run.
  "UNKNOWN_NAME_ASK_ENABLED",
  // coding 5: CORRECTED_DATE_KEPT (default off): forced off with the others in the child run.
  "CORRECTED_DATE_KEPT_ENABLED",
  "DATE_QUESTION_KEPT_ENABLED",
  // coding 5: MISSED_SHIFT_NOT_LATENESS (default off): forced off with the others in the child run.
  "MISSED_SHIFT_NOT_LATENESS_ENABLED",
  // coding 4: ONE_CARD_ONE_PAGE (QA, Sunny round 9, 9 Nov 2026; default off): forced off with the others in the child run.
  "ONE_CARD_ONE_PAGE_ENABLED",
  "ANOTHER_REQUEST_LEAD_ENABLED",
  // coding 4: the make-it-about chain, ported from the sibling app (9 Nov 2026; default off): forced off with the others.
  "STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED",
  "STEP_B_DATE_SAID_ENABLED",
  "STEP_B_DATE_WITH_ABOUT_ENABLED",
  "MADE_ABOUT_ALL_OR_NOTHING_ENABLED",
  "MADE_ABOUT_UNDATED_TOGETHER_ENABLED",
  "MADE_ABOUT_POLICY_LINE_ENABLED",
  "MADE_ABOUT_READER_ACCOUNT_ENABLED",
  "MADE_ABOUT_REWRITE_FINISHES_ENABLED",
  // coding 4: CHAT_STAGE_TIMINGS (QA, 9 Nov 2026; default off): forced off with the others in the child run.
  "CHAT_STAGE_TIMINGS_ENABLED",
  "CHAT_PARALLEL_LOADS_ENABLED",
  "CHAT_PARALLEL_REWRITE_ENABLED",
  // coding 4: QA's live Bubbles round 13 (9 Nov 2026; default off): forced off with the others in the child run.
  "MADE_ABOUT_TOPIC_EVIDENCE_ENABLED",
  "FORM_DATE_SAID_ALONE_ENABLED",
  "MADE_ABOUT_SAID_DATE_ENABLED",
  "MADE_ABOUT_POLICY_LINE_REPLACES_ENABLED",
  "SECTION_BREAKS_KEPT_ENABLED",
  "ADD_NOT_REPEATED_ENABLED",
  "ADD_NOT_REPEATED_SENTENCES_ENABLED",
  // coding 4: MODEL_POLICY_DEFERS_TO_TOPIC (QA, round 7c, 9 Nov 2026; default off): forced off with the others in the child run.
  "MODEL_POLICY_DEFERS_TO_TOPIC_ENABLED",
  // coding 4: WORK_AREA_ABSENCE_CITES_CONDUCT (Pau's decision, 9 Nov 2026; default off): forced off with the others in the child run.
  "WORK_AREA_ABSENCE_CITES_CONDUCT_ENABLED",
  // coding 4: FIRST_NAME_ANSWER_KEEPS_ACCOUNT (default off): forced off with the others in the child run.
  "FIRST_NAME_ANSWER_KEEPS_ACCOUNT_ENABLED",
  "SHIFT_ACCOUNT_IS_INCIDENT_ENABLED",
  // coding 5: UNDATED_ACCOUNT_BRIEF (default off): forced off with the others in the child run.
  "UNDATED_ACCOUNT_BRIEF_ENABLED",
  "EXCERPT_BRAND_FILTER_ENABLED",
  "HUMAN_REPLIES_ENABLED",
  "EXIT_TYPO_WORDS_ENABLED",
  "WOVEN_TEXT_NUL_STRIP_ENABLED",
  "WOVEN_FAILED_RETRY_ENABLED",
  "ADD_THAT_IS_ACCOUNT_ENABLED",
  "WHAT_HAPPENED_NO_CREATE_ENABLED",
  "CREATE_FROM_CONVERSATION_POINTS_TO_CARD_ENABLED",
  "OBSERVATION_OWN_PERSON_ONLY_ENABLED",
  "POLICY_TOPIC_INTO_FIELD_ENABLED",
  "LETTER_GREETING_NOT_NAME_ENABLED",
  "LATE_READS_ATTENDANCE_ENABLED",
  "LATE_SLOT_READS_ATTENDANCE_ENABLED",
  "EXIT_FORM_DATE_FROM_TERMINATION_ENABLED",
  "EXIT_LETTER_ADDRESSEE_ENABLED",
  "MISSED_SHIFT_CITES_ATTENDANCE_ENABLED",
  "EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED",
  "POSSESSIVE_PLACE_NOT_PERSON_ENABLED",
  "OFF_ROSTER_ASK_BEFORE_CARD_ENABLED",
  // coding 5: CORRECTED_DATE_KEPT (default off): forced off with the others in the child run.
  "CORRECTED_DATE_KEPT_ENABLED",
  "DATE_QUESTION_KEPT_ENABLED",
  // coding 2: CREATE_COMMAND_POINTS_TO_CARD and CARD_COMPLAINT_NOT_ACCOUNT (default off): forced off with the others.
  "CREATE_COMMAND_POINTS_TO_CARD_ENABLED",
  "CARD_COMPLAINT_NOT_ACCOUNT_ENABLED",
  // coding 2: OTHER_POLICY_AGREES and OTHER_NOT_A_POLICY_NAME (QA, 11 Nov 2026; default off): forced off with the others.
  "OTHER_POLICY_AGREES_ENABLED",
  "OTHER_NOT_A_POLICY_NAME_ENABLED",
  "ACCOUNT_TYPOS_FIXED_ENABLED",
  // coding 2: EXCERPT_EMPTY_CARD_DROP (QA, 11 Nov 2026; default off): forced off with the others.
  "EXCERPT_EMPTY_CARD_DROP_ENABLED",
  // coding 6: REQUEST_ISSUE_KEPT (ported from Ask Bubbles, QA round 17b; default off).
  "REQUEST_ISSUE_KEPT_ENABLED",
  // coding 4: STEP_B_SECTION_SPACING (ported from Ask Bubbles; split out of #662, 12 Nov 2026; default off).
  "STEP_B_SECTION_SPACING_ENABLED",
  "DRAFT_NO_INVENTED_PLAN_ENABLED",
  "GROUP_WORDS_NOT_A_NAME_ENABLED",
  // coding 4: FORMS_ON_FILE_ORDER_MATCH_POSSIBLE (ported from Ask Bubbles, 11 Nov 2026; default off).
  "FORMS_ON_FILE_ORDER_MATCH_POSSIBLE_ENABLED",
  // coding 6: POLICY_CARRY_RETRIEVAL (#248 rebuilt on main; QA item 10; default off).
  "POLICY_CARRY_RETRIEVAL_ENABLED",
  // coding 2: OFF_ROSTER_STORE_ANSWER_ONLY (QA's #735 ruling, 12 Nov 2026; default off).
  "OFF_ROSTER_STORE_ANSWER_ONLY_ENABLED",
  // coding 6: SAME_NAME_ASKS_WHICH (QA, 12 Nov 2026; default off; high priority).
  "SAME_NAME_ASKS_WHICH_ENABLED",
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
 * on the PROTECTED list; only the diff check leaves it out.
 *
 * The user (Pau) approved, on 26 Oct 2026, editing src/lib/ai/form-proposal.ts
 * for STORED_SLOTS_NOT_A_REQUEST_ENABLED: in turnsAboutThisForm the new-request
 * check reads the manager's words, not the app's stored-slot lines, with the
 * flag-off reading unchanged. It stays on the PROTECTED list; only the diff
 * check leaves it out. No other protected file is excepted.
 * PRIOR_ACTIONS_PARSE_ENABLED, with the flag-off reading unchanged, and on
 * 26 Oct 2026 again for the incident date behind PRIOR_SENTENCE_FIX_ENABLED
 * (a prior step's date is never the form's Date). It stays
 * on the PROTECTED list; only the diff check leaves it out. No other
 * protected file is excepted.
 *
 * The user (Pau) approved, in the Code session on 26 Oct 2026, editing
 * src/lib/forms/proposal.ts behind ANSWER_NOT_A_NAME_ENABLED: one import and
 * readEmployeeMentions' return filters its candidates through `namesSomebody`,
 * which keeps every one with the flag off. It stays on the PROTECTED list;
 * only the diff check leaves it out.
 *
 * The user (Pau) approved, via QA on 29 Oct 2026 ("yes do that please"),
 * two more lines in src/lib/forms/proposal.ts, both apps: the import
 * `import { isExitTerms, namesSomebody } from "./answer-not-a-name";` and in
 * employeeState `reading.names.filter((name) => !excluded.some((not) =>
 * samePerson(not, name)) && !isExitTerms(name))`. Behind
 * EXIT_TERMS_NOT_NAMES_ENABLED, default off; off, isExitTerms is false and
 * every name is kept.
 *
 * The user (Pau) approved, via QA on 29 Oct 2026 ("ok address line"), the
 * same two lines again in src/lib/forms/proposal.ts, both apps: the import
 * `import { isExitTerms, namesSomebody, notInStreetAddress } from
 * "./answer-not-a-name";` and in employeeState `… && !isExitTerms(name) &&
 * notInStreetAddress(message.content)(name)`. Behind
 * STREET_ADDRESS_NOT_A_NAME_ENABLED, default off; off, notInStreetAddress
 * keeps every name.
 *
 * The user (Pau) approved, in the Code session on 27 Oct 2026 ("yes, name
 * question form-proposal.ts both apps"), two lines in src/lib/ai/form-proposal.ts
 * openingQuestions behind NAME_QUESTION_ONLY_ENABLED: with no employee named,
 * one plain question instead of the list. Off, the list as before.
 *
 * The user (Pau) approved, in the Code session on 27 Oct 2026, editing
 * src/lib/forms/form-date-answer.ts in both apps, only two lines: the import
 * of `withWiderDates` from "./wider-dates", and datesInText's last line
 * `return withWiderDates(text ?? "", today, found);`. Behind
 * WIDER_DATE_READER_ENABLED, default off; off, the dates found are returned
 * as they were.
 *
 * The user (Pau) approved, via QA on 30 Oct 2026 ("Ok amount line"), two
 * lines in src/lib/forms/payroll-deduct.ts, this app only: the import
 * `payrollAmountWording,` from "./payroll-deduct-answer", and in
 * payrollDeductAmount `const amount = latestAmount(payrollAmountWording(text));`.
 * Behind CA_SHORTCUT_WORDS_ENABLED, default off; off, payrollAmountWording
 * returns the text unchanged.
 *
 * The user (Pau) approved in writing, via QA on 31 Oct 2026 ("Approve both"),
 * in src/lib/forms/chat-revision.ts, both apps: the import
 * `import { revisionSameValueEnabled } from "@/lib/config/chat-quality-flags";`
 * and, before `const changed`, a value equal to the field's current text is
 * dropped from `byName.values`. Behind REVISION_SAME_VALUE_ENABLED, default
 * off; off, nothing is dropped.
 *
 * The user (Pau) approved in writing, via QA on 31 Oct 2026 ("Approve both"),
 * in src/lib/forms/proposal.ts, both apps: `thisPersonsTurnsEnabled` added to
 * the chat-quality-flags import, the import `import {
 * turnsFromThisPersonsRequest } from "./this-persons-turns";`, and in
 * buildProposal `sourceMessageIds: thisPersonsTurnsEnabled() ?
 * turnsFromThisPersonsRequest(input.context, employeeName, { names:
 * extractEmployeeNames, same: samePerson }) : input.context.ids`. Behind
 * THIS_PERSONS_TURNS_ENABLED, default off; off, every retained turn as before.
 *
 * The user (Pau) approved in the Code session on 3 Nov 2026 ("Approve chat
 * revisions"), in src/lib/forms/chat-revision.ts, both apps: the import
 * `import { namesOnRoster } from "./roster-name-gate";` and the existing
 * `const named = extractEmployeeNames(...).filter(...)` wrapped as
 * `await namesOnRoster(<the same filtered list>, actor.scope)`. Behind
 * FORM_EDIT_NAME_GATE_ROSTER_ENABLED, default off; off, namesOnRoster returns
 * the list unchanged and reads nothing.
 *
 * The user (Pau) approved on 4 Nov 2026, via QA ("chat-revision.ts hunk 1,
 * version 2: YES, same hunk in both apps"), in src/lib/forms/chat-revision.ts:
 * the import `formEditSingleWriterEnabled` beside `revisionSameValueEnabled`,
 * and the revision's save as `formEditSingleWriterEnabled() ?
 * writeRevisionEdits(…, { actorId, latest: input.question, notes }) :
 * applyAssistantRevision(…)`. Behind FORM_EDIT_SINGLE_WRITER_ENABLED, default
 * off; off, the same applyAssistantRevision call as before.
 *
 * The user (Pau) approved on 4 Nov 2026 ("#424: Option A approved"), in
 * src/lib/forms/instances.ts, `reviseInstance`: the imports
 * `offeredOffenseKeys` (./offense-keys) and `caSalesPolicyEnabled`, and one
 * block after `const byKey`: only when the revision lands on a NEWER version,
 * a Type of Offense tick on a box Corrective Action revision 7 replaced is
 * carried as the box that replaced it, and an old Other write-in ticks Other.
 * Behind CA_SALES_POLICY_ENABLED, default off; off, every row is carried as
 * before. The filed form is never touched. Same hunk in both apps (Ask
 * Bubbles 66813d54); in Ask Sunny the Type of Offense change is revision 8.
 *
 * The user (Pau) approved, under Pau's standing approval via QA, 11 Nov 2026, in
 * src/lib/forms/ca-action-plan.ts, exactly the lines of
 * docs/patches/other-not-a-policy-name.patch: the import
 * `otherNotAPolicyNameEnabled`, and in policyNamesFromViolated the one guarded
 * line `if (otherNotAPolicyNameEnabled() && /^other$/i.test(text)) return "";`
 * (a bare "Other" is never a policy name: no "review the Other policy").
 * Behind OTHER_NOT_A_POLICY_NAME_ENABLED, default off; off, as before.
 *
 * The user (Pau) approved on 11 Nov 2026, via QA (Pau's standing approval for
 * fixes, recorded by QA), in src/lib/forms/proposal.ts, exactly the hunks in
 * docs/patches/form-name-not-a-title.patch: the import
 * `formNameNotATitleEnabled`, `FORM_NAME_AFTER` and `titleSaidLater`, and in
 * extractJobTitle a title word straight before "EPP" is skipped as the form's
 * name unless the title is said again later. Behind
 * FORM_NAME_NOT_A_TITLE_ENABLED, default off; off, every title is read as before.
 * The user (Pau) approved in writing on 10 Nov 2026, via QA ("ok termination
 * closing"), behind TERMINATION_STATED_TICKS_ENABLED (default off), both apps:
 * in src/lib/forms/required-closing.ts, `withRequiredClosing` returns a value
 * that already ends with the termination sentence unchanged (with its
 * `TERMINATION_PLAN_CLOSING` constant and the flag import); in
 * src/lib/forms/ca-action-plan.ts, `ActionPlanInput.termination`, and a
 * Termination plan's closing is the termination sentence (`planClosing`, also
 * in `refreshedActionPlan`). Off, both are exactly as before; instances.ts is
 * not touched.
 *
 * QA approved on 13 Nov 2026 (live bug: evening forms dated the next day; Pau's audit, 27 of 29 evening forms in 30
 * days), in src/lib/forms/instances.ts, the seeded `form_date`/`date` default only: `input.formDate ?? recordToday()`
 * (`lib/business-today.ts`) in place of `new Date().toISOString().slice(0, 10)`, and its import. Behind
 * FORM_DATE_BUSINESS_TODAY_ENABLED, default off; off, recordToday() is that same UTC date.
 */
const APPROVED_PROTECTED_EDITS = [
  ":(exclude)src/lib/forms/required-closing.ts",
  ":(exclude)src/lib/forms/ca-action-plan.ts",
  ":(exclude)src/lib/forms/proposal.ts",
  ":(exclude)src/lib/forms/chat-revision.ts",
  ":(exclude)src/lib/forms/instances.ts",
  ":(exclude)src/lib/forms/payroll-deduct.ts",
  ":(exclude)src/lib/forms/form-date-answer.ts",
  ":(exclude)src/lib/ai/form-proposal.ts",
];

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
  /*
   * Pau approved, via QA on 29 Oct 2026, both apps, no flag: the row menu
   * "…" shows only when it has an item. A role that may track but not manage
   * got an empty menu on a row that is not followed up ("wanted to delete
   * some form but the ... is not showing when clicked").
   */
  "-                            {mayManage || mayTrack ? (",
  "+                            {mayManage || (form.followedUpAt && mayTrack) ? (",
];

/*
 * NEXT_PUBLIC_INVITED_SIGNIN_ACCEPTS_ENABLED (QA approved 28 Oct 2026, both
 * apps; QA reviews the auth diff line by line): sign-in-form.tsx may add
 * exactly the flag import and the gated accept call, plus comment lines.
 * Off, the form behaves as before. Any other change to the file fails.
 */
const SIGN_IN_FORM = "src/features/auth/sign-in-form.tsx";
const SIGN_IN_ACCEPT = [
  '+import { invitedSignInAcceptsEnabled } from "@/lib/auth/invited-signin-flag";',
  "+      if (invitedSignInAcceptsEnabled()) {",
  '+        await fetch("/api/auth/accept-invitation", { method: "POST" }).catch(() => undefined);',
  "+      }",
];
const isAddedCommentOrBlank = (line: string) => /^\+\s*(\/\*.*|\*.*|)$/.test(line);

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
    expect(caAsksWhatHappenedEnabled()).toBe(false);
    expect(omissionIsAccountEnabled()).toBe(false);
    expect(observationWithoutAskEnabled()).toBe(false);
    expect(stepDateNotIncidentEnabled()).toBe(false);
    expect(warningLevelAndClauseEnabled()).toBe(false);
    expect(jobTitleAppositionEnabled()).toBe(false);
    expect(followUpReadbackCueEnabled()).toBe(false);
    expect(exitReadbackJobTitleEnabled()).toBe(false);
    expect(followUpCitationFieldEnabled()).toBe(false);
    expect(grammarAskNotAccountEnabled()).toBe(false);
    expect(jobTitleCaseEnabled()).toBe(false);
    expect(levelStepNotAccountEnabled()).toBe(false);
    expect(jobTitleReadbackCaseEnabled()).toBe(false);
    expect(stepDateNoQuestionEnabled()).toBe(false);
    expect(firstNameAskEnabled()).toBe(false);
    expect(typoReadingRoutesEnabled()).toBe(false);
    expect(typoReadingCopyEnabled()).toBe(false);
    expect(dayWordTyposEnabled()).toBe(false);
    expect(amountUnknownAckEnabled()).toBe(false);
    expect(outOfScopePlaceSaidEnabled()).toBe(false);
    expect(outOfScopePlaceKeepsOwnEnabled()).toBe(false);
    expect(formTypeSwitchEnabled()).toBe(false);
    expect(formTypeSwitchAfterCreateNoteEnabled()).toBe(false);
    expect(cardChangePlanRebuildEnabled()).toBe(false);
    expect(spendGuardAllCallsEnabled()).toBe(false);
    expect(firstNameSuggestEnabled()).toBe(false);
    expect(otherWriteInGuardEnabled()).toBe(false);
    expect(unreadDayNotIncidentDateEnabled()).toBe(false);
    expect(unreadDatePlainAskEnabled()).toBe(false);
    expect(partialNameCardCurrentEnabled()).toBe(false);
    expect(partialSurnameAskEnabled()).toBe(false);
    expect(suggestAnswerReplacesTypedEnabled()).toBe(false);
    expect(preferredNameCardCurrentEnabled()).toBe(false);
    expect(switchKeepsNamedFormEnabled()).toBe(false);
    expect(severalFormsStayCurrentEnabled()).toBe(false);
    expect(partialNameLooseMatchEnabled()).toBe(false);
    expect(staleNeedsRosterPersonEnabled()).toBe(false);
    expect(correctedEmployeeSlotEnabled()).toBe(false);
    expect(exitTermsNotNamesEnabled()).toBe(false);
    // On by default since 3 Nov 2026 ("(E) batch 1", config/default-on.ts): unset is on; "off" still turns it off (checked below).
    expect(exitShortcutWordsEnabled()).toBe(true);
    expect(caShortcutWordsEnabled()).toBe(false);
    // On by default since 3 Nov 2026 ("(E) batch 1", config/default-on.ts): unset is on; "off" still turns it off (checked below).
    expect(streetAddressNotANameEnabled()).toBe(true);
    expect(accountOnlyPolicyQueryEnabled()).toBe(false);
    expect(relativeDateReaderEnabled()).toBe(false);
    expect(unreadDateAskEnabled()).toBe(false);
    expect(amountAnswerSavedEnabled()).toBe(false);
    expect(amountAnswerNotAccountEnabled()).toBe(false);
    expect(modelCallDailyCapEnabled()).toBe(false);
    expect(monthlyBudgetGuardEnabled()).toBe(false);
    expect(ordinalDateInDraftEnabled()).toBe(false);
    expect(widerDateReaderEnabled()).toBe(false);
    expect(aiReadsCodeChecksEnabled()).toBe(false);
    expect(privateCreatorFormsEnabled()).toBe(false);
    expect(privateCreatorsActive()).toBe(false);
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
    expect(formDateIncidentOnlyEnabled()).toBe(false);
    expect(reopenVerbGuardEnabled()).toBe(false);
    expect(reopenByAnyOpenVerbEnabled()).toBe(false);
    expect(formRevisionsEnabled()).toBe(false);
    expect(formRevisionsUiEnabled()).toBe(false);
    expect(sensitiveDefaultsRedactEnabled()).toBe(false);
    expect(appPasswordHelpEnabled()).toBe(false);
    expect(policyCleaningIncidentEnabled()).toBe(false);
    expect(policySpecificTopicsEnabled()).toBe(false);
    expect(nameBeforeTitleEnabled()).toBe(false);
    expect(latePayrollFromFormEnabled()).toBe(false);
    expect(followUpNotPriorEnabled()).toBe(false);
    expect(stateCodeNotAPersonEnabled()).toBe(false);
    expect(googleReviewsInChatEnabled()).toBe(false);
    expect(draftNeverBlankEnabled()).toBe(false);
    expect(storedSlotsNotARequestEnabled()).toBe(false);
    expect(priorSentenceFixEnabled()).toBe(false);
    expect(attendanceActionPlanEnabled()).toBe(false);
    expect(hideNoPolicyMatchNoticeEnabled()).toBe(false);
    expect(payrollTypoNotANameEnabled()).toBe(false);
    expect(answerNotANameEnabled()).toBe(false);
    expect(dateAnswerAppliedEnabled()).toBe(false);
    expect(dateAnswerKeepsOpenEnabled()).toBe(false);
    expect(requestLineAccountEnabled()).toBe(false);
    expect(notDeductibleReadEnabled()).toBe(false);
    expect(priorStepSentenceEnabled()).toBe(false);
    expect(exitFulfilledIsLastDayEnabled()).toBe(false);
    expect(futurePriorRowDropEnabled()).toBe(false);
    expect(nameQuestionOnlyEnabled()).toBe(false);
    expect(animalAnywhereEnabled()).toBe(false);
    expect(meetingNotLatenessPlanEnabled()).toBe(false);
    expect(planPayrollSentenceEnabled()).toBe(false);
    expect(jobTitleNotIncidentEnabled()).toBe(false);
    expect(priorRowNotOnIncidentDateEnabled()).toBe(false);
    expect(jobTitleFromWordsEnabled()).toBe(false);
    expect(cardChangeEnabled()).toBe(false);
    expect(cardChangeFinalizedEnabled()).toBe(false);
    expect(formPatchReducerEnabled()).toBe(false);
    expect(formReplyFromDiffEnabled()).toBe(false);
    expect(draftNoInventedPlanEnabled()).toBe(false);

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

    // The flags on by default still turn off when the variable says so (the emergency off switch).
    for (const name of DEFAULT_ON) {
      process.env[name] = "off";
      expect(envFlag(name), name).toBe(false);
      delete process.env[name];
    }

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
      // And except the four Form Monitoring links (Overview card and page,
      // chat card button, search and its hook): QA approved on 26 Oct 2026, behind
      // NEXT_PUBLIC_ASD_NO_FORM_MONITORING_ENABLED, hiding them from a reader
      // without Form Monitoring. Each gate reads the flag first; off, it
      // renders as before for every role.
      // And the follow-up reads in layout.tsx, forms/monitoring/page.tsx and
      // (app)/page.tsx: QA approved on 26 Oct 2026, behind
      // PRIVATE_CREATOR_FORMS_ENABLED, over-reading and trimming to the page
      // so private rows dropped after the query cannot leave it short. Off,
      // each read asks for its page exactly as before.
      // And card-change-panel.tsx: QA-approved 2026-10-27 (owner asked for the
      // Change something button), behind NEXT_PUBLIC_CARD_CHANGE_ENABLED; off,
      // it renders nothing and the bubble's one mount line adds nothing.
      // And finalized-change-panel.tsx: QA-approved 2026-10-28 (Pau: structured
      // changes on a finalized form), behind NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED;
      // off, it renders nothing and the card's one mount line adds nothing.
      expect(
        diff(uiBase, [
          ...UI_PATHS,
          ":(exclude)**/*.test.tsx",
          ":(exclude)**/*.dom.test.tsx",
          ":(exclude)src/features/chat/message-bubble.tsx",
          ":(exclude)src/features/chat/card-change-panel.tsx",
          ":(exclude)src/features/chat/finalized-change-panel.tsx",
          ":(exclude)src/features/chat/chat-screen.tsx",
          ":(exclude)src/features/chat/composer.tsx",
          ":(exclude)src/features/chat/inline-form.tsx",
          ":(exclude)src/features/dashboard/overview.tsx",
          ":(exclude)src/components/shell/global-search.tsx",
          ":(exclude)src/components/shell/hides-form-monitoring.ts",
          ":(exclude)src/app/(app)/page.tsx",
          ":(exclude)src/app/(app)/layout.tsx",
          ":(exclude)src/app/(app)/forms/monitoring/page.tsx",
          `:(exclude)${MONITORING_TABLE}`,
          // INVITE_LINK_HOLD_ENABLED (QA approved 28 Oct 2026, both apps): the new
          // invitation Continue page and its form. Off, the page never shows Continue.
          ":(exclude)src/app/auth/invite-continue/page.tsx",
          ":(exclude)src/features/auth/invite-continue-form.tsx",
          // Import's "belongs to another account" line (QA, 31 Oct 2026, both apps): shown only
          // when the server declines a chat as another account's, i.e. only with
          // CHAT_IMPORT_OWN_ONLY_ENABLED on. Off, the server never declines that way, so it never shows.
          // Its "couldn't confirm … is yours" line (QA, 12 Nov 2026, both apps) likewise shows only for a "not_proven"
          // decline, which only CHAT_IMPORT_PROVEN_OWN_ENABLED returns.
          ":(exclude)src/features/chat/import-local-history.tsx",
          // App switcher's Leadership Hub tab (requested by Paulyne through the QA session,
          // 1 Nov 2026 — QA to confirm): shell plumbing for a server yes/no. With
          // LEADERSHIP_HUB_TAB_EMAILS unset the tab never renders, so the shell is as before.
          ":(exclude)src/components/shell/app-shell.tsx",
          ":(exclude)src/components/shell/sidebar.tsx",
          ":(exclude)src/components/shell/app-switcher.tsx",
          `:(exclude)${SIGN_IN_FORM}`,
          // THE CLAY RESTYLE (requested by Paulyne, 9 Nov 2026, from the approved
          // "Ask Sunny Clay Web" mockup; QA to confirm before merge). Unlike the
          // entries above it is NOT behind a flag: it is a deliberate visual change
          // to styles and markup only — clay shadows, radii, the Sunny mascot, the
          // floating rail and top bar, the cloud background and the login
          // gradient. No data, permission or chat behaviour changes. The shell,
          // chat and Overview files it touches are already listed above.
          ":(exclude)src/app/globals.css",
          ":(exclude)src/features/auth/login-screen.module.css",
          ":(exclude)src/features/auth/login-screen.tsx",
          ":(exclude)src/components/sunny-mascot.tsx",
          ":(exclude)src/components/shell/jump-to-row.tsx",
          ":(exclude)src/components/source-card.tsx",
          ":(exclude)src/components/stat-card.tsx",
          ":(exclude)src/components/video-card.tsx",
          ":(exclude)src/components/ui/badge.tsx",
          ":(exclude)src/components/ui/button.tsx",
          ":(exclude)src/components/ui/card.tsx",
          ":(exclude)src/components/ui/controls.tsx",
          ":(exclude)src/components/ui/feedback.tsx",
          ":(exclude)src/components/ui/field.tsx",
          ":(exclude)src/components/ui/layout.tsx",
          ":(exclude)src/components/ui/marquee.tsx",
          ":(exclude)src/features/dashboard/ask-band.tsx",
          ":(exclude)src/features/reports/report-frame.tsx",
          ":(exclude)src/features/videos/category-overview.tsx",
          ":(exclude)src/features/videos/videos-screen.tsx",
          ":(exclude)src/features/reports/report-tabs.tsx",
          ":(exclude)src/features/reviews/reviews-tabs.tsx",
          ":(exclude)src/features/reviews/review-goal-parts.tsx",
          ":(exclude)src/features/reports/salon-performance/kpi-cards.tsx",
          ":(exclude)src/features/reports/salon-performance/salon-kpi-cards.tsx",
          ":(exclude)src/features/reports/detail-section.tsx",
          ":(exclude)src/features/dashboard/performance-overview.tsx",
          // Confetti on a 5-star rating (requested by Paulyne, 9 Nov 2026): the
          // one mount line after a rating saves; `lib/ui/confetti.ts` does the rest.
          ":(exclude)src/features/chat/conversation-rating.tsx",
          // DM L10 tab (requested by Paulyne via QA, 13 Nov 2026; approved by QA): new pages and
          // components only, shown only when HUB_PARTNER_SECRET is set and the Leadership Hub says
          // the person holds the meeting's role. No existing page, chat or form behaviour changes.
          ":(exclude)src/app/(app)/meetings",
          ":(exclude)src/features/l10",
        ]),
      ).toBe("");
      expect(changedLines(diff(uiBase, [MONITORING_TABLE])).filter((line) => !MONITORING_MOUNT.includes(line))).toEqual([]);
      expect(
        changedLines(diff(uiBase, [SIGN_IN_FORM])).filter((line) => !SIGN_IN_ACCEPT.includes(line) && !isAddedCommentOrBlank(line)),
      ).toEqual([]);
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

/*
 * The child run is split (QA, 3 Nov 2026, then 7 Nov 2026). As one run over all
 * four folders it took about 526 s of its 540 s on CI and timed out (ETIMEDOUT)
 * whenever the runner was busy, so it was split in two. By 7 Nov the chat+forms
 * half alone took 530 s on main on a 4-CPU runner (564–607 s on branches that add
 * replay cases) and timed out again. Measured there (4-CPU), its parts were:
 * src/app/api/chat without the replay pack 386 s, src/app/api/forms 80 s, the
 * replay pack 144 s (src/lib 185 s). So it is five children now — src/lib; the
 * chat folder without the pack, in two halves by name; src/app/api/forms; the
 * replay pack — each well under the budget, and the chat folder can keep growing.
 * The folders, the flags and what must pass are unchanged, and every test file
 * still runs in exactly one child.
 *
 * Vitest's `--exclude` does not reach inside a project (the "unit" project's own
 * `exclude` wins), and a path filter matches any file whose path contains it. So
 * the chat folder without the pack is named entry by entry — each test file, and
 * each folder with its trailing "/" — read from the folder itself.
 */
const CHAT = "src/app/api/chat";
const REPLAY_PACK = `${CHAT}/replay-pack`;
function chatWithoutReplayPack(): string[] {
  return readdirSync(CHAT, { withFileTypes: true })
    .filter((entry) => `${CHAT}/${entry.name}` !== REPLAY_PACK)
    .filter((entry) => entry.isDirectory() || /\.test\.tsx?$/.test(entry.name))
    .map((entry) => `${CHAT}/${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort();
}
/** The chat folder without the pack, in two halves by name (`half` 0 or 1): each half is its own child. */
function chatHalf(half: 0 | 1): string[] {
  const all = chatWithoutReplayPack();
  const middle = Math.ceil(all.length / 2);
  return half === 0 ? all.slice(0, middle) : all.slice(middle);
}
/*
 * THE REPLAY PACK IN QUARTERS (QA, 9 Nov 2026 in halves; thirds 12 Nov; quarters 13 Nov 2026): its child timed out at
 * 540 s on CI (ask-sunny#713, #717; main 7e8dcdb6 with halves; ask-sunny#839 with thirds, its first third at 540 s;
 * ETIMEDOUT, no assertion failed) as the pack grew. Nearly all of its time is one file, `replay-pack-e2e.test.ts`, so
 * it is split by case, not by file: four children run that file with one quarter of the cases each (`REPLAY_PACK_PART`
 * "i/4", interleaved by id so the heavy cases spread out), and one child runs the pack's other test files (a few
 * seconds). Every case and every file still runs exactly once, with every new flag off. No timeout is raised.
 */
const REPLAY_PACK_E2E = `${REPLAY_PACK}/replay-pack-e2e.test.ts`;
/** The pack's own test files besides the e2e (registry, policy-line, step-b-live-check, …): one child, a few seconds. */
function replayPackOtherFiles(): string[] {
  return readdirSync(REPLAY_PACK)
    .filter((name) => /\.test\.tsx?$/.test(name) && `${REPLAY_PACK}/${name}` !== REPLAY_PACK_E2E)
    .map((name) => `${REPLAY_PACK}/${name}`)
    .sort();
}
const CHILDREN: readonly { readonly name: string; readonly paths: () => readonly string[]; readonly env?: Readonly<Record<string, string>> }[] = [
  { name: "src/lib/ai, src/lib/forms", paths: () => ["src/lib/ai", "src/lib/forms"] },
  { name: `${CHAT} (without the replay pack), first half by name`, paths: () => chatHalf(0) },
  { name: `${CHAT} (without the replay pack), second half by name`, paths: () => chatHalf(1) },
  { name: "src/app/api/forms", paths: () => ["src/app/api/forms"] },
  { name: `${REPLAY_PACK}, its test files other than the e2e`, paths: () => replayPackOtherFiles() },
  { name: `${REPLAY_PACK}, the cases in quarter 1 of 4`, paths: () => [REPLAY_PACK_E2E], env: { REPLAY_PACK_PART: "0/4" } },
  { name: `${REPLAY_PACK}, the cases in quarter 2 of 4`, paths: () => [REPLAY_PACK_E2E], env: { REPLAY_PACK_PART: "1/4" } },
  { name: `${REPLAY_PACK}, the cases in quarter 3 of 4`, paths: () => [REPLAY_PACK_E2E], env: { REPLAY_PACK_PART: "2/4" } },
  { name: `${REPLAY_PACK}, the cases in quarter 4 of 4`, paths: () => [REPLAY_PACK_E2E], env: { REPLAY_PACK_PART: "3/4" } },
];

/*
 * THE CHILDREN AS PARALLEL CI JOBS (QA, 13 Nov 2026): the children run one after another (each a blocking execFileSync),
 * so splitting the pack only keeps each child under 540 s; the job's total stays the sum, and the 30-minute job was
 * cancelled at 30:11 (ask-sunny#930, no failing test). PARITY_ONLY (CI only) runs ONE child — its index in CHILDREN — so
 * `.github/workflows/ci.yml` runs every child in its own matrix job, side by side; "guards" runs this file's other tests
 * and no child. Unset (npm test, local), everything runs here, as before. The matrix lists every child: checked below.
 */
const PARITY_ONLY = process.env.PARITY_ONLY;
const childSkipped = (index: number) => PARITY_ONLY !== undefined && PARITY_ONLY !== String(index);

describe("the CI matrix runs every parity child", () => {
  it("ci.yml's flags-off-parity matrix lists guards and each CHILDREN index, once", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const listed = /parity-child:\s*\[([^\]]*)\]/.exec(workflow)?.[1]?.split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")) ?? [];
    expect(listed).toEqual(["guards", ...CHILDREN.map((_child, index) => String(index))]);
  });
});

describe("existing chat and form suites with every new flag off", () => {
  for (const [index, child] of CHILDREN.entries()) {
    it.skipIf(CHILD || childSkipped(index))(
      `passes the suites whose expectations are already on main: ${child.name}`,
      () => {
        const env: NodeJS.ProcessEnv = { ...process.env, FLAGS_OFF_PARITY_CHILD: "1", ...child.env };
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
            ...child.paths(),
          ],
          // The child's output (every suite's logs) passed Node's 1 MB default
          // buffer on CI and failed with ENOBUFS before any test failed.
          { env, encoding: "utf8", timeout: 540_000, stdio: "pipe", maxBuffer: 256 * 1024 * 1024 },
        );
        expect(output).toMatch(/Test Files[\s\S]*passed/);
      },
      560_000,
    );
  }
});
