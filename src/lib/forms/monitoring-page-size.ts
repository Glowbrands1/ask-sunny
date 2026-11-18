/**
 * HOW MANY FORMS FORM MONITORING LOADS, AND "LOAD MORE".
 *
 * The page used to read the newest 200 forms and stop, with nothing on screen
 * saying so. Once a company passed 200 active forms, older ones — including
 * overdue follow-ups the Overview was still listing — could not be found on the
 * page whose job is to show every form.
 *
 * Now the count lives in the URL (`?show=400`) so a "Load more" button can ask
 * the server for the next page, and the view survives a refresh. It is always a
 * whole number of pages and is capped, so a hand-edited URL cannot ask for an
 * unbounded read.
 */

export const MONITORING_PAGE_SIZE = 200;
export const MONITORING_MAX_ROWS = 5000;

/** The number of forms to load for a `show` search parameter. */
export function parseShowCount(raw: string | undefined): number {
  const requested = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(requested) || requested <= MONITORING_PAGE_SIZE) return MONITORING_PAGE_SIZE;
  const pages = Math.ceil(requested / MONITORING_PAGE_SIZE);
  return Math.min(pages * MONITORING_PAGE_SIZE, MONITORING_MAX_ROWS);
}

/** The count after one more page, or null when the cap is reached. */
export function nextShowCount(current: number): number | null {
  const next = current + MONITORING_PAGE_SIZE;
  return next > MONITORING_MAX_ROWS ? null : next;
}
