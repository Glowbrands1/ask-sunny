import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { isSameOriginRequest } from "@/lib/reviews/gbp/csrf";
import { GBP_PUBSUB_TOPIC_ENV, isProductionRuntime, readSyncMode } from "@/lib/reviews/gbp/config";
import { discoverMappings } from "@/lib/reviews/gbp/locations";
import { buildGbpRuntime } from "@/lib/reviews/gbp/runtime";
import { createSupabaseStore } from "@/lib/reviews/gbp/store";
import { runGbpSync } from "@/lib/reviews/gbp/sync";

/**
 * /api/admin/reviews/gbp — the operator's console for the Business Profile
 * integration. Requires `manage_integrations`.
 *
 *   GET                           mapping state held in the database (no Google call)
 *   POST { action: "discover" }   ask Google for locations; PROPOSE mappings; writes nothing
 *   POST { action: "confirm", storeCode, locationName }
 *                                 confirm ONE mapping, only if discovery still rates it `eligible`
 *   POST { action: "dry_run", scope?, storeCodes?, from?, to? }
 *                                 from/to (YYYY-MM-DD) add an `inWindow` summary, e.g. 2026-09-01..2026-11-01
 *                                 full reconciliation report; writes nothing
 *   POST { action: "sync", scope?, storeCodes? }
 *                                 files reviews. Refused unless GBP_SYNC_MODE=live
 *   POST { action: "configure_notifications", accountName }
 *                                 points Google's notification setting at GBP_PUBSUB_TOPIC
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    /* Reading mapping state needs no Google credential, so it must not demand one. */
    const store = createSupabaseStore();
    const listings = await store.readListings();
    return NextResponse.json({
      status: "ok",
      mode: readSyncMode(),
      listings: listings.map((l) => ({
        storeCode: l.storeCode,
        label: l.googleLocationLabel,
        confirmed: l.confirmedLocationName !== null,
        isActive: l.isActive,
      })),
    });
  } catch (error) {
    return errorResponse(error, "admin/reviews/gbp");
  }
}

const SCOPES = new Set(["incremental", "backfill"]);

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ status: "refused", reason: "Cross-site request refused." }, { status: 403 });
    }
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{
      action?: unknown;
      scope?: unknown;
      storeCodes?: unknown;
      storeCode?: unknown;
      locationName?: unknown;
      accountName?: unknown;
      from?: unknown;
      to?: unknown;
    }>(request);
    const action = typeof body.action === "string" ? body.action : "";
    const deps = await buildGbpRuntime();

    if (action === "discover" || action === "confirm") {
      const listings = await deps.store.readListings();
      const accounts = await deps.client.listAccounts();
      const found: { accountName: string; location: Awaited<ReturnType<typeof deps.client.listLocations>>[number] }[] = [];
      for (const account of accounts) {
        for (const location of await deps.client.listLocations(account.name)) {
          found.push({ accountName: account.name, location });
        }
      }
      const discovery = discoverMappings(
        found.map((f) => f.location),
        listings,
      );

      if (action === "discover") {
        return NextResponse.json({
          status: "ok",
          accounts: accounts.length,
          counts: discovery.counts,
          proposals: discovery.proposals,
          missing: discovery.missing,
        });
      }

      if (!isProductionRuntime()) {
        /* Preview shares the production database: mapping changes are a write. */
        return NextResponse.json({ status: "refused", reason: "Mappings can only be confirmed from the production deployment." }, { status: 409 });
      }
      const storeCode = typeof body.storeCode === "string" ? body.storeCode.trim() : "";
      const locationName = typeof body.locationName === "string" ? body.locationName.trim() : "";
      const proposal = discovery.proposals.find(
        (p) => p.storeCode === storeCode && p.googleLocationName === locationName,
      );
      /* Confirmable only on a FRESH `eligible` verdict: store code, uniqueness and place id all agree. */
      if (!proposal || proposal.verdict !== "eligible") {
        return NextResponse.json(
          {
            status: "refused",
            verdict: proposal?.verdict ?? "not_found",
            reasons: proposal?.reasons ?? ["no_matching_google_location"],
          },
          { status: 409 },
        );
      }
      const owner = found.find((f) => f.location.name === locationName)!;
      const outcome = await deps.store.confirmMapping({
        storeCode,
        accountName: owner.accountName,
        locationName,
        placeId: proposal.placeId,
        evidence: { storeCode: true, uniqueStoreCode: true, placeIdMatchesVerified: true, title: proposal.title },
        confirmedBy: context.identity.email || context.identity.subject,
      });
      return NextResponse.json({ status: outcome === "confirmed" ? "ok" : "refused", outcome }, { status: outcome === "confirmed" ? 200 : 409 });
    }

    if (action === "dry_run" || action === "sync") {
      const scope = typeof body.scope === "string" && SCOPES.has(body.scope) ? (body.scope as "incremental" | "backfill") : "incremental";
      const storeCodes = Array.isArray(body.storeCodes)
        ? body.storeCodes.filter((c): c is string => typeof c === "string" && /^[0-9]{1,8}$/.test(c)).slice(0, 20)
        : undefined;
      const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
      const window = isDay(body.from) && isDay(body.to) && body.from < body.to ? { from: body.from, to: body.to } : undefined;
      const report = await runGbpSync(
        { requestedMode: action === "sync" ? "live" : "dry_run", scope, trigger: "admin", storeCodes, window },
        deps,
      );
      return NextResponse.json({ status: "ok", report });
    }

    if (action === "configure_notifications") {
      if (!isProductionRuntime()) {
        return NextResponse.json({ status: "refused", reason: "Notifications can only be configured from the production deployment." }, { status: 409 });
      }
      const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
      const topic = process.env[GBP_PUBSUB_TOPIC_ENV];
      if (!topic) throw new AiError("not_configured", "The Pub/Sub topic is not configured.", 503, [GBP_PUBSUB_TOPIC_ENV]);
      /*
       * A Business Profile ACCOUNT has exactly ONE notification setting, and the
       * Glow Brands account is shared with Ask Bubbles. Overwriting it would
       * silently redirect (or break) the other app's notifications, so this
       * refuses unless no topic is set yet or it is already this topic. Sharing
       * one topic between the apps is done with a second SUBSCRIPTION, not by
       * re-pointing the account.
       */
      const current = await deps.client.getNotificationSetting(accountName);
      if (current?.pubsubTopic && current.pubsubTopic !== topic) {
        return NextResponse.json(
          {
            status: "refused",
            reason: "This account already notifies a different Pub/Sub topic. Add a subscription to that topic instead of changing it.",
            currentTopic: current.pubsubTopic,
          },
          { status: 409 },
        );
      }
      if (current?.pubsubTopic === topic) return NextResponse.json({ status: "ok", unchanged: true });
      await deps.client.setNotificationSetting(accountName, topic);
      return NextResponse.json({ status: "ok" });
    }

    throw new AiError("bad_request", "Unknown action.", 400);
  } catch (error) {
    return errorResponse(error, "admin/reviews/gbp");
  }
}
