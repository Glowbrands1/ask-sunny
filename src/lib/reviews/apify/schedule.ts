/**
 * ============================================================================
 * WHEN THE SCHEDULED SYNC IS DUE, IN THE SALONS' OWN TIME
 * ============================================================================
 *
 * One run a day, at 06:00 in America/Chicago, all year — including the two
 * Sundays a year when that is not the same UTC hour it was the day before.
 *
 * ============================================================================
 * WHY THIS MODULE HAS TO EXIST AT ALL
 * ============================================================================
 *
 * VERCEL CRON HAS NO TIME ZONE. A `schedule` in `vercel.json` is a bare cron
 * expression evaluated in UTC, and there is no field to say otherwise. So a
 * single fixed UTC hour is 06:00 Central for one half of the year and 05:00 or
 * 07:00 for the other — the schedule silently walks an hour twice a year, and
 * "the morning figures were not there at six" is the symptom somebody has to
 * debug months later.
 *
 * Moving the schedule to Apify, which does understand IANA zones, was the other
 * way out and is the one thing this integration deliberately does not do: the
 * Actor's input would then live on Apify, the fifteen-location mapping would
 * exist in two places, and the copy a scheduled run actually used would be the
 * one nobody could see from ASK Sunny. That trade is argued in
 * `docs/google-reviews-apify.md` §3 and it did not change.
 *
 * ============================================================================
 * SO: TWO UTC TICKS, ONE OF WHICH IS ALWAYS SIX O'CLOCK CENTRAL
 * ============================================================================
 *
 *   11:00 UTC  =  06:00 CDT (Mar–Nov, UTC−5)   05:00 CST
 *   12:00 UTC  =  07:00 CDT                    06:00 CST (Nov–Mar, UTC−6)
 *
 * Exactly one of the two is 06:00 local on every day of the year, and the tick
 * that is not simply starts nothing. Never zero runs, never two — which the
 * tests below assert over every day of several years rather than by argument.
 *
 * The US changes its clocks at 02:00 local on a Sunday, so by 05:00 the day's
 * offset is already settled and neither transition day is a special case.
 *
 * ============================================================================
 * AND A TICK THAT STARTS NOTHING COSTS NOTHING
 * ============================================================================
 *
 * The off-hour tick still reconciles a run whose completion webhook was lost,
 * which is a query against our own database and reaches Apify only when there
 * is genuinely a stuck run to settle. It cannot start an Actor run, so it
 * cannot spend a credit.
 */

/** The salons' own morning. Not the server's, and not the reader's. */
export const SYNC_TIME_ZONE = "America/Chicago";

/** Six o'clock, local: the figures are on the screen before the day starts. */
export const SYNC_LOCAL_HOUR = 6;

/**
 * The UTC hours that bracket {@link SYNC_LOCAL_HOUR} across both offsets.
 *
 * These are the hours `vercel.json` must fire on, and `schedule.test.ts`
 * asserts that it does — so the two cannot drift apart unnoticed.
 */
export const SYNC_CRON_UTC_HOURS = [11, 12] as const;

/** The literal `schedule` string for the cron entry in `vercel.json`. */
export const SYNC_CRON_EXPRESSION = `0 ${SYNC_CRON_UTC_HOURS.join(",")} * * *`;

/** What the integration panel says, when nobody has written something else. */
export const SYNC_SCHEDULE_DESCRIPTION = "Daily, 6:00 AM US Central (America/Chicago)";

/**
 * The hour of the day at `at`, in `timeZone`, as a number from 0 to 23.
 *
 * `null` when the runtime cannot resolve the zone. That is very nearly
 * impossible on Node — time zone data ships separately from locale data, so
 * even a small-ICU build has it — but the consequence of guessing wrong is a
 * run at the wrong hour, so it is reported rather than assumed.
 */
export function localHourIn(timeZone: string, at: Date): number | null {
  let formatter: Intl.DateTimeFormat;

  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
    });
  } catch {
    return null;
  }

  /*
   * A RUNTIME WITHOUT THE ZONE CAN ANSWER IN UTC RATHER THAN THROW, and that
   * failure looks exactly like success. Asking the formatter what zone it
   * actually resolved is what tells the two apart.
   */
  if (formatter.resolvedOptions().timeZone !== timeZone) return null;

  const hour = formatter
    .formatToParts(at)
    .find((part) => part.type === "hour")?.value;

  if (hour === undefined) return null;

  const parsed = Number(hour);
  /* `h23` renders midnight as `24` in some ICU versions. */
  return Number.isInteger(parsed) ? parsed % 24 : null;
}

/** `2026-09-19 06:00 America/Chicago`, for a log line and an operator's eyes. */
export function localTimeIn(timeZone: string, at: Date): string | null {
  let formatter: Intl.DateTimeFormat;

  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }

  if (formatter.resolvedOptions().timeZone !== timeZone) return null;

  const parts = new Map(formatter.formatToParts(at).map((part) => [part.type, part.value]));
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  const hour = parts.get("hour");
  const minute = parts.get("minute");

  if (!year || !month || !day || !hour || !minute) return null;

  return `${year}-${month}-${day} ${hour}:${minute} ${timeZone}`;
}

export type ScheduleWindow =
  | { status: "due"; localTime: string }
  | { status: "outside_window"; localTime: string }
  | { status: "timezone_unavailable" };

/**
 * Whether a cron tick landing now is the one that should start the day's run.
 *
 * `due` for the tick that lands in the 06:00 hour in {@link SYNC_TIME_ZONE},
 * `outside_window` for its DST partner, and `timezone_unavailable` when the
 * runtime cannot answer — which FAILS CLOSED. A schedule that cannot prove it
 * is six in the morning does not start a run, because a daily sync arriving an
 * hour late is a smaller problem than a daily sync nobody can predict.
 */
export function scheduleWindow(at: Date = new Date()): ScheduleWindow {
  const hour = localHourIn(SYNC_TIME_ZONE, at);
  if (hour === null) return { status: "timezone_unavailable" };

  const localTime = localTimeIn(SYNC_TIME_ZONE, at) ?? `hour ${hour} ${SYNC_TIME_ZONE}`;

  return hour === SYNC_LOCAL_HOUR
    ? { status: "due", localTime }
    : { status: "outside_window", localTime };
}
