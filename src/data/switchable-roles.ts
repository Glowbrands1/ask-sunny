import type { Role } from "@/types";

/**
 * The roles the demo switcher offers, in presentation order.
 *
 * A list of role NAMES — no person, no salon, no figure — so it is safe to
 * ship, and it has to be: the login screen and the user menu both need it
 * synchronously to decide whether to draw the switcher at all, and both are
 * rendered before any demo chunk could be fetched.
 *
 * It moved out of `data/demo/users.ts` because that file also holds
 * `DEMO_USERS`, a roster of fabricated people with names, emails and titles.
 * Importing four strings from there shipped all of them.
 */
export const DEMO_SWITCHABLE_ROLES: Role[] = [
  "salon_director",
  "district_manager",
  "regional_manager",
  "owner",
];
