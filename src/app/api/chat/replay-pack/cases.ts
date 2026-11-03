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
  formProposal?: { templateKey?: string; employeeName?: string | null; status?: string; subject?: string; locationId?: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
  formOpened?: { instanceId: string };
}

export interface ReplayThread {
  say(text: string): Promise<ReplayAnswer>;
  create(): Promise<string>;
  readonly proposal: ReplayAnswer["formProposal"] | null;
  readonly instanceId: string | null;
}

export interface ReplayContext {
  thread(): ReplayThread;
  as(role: string, scope: unknown): void;
  directory(rows: readonly DirectoryRow[]): void;
  /** What the drafting model writes at Create. */
  draftWrites(values: Record<string, string>): void;
  /** What the revision model writes on the next revision. */
  revisionWrites(values: Record<string, string>): void;
  /** What the answering model says on its next turns (null: the default answer). */
  modelSays(text: string | null): void;
  calls(): { chat: number; draft: number; revision: number; tool: number };
  forms(): Record<string, unknown>[];
  values(instanceId: string): Record<string, string>;
  /** What the drafting model was given, one entry per draft written. */
  draftPrompts(): string[];
  /** The manager types on the form and saves (filled by the manager). */
  typeOnForm(instanceId: string, values: Record<string, string>): void;
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
const CLAIM = /\b(?:updated|now reads|now says|applied|is on the card|that'?s on the card|reflected on|confirmed against)\b/i;

export function noClaimWithoutUpdate(reply: ReplayAnswer): void {
  if (reply.formUpdate || reply.formOpened) return;
  expect(reply.content.split("\n").filter((line) => CLAIM.test(line) && /\b(?:form|draft|card|name|details)\b/i.test(line))).toEqual([]);
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
