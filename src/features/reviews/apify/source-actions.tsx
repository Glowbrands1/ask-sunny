"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
} from "@/components/ui/overlays";
import type { ApifyLocationMapping, ApifyTriggerResult } from "@/lib/reviews/apify/types";

/**
 * ============================================================================
 * THE CONTROLS THAT START AN APIFY RUN
 * ============================================================================
 *
 * ============================================================================
 * WHAT THESE BUTTONS DO NOT DECIDE
 * ============================================================================
 *
 * Nothing about cost, nothing about which locations are scraped, and nothing
 * about which reviews count. They post an intention; the server reads the
 * verified mapping, applies the per-location limit, takes the single-run lock
 * and checks the daily budget. A page is not a boundary.
 *
 * ============================================================================
 * THE DISABLED BUTTON IS A COURTESY, NOT THE LOCK
 * ============================================================================
 *
 * `busy` stops the obvious double-click. It does NOT stop two tabs, a cron tick
 * landing at the same moment, or a retried request — and none of those get past
 * `google_review_apify_claim_run`, which inserts into a table with a partial
 * unique index over the live run. The real answer to "did I just pay twice" is
 * in Postgres; this is what stops somebody having to find out.
 *
 * ============================================================================
 * AND NO SECRET IS EVER IN THIS FILE
 * ============================================================================
 *
 * `APIFY_TOKEN` and `APIFY_WEBHOOK_SECRET` are `server-only`. This component
 * posts to a session-authenticated admin route and is told what happened. It
 * could not reach Apify if it wanted to.
 */

interface ActionState {
  tone: "neutral" | "accent" | "attention";
  message: string;
}

async function post(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, body };
}

/** Turns a trigger outcome into the sentence an operator should read. */
function describeTrigger(result: ApifyTriggerResult | undefined, fallback: string): ActionState {
  if (!result) return { tone: "attention", message: fallback };

  return {
    tone:
      result.status === "started"
        ? "accent"
        : result.status === "already_running"
          ? "neutral"
          : "attention",
    message: result.message,
  };
}

export function SyncNowButtons({ liveRunId }: { liveRunId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<ActionState | null>(null);
  const [confirmBackfill, setConfirmBackfill] = useState(false);

  async function trigger(mode: "incremental" | "backfill") {
    setBusy(mode);
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/sync", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });

      setState(
        ok
          ? describeTrigger(
              body.run as ApifyTriggerResult | undefined,
              "The run was started.",
            )
          : {
              tone: "attention",
              message:
                typeof body.error === "string"
                  ? body.error
                  : "The sync could not be started. Nothing has been changed.",
            },
      );
      router.refresh();
    } catch {
      setState({
        tone: "attention",
        message: "The request did not reach Ask Sunny. Nothing has been started.",
      });
    } finally {
      setBusy(null);
      setConfirmBackfill(false);
    }
  }

  /**
   * SETTLE A RUN WHOSE WEBHOOK HAS NOT ARRIVED. Reads Apify and files what the
   * run produced; it starts nothing and spends no credit, which is why it is
   * safe as a button rather than something an operator has to wait out.
   */
  async function settle() {
    if (!liveRunId) return;
    setBusy("settle");
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/sync", {
        method: "PATCH",
        body: JSON.stringify({ runId: liveRunId }),
      });

      const result = body.result as { message?: string } | undefined;
      setState({
        tone: ok ? "accent" : "attention",
        message:
          result?.message ??
          (typeof body.error === "string" ? body.error : "The run could not be checked."),
      });
      router.refresh();
    } catch {
      setState({ tone: "attention", message: "The request did not reach Ask Sunny." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy !== null || liveRunId !== null}
          onClick={() => void trigger("incremental")}
        >
          {busy === "incremental" ? <Loader2 className="animate-spin" /> : null}
          Sync Google Reviews Now
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || liveRunId !== null}
          onClick={() => setConfirmBackfill(true)}
        >
          Import Google Review History via Apify
        </Button>

        {liveRunId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => void settle()}
          >
            {busy === "settle" ? <Loader2 className="animate-spin" /> : null}
            Check the running job
          </Button>
        ) : null}
      </div>

      {liveRunId ? (
        <Notice tone="neutral" icon={<Loader2 className="animate-spin" />}>
          A run is in progress. Apify will report back when it finishes — usually within a
          few minutes. Starting another would scrape and pay for the same reviews twice,
          so both buttons are closed until this one lands.
        </Notice>
      ) : null}

      {state ? (
        <Notice
          tone={state.tone}
          icon={state.tone === "attention" ? <AlertTriangle /> : <Check />}
        >
          {state.message}
        </Notice>
      ) : null}

      <Dialog open={confirmBackfill} onOpenChange={setConfirmBackfill}>
        <DialogContent title="Import Google review history">
          <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
            <p>
              This runs a deeper, one-off import across every verified location — up to the
              configured backfill limit per location, rather than the small recurring
              window. It costs more than a normal sync, which is why it is a separate
              button.
            </p>
            {/*
              THE SENTENCE THAT PRE-EMPTS THE SUPPORT QUESTION. A first import
              raising this week's official number by zero is the system working
              correctly, and somebody who has not been told that reads it as a
              failure — which is exactly what happened on the extension's first
              live run.
            */}
            <p className="text-foreground">
              Imported history is stored as <strong>historical</strong> and counts toward
              no reporting week. This week&rsquo;s official Google review total will not
              move, however many reviews arrive.
            </p>
          </div>
          <DialogActions>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void trigger("backfill")}
            >
              {busy === "backfill" ? <Loader2 className="animate-spin" /> : null}
              Import history
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * THE MAPPING FORM — one Google identifier per listing.
 *
 * WHAT IS PASTED IS NEVER TRUSTED. It is saved as `pending_verification`, which
 * takes part in no review run, and only a verification run against Google's own
 * answer can promote it. There is no control on this page that writes
 * `verified`, because the server has no field that accepts one.
 */
export function LocationMappingForm({
  locations,
  liveRunId,
}: {
  locations: ApifyLocationMapping[];
  liveRunId: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<ActionState | null>(null);

  const pending = locations.filter(
    (location) => location.sourceStatus === "pending_verification",
  );

  async function save() {
    const entries = Object.entries(values)
      .map(([storeCode, place]) => ({ storeCode, place: place.trim() }))
      .filter((entry) => entry.place.length > 0);

    if (entries.length === 0) {
      setState({ tone: "neutral", message: "Nothing to save." });
      return;
    }

    setBusy("save");
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/locations", {
        method: "POST",
        body: JSON.stringify({ locations: entries }),
      });

      const unreadable = Array.isArray(body.unreadable) ? (body.unreadable as string[]) : [];
      const outcomes = Array.isArray(body.outcomes)
        ? (body.outcomes as { storeCode: string; status: string; conflictsWith?: string }[])
        : [];
      const clashes = outcomes.filter((outcome) => outcome.status === "place_already_mapped");

      setState({
        tone: ok && unreadable.length === 0 && clashes.length === 0 ? "accent" : "attention",
        message: !ok
          ? typeof body.error === "string"
            ? body.error
            : "The mappings could not be saved."
          : [
              `${outcomes.filter((outcome) => outcome.status === "ok").length} saved as awaiting verification.`,
              unreadable.length > 0
                ? `No Place ID could be read for ${unreadable.join(", ")} — paste the Maps URL that contains place_id, or the Place ID itself.`
                : "",
              clashes.length > 0
                ? `Already mapped to another salon: ${clashes
                    .map((clash) => `${clash.storeCode} clashes with ${clash.conflictsWith}`)
                    .join("; ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
      });

      if (ok) setValues({});
      router.refresh();
    } catch {
      setState({ tone: "attention", message: "The request did not reach Ask Sunny." });
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setBusy("verify");
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/locations", {
        method: "PUT",
        body: JSON.stringify({}),
      });

      setState(
        ok
          ? describeTrigger(
              body.run as ApifyTriggerResult | undefined,
              "The check was started.",
            )
          : {
              tone: "attention",
              message:
                typeof body.error === "string" ? body.error : "The check could not be started.",
            },
      );
      router.refresh();
    } catch {
      setState({ tone: "attention", message: "The request did not reach Ask Sunny." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <th className="py-2 pr-3 font-semibold">Store code</th>
              <th className="py-2 pr-3 font-semibold">Salon</th>
              <th className="py-2 pr-3 font-semibold">State</th>
              <th className="py-2 font-semibold">Google Place ID or Maps URL</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.storeCode} className="border-b border-border/60">
                <td className="py-2 pr-3 font-mono text-[12px]">{location.storeCode}</td>
                <td className="py-2 pr-3">
                  {/*
                    BOTH NUMBERING SYSTEMS, SIDE BY SIDE. Google's 306 is salon
                    0462, and this is one of the two screens where somebody has
                    to be able to confirm that before acting.
                  */}
                  {location.locationName}
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {location.salonNumber ?? "—"}
                  </span>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {location.sourceStatus === "verified"
                    ? "Verified"
                    : location.sourceStatus === "pending_verification"
                      ? "Awaiting check"
                      : location.sourceStatus === "rejected"
                        ? "Rejected"
                        : "Not mapped"}
                </td>
                <td className="py-2">
                  <Input
                    value={values[location.storeCode] ?? ""}
                    placeholder={location.googlePlaceId ?? "ChIJ… or https://…place_id=ChIJ…"}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [location.storeCode]: event.target.value,
                      }))
                    }
                    className="h-8 font-mono text-[12px]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void save()}
        >
          {busy === "save" ? <Loader2 className="animate-spin" /> : null}
          Save identifiers
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy !== null || liveRunId !== null || pending.length === 0}
          onClick={() => void verify()}
        >
          {busy === "verify" ? <Loader2 className="animate-spin" /> : null}
          Check {pending.length} against Google
        </Button>
      </div>

      {state ? (
        <Notice
          tone={state.tone}
          icon={state.tone === "attention" ? <AlertTriangle /> : <Check />}
        >
          {state.message}
        </Notice>
      ) : null}
    </div>
  );
}
