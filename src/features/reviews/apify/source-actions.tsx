"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";

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
 * ============================================================================
 * THE EXPECTED ADDRESS — the form that replaces hunting fifteen Place IDs
 * ============================================================================
 *
 * A Google Place ID is a value only Google holds, only a developer knows how to
 * extract, and nobody can check by looking. An address is on the front of the
 * building. Asking an operations manager for fifteen of the first thing was the
 * wrong question; this asks for the second.
 *
 * WHAT IT SAVES IS AN EXPECTATION, NOT A MAPPING. Nothing typed here attaches a
 * salon to a Google listing. It is what the next search is BUILT from and what
 * the candidates that come back are CHECKED against — and the database function
 * behind it has no access to the identifier or status columns at all, so no
 * amount of editing here can re-point a salon or promote a listing nobody
 * looked at.
 *
 * ============================================================================
 * CITY AND STATE ARE ALREADY THERE, SO MOST ROWS NEED ONE FIELD
 * ============================================================================
 *
 * Every listing has been seeded with its city and state since the first
 * migration. In practice a person fills in the street and the postcode and
 * leaves the rest alone, which is why the fields are pre-filled with what is
 * stored rather than left blank for re-typing.
 *
 * ONLY EDITED ROWS ARE SENT. An untouched row is not in `edits` and is not in
 * the request, so pressing Save cannot rewrite fourteen rows somebody did not
 * look at — and a field a person deliberately EMPTIED is sent as an empty
 * string, which clears it, because a wrong address has to be removable.
 */

interface AddressEdit {
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

function storedAddress(location: ApifyLocationMapping): AddressEdit {
  return {
    streetAddress: location.expectedStreetAddress ?? "",
    city: location.expectedCity ?? "",
    state: location.expectedState ?? "",
    postalCode: location.expectedPostalCode ?? "",
    country: location.expectedCountry ?? "",
  };
}

export function ExpectedAddressForm({ locations }: { locations: ApifyLocationMapping[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, AddressEdit>>({});
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionState | null>(null);

  const edited = Object.keys(edits);

  function change(location: ApifyLocationMapping, field: keyof AddressEdit, value: string) {
    setEdits((current) => ({
      ...current,
      [location.storeCode]: {
        ...(current[location.storeCode] ?? storedAddress(location)),
        [field]: value,
      },
    }));
  }

  function valueFor(location: ApifyLocationMapping, field: keyof AddressEdit): string {
    return (edits[location.storeCode] ?? storedAddress(location))[field];
  }

  async function save() {
    if (edited.length === 0) {
      setState({ tone: "neutral", message: "No address has been changed." });
      return;
    }

    setBusy(true);
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/locations", {
        method: "POST",
        body: JSON.stringify({
          addresses: edited.map((storeCode) => ({ storeCode, ...edits[storeCode] })),
        }),
      });

      const outcomes = Array.isArray(body.addressOutcomes)
        ? (body.addressOutcomes as { storeCode: string; status: string }[])
        : [];
      const saved = outcomes.filter((outcome) => outcome.status === "ok");
      const refused = outcomes.filter((outcome) => outcome.status !== "ok");

      setState({
        tone: ok && refused.length === 0 ? "accent" : "attention",
        message: !ok
          ? typeof body.error === "string"
            ? body.error
            : "The addresses could not be saved."
          : [
              `${saved.length} address${saved.length === 1 ? "" : "es"} saved.`,
              refused.length > 0
                ? `Not saved: ${refused
                    .map((outcome) => `${outcome.storeCode} (${outcome.status.replace(/_/g, " ")})`)
                    .join("; ")}.`
                : "Search again to find the Google listings at these addresses.",
            ]
              .filter(Boolean)
              .join(" "),
      });

      if (ok && refused.length === 0) setEdits({});
      router.refresh();
    } catch {
      setState({ tone: "attention", message: "The request did not reach Ask Sunny." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
              <th className="py-2 pr-3 font-semibold">Store</th>
              <th className="py-2 pr-3 font-semibold">Salon</th>
              <th className="py-2 pr-3 font-semibold">Street address</th>
              <th className="py-2 pr-3 font-semibold">City</th>
              <th className="py-2 pr-3 font-semibold">State</th>
              <th className="py-2 pr-3 font-semibold">ZIP</th>
              <th className="py-2 font-semibold">Country</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={location.storeCode} className="border-b border-border/60">
                <td className="py-2 pr-3 font-mono text-[12px]">{location.storeCode}</td>
                <td className="py-2 pr-3">
                  {location.locationName}
                  {/*
                    BOTH NUMBERING SYSTEMS, SIDE BY SIDE. Google's store 306 is
                    ASK Sunny's salon 0462, and somebody typing an address for
                    one has to be able to see they are typing it for the other.
                  */}
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                    {location.salonNumber ?? "—"}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={valueFor(location, "streetAddress")}
                    placeholder="2624 Iowa St Ste B"
                    onChange={(event) => change(location, "streetAddress", event.target.value)}
                    className="h-8 min-w-[220px] text-[12px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={valueFor(location, "city")}
                    placeholder="Lawrence"
                    onChange={(event) => change(location, "city", event.target.value)}
                    className="h-8 min-w-[130px] text-[12px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={valueFor(location, "state")}
                    placeholder="KS"
                    onChange={(event) => change(location, "state", event.target.value)}
                    className="h-8 w-[70px] text-[12px]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <Input
                    value={valueFor(location, "postalCode")}
                    placeholder="66046"
                    onChange={(event) => change(location, "postalCode", event.target.value)}
                    className="h-8 w-[90px] text-[12px]"
                  />
                </td>
                <td className="py-2">
                  <Input
                    value={valueFor(location, "country")}
                    placeholder="United States"
                    onChange={(event) => change(location, "country", event.target.value)}
                    className="h-8 min-w-[140px] text-[12px]"
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
          variant="primary"
          size="sm"
          disabled={busy || edited.length === 0}
          onClick={() => void save()}
        >
          {busy ? <Loader2 className="animate-spin" /> : <MapPin />}
          Save {edited.length === 0 ? "expected addresses" : `${edited.length} expected address${edited.length === 1 ? "" : "es"}`}
        </Button>
        <span className="text-[11.5px] text-muted-foreground">
          Saving an address maps nothing. It is what the next search looks for.
        </span>
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

/**
 * THE ONE-CLICK SETUP: search Google for all fifteen, then accept what was
 * unambiguous.
 *
 * ============================================================================
 * TWO BUTTONS, AND ONLY ONE OF THEM SPENDS ANYTHING
 * ============================================================================
 *
 * DISCOVER starts one Apify run against a places Actor — one search per salon,
 * built from the roster. It writes proposals and maps nothing.
 *
 * VERIFY ALL SAFE MATCHES costs nothing at all. The evidence — Google's own
 * name and address — was captured when the candidate was found, so accepting
 * fourteen locations is a database write rather than fourteen more Actor runs.
 * That is why it can be pressed freely, and why discovery is worth doing in one
 * pass rather than a salon at a time.
 *
 * ============================================================================
 * THE COUNT ON THE BUTTON IS THE SAFE SET, NOT THE TOTAL
 * ============================================================================
 *
 * It names how many listings matched exactly one Google result that matched no
 * other salon. Anything ambiguous, not found, or flagged by Google is excluded
 * — and is excluded again by the database function, because a label on a button
 * is not a boundary.
 */
export function DiscoveryActions({
  liveRunId,
  safeMatchCount,
  unresolvedCount,
  searchableCount,
  rediscoverableCount,
}: {
  liveRunId: string | null;
  safeMatchCount: number;
  unresolvedCount: number;
  searchableCount: number;
  /**
   * How many listings a second pass would actually search: the ones still
   * unanswered. It is smaller than `searchableCount` by everything already
   * verified, already proposed, or waiting on a check — which is the entire
   * point of the button it labels.
   */
  rediscoverableCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [state, setState] = useState<ActionState | null>(null);

  async function discover(mode: "discover" | "rediscover") {
    setBusy(mode);
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/locations", {
        method: "PUT",
        body: JSON.stringify({ mode }),
      });

      setState(
        ok
          ? describeTrigger(
              body.run as ApifyTriggerResult | undefined,
              "The search was started.",
            )
          : {
              tone: "attention",
              message:
                typeof body.error === "string"
                  ? body.error
                  : "The search could not be started. Nothing has been changed.",
            },
      );
      router.refresh();
    } catch {
      setState({ tone: "attention", message: "The request did not reach Ask Sunny." });
    } finally {
      setBusy(null);
    }
  }

  async function acceptSafe() {
    setBusy("accept");
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/locations", {
        method: "PATCH",
        body: JSON.stringify({}),
      });

      const outcomes = Array.isArray(body.outcomes)
        ? (body.outcomes as { storeCode: string; status: string; conflictsWith?: string }[])
        : [];
      const verified = outcomes.filter((outcome) => outcome.status === "verified");
      const refused = outcomes.filter((outcome) => outcome.status !== "verified");

      setState({
        tone: ok && refused.length === 0 ? "accent" : ok ? "neutral" : "attention",
        message: !ok
          ? typeof body.error === "string"
            ? body.error
            : "The locations could not be confirmed."
          : [
              `${verified.length} location${verified.length === 1 ? "" : "s"} verified and ready to sync.`,
              refused.length > 0
                ? `${refused.length} refused: ${refused
                    .map((outcome) =>
                      outcome.conflictsWith
                        ? `${outcome.storeCode} clashes with ${outcome.conflictsWith}`
                        : `${outcome.storeCode} (${outcome.status.replace(/_/g, " ")})`,
                    )
                    .join("; ")}.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
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
          disabled={busy !== null || liveRunId !== null || searchableCount === 0}
          onClick={() => void discover("discover")}
        >
          {busy === "discover" ? <Loader2 className="animate-spin" /> : <Search />}
          Discover Google Listings for All {searchableCount} Locations
        </Button>

        {/*
          THE SECOND PASS, AND IT COSTS A FRACTION OF THE FIRST.

          The shape of this work is: search everything, get most of them, type
          street addresses for the ones that failed, search again. Searching all
          fifteen the second time pays again for the answers that were already
          right — so this searches only what is still unresolved, and says how
          many that is on the button rather than making somebody guess.
        */}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || liveRunId !== null || rediscoverableCount === 0}
          onClick={() => void discover("rediscover")}
        >
          {busy === "rediscover" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Rediscover Unresolved Locations ({rediscoverableCount})
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || safeMatchCount === 0}
          onClick={() => void acceptSafe()}
        >
          {busy === "accept" ? <Loader2 className="animate-spin" /> : <Check />}
          Verify All Safe Matches ({safeMatchCount})
        </Button>
      </div>

      {unresolvedCount > 0 ? (
        <Notice tone="neutral" icon={<Info />}>
          {unresolvedCount} location{unresolvedCount === 1 ? "" : "s"} could not be resolved
          automatically. Add a street address for each above and press{" "}
          <strong>Rediscover Unresolved Locations</strong> — that is almost always what a
          listing was missing. Pasting a Place ID by hand stays available below as the
          fallback. Nothing ambiguous is ever attached on its own.
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
    </div>
  );
}

/**
 * THE MAPPING FORM — one Google identifier per listing.
 *
 * THE FALLBACK, not the main path. Discovery resolves most listings; this is
 * for the ones it reported as ambiguous or not found, and for re-pointing a
 * salon whose Google listing moved.
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
