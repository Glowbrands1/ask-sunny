import "server-only";

import { AiError } from "@/lib/ai/errors";
import { createTokenProvider } from "./auth";
import { createGbpClient, type GbpClient } from "./client";
import {
  GBP_TOKEN_ENCRYPTION_KEY_ENV,
  missingCredentialNames,
  readLimits,
  readOAuthClient,
  type GbpLimits,
} from "./config";
import { REFRESH_TOKEN_LABEL, SealError, open, readEncryptionKey } from "./crypto";
import { GbpApiError } from "./http";
import { createSupabaseStore, type GbpStore } from "./store";

export interface GbpRuntime {
  client: GbpClient;
  store: GbpStore;
  limits: GbpLimits;
  connectionId: string;
}

/**
 * Wires the real client and store. The refresh token is read from the database
 * (sealed) at the moment of an exchange; it is never in the environment.
 */
export async function buildGbpRuntime(): Promise<GbpRuntime> {
  const oauth = readOAuthClient();
  if (!oauth || !process.env[GBP_TOKEN_ENCRYPTION_KEY_ENV]?.trim()) {
    throw new AiError(
      "not_configured",
      "The Google Business Profile OAuth client is not configured.",
      503,
      missingCredentialNames(),
    );
  }
  const store = createSupabaseStore();
  const connection = await store.getActiveConnection();
  if (!connection) {
    throw new AiError(
      "not_configured",
      "No Google account is connected. An administrator must connect one (Connect Google account).",
      409,
    );
  }
  const limits = readLimits();
  const key = (() => {
    try {
      return readEncryptionKey();
    } catch (error) {
      /* A key problem is a configuration problem, not a Google problem; the connection is NOT ended. */
      throw new AiError("not_configured", error instanceof SealError ? error.message : "The token key is unusable.", 503, [
        GBP_TOKEN_ENCRYPTION_KEY_ENV,
      ]);
    }
  })();
  const tokens = createTokenProvider(oauth, async () => {
    try {
      return open(connection.refreshTokenSealed, REFRESH_TOKEN_LABEL, key);
    } catch {
      throw new GbpApiError("auth_failed", "The saved Google authorization could not be opened.");
    }
  });
  const client = createGbpClient({ tokens, maxRequests: limits.maxRequestsPerRun });
  return { client, store, limits, connectionId: connection.id };
}
