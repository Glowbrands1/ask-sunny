import { businessToday } from "@/lib/business-date";
import { appConfig } from "@/lib/ai/agent-loop/app-config";
import { FollowUpError, setFollowUpDate } from "@/lib/forms/instances";
import { followUpDateForNewForm, followUpLine, planPromisesFollowUp } from "@/lib/forms/follow-up-default";

/**
 * The write side of `follow-up-default.ts` (Pau, 20 Nov 2026): a form the agent loop creates gets its follow-up date
 * through `setFollowUpDate`, the form's own date control's path, so the history records `follow_up_started` and the
 * manager changes it the same way.
 *
 * WHEN. A Corrective Action, always (at Create, before any drafting); any other form only when its drafted plan, or
 * the manager's own words, promise a follow-up (after drafting). Never over a date the form already has.
 */
/** Where a form's plan is written: a Corrective Action's Action Plan, a Coaching Form's Details, other forms' Plan of Action. */
export const PLAN_FIELD_KEYS: ReadonlySet<string> = new Set(["action_plan", "plan_of_action", "coaching_details"]);

export interface DefaultedFollowUp {
  date: string;
  /** "Follow-up: Fri, Nov 27 (change it anytime)." */
  notice: string;
}

export async function applyLoopFollowUpDefault(input: {
  instance: { id: string; templateKey: string; formDate: string; followUpDate: string | null };
  managerWords: string;
  actorId: string;
  /** The drafted Action Plan, after drafting; absent at Create. */
  actionPlan?: string | null;
  today?: string;
}): Promise<DefaultedFollowUp | null> {
  const corrective = input.instance.templateKey === appConfig().formKeys.corrective;
  // The drafter keeps scheduling talk out of a plan the manager did not give it, so their own words count too.
  if (!corrective && !planPromisesFollowUp(input.actionPlan) && !planPromisesFollowUp(input.managerWords)) return null;
  const date = followUpDateForNewForm({
    formDate: input.instance.formDate,
    followUpDate: input.instance.followUpDate,
    managerWords: input.managerWords,
    today: input.today ?? businessToday(),
  });
  if (!date) return null;
  try {
    await setFollowUpDate(input.instance.id, date, input.actorId);
  } catch (error) {
    // An archived or completed form keeps what it has; the form is created either way.
    if (error instanceof FollowUpError) return null;
    throw error;
  }
  return { date, notice: followUpLine(date) };
}
