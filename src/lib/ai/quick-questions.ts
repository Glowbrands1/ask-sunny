import { ACTIVE_BRAND } from "@/lib/brand";
import type { AccessScope, Permission } from "@/types";

/**
 * ============================================================================
 * THE QUESTIONS THE PRODUCT PUTS IN FRONT OF SOMEBODY
 * ============================================================================
 *
 * The chips on the Overview band and on the empty chat screen. They are the
 * first thing most managers ever ask Sunny, which makes them the product's own
 * claim about what it is for — and a chip that cannot be answered well is worse
 * than no chip, because the manager did not choose it, the product did.
 *
 * TWO THINGS WERE WRONG WITH THE LIST THIS REPLACES, and they are different
 * kinds of wrong.
 *
 * THE FIRST WAS A PROMISE THE DATA CANNOT KEEP. "What should I focus on in
 * today's Daily Stats?" asks for a report dated today. No delivery is ever
 * dated today — the Sales Totals email arrives overnight and covers yesterday,
 * by design, on every healthy day this company has ever had. So the one
 * question the homepage led with was the one question guaranteed to open with
 * an absence. The fix is in two places: `report-freshness.ts` now says to
 * answer from the most recent delivery and name its date, and the questions
 * below no longer ask for a day the reports do not carry.
 *
 * THE SECOND WAS THAT EVERYBODY GOT THE SAME SIX. A District Manager covering
 * three districts and a frontline employee with no reporting access at all were
 * offered the same list. For the employee that is a chip whose only possible
 * answer is "you have no salons assigned"; for the DM it is a single-salon
 * question asked of somebody who manages fifteen.
 *
 * ============================================================================
 * BREADTH COMES FROM THE SCOPE, NOT FROM RELABELLING THE ROLE
 * ============================================================================
 *
 * The obvious implementation is a `Record<Role, string[]>`. It is wrong, and
 * the reason is worth stating because the role names make it look right.
 *
 * `app_users.role` says what somebody DOES. `app_users.scope_level` says which
 * salons' rows they may be shown, and it is the second one these questions
 * depend on: "which salons need my attention" is a real question for anybody
 * who can read more than one salon and a strange one for anybody who cannot.
 * The two usually agree — a `district_manager` carries `level: "district"` —
 * but where they disagree the SCOPE is the one that decides what comes back
 * from the database, so it is the one that decides what to offer. A DM scoped
 * to a single salon while they cover for somebody gets the single-salon
 * question, and that is correct: a region question would have returned one
 * salon and called it a region.
 *
 * IT IS ALSO WHAT KEEPS ADMINISTRATORS HONEST. An `admin`, `owner` or
 * `developer` is not a District Manager and must not be described as one, but
 * they hold `level: "global"` and can read every salon, so the multi-salon
 * questions are the ones their access actually supports. Scope gives them that
 * without anybody writing `admin: DM_QUESTIONS` and pretending the two roles
 * are the same job.
 *
 * NO ROLE IS NAMED ANYWHERE BELOW. That is the test of whether this got it
 * right, and `quick-questions.test.ts` asserts it against the source.
 *
 * ============================================================================
 * PERMISSION DECIDES WHETHER A QUESTION APPEARS AT ALL
 * ============================================================================
 *
 * Every question declares the permission it needs, checked through the same
 * `can()` the navigation uses — `DEFAULT_PERMISSION_MATRIX`, server-owned, not
 * the store's editable copy. `view_daily_stats` already exists and already
 * means this; nothing new was invented to gate a chip.
 *
 * THIS IS A DISPLAY FILTER AND NOT A SECURITY BOUNDARY, and the distinction
 * matters enough to say. Anybody can type any question. What stops an employee
 * reading a district's revenue is `reportingScopeOf` narrowing the QUERIES in
 * `report-briefing.ts`, which is unchanged and untouched by this file. What
 * this prevents is the product offering somebody a question it will then
 * refuse — which is a worse first impression than not offering it.
 *
 * ============================================================================
 * NOT DEMO CONTENT
 * ============================================================================
 *
 * The list this replaces lived in `data/demo/chat.ts`, under a header that
 * says "DEMO CONTENT" in capitals, and was rendered in production by both the
 * Overview band and the chat screen. The seeded MockAIProvider follow-ups stay
 * there, because they are demo content and belong there. What the real product
 * shows people lives here.
 */

/** The report this company calls its daily one. "Daily Stats", per brand. */
const DAILY_REPORT = ACTIVE_BRAND.vocabulary.dailyReportName;

/**
 * How many salons the reader can actually be shown.
 *
 * `multi` is anything wider than one salon — a district, a region, a global
 * assignment, or a salon-level assignment that also covers other areas. `one`
 * is a single salon and nothing else.
 */
export type OperationalBreadth = "multi" | "one";

/**
 * The breadth a scope entitles somebody to, read from the scope alone.
 *
 * `alsoCoversAreaIds` counts. An assignment can be salon-level and still cover
 * two more salons while somebody is on leave, and a manager in that position is
 * answering for more than one salon whatever their level says.
 */
export function breadthOf(scope: AccessScope): OperationalBreadth {
  if (scope.level !== "salon") return "multi";
  return scope.alsoCoversAreaIds.length > 0 ? "multi" : "one";
}

export interface QuickQuestion {
  /** The text of the chip, which is also the question that gets sent. */
  readonly text: string;
  /** Shown only to a reader who holds this. Null means everybody who can ask. */
  readonly needs: Permission | null;
  /**
   * The breadth this question is written for, or null for both.
   *
   * A question that names salons in the plural is not a better version of one
   * that names a salon — they are different questions, and offering both would
   * put two openings on a screen that has room for four chips.
   */
  readonly breadth: OperationalBreadth | null;
}

/**
 * The catalogue, in the order the chips appear.
 *
 * REPORT QUESTIONS LEAD, because the reports are the thing a manager cannot get
 * anywhere else in thirty seconds, and because the Overview band shows only the
 * first four.
 */
export const QUICK_QUESTIONS: readonly QuickQuestion[] = [
  /*
   * ==========================================================================
   * THE MULTI-SALON PAIR
   * ==========================================================================
   *
   * "BASED ON THE LATEST DATA" RATHER THAN "THIS WEEK", and that is a
   * deliberate correction to an earlier draft of this question. No source here
   * delivers a week: Sales Totals delivers a day and a month to date, the Comp
   * Report delivers month to date and year to date. A chip promising a weekly
   * window would have been the same defect as the "today's Daily Stats" chip it
   * replaced — the product asking for a window that does not exist, and the
   * answer opening by explaining why it cannot have it.
   *
   * "TODAY" SURVIVES IN THE SECOND ONE, AND MEANS SOMETHING DIFFERENT. "Which
   * salons need my attention today?" is about when the manager acts, not about
   * when the figures were measured. The reports answer it from the most recent
   * delivery and say which date that was; nothing about the sentence claims the
   * data is same-day. The first question could not make that distinction
   * because "this week" IS a window claim.
   */
  {
    text: "Where is my region losing revenue based on the latest data?",
    needs: "view_daily_stats",
    breadth: "multi",
  },
  {
    text: "Which salons need my attention today?",
    needs: "view_daily_stats",
    breadth: "multi",
  },
  /*
   * THE SINGLE-SALON OPENING. "Most recent" is doing real work in this
   * sentence: it routes through `detectPeriodIntent` as an explicit `latest`
   * intent, so the briefing names the period it read rather than falling back
   * to it silently.
   */
  {
    text: `Show me the most recent ${DAILY_REPORT} and what I need to focus on today.`,
    needs: "view_daily_stats",
    breadth: "one",
  },
  /*
   * THE REST ARE UNCHANGED IN WORDING and gated on the permissions that were
   * always behind them. An employee holds `ask_questions`, `view_knowledge` and
   * `view_videos`, so they keep the policy, objection and training questions
   * and lose the three that would have answered "you have no salons" or "you
   * cannot open that form".
   */
  { text: "Help me prepare for a coaching conversation.", needs: "create_coaching", breadth: null },
  { text: "What does our policy say about attendance?", needs: "view_knowledge", breadth: null },
  {
    text: "Create a coaching form for a performance concern.",
    needs: "create_coaching_form",
    breadth: null,
  },
  /*
   * FLOOR-LEVEL, so it is offered to a single salon and to anybody without
   * reporting access, and not to somebody triaging fifteen salons — a District
   * Manager is not the person handling the objection. This is the only question
   * the multi-salon list drops, and it keeps both lists at the six the screens
   * were designed around.
   */
  { text: "How should I handle a client objection?", needs: null, breadth: "one" },
  { text: "Show me training related to this issue.", needs: "view_videos", breadth: null },
];

/**
 * The questions to offer this reader, in order.
 *
 * `can` is passed in rather than read here: this module is imported by client
 * components, and the session already owns the one correct answer to "may
 * they". A second permission lookup would be a second opinion.
 */
export function quickQuestionsFor(input: {
  readonly scope: AccessScope;
  readonly can: (permission: Permission) => boolean;
}): string[] {
  const breadth = breadthOf(input.scope);

  return QUICK_QUESTIONS.filter((question) => {
    if (question.breadth !== null && question.breadth !== breadth) return false;
    /*
     * A READER WITHOUT REPORTING ACCESS LOSES THE REPORT QUESTIONS ENTIRELY,
     * and is not given a smaller one instead. There is no salon-free version of
     * "what should I focus on" that this data can answer, and inventing one
     * would be a chip that returns a shrug.
     */
    return question.needs === null || input.can(question.needs);
  }).map((question) => question.text);
}
