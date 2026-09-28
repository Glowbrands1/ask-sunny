import "server-only";

import { parseIngestCredentials, verifyIngestSecret } from "@/lib/reporting/ingest-credential";

/**
 * THE SCHEDULED-INVOCATION CREDENTIAL, for cron routes added after the Google
 * review sync.
 *
 * `CRON_SECRET` is Vercel's own convention: Vercel sends it as
 * `Authorization: Bearer …` on scheduled invocations. It is verified with the
 * same constant-time comparison every other machine credential here uses, and
 * a deployment without it refuses every call — an unauthenticated cron route
 * is a public button.
 *
 * `/api/reviews/apify/cron` keeps its own copy of this check; it is not
 * rewired here, so that route's behaviour is untouched by this addition.
 */
export const CRON_SECRET_ENV = "CRON_SECRET";

export type CronAuthorization = "ok" | "unauthorized" | "unconfigured";

export async function authorizeCronRequest(request: Request): Promise<CronAuthorization> {
  const credentials = parseIngestCredentials(process.env[CRON_SECRET_ENV], "cron");
  if (credentials.length === 0) return "unconfigured";

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  const presented = bearer ? bearer[1].trim() : null;

  const { authorized } = await verifyIngestSecret(presented, credentials);
  return authorized ? "ok" : "unauthorized";
}
