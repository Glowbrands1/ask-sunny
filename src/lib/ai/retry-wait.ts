/**
 * The wait between two attempts at an upstream call. Its own module so a test
 * can record the wait instead of sleeping through it.
 */
export function waitBeforeRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
