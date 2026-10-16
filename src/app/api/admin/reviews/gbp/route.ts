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
import { readApifySourceStatus } from "@/lib/reviews/apify/status";
import { GBP_PUBSUB_TOPIC_ENV, isProductionRuntime, readSyncMode } from "@/lib/reviews/gbp/config";
import { isSameOriginRequest } from "@/lib/reviews/gbp/csrf";
import { discoverFromGoogle } from "@/lib/reviews/gbp/discovery";
import { isManuallyConfirmable } from "@/lib/reviews/gbp/locations";
import { apifyGlance, loadGbpOverview } from "@/lib/reviews/gbp/overview-load";
import { buildGbpRuntime } from "@/lib/reviews/gbp/runtime";
import { createSupabaseStore } from "@/lib/reviews/gbp/store";
import { runGbpSync } from "@/lib/reviews/gbp/sync";

/**
 * /api/admin/reviews/gbp — the Business Profile integration's controls. Requires
 * `manage_integrations`. The admin screen calls these; nobody types a URL.
 *
 *   GET                                  the overview (status, 15 listings, runs, readiness)
 *   POST { action: "discover" }          ask Google for locations and PROPOSE mappings; writes nothing
 *   POST { action: "confirm", storeCode, locationName, manual? }
 *                                        confirm ONE mapping from FRESH evidence: `eligible`, or —
 *                                        with manual:true — a listing whose only gap is missing
 *                                        corroboration (a person compared the address)
 *   POST { action: "confirm_all" }       confirm every `eligible` proposal, each re-checked
 *   POST { action: "unlink", storeCode } stop a listing syncing (refused while reviews are linked)
 *   POST { action: "dry_run", scope?, storeCodes?, from?, to? }
 *                                        full reconciliation report; no review data is written
 *   POST { action: "sync", confirm: true, scope?, storeCodes? }
 *                                        files reviews. Needs confirm:true AND GBP_SYNC_MODE=live
 *   POST { action: "configure_notifications", accountName }
 *                                        points Google's notification setting at GBP_PUBSUB_TOPIC
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");
    /* Reading state needs no Google credential, so it must not demand one. */
    const overview = await loadGbpOverview(apifyGlance(await readApifySourceStatus()));
    return NextResponse.json({ status: "ok", overview });
  } catch (error) {
    return errorResponse(error, "admin/reviews/gbp");
  }
}

const SCOPES = new Set(["incremental", "backfill"]);
const WRITE_REFUSED = "Mappings can only be changed from the production deployment.";

export async function POST(request: Request) {
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ status: "refused", reason: "Cross-site request refused." }, { status: 403 });
    }
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");
    const actor = context.identity.email || context.identity.subject;

    const body = await parseJsonBody<{
      action?: unknown;
      scope?: unknown;
      storeCodes?: unknown;
      storeCode?: unknown;
      locationName?: unknown;
      accountName?: unknown;
      from?: unknown;
      to?: unknown;
      manual?: unknown;
      confirm?: unknown;
    }>(request);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "unlink") {
      if (!isProductionRuntime()) return NextResponse.json({ status: "refused", reason: WRITE_REFUSED }, { status: 409 });
      const storeCode = typeof body.storeCode === "string" ? body.storeCode.trim() : "";
      const outcome = await createSupabaseStore().clearMapping(storeCode, actor);
      return NextResponse.json({ status: outcome === "cleared" ? "ok" : "refused", outcome }, { status: outcome === "cleared" ? 200 : 409 });
    }

    const deps = await buildGbpRuntime();

    if (action === "discover" || action === "confirm" || action === "confirm_all") {
      /* The switch that makes the whole integration inert also silences discovery. */
      if (readSyncMode() === "off") {
        return NextResponse.json({ status: "disabled", reason: "GBP_SYNC_MODE is off, so nothing reaches Google." }, { status: 409 });
      }
      const discovery = await discoverFromGoogle(deps.client, deps.store);

      if (action === "discover") {
        return NextResponse.json({
          status: "ok",
          accounts: discovery.accounts,
          counts: discovery.counts,
          proposals: discovery.proposals,
          missing: discovery.missing,
        });
      }

      if (!isProductionRuntime()) {
        /* Preview shares the production database: mapping changes are a write. */
        return NextResponse.json({ status: "refused", reason: WRITE_REFUSED }, { status: 409 });
      }

      if (action === "confirm_all") {
        const outcomes: { storeCode: string; outcome: string }[] = [];
        for (const proposal of discovery.proposals) {
          if (proposal.verdict !== "eligible" || !proposal.storeCode) continue;
          const outcome = await deps.store.confirmMapping({
            storeCode: proposal.storeCode,
            accountName: proposal.accountName,
            locationName: proposal.googleLocationName,
            placeId: proposal.placeId,
            evidence: { storeCode: true, uniqueStoreCode: true, corroborated: true, title: proposal.title, bulk: true },
            confirmedBy: actor,
          });
          outcomes.push({ storeCode: proposal.storeCode, outcome });
        }
        return NextResponse.json({ status: "ok", confirmed: outcomes.filter((o) => o.outcome === "confirmed").length, outcomes });
      }

      const storeCode = typeof body.storeCode === "string" ? body.storeCode.trim() : "";
      const locationName = typeof body.locationName === "string" ? body.locationName.trim() : "";
      const manual = body.manual === true;
      const proposal = discovery.proposals.find((p) => p.storeCode === storeCode && p.googleLocationName === locationName);
      /*
       * FRESH EVIDENCE ONLY. `eligible` (store code, uniqueness and place id or
       * address all agree) confirms. A listing whose only gap is missing
       * corroboration confirms only when a person says they compared it
       * (`manual`). A conflict never confirms.
       */
      const confirmable = !!proposal && (proposal.verdict === "eligible" || (manual && isManuallyConfirmable(proposal)));
      if (!proposal || !confirmable) {
        return NextResponse.json(
          { status: "refused", verdict: proposal?.verdict ?? "not_found", reasons: proposal?.reasons ?? ["no_matching_google_location"] },
          { status: 409 },
        );
      }
      const outcome = await deps.store.confirmMapping({
        storeCode,
        accountName: proposal.accountName,
        locationName,
        placeId: proposal.placeId,
        evidence: { storeCode: true, uniqueStoreCode: true, corroborated: proposal.verdict === "eligible", manual: proposal.verdict !== "eligible", title: proposal.title },
        confirmedBy: actor,
      });
      return NextResponse.json({ status: outcome === "confirmed" ? "ok" : "refused", outcome }, { status: outcome === "confirmed" ? 200 : 409 });
    }

    if (action === "dry_run" || action === "sync") {
      if (action === "sync" && body.confirm !== true) {
        return NextResponse.json(
          { status: "confirmation_required", reason: "Saving needs an explicit confirmation. Nothing was read or saved." },
          { status: 409 },
        );
      }
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
