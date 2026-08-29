import { NextResponse } from "next/server";

import { liveReadiness } from "@/lib/config/server-env";

/**
 * GET /api/health
 *
 * Configuration readiness, by variable NAME only. No value of any environment
 * variable is read into the response, so this is safe to call from the
 * Integrations screen and safe to leave in a log.
 *
 * This reports whether the app is CONFIGURED. It does not claim any service has
 * been reached: a present key is not a working key, and this endpoint does not
 * pretend otherwise.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = liveReadiness();

  return NextResponse.json({
    mode: readiness.mode,
    configured: readiness.ready,
    /* Names only. Never values. */
    missingEnvironmentVariables: readiness.missing,
    /* Misconfigurations that block live mode even when nothing is missing. */
    configurationProblems: readiness.problems,
    services: {
      anthropic: { configured: readiness.anthropic.ready, missing: readiness.anthropic.missing },
      voyage: { configured: readiness.voyage.ready, missing: readiness.voyage.missing },
      supabase: {
        configured: readiness.supabase.ready,
        missing: readiness.supabase.missing,
        /* Which variable name supplied the privileged key. Never the value. */
        secretKeySource: readiness.supabaseSecretKeySource,
        browserPublishableKey: {
          configured: readiness.supabaseBrowserKey.ready,
          requiredNow: readiness.supabaseBrowserKey.requiredNow,
          note: "Reserved for the browser client that arrives with authentication. Nothing reads it yet, so it does not block live mode.",
        },
      },
    },
    models: {
      claude: readiness.claudeModel,
      embedding: readiness.embeddingModel,
      embeddingDimensions: readiness.embeddingDimensions,
      embeddingDimensionMismatch: readiness.embeddingDimensionMismatch,
    },
    verified: false,
    note: "Reports configuration only. No request has been made to any external service.",
  });
}
