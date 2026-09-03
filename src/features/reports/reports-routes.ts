/**
 * The Reports & Analytics section's paths, in one place.
 *
 * Three things have to agree on where this section starts: the sidebar entry,
 * the `/reports` redirect, and the active-state prefix. They were going to be
 * three string literals in three files, and the failure mode is quiet — the
 * dashboard still works, the sidebar just stops lighting up, or a redirect
 * lands somewhere that no longer exists. Naming them once turns that into a
 * type error instead.
 *
 * Plain constants, safe in a client component: the sidebar is one.
 */

/** The section root. Redirects to the default report; never rendered itself. */
export const REPORTS_SECTION_PATH = "/reports";

/**
 * The report the section opens on.
 *
 * Salon Performance is the default because it is the one built on live data.
 * When Sales Totals ships, this is the line that decides which one a manager
 * sees first.
 */
export const REPORTS_DEFAULT_PATH = "/reports/salon-performance";
