/**
 * ============================================================================
 * AN AREA ID IS A SLUG OF THE NAME REPORTING USES — NOT A LOOKUP
 * ============================================================================
 *
 * Districts and regions have no id in the reporting source. They are LABELS:
 * `salon_period_attributes.district_label` holds the name of the manager who
 * runs the district, and `region_label` the same for the region.
 *
 * So an area id is derived from the label by a pure function rather than
 * assigned by a table. That is what lets the authorization path resolve a
 * district scope entirely from live data: hand it a label from reporting, slug
 * it, and compare. No static map sits between the two, so nothing can go stale
 * between them.
 *
 * WHAT HAPPENS WHEN A DISTRICT IS RENAMED. Its slug changes, an account still
 * carrying the old id matches nothing, and the allowlist comes back empty —
 * the account sees no salons until it is reassigned. That is the safe
 * direction: a renamed district is a business change somebody should confirm,
 * and showing nothing is recoverable where showing the wrong salons is not.
 */

/** `Patterson, Madeline` -> `patterson-madeline`. Stable and reversible enough. */
function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function districtIdOf(label: string): string {
  return `dist-${slug(label)}`;
}

export function regionIdOf(label: string): string {
  return `reg-${slug(label)}`;
}
