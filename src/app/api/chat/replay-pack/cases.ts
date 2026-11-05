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
  formProposal?: { templateKey?: string; employeeName?: string | null; employeeRole?: string | null; status?: string; subject?: string; locationId?: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
  formOpened?: { instanceId: string };
  /** A form picker's cards, shown under the reply (`formOpportunityLead` introduces them). */
  formSelection?: unknown;
}

export interface ReplayThread {
  /** `reading`: what the stand-in form-reading model returns this turn (e.g. `{ employeeName }`); none by default. */
  say(text: string, reading?: Record<string, unknown>): Promise<ReplayAnswer>;
  create(): Promise<string>;
  /** The card on screen also reads this line — what the live model put on it that the stand-in cannot. */
  cardReads(line: string): void;
  readonly proposal: ReplayAnswer["formProposal"] | null;
  readonly instanceId: string | null;
}

export interface ReplayContext {
  thread(): ReplayThread;
  as(role: string, scope: unknown): void;
  directory(rows: readonly DirectoryRow[]): void;
  /** What the drafting model writes at Create. */
  draftWrites(values: Record<string, string>, checked?: Record<string, string[]>): void;
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
   * (checked against the roster, as in production), as a production trace shows them.
   */
  slotsRead(slots: Record<string, unknown>, readerEmployee?: string | null): void;
  /** Step B's form-patch model: its raw outputs, one per call in order (null: the call falls back). Unscripted calls fall back. */
  patchWrites(outputs: readonly unknown[]): void;
  calls(): { chat: number; draft: number; revision: number; tool: number; patch: number };
  forms(): Record<string, unknown>[];
  values(instanceId: string): Record<string, string>;
  /** The ticked options of each checkbox group (form_instance_values.checked); groups with none are left out. */
  checked(instanceId: string): Record<string, string[]>;
  /** What the drafting model was given, one entry per draft written. */
  draftPrompts(): string[];
  /** The draft route's POST for this form, as a redraft sends it (`keepManagerValues`); the route's response. */
  redraft(instanceId: string, notes: string): Promise<Record<string, unknown>>;
  /** The manager types on the form and saves (filled by the manager). */
  typeOnForm(instanceId: string, values: Record<string, string>): void;
  /** Production's race: the next message arrives before the drafting model's values are saved. */
  draftNotYetSaved(instanceId: string): void;
  /**
   * A form filed on an EARLIER published version of its template (the CA
   * revision, #424 / #512): the form is moved onto a new version row holding
   * `document` as `version`, as if it had been created before the template
   * changed. `checked`: ticks the form was filed with on that version (its
   * own option keys). Nothing else about the form changes.
   */
  pinVersion?(instanceId: string, document: unknown, version: number, checked?: Record<string, string[]>): void;
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

/**
 * A reply ends as a sentence (sf-b6, 4 Nov 2026): it never ends on a heading
 * that introduces something — a line ending in ":" — unless the cards it
 * introduces come with it, and it never introduces a form picker while a form
 * is already in progress in this chat.
 */
export function endsAsSentence(reply: ReplayAnswer, said: string, formInProgress = false): void {
  const last = reply.content.trimEnd().split("\n").pop() ?? "";
  const dangling = /:\s*$/.test(last) && !reply.formSelection && !reply.formProposal;
  expect(dangling ? last : null, `"${said}": the reply ends on a heading with nothing under it`).toBeNull();
  if (formInProgress) {
    expect(reply.formSelection ?? null, `"${said}": a form picker while a form is already in progress`).toBeNull();
    expect(/:\s*$/.test(last) ? last : null, `"${said}": a heading ending the reply while a form is in progress`).toBeNull();
  }
}

/**
 * "as you said" (sf-s21, sf-s24, sf-s25): a value the reply attributes to the
 * manager is one the manager wrote. Structural, no list of phrases: the value
 * before ", as you said" on a labelled line must share a word of four or more
 * letters with the manager's own turns — the app's own rule for the card
 * (`saidInWords`), so "Verbal Warning" after "…, verbal" holds and "Standards
 * of Conduct" after "it should be must see behaviors" does not.
 */
export function noAsYouSaidUnlessSaid(reply: ReplayAnswer, managerTurns: readonly string[]): void {
  const said = managerTurns.join("\n").toLowerCase();
  for (const line of reply.content.split("\n")) {
    const match = /(?:\*\*)?([^*:·\n]+?)(?:\*\*)?:(?:\*\*)?\s*([^·\n]+?),\s*as you said/i.exec(line);
    if (!match) continue;
    const value = match[2]!.replace(/\*\*/g, "").trim();
    const words = value.toLowerCase().split(/[^a-z']+/).filter((word) => word.length >= 4);
    const shared = words.some((word) => new RegExp(`\\b${word}\\b`).test(said));
    expect(shared ? null : `${match[1]!.trim()}: ${value}`, `"as you said" for words the manager did not write`).toBeNull();
  }
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
