/**
 * Errors the live answer path returns.
 *
 * Every one of these is surfaced to the manager as itself. None of them is
 * ever swallowed and replaced with a seeded demo answer — a wrong answer that
 * looks right is worse than an error that says what is broken.
 */
export type AiErrorCode =
  | "not_configured"
  | "retrieval_failed"
  | "model_failed"
  | "refused"
  | "bad_request"
  /**
   * The server could not open a recorded turn, so nothing was asked.
   *
   * ITS OWN CODE RATHER THAN `model_failed`, because the two need opposite
   * things said about them. A model failure means Sunny tried and could not
   * answer; this means Sunny never tried — no question reached Anthropic, no
   * answer exists, and nothing was lost. Retrying is genuinely worth it, which
   * is the one thing the manager needs to know.
   */
  | "turn_unavailable";

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  /** Environment variable NAMES that are missing. Never values. */
  readonly missing: string[];
  /**
   * Seconds until a rate-limited caller may try again.
   *
   * SET ONLY ON A 429, and it exists so a legitimate caller can WAIT rather
   * than guess or give up. The upload budget is ten a minute, which a bulk
   * upload of a policy folder will reach — and the right behaviour there is for
   * the client to pause for the rest of the window and carry on, not to abandon
   * the remaining files and not to have the cap raised. `errorResponse` turns
   * this into a real `Retry-After` header.
   */
  readonly retryAfterSeconds?: number;

  constructor(
    code: AiErrorCode,
    message: string,
    status = 502,
    missing: string[] = [],
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
    this.missing = missing;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
