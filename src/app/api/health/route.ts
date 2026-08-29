import { NextResponse } from "next/server";

import { getRateLimiter } from "@/lib/api/rate-limit";
import { authProviderStatus } from "@/lib/auth";
import {
  UNAUTHENTICATED_ESCAPE_HATCH,
  unauthenticatedAccessAllowed,
} from "@/lib/auth/server";
import { buildSecurityWarnings } from "@/lib/config/security-warnings";
import { liveReadiness } from "@/lib/config/server-env";

/**
 * GET /api/health
 *
 * Configuration readiness, by variable NAME only. No value of any environment
 * variable is read into the response, so this is safe to call from the admin
 * screen and safe to leave in a log.
 *
 * This reports whether the app is CONFIGURED. It does not claim any service has
 * been reached: a present key is not a working key, and this endpoint does not
 * pretend otherwise. `verified: false` says so in the payload itself.
 *
 * Deliberately unauthenticated: it is the screen an administrator uses to find
 * out why nothing works, which must keep working when authentication is the
 * thing that is broken. It discloses variable names, service names and model
 * names — facts already in the repository — and nothing else.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = liveReadiness();
  const auth = authProviderStatus();
  const escapeHatchOn = unauthenticatedAccessAllowed();

  /* Security warnings are separate from configuration problems: these are
     states that work but should not be trusted, rather than states that fail. */
  const securityWarnings = buildSecurityWarnings({
    mode: readiness.mode,
    authProviderKind: auth.kind,
    authIsProductionGrade: auth.productionGrade,
    unauthenticatedAccessAllowed: escapeHatchOn,
    escapeHatchVariableName: UNAUTHENTICATED_ESCAPE_HATCH,
  });

  return NextResponse.json({
    mode: readiness.mode,
    configured: readiness.ready,
    /* Names only. Never values. */
    missingEnvironmentVariables: readiness.missing,
    /* Misconfigurations that block live mode even when nothing is missing. */
    configurationProblems: readiness.problems,
    securityWarnings,
    services: {
      anthropic: {
        configured: readiness.anthropic.ready,
        missing: readiness.anthropic.missing,
      },
      voyage: {
        configured: readiness.voyage.ready,
        missing: readiness.voyage.missing,
      },
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
      authentication: {
        kind: auth.kind,
        name: auth.name,
        productionGrade: auth.productionGrade,
        missing: auth.missingConfiguration,
        detail: auth.detail,
        unauthenticatedAccessAllowed: escapeHatchOn,
      },
    },
    models: {
      claude: readiness.claudeModel,
      embedding: readiness.embeddingModel,
      embeddingDimensions: readiness.embeddingDimensions,
      embeddingDimensionMismatch: readiness.embeddingDimensionMismatch,
    },
    rateLimit: {
      name: getRateLimiter().name,
      /* False for the in-memory limiter: counters are per server instance. */
      distributed: getRateLimiter().distributed,
    },
    verified: false,
    note: "Reports configuration only. No request has been made to any external service.",
  });
}
