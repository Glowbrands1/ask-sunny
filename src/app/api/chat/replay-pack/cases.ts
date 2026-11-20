import { expect } from "vitest";

/**
 * ============================================================================
 * THE REPLAY PACK'S CASES — ONE PER REPORTED CHAT
 * ============================================================================
 *
 * Each case is a production chat a manager, HR or QA reported: their exact
 * words, every person invented (the repository is public), and the shared
 * login, store and roles as they were. `run` drives the chat through the real
 * route (see `replay-pack-e2e.test.ts`) and asserts what must hold — an
 * invariant, never a model's wording.
 *
 * `status`: "fixed" holds with production's flags today; `{ open: … }` is still
 * broken in production and says what would fix it. `fixFlags`: with these on
 * (and production's), the case must hold — the fix covers the path production
 * takes. Add a case for every new report, before the fix.
 */

export interface ReplayAnswer {
  content: string;
  formProposal?: { templateKey?: string; employeeName?: string | null; employeeRole?: string | null; status?: string; subject?: string; locationId?: string | null; wovenCloseMatch?: string | null; formDate?: string | null; warningLevel?: string | null; issue?: string | null; supportsInlineDraft?: boolean };
  formUpdate?: { instanceId: string; updated: string[] };
  formOpened?: { instanceId: string; revisesInstanceId?: string | null };
  /** The source cards the reply carries. */
  citations?: { documentTitle?: string }[];
}

export interface ReplayThread {
  /** `reading`: what the stand-in form-reading model returns this turn (e.g. `{ employeeName }`); none by default. */
  /** `extra`: other request fields the browser can send (batch F5: attachments, report context, answer mode). */
  say(text: string, reading?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<ReplayAnswer>;
  create(): Promise<string>;
  /** Create from the latest card for this person (an earlier card still on screen). */
  createCard?(employeeName: string): Promise<string>;
  /** The chat as the browser holds it. */
  readonly conversation?: readonly import("@/types").ChatMessage[];
  /** The card on screen also reads this line — what the live model put on it that the stand-in cannot. */
  cardReads(line: string): void;
  readonly proposal: ReplayAnswer["formProposal"] | null;
  readonly instanceId: string | null;
  /** PR 6 item 5: from now on the thread asks for progress lines (the browser's `x-chat-progress: 1`), as the chat screen does. */
  askProgress?(): void;
  /** PR 6 item 5: the statuses the last turn streamed, in order, and its stream version (`x-chat-stream`: "1", "2" or null when not streamed). */
  readonly lastProgress?: readonly string[];
  readonly lastStreamVersion?: string | null;
}

export interface ReplayContext {
  thread(): ReplayThread;
  /** `subject`: who is signed in (default "qa-manager"), for a case with two managers. */
  as(role: string, scope: unknown, subject?: string): void;
  directory(rows: readonly DirectoryRow[]): void;
  /** What the drafting model writes at Create. */
  /** `extra`: other fields of the draft tool's input, e.g. `{ offense_basis: "sales" }` (CA_SALES_POLICY_ENABLED). */
  draftWrites(values: Record<string, string>, checked?: Record<string, string[]>, extra?: Record<string, unknown>): void;
  /** The pinned policy manual also has these chunks this case (as `fetchOfficialPolicyManual` returns them); none by default. */
  manualAlsoHas?(chunks: readonly Record<string, unknown>[]): void;
  /**
   * FULL_MANUAL_KEEPS_RETRIEVAL (QA, 10 Nov 2026): what the knowledge search returns this case (none by default), the
   * message normalizer's intent label (none by default: the glossary's reading), and whether the whole JBA Policy Manual
   * loads for a policy question (not by default: the loader finds no manual offline).
   */
  knowledgeHas?(rows: readonly Record<string, unknown>[]): void;
  /** Every knowledge search's query this case, in order (POLICY_CARRY_RETRIEVAL, 12 Nov 2026). */
  searches?(): string[];
  normalizerReads?(intent: "policy_question" | "form_command" | "other"): void;
  fullManualLoads?(): void;
  /** PR 6 item 2: how many times the official policy manual was read this case (the agent loop reads it once per turn). */
  manualReads?(): number;
  /** PR 6: how many times the agent loop checked which document is the manual and its version (once per turn). */
  manualVersionChecks?(): number;
  /** The grounding block the answering model was given on its last answer. */
  lastGrounding?(): string;
  /** The REPORT DATA block the answering model was last given (empty when none): Google reviews in chat, 18 Nov 2026. */
  lastReportData?(): string;
  /** The answering model's last system prompt (its report-figure rule): Google reviews in chat, 18 Nov 2026. */
  lastSystem?(): string;
  /**
   * The Google Reviews page holds the harness's fixed figures for this case (every listing: 2 reviews this reporting
   * week, both qualifying; 4 last week, 3 qualifying; week of Sun 15 Nov 2026). Without it the page's reads go to the
   * fake database, which holds no review.
   */
  reviewsOnFile?(): void;
  /** The FORMS ON FILE block the answering model was last given (empty when none): FORMS_ON_FILE_DATE_RANGE, 18 Nov 2026. */
  lastFormRecords?(): string;
  /** What the revision model writes on the next revision. */
  revisionWrites(values: Record<string, string>): void;
  /** What the answering model says on its next turns (null: the default answer). */
  modelSays(text: string | null): void;
  /**
   * FORM_EDIT_TOOL_IN_STREAM_ENABLED: on its next turn that is offered
   * `edit_form`, the answering model calls it with this input (null: it does
   * not). Its text that turn is `modelSays`'s.
   */
  modelCallsEditTool?(input: unknown | null): void;
  /** FORM_EDIT_TOOL_IN_STREAM_ENABLED: how many answering calls were offered `edit_form`, and its DATA block on the last. */
  editToolOffers?(): { offered: number; lastData: string | null };
  /**
   * What the slot model reads on the next turns (record_intent_slots), and the employee the AI reader quotes
   * (checked against the roster, as in production), as a production trace shows them. `onlyIfSaid`: the slot
   * model reads the scripted employee only on a call whose messages contain that name, as the live model would.
   */
  slotsRead(slots: Record<string, unknown>, readerEmployee?: string | null, options?: { onlyIfSaid?: boolean }): void;
  /** Step B's form-patch model: its raw outputs, one per call in order (null: the call falls back). Unscripted calls fall back. */
  patchWrites(outputs: readonly unknown[]): void;
  /** Step B's form-patch model, by the manager's latest message (exact text): its raw output for that turn; a message not listed falls back. */
  patchReads?(byLatest: Readonly<Record<string, unknown>>): void;
  /**
   * EDIT_SEES_SAVED_FORM_ENABLED: the patch model's outputs on the check rounds (after a write, with the saved form), in
   * order. Past the end it confirms (no set, no clear); `null` is a fallback. Every scripted round is in the case file.
   */
  patchChecks?(outputs: readonly unknown[]): void;
  /** QA's audit (item 14b, 20 Nov 2026): every form-patch call this case takes this long first (real time), as a slow reviser does. */
  patchTakes?(ms: number): void;
  /** EDIT_SEES_SAVED_FORM_ENABLED: how many check rounds the patch model was asked this case. */
  patchCheckCalls?(): number;
  /** CARD_CHECKED_AGAINST_WORDS_ENABLED: the card check's model outputs, in order; past the end it falls back. */
  cardChecks?(outputs: readonly unknown[]): void;
  /** CARD_CHECKED_AGAINST_WORDS_ENABLED: how many card-check model calls this case made. */
  cardCheckCalls?(): number;
  /** Fault injection (QA, 9 Nov 2026): from now on, a save of the form's values that includes this field fails (the save throws). */
  failSavesOf?(field: string): void;
  /** Fault injection (PR 4, the owner's additions): from now on, deleting a row of this table fails (the delete returns an error). */
  failDeletesOf?(table: string): void;
  /** The long-context summary model's answer (QA, 10 Nov 2026); unscripted, the summary call fails and nothing is saved. */
  summaryWrites?(summary: string): void;
  /** The rows a table holds now (`user_memory`, `chat_context_summaries`, …). */
  rows?(table: string): Record<string, unknown>[];
  /** Fault injection (DRAFT_WRITE_NEVER_SILENT_ENABLED): the draft route's next one-writer write also carries this field, once; the real writer refuses it and, all or nothing, the whole write. */
  draftWriteCarries?(field: string): void;
  calls(): { chat: number; draft: number; revision: number; tool: number; patch: number };
  forms(): Record<string, unknown>[];
  values(instanceId: string): Record<string, string>;
  /** The ticked options of each checkbox group (form_instance_values.checked); groups with none are left out. */
  checked(instanceId: string): Record<string, string[]>;
  /** What the drafting model was given, one entry per draft written. */
  draftPrompts(): string[];
  /** What the revision model was given (its messages, as JSON), one entry per revision call. */
  revisionPrompts?(): string[];
  /** The drafting model's system prompt, one entry per draft written. */
  draftSystems?(): string[];
  /** The answering model's system prompt, one entry per answering call this case. */
  answerSystems?(): string[];
  /** The draft call's tools as sent, one JSON string per call. */
  draftTools(): string[];
  /** The draft route's POST for this form, as a redraft sends it (`keepManagerValues`); the route's response. */
  redraft(instanceId: string, notes: string): Promise<Record<string, unknown>>;
  /** The manager types on the form and saves (filled by the manager). */
  typeOnForm(instanceId: string, values: Record<string, string>): void;
  /** Production's race: the next message arrives before the drafting model's values are saved. */
  draftNotYetSaved(instanceId: string): void;
  /** The draft route's replies this case, in order (e.g. its `notice`). */
  draftReplies?(): Record<string, unknown>[];
  /** AGENT_LOOP_ENABLED: whether this run has the tool loop on (a case's `fixFlags` run, or production once QA turns it on). */
  loopOn?(): boolean;
  /** AGENT_LOOP_ENABLED: the loop really answers this case's turns (the flag on, a stand-in model, the manager listed). */
  loopActive?(): boolean;
  /** AGENT_LOOP_ENABLED: the loop's stand-in model for this case (`loop-stand-in.ts`); lists the signed-in manager in AGENT_LOOP_USERS. */
  loopModel?(standIn: import("./loop-stand-in").LoopStandIn): void;
  /** AGENT_LOOP_ENABLED: find_staff's roster read fails from now on. */
  rosterFails?(): void;
  /**
   * AGENT_LOOP_ENABLED: watch the chat route's entry into the tool loop (its `runAgentTurn`). `entered()` counts the
   * entries since the watch began; `stop()` ends it. The harness holds the module reference, so a case file never names it
   * (the form-patch guard allows only the route to import the loop in production sources).
   */
  watchLoopEntries?(): { entered(): number; stop(): void };
}

export interface DirectoryRow {
  id: string;
  firstName: string;
  lastName: string;
  preferredFirstName: string | null;
  employmentStatus: string;
  salonIds: string[];
  positionName: string | null;
}

export interface ReplayCase {
  id: string;
  title: string;
  /** Where it was reported, and the reporter's words. */
  report: string;
  status: "fixed" | { open: string };
  fixFlags?: string[];
  /**
   * A fix-flag run that fails today: it runs as an expected failure (like `status.open`), so it
   * flips to a reported pass the day it is fixed. Used for production defects found with
   * production's real flags (QA's Vercel read, 5 Nov 2026).
   */
  fixStatus?: { open: string };
  run(context: ReplayContext): Promise<void>;
}

/* ------------------------------------------------------------ invariants -- */

/** A claim that the form changed, said with no change made. */
const CLAIM = /\b(?:updated|now reads|now says|applied|is on the card|that'?s on the card|reflected on|confirmed against|matching woven)\b/i;

export function noClaimWithoutUpdate(reply: ReplayAnswer): void {
  if (reply.formUpdate || reply.formOpened) return;
  expect(reply.content.split("\n").filter((line) => CLAIM.test(line) && /\b(?:form|draft|card|name|details|records?|woven)\b/i.test(line))).toEqual([]);
}

/** Step B: a reply that says the form changed — a `formUpdate`, or words saying so about the form. */
const CHANGE_CLAIM = /\b(?:updated|added|now reads|now says|applied|is on the card|that'?s on the card|reflected on)\b/i;
export function claimsFormChange(reply: ReplayAnswer): boolean {
  if (reply.formUpdate?.updated.length) return true;
  return reply.content.split("\n").some((line) => CHANGE_CLAIM.test(line) && /\b(?:form|draft|card|details|observation)\b/i.test(line));
}

/** What is saved on a form: its text values and its ticked options. */
export function savedForm(t: Pick<ReplayContext, "values" | "checked">, instanceId: string): string {
  return JSON.stringify({ values: t.values(instanceId), checked: t.checked(instanceId) });
}

/**
 * Step B (FORM_REPLY_FROM_DIFF_ENABLED): a reply with a `formUpdate`, or words
 * claiming a change, needs a real change in the saved values. `before` is
 * `savedForm` taken before the turn.
 */
export function replyMatchesDiff(t: Pick<ReplayContext, "values" | "checked">, instanceId: string, before: string, reply: ReplayAnswer, said: string): void {
  if (!claimsFormChange(reply)) return;
  expect(savedForm(t, instanceId), `"${said}": the reply says the form changed, and the saved form did not`).not.toBe(before);
}

/** The same reply, word for word, twice in a row. */
export function noRepeatedReply(replies: readonly ReplayAnswer[]): void {
  for (let index = 1; index < replies.length; index += 1) {
    expect(replies[index]!.content, `reply ${index + 1} repeats reply ${index}`).not.toBe(replies[index - 1]!.content);
  }
}

/* ---------------------------------------------------------------- people -- */

export const KEARNEY = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
export const TWO_SALONS = { level: "salon", primaryAreaId: "loc-0307", alsoCoversAreaIds: ["loc-0309"] };

export const STAFF: DirectoryRow[] = [
  { id: "e-1", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "e-2", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "e-3", firstName: "Juno", lastName: "Paxton", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Assistant Salon Director" },
  { id: "e-4", firstName: "Rowan", lastName: "Kestrel", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
  { id: "e-5", firstName: "Kearney", lastName: "Account", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];
