"use client";

import { useState } from "react";

/**
 * THE EMPLOYEE DIRECTORY'S "SHOW HOME ADDRESS" (Pau, 26 Nov 2026, approved by Curt; admins only).
 *
 * Nothing is read until an admin clicks: then ONE employee's address is fetched live from Woven
 * (`/api/admin/employees/woven/home-address`) and shown in this cell only. It is not stored and not in the URL.
 * Sample data has no Woven record behind it, so the button is off there.
 */

type Lookup = { status: "found"; address: string } | { status: "none" } | { status: "unavailable" };

export function HomeAddressReveal({ directoryId, disabled }: { directoryId: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/employees/woven/home-address?id=${encodeURIComponent(directoryId)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as (Lookup & { reason?: string }) | null;
      if (!response.ok || !body?.status) setError(body?.reason ?? `Could not look it up (HTTP ${response.status}).`);
      else setResult(body);
    } catch {
      setError("The server could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  if (result?.status === "found") return <span className="whitespace-normal text-foreground">{result.address}</span>;
  if (result?.status === "none") return <span className="text-muted-foreground">No address in Woven</span>;

  return (
    <span className="flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={show}
        disabled={disabled || busy}
        className="text-[12px] font-semibold text-primary underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
      >
        {busy ? "Looking up…" : "Show home address"}
      </button>
      {result?.status === "unavailable" ? <span className="text-[11px] text-muted-foreground">Woven didn&apos;t answer. Try again.</span> : null}
      {error ? <span className="text-[11px] text-[var(--color-failed,#b91c1c)]">{error}</span> : null}
    </span>
  );
}
