import "server-only";

import { AiError } from "@/lib/ai/errors";
import { maxItemsForRun, type ApifyConfig } from "./config";

/**
 * ============================================================================
 * THE APIFY REST CLIENT — the only place this system talks to Apify
 * ============================================================================
 *
 * ============================================================================
 * THE TOKEN GOES IN A HEADER AND NOWHERE ELSE
 * ============================================================================
 *
 * Apify's API also accepts `?token=…`, and that form is never used here. A
 * secret in a query string is written into every access log, proxy log and
 * error report between this process and Apify, and it survives rotation in all
 * of them. It is the same rule `sync-credential.ts` already states for the
 * inbound direction, applied outbound.
 *
 * AND IT NEVER REACHES AN ERROR MESSAGE. `describeFailure` below reads the
 * status and a bounded, quoted excerpt of the body; the request that produced
 * it — headers included — is not logged, because the header is the token.
 *
 * ============================================================================
 * NO POLLING LOOP
 * ============================================================================
 *
 * `startRun` returns as soon as Apify accepts the run. Completion arrives as a
 * webhook attached to that run, so nothing here sleeps, retries on a timer, or
 * burns a serverless invocation waiting. `getRun` exists for exactly two
 * bounded uses: confirming a webhook's claim against Apify itself, and the
 * single reconciliation read the next scheduled tick makes over a run whose
 * webhook never arrived.
 */

const API_BASE = "https://api.apify.com/v2";

/** Apify's own run states. Anything unrecognised is treated as a failure. */
export type ApifyRunState =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED";

export interface ApifyRun {
  id: string;
  actorId: string | null;
  status: ApifyRunState;
  defaultDatasetId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** What Apify says the run cost. Null when Apify did not report it. */
  usageTotalUsd: number | null;
}

/** One ad-hoc webhook, attached to the run that is being started. */
export interface ApifyWebhookRequest {
  eventTypes: string[];
  requestUrl: string;
  payloadTemplate: string;
  headersTemplate?: string;
}

export interface StartRunOptions {
  /** The Actor's input, as an opaque JSON body. Built by `buildActorInput`. */
  input: object;
  limitPerLocation: number;
  locations: number;
  webhooks?: ApifyWebhookRequest[];
}

function requireToken(config: ApifyConfig): string {
  if (!config.token) {
    throw new AiError(
      "bad_request",
      "Apify is not configured for this deployment, so no run can be started.",
      503,
    );
  }
  return config.token;
}

/**
 * A failure description that is safe to log and safe to show.
 *
 * Apify's error bodies are small JSON objects naming the fault ("actor not
 * found", "monthly usage hard limit exceeded"), which is exactly what an
 * operator needs. They are bounded and quoted rather than interpolated raw, so
 * an unexpected body cannot smuggle anything into a log line.
 */
function describeFailure(status: number, body: string): string {
  const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 300);
  return excerpt.length > 0 ? `HTTP ${status}: ${excerpt}` : `HTTP ${status}`;
}

async function apifyFetch(
  config: ApifyConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const token = requireToken(config);
  const { timeoutMs = 20_000, ...rest } = init;

  /*
   * A DEADLINE ON EVERY CALL. This runs inside a serverless invocation with a
   * wall clock of its own; a request that hangs would spend the whole budget
   * and return nothing, which reads to an operator as "the sync silently does
   * not work" rather than as "Apify did not answer".
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        ...(rest.headers ?? {}),
        /* THE ONLY PLACE THE TOKEN APPEARS. Never a query parameter. */
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? `Apify did not answer within ${Math.round(timeoutMs / 1000)}s.`
      : "Apify could not be reached.";
    throw new AiError("bad_request", reason, 502);
  } finally {
    clearTimeout(timer);
  }
}

function readRun(payload: unknown): ApifyRun {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data ?? {};

  const id = typeof data.id === "string" ? data.id : null;
  if (!id) {
    throw new AiError("bad_request", "Apify accepted the run but returned no run id.", 502);
  }

  const usage = data.usageTotalUsd;

  return {
    id,
    actorId: typeof data.actId === "string" ? data.actId : null,
    status: typeof data.status === "string" ? (data.status as ApifyRunState) : "FAILED",
    defaultDatasetId:
      typeof data.defaultDatasetId === "string" ? data.defaultDatasetId : null,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : null,
    finishedAt: typeof data.finishedAt === "string" ? data.finishedAt : null,
    usageTotalUsd: typeof usage === "number" && Number.isFinite(usage) ? usage : null,
  };
}

/**
 * Start one Actor run.
 *
 * ============================================================================
 * THREE CEILINGS, AND ONLY THE LAST ONE IS APIFY'S TO ENFORCE
 * ============================================================================
 *
 * `maxItems` is sent as a run parameter, so APIFY stops the run when it has
 * produced that many records — whatever the Actor's own input limits do. That
 * matters because the per-location limit is a request to third-party code, and
 * `maxItems` is a contract with the platform that bills us.
 *
 * `timeout` and `memory` bound the compute the run may consume. An Actor that
 * hangs stops costing money at the timeout rather than at the plan's limit.
 */
export async function startRun(
  config: ApifyConfig,
  options: StartRunOptions,
): Promise<ApifyRun> {
  const params = new URLSearchParams({
    timeout: String(config.timeoutSeconds),
    memory: String(config.memoryMbytes),
    maxItems: String(maxItemsForRun(options.limitPerLocation, options.locations)),
  });

  if (options.webhooks && options.webhooks.length > 0) {
    /*
     * AD-HOC WEBHOOKS, ATTACHED TO THIS RUN ONLY.
     *
     * Deliberately not a webhook configured once in the Apify account: one
     * attached to the run cannot fire for a run this system did not start, it
     * disappears with the run, and it means the Apify side holds no standing
     * configuration that could drift from what this code expects. Apify takes
     * them base64-encoded in a query parameter.
     */
    params.set(
      "webhooks",
      Buffer.from(JSON.stringify(options.webhooks), "utf8").toString("base64"),
    );
  }

  const response = await apifyFetch(config, `/acts/${config.actorId}/runs?${params}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.input),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = describeFailure(response.status, body);
    console.error(`[reviews/apify] could not start a run — ${detail}`);

    /*
     * 402 IS THE ONE AN OPERATOR CAN ACT ON IMMEDIATELY, so it is named rather
     * than folded into "Apify refused". It means the account's usage limit was
     * reached — the guardrails working at the platform's end.
     */
    if (response.status === 402) {
      throw new AiError(
        "bad_request",
        "Apify refused the run: the account's usage limit has been reached. No reviews were changed.",
        402,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new AiError(
        "bad_request",
        "Apify refused the credentials. Check APIFY_TOKEN, then try again. No reviews were changed.",
        502,
      );
    }
    throw new AiError(
      "bad_request",
      "Apify would not start the run. No reviews were changed.",
      502,
    );
  }

  return readRun(await response.json());
}

/** Ask Apify what a run actually did. Used to confirm a webhook, never to poll. */
export async function getRun(config: ApifyConfig, runId: string): Promise<ApifyRun | null> {
  const response = await apifyFetch(config, `/actor-runs/${encodeURIComponent(runId)}`);

  if (response.status === 404) return null;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `[reviews/apify] could not read run ${runId} — ${describeFailure(response.status, body)}`,
    );
    throw new AiError("bad_request", "Apify could not be asked about that run.", 502);
  }

  return readRun(await response.json());
}

/** The largest dataset this system will read in one run. A ceiling, not a target. */
export const MAX_DATASET_ITEMS = 5_000;
const DATASET_PAGE = 1_000;

/**
 * Read a run's dataset, server-side and bounded.
 *
 * THE WEBHOOK NEVER SUPPLIES THE ITEMS. It supplies, at most, a claim about
 * which run finished; the records are fetched here with this system's own
 * token, from the dataset Apify itself named. A payload posted by anybody who
 * guessed the URL therefore cannot introduce a single review.
 *
 * `MAX_DATASET_ITEMS` is a refusal rather than a truncation: a dataset larger
 * than any configuration here could have asked for means something is wrong
 * with the run, and quietly importing the first five thousand records of it
 * would hide that.
 */
export async function fetchDatasetItems(
  config: ApifyConfig,
  datasetId: string,
): Promise<unknown[]> {
  const items: unknown[] = [];

  for (let offset = 0; offset < MAX_DATASET_ITEMS; offset += DATASET_PAGE) {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(DATASET_PAGE),
      /* Skips the Actor's own empty and hidden records. */
      clean: "true",
      format: "json",
    });

    const response = await apifyFetch(
      config,
      `/datasets/${encodeURIComponent(datasetId)}/items?${params}`,
      { timeoutMs: 30_000 },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[reviews/apify] could not read dataset ${datasetId} — ${describeFailure(response.status, body)}`,
      );
      throw new AiError(
        "bad_request",
        "Apify finished the run but its results could not be read. Nothing has been changed.",
        502,
      );
    }

    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new AiError(
        "bad_request",
        "Apify returned results in a shape this system does not recognise. Nothing has been changed.",
        502,
      );
    }

    items.push(...page);
    if (page.length < DATASET_PAGE) return items;
  }

  throw new AiError(
    "bad_request",
    `The Apify run produced more than ${MAX_DATASET_ITEMS} records, which is more than any configured limit should allow. Nothing has been imported; check the run's input.`,
    502,
  );
}

/** Whether a run state means "finished, successfully". */
export function runSucceeded(status: ApifyRunState): boolean {
  return status === "SUCCEEDED";
}

/** Whether a run state means "still going", so nothing should be concluded yet. */
export function runInProgress(status: ApifyRunState): boolean {
  return status === "READY" || status === "RUNNING";
}
