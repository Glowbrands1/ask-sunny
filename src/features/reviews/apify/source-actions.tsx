"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  Check,
  History,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
} from "@/components/ui/overlays";
import {
  addressChanges,
  parseGoogleAddress,
  UNITED_STATES,
  type AddressFieldChange,
  type ParsedAddress,
} from "@/lib/reviews/apify/address-parse";
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
 * ONE PASTE PER SALON, NOT FIVE FIELDS
 * ============================================================================
 *
 * The address is already on the clipboard in one line. Typing it back out as
 * street, city, state, ZIP and country, fifteen times, is seventy-five fields
 * of transcription and seventy-five chances to fat-finger a house number that
 * the Google search is then built from.
 *
 * So each salon takes the whole line, splits it, and fills the five fields —
 * which stay editable, because a parser that is right nineteen times out of
 * twenty still needs the twentieth correcting by hand.
 *
 * ============================================================================
 * WHEN IT FILLS ON ITS OWN, AND WHEN IT ASKS
 * ============================================================================
 *
 * IT FILLS IMMEDIATELY when the parse is confident AND every field it would
 * write is empty. There is nothing to lose, the result is visible in the fields
 * themselves, and a confirmation line names what landed where.
 *
 * IT ASKS FIRST when it would REPLACE something somebody already typed, or when
 * the parse is doubtful. They put that value there on purpose and a paste that
 * quietly overwrote it would be a loss nobody saw — so the preview names every
 * field, shows the old value beside the new one, and waits for a press.
 *
 * ============================================================================
 * AND THE COUNTRY IS THE CALLER'S TO SUPPLY
 * ============================================================================
 *
 * A Maps copy usually omits it. The parser does not invent one; this fills
 * "United States" only where the salon is ALREADY on record as trading there,
 * which is all fifteen — seeded by the migration rather than assumed here.
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

/** A parse waiting on a person, because it would overwrite or it is doubtful. */
interface PendingParse {
  parsed: ParsedAddress;
  changes: AddressFieldChange[];
}

export function ExpectedAddressForm({ locations }: { locations: ApifyLocationMapping[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, AddressEdit>>({});
  const [pasted, setPasted] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, PendingParse>>({});
  const [filled, setFilled] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ActionState | null>(null);

  const edited = Object.keys(edits);

  function valuesFor(location: ApifyLocationMapping): AddressEdit {
    return edits[location.storeCode] ?? storedAddress(location);
  }

  function change(location: ApifyLocationMapping, field: keyof AddressEdit, value: string) {
    setEdits((current) => ({
      ...current,
      [location.storeCode]: { ...valuesFor(location), [field]: value },
    }));
  }

  /** Write a set of parsed changes into the fields, and say what landed. */
  function apply(location: ApifyLocationMapping, changes: AddressFieldChange[]) {
    const next = { ...valuesFor(location) };
    for (const item of changes) next[item.field] = item.to;

    setEdits((current) => ({ ...current, [location.storeCode]: next }));
    setPending((current) => {
      const rest = { ...current };
      delete rest[location.storeCode];
      return rest;
    });
    setFilled((current) => ({
      ...current,
      [location.storeCode]: changes.map((item) => `${item.label} → ${item.to}`).join(" · "),
    }));
  }

  function dismiss(storeCode: string) {
    setPending((current) => {
      const rest = { ...current };
      delete rest[storeCode];
      return rest;
    });
  }

  /**
   * Read one pasted line for one salon.
   *
   * THE COUNTRY IS ADDED HERE RATHER THAN IN THE PARSER, and only when the
   * salon already says United States. That is the difference between reading a
   * fact off the clipboard and asserting one about a place we just failed to
   * read.
   */
  function read(location: ApifyLocationMapping, raw: string) {
    setFilled((current) => {
      const rest = { ...current };
      delete rest[location.storeCode];
      return rest;
    });

    if (raw.trim().length === 0) {
      dismiss(location.storeCode);
      return;
    }

    const parsed = parseGoogleAddress(raw);
    const known = (location.expectedCountry ?? "").trim().toLowerCase();
    const resolved: ParsedAddress =
      parsed.country === null && known === UNITED_STATES.toLowerCase()
        ? { ...parsed, country: UNITED_STATES }
        : parsed;

    const changes = addressChanges(resolved, valuesFor(location));

    if (resolved.confident && changes.every((item) => !item.overwrites)) {
      apply(location, changes);
      return;
    }

    setPending((current) => ({
      ...current,
      [location.storeCode]: { parsed: resolved, changes },
    }));
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

      if (ok && refused.length === 0) {
        setEdits({});
        setPasted({});
        setFilled({});
      }
      router.refresh();
    } catch {
      setState({ tone: "attention", message: "The request did not reach Ask Sunny." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        {locations.map((location) => {
          const values = valuesFor(location);
          const waiting = pending[location.storeCode];
          const done = filled[location.storeCode];

          return (
            <article
              key={location.storeCode}
              className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3"
            >
              <p className="text-[12.5px] font-semibold">
                {location.locationName}
                {/*
                  BOTH NUMBERING SYSTEMS, SIDE BY SIDE. Google's store 306 is
                  ASK Sunny's salon 0462, and somebody pasting an address for
                  one has to be able to see they are pasting it for the other.
                */}
                <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                  store {location.storeCode} · salon {location.salonNumber ?? "—"}
                </span>
              </p>

              <div className="mt-2 flex flex-col gap-1.5 sm:flex-row sm:items-start">
                <Textarea
                  rows={1}
                  value={pasted[location.storeCode] ?? ""}
                  placeholder="Paste full Google Maps address — 2624 Iowa St Ste B, Lawrence, KS 66046, United States"
                  aria-label={`Paste full Google Maps address for ${location.locationName}`}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setPasted((current) => ({ ...current, [location.storeCode]: raw }));
                  }}
                  /*
                    ON PASTE AND ON LEAVING THE FIELD, never on every keystroke:
                    parsing half a typed address would flash conclusions at
                    somebody who has not finished telling us the address.
                  */
                  onPaste={(event) => {
                    const raw = event.clipboardData.getData("text");
                    if (raw.trim().length === 0) return;
                    event.preventDefault();
                    setPasted((current) => ({ ...current, [location.storeCode]: raw }));
                    read(location, raw);
                  }}
                  onBlur={(event) => read(location, event.target.value)}
                  className="min-h-[34px] flex-1 text-[12px]"
                />
              </div>

              {done ? (
                <p className="mt-1.5 text-[11px] text-measure-positive-foreground">
                  Filled from the pasted address — {done}
                </p>
              ) : null}

              {waiting ? (
                <div className="mt-2 rounded-[var(--radius-sm)] border border-status-attention/40 bg-status-attention/5 px-3 py-2">
                  {/*
                    THE PASTED TEXT IS SHOWN BACK, because when a parse is
                    doubtful the most useful thing on the screen is the line it
                    was doubtful about.
                  */}
                  <p className="text-[11px] text-muted-foreground">
                    Read from: <span className="font-mono">{pasted[location.storeCode]}</span>
                  </p>

                  {waiting.parsed.issues.map((issue) => (
                    <p key={issue} className="mt-1 text-[11.5px] text-status-attention">
                      {issue}
                    </p>
                  ))}

                  {waiting.changes.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {waiting.changes.map((item) => (
                        <li key={item.field} className="text-[11.5px]">
                          <span className="text-muted-foreground">{item.label}:</span>{" "}
                          {item.overwrites ? (
                            <>
                              <span className="line-through opacity-70">{item.from}</span>{" "}
                              <span aria-hidden>→</span>{" "}
                              <span className="font-semibold">{item.to}</span>
                              <span className="ml-1.5 text-[10px] font-black tracking-[0.06em] text-status-attention uppercase">
                                replaces
                              </span>
                            </>
                          ) : (
                            <span className="font-semibold">{item.to}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                      Nothing to fill in — the fields already say this.
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {waiting.changes.length > 0 ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => apply(location, waiting.changes)}
                      >
                        <Check />
                        {waiting.changes.some((item) => item.overwrites)
                          ? "Replace these fields"
                          : "Fill these fields"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(location.storeCode)}
                    >
                      Leave as is
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* ------------------------------------ the five fields, always -- */}
              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_64px_84px_minmax(0,1fr)]">
                <Input
                  value={values.streetAddress}
                  placeholder="2624 Iowa St Ste B"
                  aria-label={`Street address for ${location.locationName}`}
                  onChange={(event) => change(location, "streetAddress", event.target.value)}
                  className="col-span-2 h-8 text-[12px] sm:col-span-1"
                />
                <Input
                  value={values.city}
                  placeholder="Lawrence"
                  aria-label={`City for ${location.locationName}`}
                  onChange={(event) => change(location, "city", event.target.value)}
                  className="h-8 text-[12px]"
                />
                <Input
                  value={values.state}
                  placeholder="KS"
                  aria-label={`State for ${location.locationName}`}
                  onChange={(event) => change(location, "state", event.target.value)}
                  className="h-8 text-[12px]"
                />
                <Input
                  value={values.postalCode}
                  placeholder="66046"
                  aria-label={`ZIP for ${location.locationName}`}
                  onChange={(event) => change(location, "postalCode", event.target.value)}
                  className="h-8 text-[12px]"
                />
                <Input
                  value={values.country}
                  placeholder="United States"
                  aria-label={`Country for ${location.locationName}`}
                  onChange={(event) => change(location, "country", event.target.value)}
                  className="col-span-2 h-8 text-[12px] sm:col-span-1"
                />
              </div>
            </article>
          );
        })}
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
          Save{" "}
          {edited.length === 0
            ? "expected addresses"
            : `${edited.length} expected address${edited.length === 1 ? "" : "es"}`}
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

  /**
   * Re-read the dataset the last discovery already paid for.
   *
   * IT STARTS NO ACTOR RUN. When a dataset was fetched correctly but
   * RECONCILED wrongly — a schema the reader did not recognise, a matcher that
   * was too strict — buying the same place records again is paying twice for
   * one mistake. Apify keeps the dataset; this reads it back.
   */
  async function reprocess() {
    setBusy("reprocess");
    setState(null);
    try {
      const { ok, body } = await post("/api/admin/reviews/apify/locations", {
        method: "PUT",
        body: JSON.stringify({ mode: "reprocess" }),
      });

      const outcome = body.reprocess as
        | { message?: string; received?: number; readable?: number; sampleKeys?: string[] }
        | undefined;

      setState({
        tone: ok && (outcome?.readable ?? 0) > 0 ? "accent" : "attention",
        message: !ok
          ? typeof body.error === "string"
            ? body.error
            : "The stored dataset could not be re-read."
          : [
              outcome?.message ?? "The stored dataset was re-read.",
              /*
                THE FIELD NAMES, WHEN NOTHING COULD BE READ. This is the one
                piece of evidence that turns "the Actor changed its schema"
                from a guess into a fact, and key names from a public place
                listing are safe to show — they are not values and not secrets.
              */
              (outcome?.readable ?? 0) === 0 && (outcome?.sampleKeys?.length ?? 0) > 0
                ? `The records carry these fields: ${outcome?.sampleKeys?.join(", ")}.`
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

        {/*
          THE FREE ONE. A discovery that fetched a good dataset and reconciled
          it wrongly does not need to be bought again — this re-reads the
          records Apify is already holding. No Actor run, no new charge.
        */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy !== null || liveRunId !== null}
          onClick={() => void reprocess()}
        >
          {busy === "reprocess" ? <Loader2 className="animate-spin" /> : <History />}
          Re-read the last discovery (no new run)
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
        ? (body.outcomes as {
            storeCode: string;
            status: string;
            conflictsWith?: string;
            reason?: string;
          }[])
        : [];

      /*
       * ======================================================================
       * ONE LINE PER ROW THAT FAILED, NAMING THE ROW AND THE REASON
       * ======================================================================
       *
       * The old message was a single sentence for any cause on any row: an
       * operator mapping four salons could not tell which had failed, and the
       * sentence named nothing they could act on. Every failure mode now says
       * which store it was and what to do about it.
       */
      const saved = outcomes.filter((outcome) => outcome.status === "ok");
      const failures: string[] = [
        ...unreadable.map(
          (storeCode) =>
            `Store ${storeCode}: could not read a Google Place ID. Paste the Place ID itself, or a Maps URL containing place_id= or query_place_id=.`,
        ),
        ...outcomes
          .filter((outcome) => outcome.status !== "ok")
          .map((outcome) => {
            if (outcome.status === "place_already_mapped") {
              return `Store ${outcome.storeCode}: that Place ID is already assigned to store ${outcome.conflictsWith ?? "another salon"}.`;
            }
            if (outcome.status === "unknown_store") {
              return `Store ${outcome.storeCode}: not a store code ASK Sunny holds.`;
            }
            if (outcome.status === "invalid_place_id") {
              return `Store ${outcome.storeCode}: the value read is not a valid Google Place ID.`;
            }
            return `Store ${outcome.storeCode}: ${outcome.reason ?? "the mapping was refused."}`;
          }),
      ];

      setState({
        tone: ok && failures.length === 0 ? "accent" : "attention",
        message: !ok
          ? typeof body.error === "string"
            ? body.error
            : "The mappings could not be saved."
          : [
              `${saved.length} saved as awaiting verification.`,
              ...failures,
            ].join(" "),
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
