import "server-only";

import { randomBytes } from "node:crypto";

import { leadershipHubUrl } from "@/lib/config/app-switcher";
import { MIN_SECRET_LENGTH, PARTNER_HEADERS, signPartnerRequest } from "./signature";

/**
 * ASK SUNNY'S SIDE OF THE LEADERSHIP HUB PARTNER API.
 *
 * The Hub is the only copy of every L10 meeting. Ask Sunny holds no meeting data, no Hub credential and no Hub
 * database key: it holds one shared secret (HUB_PARTNER_SECRET, server only) and signs each request with it. The
 * Hub's database then acts as the Hub account with the same email as the signed-in Ask Sunny user, checks that
 * account's meeting role and refuses every meeting not on its allowlist (only the STC DM L10).
 *
 * The email signed here is ALWAYS the verified session's (see `l10Viewer` in ../data.server.ts), never one that
 * came from the browser.
 *
 * Fails closed: without the secret the DM L10 tab does not render and every call answers "not configured".
 */
export const PARTNER_ID = "ask-sunny";
const TIMEOUT_MS = 15_000;

export function hubPartnerConfig(env: Record<string, string | undefined> = process.env): { baseUrl: string; secret: string } | null {
  const secret = env.HUB_PARTNER_SECRET?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return { baseUrl: leadershipHubUrl(), secret };
}

export type HubAnswer = { status: number; body: Record<string, unknown> };

/** One signed call. Network failures and timeouts come back as status 0, never as a throw. */
export async function callHub(op: string, email: string, args: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<HubAnswer> {
  const config = hubPartnerConfig();
  if (!config) return { status: 0, body: { error: "not_configured" } };
  const body = JSON.stringify({ ...args, op, email, nonce: randomBytes(16).toString("base64url") });
  const timestamp = String(Date.now());
  try {
    const res = await fetchImpl(`${config.baseUrl}/api/partner/l10`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        [PARTNER_HEADERS.partner]: PARTNER_ID,
        [PARTNER_HEADERS.timestamp]: timestamp,
        [PARTNER_HEADERS.signature]: signPartnerRequest(config.secret, PARTNER_ID, timestamp, body),
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body: json && typeof json === "object" ? json : {} };
  } catch {
    // Never log the request: it carries the person's email and the meeting's content.
    return { status: 0, body: { error: "unavailable" } };
  }
}
