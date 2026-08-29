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
  | "bad_request";

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number;
  /** Environment variable NAMES that are missing. Never values. */
  readonly missing: string[];

  constructor(
    code: AiErrorCode,
    message: string,
    status = 502,
    missing: string[] = [],
  ) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
    this.missing = missing;
  }
}
