/**
 * THE RATING THE PAGE TREATS AS LOW, IN ONE PLACE.
 *
 * It is not a goal and it is not stored anywhere — it is a READING THRESHOLD,
 * the point below which the leaderboard colours an average coral and the
 * Overview's attention tile counts a salon. Both read this constant, so the
 * tile cannot count a salon the table renders as unremarkable.
 *
 * ============================================================================
 * IT LIVES IN A MODULE OF ITS OWN BECAUSE BOTH SIDES OF THE RENDER READ IT
 * ============================================================================
 *
 * The leaderboard is a client component; the Overview is server-rendered. A
 * server component importing a plain VALUE out of a `"use client"` module does
 * not get the value — it gets the client module's reference, and the first
 * `.toFixed()` on it throws at request time while typechecking cleanly and
 * passing every jsdom test, because under test both halves are in one runtime.
 * This was found by opening the page in a browser, which is the only place it
 * is visible. So the constant sits here, with no directive, and both import it.
 */
export const RATING_FLOOR = 4.5;
