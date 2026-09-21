import { ACTIVE_BRAND } from "@/lib/brand";
import type { AccessScope, Permission, ScopeLevel } from "@/types";

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
 * THE LEVEL COMES FROM `scope_level`, AND FROM NOTHING ELSE
 * ============================================================================
 *
 * The obvious implementation is a `Record<Role, string[]>`. It is wrong, and
 * the reason is worth stating because the role names make it look right.
 *
 * `app_users.role` says what somebody DOES. `app_users.scope_level` says at
 * what level they are assigned — salon, district, region or the whole
 * organization — and it is a four-value enum the server owns and the holder
 * cannot edit. It is the one field that answers "whose salons are these, and
 * what does this person call the group they run", which is exactly what these
 * questions have to get right. So there is one report question per level and
 * the level selects it.
 *
 * IT IS NOT A HEAD COUNT, AND THAT DISTINCTION IS A CORRECTION. A first
 * version of this file derived a two-value "breadth" and widened anybody whose
 * `alsoCoversAreaIds` was non-empty, so a Salon Director covering two salons
 * during a vacancy was handed the District Manager's questions and asked about
 * "my district". They are still a Salon Director. Extra salon access changes
 * WHICH ROWS COME BACK — `reportingScopeOf` reads `alsoCoversAreaIds` and
 * always did — and it must not change what the product calls them or which
 * operational question it puts in front of them. Accessible salon count is a
 * data boundary; `scope_level` is the persona. This file reads only the
 * second, and `quick-questions.test.ts` pins that with a regression case.
 *
 * IT ALSO KEEPS ADMINISTRATORS HONEST. An `admin`, `owner` or `developer` is
 * not a District Manager and must not be described as one, so `global` gets
 * its own neutral wording — "where are we losing revenue", "which salons need
 * attention" — rather than borrowing a field title nobody at that level holds.
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

export interface QuickQuestion {
  /** The text of the chip, which is also the question that gets sent. */
  readonly text: string;
  /** Shown only to a reader who holds this. Null means everybody who can ask. */
  readonly needs: Permission | null;
  /**
   * The scope levels this question is written for, or null for every level.
   *
   * A question that names salons in the plural is not a better version of one
   * that names a salon — they are different questions, and offering both would
   * put two openings on a screen that has room for four chips. So each report
   * question belongs to the levels whose wording it actually fits, and there
   * is exactly one of them per level.
   */
  readonly levels: readonly ScopeLevel[] | null;
}

/**
 * The catalogue, in the order the chips appear.
 *
 * REPORT QUESTIONS LEAD, because the reports are the thing a manager cannot get
 * anywhere else in thirty seconds, and because the Overview band shows only the
 * first four.
 *
 * ============================================================================
 * "BASED ON THE LATEST DATA" RATHER THAN "THIS WEEK"
 * ============================================================================
 *
 * A deliberate correction to an earlier draft of the revenue question. No
 * source here delivers a week: Sales Totals delivers a day and a month to
 * date, the Comp Report delivers month to date and year to date. A chip
 * promising a weekly window would have been the same defect as the "today's
 * Daily Stats" chip it replaced — the product asking for a window that does
 * not exist, and the answer opening by explaining why it cannot have it.
 *
 * "TODAY" SURVIVES IN THE ATTENTION QUESTION, AND MEANS SOMETHING DIFFERENT.
 * "Which salons need my attention today?" is about when the manager acts, not
 * about when the figures were measured. The reports answer it from the most
 * recent delivery and say which date that was; nothing about the sentence
 * claims the data is same-day. "This week" could not make that distinction,
 * because it IS a window claim.
 */
export const QUICK_QUESTIONS: readonly QuickQuestion[] = [
  /*
   * ==========================================================================
   * ONE REVENUE QUESTION PER LEVEL, IN THAT LEVEL'S OWN WORDS
   * ==========================================================================
   *
   * A District Manager owns a district and a Regional Manager owns a region;
   * asking a DM about "my region" is wrong in the reader's own vocabulary even
   * though the query underneath would have been identical. An administrator
   * owns neither, so theirs says "we" — the organization — rather than
   * borrowing a field title they do not hold.
   */
  {
    text: "Where is my district losing revenue based on the latest data?",
    needs: "view_daily_stats",
    levels: ["district"],
  },
  {
    text: "Where is my region losing revenue based on the latest data?",
    needs: "view_daily_stats",
    levels: ["region"],
  },
  {
    text: "Where are we losing revenue based on the latest data?",
    needs: "view_daily_stats",
    levels: ["global"],
  },
  /*
   * THE TRIAGE QUESTION, in the possessive for a field manager and neutral for
   * an administrator, who is not triaging salons they own.
   */
  {
    text: "Which salons need my attention today?",
    needs: "view_daily_stats",
    levels: ["district", "region"],
  },
  {
    text: "Which salons need attention today?",
    needs: "view_daily_stats",
    levels: ["global"],
  },
  /*
   * THE SALON-LEVEL OPENING. "Most recent" is doing real work in this
   * sentence: it routes through `detectPeriodIntent` as an explicit `latest`
   * intent, so the briefing names the period it read rather than falling back
   * to it silently.
   */
  {
    text: `Show me the most recent ${DAILY_REPORT} and what I need to focus on today.`,
    needs: "view_daily_stats",
    levels: ["salon"],
  },
  /*
   * THE REST ARE UNCHANGED IN WORDING and gated on the permissions that were
   * always behind them. An employee holds `ask_questions`, `view_knowledge` and
   * `view_videos`, so they keep the policy, objection and training questions
   * and lose the ones that would have answered "you have no salons" or "you
   * cannot open that form".
   */
  { text: "Help me prepare for a coaching conversation.", needs: "create_coaching", levels: null },
  { text: "What does our policy say about attendance?", needs: "view_knowledge", levels: null },
  {
    text: "Create a coaching form for a performance concern.",
    needs: "create_coaching_form",
    levels: null,
  },
  /*
   * FLOOR-LEVEL, so it belongs to the salon and not to somebody triaging a
   * district — a District Manager is not the person handling the objection.
   * This is the one question the wider lists drop, and it keeps every list at
   * the six the screens were designed around.
   */
  { text: "How should I handle a client objection?", needs: null, levels: ["salon"] },
  { text: "Show me training related to this issue.", needs: "view_videos", levels: null },
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
  const level = input.scope.level;

  return QUICK_QUESTIONS.filter((question) => {
    if (question.levels !== null && !question.levels.includes(level)) return false;
    /*
     * A READER WITHOUT REPORTING ACCESS LOSES THE REPORT QUESTIONS ENTIRELY,
     * and is not given a smaller one instead. There is no salon-free version of
     * "what should I focus on" that this data can answer, and inventing one
     * would be a chip that returns a shrug.
     */
    return question.needs === null || input.can(question.needs);
  }).map((question) => question.text);
}
