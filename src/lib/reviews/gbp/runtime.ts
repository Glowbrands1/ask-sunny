import "server-only";

import { AiError } from "@/lib/ai/errors";
import { createTokenProvider } from "./auth";
import { createGbpClient, type GbpClient } from "./client";
import { missingCredentialNames, readCredentials, readLimits, type GbpLimits } from "./config";
import { createSupabaseStore, type GbpStore } from "./store";

/** Wires the real client and store. Routes call this; tests build their own deps. */
export function buildGbpRuntime(): { client: GbpClient; store: GbpStore; limits: GbpLimits } {
  const credentials = readCredentials();
  if (!credentials) {
    throw new AiError(
      "not_configured",
      "The Google Business Profile credentials are not configured.",
      503,
      missingCredentialNames(),
    );
  }
  const limits = readLimits();
  const client = createGbpClient({
    tokens: createTokenProvider(credentials),
    maxRequests: limits.maxRequestsPerRun,
  });
  return { client, store: createSupabaseStore(), limits };
}
