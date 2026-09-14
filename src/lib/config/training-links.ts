/**
 * ============================================================================
 * WHERE THE TRAINING ACTUALLY LIVES
 * ============================================================================
 *
 * THE FINDING, from the 14 September review:
 *
 *   "Recommended Training is currently an empty section. Since our training
 *    videos live in Teams and Woven, I'd rather this be a link directing users
 *    to those resources than an empty section that appears as though it should
 *    contain content."
 *
 * And, from the login page feedback: "We are not hosting training within the
 * site." So the product does not host training, and a section that looks like
 * it is about to is worse than one that says where the training is.
 *
 * ============================================================================
 * WHY THIS IS CONFIGURATION AND NOT A CONSTANT
 * ============================================================================
 *
 * NO URL IS INVENTED HERE, and none is guessed. A Teams channel link and a
 * Woven workspace link are facts about the customer's tenancy that this
 * repository does not know; writing a plausible one would produce a link that
 * looks right, goes nowhere, and is discovered by a Salon Director rather than
 * by a developer.
 *
 * So both are read from the environment and both are OPTIONAL. Unset means the
 * destination is not configured, and the surface says exactly that — it does
 * not render a dead link and it does not render an empty box. The values still
 * needed are listed in `docs/stakeholder-review-2026-09-14.md`.
 *
 * CLIENT-SAFE: `NEXT_PUBLIC_` only, because the link is rendered in a client
 * component. These are destinations, not secrets — the same category as the
 * Manager Resources links already on the page.
 */

export const TEAMS_TRAINING_URL_ENV = "NEXT_PUBLIC_TEAMS_TRAINING_URL";
export const WOVEN_TRAINING_URL_ENV = "NEXT_PUBLIC_WOVEN_TRAINING_URL";

export interface TrainingLink {
  readonly key: "teams" | "woven";
  readonly label: string;
  /** Where the training is. Null when this deployment has not been told. */
  readonly href: string | null;
  /** One line for a reader deciding which to open. */
  readonly description: string;
  /** The variable an administrator sets. Named so a gap is actionable. */
  readonly envVar: string;
}

/**
 * Accepts only an absolute http(s) URL.
 *
 * A relative value would resolve against Ask Sunny's own origin and produce a
 * link to a page that does not exist here — which is the specific failure this
 * whole module exists to avoid, arriving through configuration instead of
 * through code.
 */
function usableUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * The training destinations, configured or not.
 *
 * Both entries are always returned. A caller renders the configured ones as
 * links and says plainly that the others are not set up yet — which is a
 * truthful empty state an administrator can act on, unlike a blank panel.
 */
export function trainingLinks(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): TrainingLink[] {
  return [
    {
      key: "teams",
      label: "Training in Teams",
      href: usableUrl(env[TEAMS_TRAINING_URL_ENV]),
      description: "Recorded sessions and the training channel.",
      envVar: TEAMS_TRAINING_URL_ENV,
    },
    {
      key: "woven",
      label: "Training in Woven",
      href: usableUrl(env[WOVEN_TRAINING_URL_ENV]),
      description: "Courses and assigned learning paths.",
      envVar: WOVEN_TRAINING_URL_ENV,
    },
  ];
}

/** True when at least one destination has been configured. */
export function hasConfiguredTraining(links: readonly TrainingLink[]): boolean {
  return links.some((link) => link.href !== null);
}
