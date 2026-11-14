import "server-only";

import { FORM_PATCH_TIMEOUT_DEFAULT_MS, formPatchTimeoutMs } from "@/lib/config/ai-timeouts";
import { CLAUDE_READER_MODEL } from "@/lib/config/models";
import { requireEnv } from "@/lib/config/server-env";
import { activeSpendMeter } from "@/lib/ai/spend-meter";
import { logAiFailure, logAiTimeout } from "@/lib/ai/time-limit";

/**
 * ============================================================================
 * THE FORM-PATCH MODEL CALL (FORM_PATCH_REDUCER_ENABLED)
 * ============================================================================
 *
 * The only module that loads the AI SDK, and it loads it with a dynamic
 * import inside the call, so nothing is loaded until a flag-guarded caller
 * reaches here (`form-patch-flags-off.test.ts` checks both). The model's raw
 * object is returned unchecked: `form-patch-model.ts` parses it with the zod
 * schema, so a test stub of this module still runs the real parse.
 *
 * Claude Haiku (CLAUDE_READER_MODEL), temperature 0, 1,500 output tokens at
 * most, no retries, a 5 s limit (FORM_PATCH_TIMEOUT_MS, 1,000 to 10,000).
 * The usage goes into the request's spend meter when one is running. Never
 * throws: a timeout, an error or no usable object is a fallback, and the turn
 * runs on the old path.
 */

/** The call's limit; FORM_PATCH_TIMEOUT_MS sets it for a trial, clamped to 1,000–10,000 ms. See `config/ai-timeouts.ts`. */
export const FORM_PATCH_DEFAULT_TIMEOUT_MS = FORM_PATCH_TIMEOUT_DEFAULT_MS;
export { formPatchTimeoutMs };

export interface FormPatchCallInput {
  readonly system: string;
  readonly prompt: string;
  /** The output's JSON schema (`z.toJSONSchema` of `patchOutputSchema`). */
  readonly schema: Record<string, unknown>;
}

export type FormPatchCallResult =
  | { readonly ok: true; readonly output: unknown }
  | { readonly fallback: "timeout" | "error" | "invalid" };

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);

function recordUsage(usage: unknown): void {
  const meter = activeSpendMeter();
  if (!meter || typeof usage !== "object" || usage === null) return;
  const read = usage as {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  };
  const details = read.inputTokenDetails ?? {};
  meter.calls.push({
    model: CLAUDE_READER_MODEL,
    inputTokens: count(details.noCacheTokens ?? read.inputTokens),
    outputTokens: count(read.outputTokens),
    cacheReadTokens: count(details.cacheReadTokens),
    cacheWriteTokens: count(details.cacheWriteTokens),
  });
}

export async function callFormPatchModel(input: FormPatchCallInput): Promise<FormPatchCallResult> {
  const limitMs = formPatchTimeoutMs();
  const signal = AbortSignal.timeout(limitMs);
  const started = Date.now();
  /* AI TIME LIMITS (QA, 14 Nov 2026): a timeout or a failure is on the server log too; the turn still falls back. */
  const timedOut = (): { readonly fallback: "timeout" } => {
    logAiTimeout("form_patch", Date.now() - started, limitMs);
    return { fallback: "timeout" };
  };
  const failed = (error: unknown): { readonly fallback: "error" } => {
    logAiFailure("form_patch", Date.now() - started, error);
    return { fallback: "error" };
  };
  try {
    const { generateObject, jsonSchema, NoObjectGeneratedError } = await import("ai");
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    const anthropic = createAnthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
    try {
      const result = await generateObject({
        model: anthropic(CLAUDE_READER_MODEL),
        schema: jsonSchema(input.schema),
        system: input.system,
        prompt: input.prompt,
        temperature: 0,
        maxOutputTokens: 1500,
        maxRetries: 0,
        abortSignal: signal,
      });
      recordUsage(result.usage);
      return { ok: true, output: result.object };
    } catch (error) {
      if (signal.aborted) return timedOut();
      if (NoObjectGeneratedError.isInstance(error)) {
        recordUsage(error.usage);
        return { fallback: "invalid" };
      }
      return failed(error);
    }
  } catch (error) {
    return signal.aborted ? timedOut() : failed(error);
  }
}
