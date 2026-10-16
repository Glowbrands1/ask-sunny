import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api/respond";
import {
  GBP_PUBSUB_AUDIENCE_ENV,
  GBP_PUBSUB_SERVICE_ACCOUNT_ENV,
  readSyncMode,
} from "@/lib/reviews/gbp/config";
import { parsePushEnvelope, verifyPubSubRequest } from "@/lib/reviews/gbp/pubsub";
import { buildGbpRuntime } from "@/lib/reviews/gbp/runtime";
import { runGbpSync } from "@/lib/reviews/gbp/sync";

/**
 * POST /api/reviews/gbp/pubsub — Google Pub/Sub push for NEW_REVIEW and
 * UPDATED_REVIEW.
 *
 * AUTHENTICATED BY GOOGLE'S OIDC TOKEN, not by anything in the body — see
 * `verifyPubSubRequest`. The message only says WHICH listing changed; the route
 * answers by running the normal bounded sync for that one listing, so a forged,
 * duplicated or reordered message cannot write anything a scheduled run would
 * not.
 *
 * ACK SEMANTICS. 2xx acknowledges (Pub/Sub stops retrying); 5xx asks for a
 * redelivery. A message for a listing we do not sync — another brand, or one no
 * person has confirmed — is ACKNOWLEDGED, because retrying it cannot succeed.
 * A transient Google or database failure is NOT acknowledged, so it is retried.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await verifyPubSubRequest(request.headers.get("authorization"), {
    audience: process.env[GBP_PUBSUB_AUDIENCE_ENV],
    serviceAccount: process.env[GBP_PUBSUB_SERVICE_ACCOUNT_ENV],
  });
  if (auth === "unconfigured") {
    return NextResponse.json({ status: "not_configured", code: "pubsub_auth_missing" }, { status: 503 });
  }
  if (auth !== "ok") return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  if (readSyncMode() === "off") {
    return new NextResponse(null, { status: 204 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "bad_request" }, { status: 400 });
  }

  const parsed = parsePushEnvelope(body);
  /* Malformed and permanent: acknowledge so it does not loop forever. */
  if (!parsed.ok) return new NextResponse(null, { status: 204 });

  try {
    const runtimeDeps = buildGbpRuntime();
    const mappings = await runtimeDeps.store.readConfirmedMappings();
    const mapping = mappings.find(
      (m) => m.accountName === parsed.accountName && m.gbpLocationName === parsed.locationName,
    );
    if (!mapping) return new NextResponse(null, { status: 204 });

    const report = await runGbpSync(
      { requestedMode: "live", scope: "incremental", trigger: "pubsub", storeCodes: [mapping.storeCode] },
      runtimeDeps,
    );
    if (report.status === "failed" || report.status === "partial") {
      return NextResponse.json({ status: report.status }, { status: 500 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "reviews/gbp/pubsub");
  }
}
