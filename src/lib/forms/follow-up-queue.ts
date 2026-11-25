import "server-only";

import { businessToday } from "@/lib/business-date";
import type { Permission } from "@/types";

import type { FormsActor } from "./access";
import { attentionSummary, followUpState, type AttentionSummary } from "./follow-up";
import { actorMaySeeInstance, withoutUnreadable } from "./instance-scope";
import { listAllOutstandingFollowUps, type InstanceRow } from "./instances";
import { configuredExcludedNames, isProductionRecord } from "./production-records";

/**
 * ============================================================================
 * THE FOLLOW-UP QUEUE: ONE SET OF FORMS, ONE OVERDUE COUNT, FOR EVERY SCREEN
 * ============================================================================
 *
 * QA, 24 Nov 2026: "The Overview, the sidebar and the Form Monitoring banner say 19 overdue. Form Monitoring's
 * Overdue filter says 8 and Open says 6." Every screen used the same rule (`followUpState`) over a different set of
 * forms: the rail, the Overview and the banner over the first 50 outstanding follow-ups (with the Overview alone
 * leaving out test records), the pills over the 200 most recently created forms. So the numbers disagreed, and none
 * of them said it had stopped counting.
 *
 * Now there is one set: every outstanding follow-up this reader may open (their salons, their own forms elsewhere,
 * Exit forms only for those who create them, HR-pending and private forms as `actorMaySeeInstance` decides), minus
 * the non-production records the Overview already held back (`production-records.ts`), read WITHOUT A CAP
 * (`listAllOutstandingFollowUps`). The rail badge, the Overview, Form Monitoring's banner and its Open and Overdue
 * pills, and the AI (read_follow_ups), all count it.
 */
export interface FollowUpQueue {
  /** Every outstanding follow-up this reader may open, soonest first: open and overdue, test records left out. */
  readonly forms: readonly InstanceRow[];
  /** Overdue, due this week and the two together, over `forms`. */
  readonly attention: AttentionSummary;
  /** Every open follow-up (date today or later), not only this week's: the Open pill. */
  readonly open: number;
  /** Outstanding follow-ups on test / non-production records, not counted (they stay in Form Monitoring's list). */
  readonly excluded: number;
}

export const EMPTY_FOLLOW_UP_QUEUE: FollowUpQueue = {
  forms: [],
  attention: { overdue: 0, dueThisWeek: 0, needsAttention: 0 },
  open: 0,
  excluded: 0,
};

/** The pure half: which of the outstanding rows count, and their counts. */
export function followUpQueueOf(
  outstanding: readonly InstanceRow[],
  options: {
    readonly actor: FormsActor;
    /** Whether the reader may create Exit forms, and so read them (`withoutUnreadable`). */
    readonly readsExit: boolean;
    readonly today?: string;
    readonly excludedNames?: Set<string>;
  },
): FollowUpQueue {
  const today = options.today ?? businessToday();
  const holds = (permission: Permission) => permission === "create_exit_form" && options.readsExit;
  const readable = withoutUnreadable([...outstanding], holds).filter((instance) => actorMaySeeInstance(options.actor, instance));
  const excludedNames = options.excludedNames ?? configuredExcludedNames();
  const forms = readable.filter((instance) =>
    isProductionRecord(
      { employeeName: instance.employeeName, locationName: instance.locationName, locationId: instance.locationId },
      { excludedNames },
    ),
  );
  return {
    forms,
    attention: attentionSummary(forms, today),
    open: forms.filter((form) => followUpState(form, today) === "open").length,
    excluded: readable.length - forms.length,
  };
}

/**
 * The read every screen calls, with the reader's forms access as the page resolves it (`pageFormsAccess`). A reader
 * with no salon reads nothing.
 */
export async function readFollowUpQueue(
  access: {
    readonly actor: FormsActor;
    readonly locationIds: readonly string[] | null;
    readonly ownCreatedBy: string | null;
    readonly noSalon: boolean;
  },
  options: { readonly readsExit: boolean; readonly today?: string },
  read: typeof listAllOutstandingFollowUps = listAllOutstandingFollowUps,
): Promise<FollowUpQueue> {
  if (access.noSalon) return EMPTY_FOLLOW_UP_QUEUE;
  const outstanding = await read(access.locationIds, access.ownCreatedBy);
  return followUpQueueOf(outstanding, { actor: access.actor, readsExit: options.readsExit, today: options.today });
}
