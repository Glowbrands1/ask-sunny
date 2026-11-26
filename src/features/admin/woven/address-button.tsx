"use client";

import * as React from "react";
import { Loader2, MapPin } from "lucide-react";

/**
 * "SHOW ADDRESS" ON ONE DIRECTORY ROW (Pau, 26 Nov 2026: "can we list their address here"; admins only, nothing
 * saved). One click asks Woven for that one person's home address, live, and shows it in the row until the page is
 * left. It is not stored anywhere in the app. See `/api/admin/employees/woven/address`.
 */

const NO_ADDRESS: Record<string, string> = {
  no_address: "No address in Woven",
  incomplete_address: "Woven's address is incomplete",
  no_credentials: "Woven is not connected",
  unavailable: "Woven did not answer — try again",
};

export function AddressButton({ directoryId }: { directoryId: string }) {
  const [state, setState] = React.useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "found"; address: string } | { kind: "none"; text: string }
  >({ kind: "idle" });

  async function show() {
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/admin/employees/woven/address?id=${encodeURIComponent(directoryId)}`, {
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as
        | { status?: string; address?: string; reason?: string }
        | null;
      if (response.ok && body?.status === "found" && body.address) setState({ kind: "found", address: body.address });
      else if (response.ok && body?.reason) setState({ kind: "none", text: NO_ADDRESS[body.reason] ?? "No address" });
      else setState({ kind: "none", text: body?.reason ?? "Could not read the address" });
    } catch {
      setState({ kind: "none", text: "Could not read the address" });
    }
  }

  if (state.kind === "found") return <span className="block min-w-48 whitespace-normal text-foreground">{state.address}</span>;
  if (state.kind === "none") return <span className="text-muted-foreground">{state.text}</span>;
  return (
    <button
      type="button"
      onClick={show}
      disabled={state.kind === "loading"}
      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-[12px] font-semibold text-foreground disabled:opacity-60"
    >
      {state.kind === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
      Show address
    </button>
  );
}
