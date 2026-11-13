"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/AccountabilityChart.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, Card, cx, inputClass } from "@/features/l10/ui/ui";
import { newItemId } from "@/features/l10/lib/doc";
import { addResponsibility, addSeat, childrenOf, patchSeat, readSeats, removeResponsibility, removeSeat, type Seat } from "@/features/l10/lib/seats";

/** Reference item: this meeting's accountability chart (seat, person, responsibilities, seats below). Saved in the meeting document as `seats`. */
export function AccountabilityChart({ seats: raw, onChange }: { seats: unknown[]; onChange: (seats: Seat[]) => void }) {
  const seats = readSeats(raw);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  const add = (parentId: string | null) => {
    const k = parentId ?? "root";
    const next = addSeat(seats, parentId, draft[k] ?? "", newItemId());
    if (next !== seats) onChange(next);
    setDraft((d) => ({ ...d, [k]: "" }));
  };

  const renderSeat = (seat: Seat, depth: number) => {
    const kids = childrenOf(seats, seat.id);
    const open = !collapsed[seat.id];
    const label = seat.title || "Untitled seat";
    return (
      <li key={seat.id} className="flex flex-col gap-2">
        <div className="rounded-[10px] border border-line bg-white p-3 shadow-card" style={{ marginLeft: Math.min(depth, 4) * 14 }}>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label={`${open ? "Collapse" : "Expand"} seat ${label}`}
              aria-expanded={open}
              onClick={() => setCollapsed((c) => ({ ...c, [seat.id]: open }))}
              className="flex size-11 items-center justify-center text-muted hover:text-ink"
            >
              <span aria-hidden>{open ? "▾" : "▸"}</span>
            </button>
            <input aria-label={`Seat title for ${label}`} value={seat.title} onChange={(e) => onChange(patchSeat(seats, seat.id, { title: e.target.value }))} placeholder="Seat / role" className={cx(inputClass, "min-w-[140px] flex-[2_1_160px] font-bold")} />
            <input aria-label={`Who sits in ${label}`} value={seat.name} onChange={(e) => onChange(patchSeat(seats, seat.id, { name: e.target.value }))} placeholder="Who sits here" className={cx(inputClass, "min-w-[140px] flex-[1_1_140px]")} />
            <Button variant="outline" aria-label={`Remove seat ${label}${kids.length ? " and the seats below it" : ""}`} onClick={() => onChange(removeSeat(seats, seat.id))}>
              Remove
            </Button>
          </div>
          {open && (
            <div className="mt-2 flex flex-col gap-2 pl-2 sm:pl-12">
              {seat.responsibilities.length > 0 && (
                <ul aria-label={`Responsibilities of ${label}`} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {seat.responsibilities.map((r, i) => (
                    <li key={i} className="flex items-center gap-1 rounded-full bg-cream py-0.5 pr-1 pl-2.5 text-xs">
                      {r}
                      <button type="button" aria-label={`Remove responsibility ${r}`} onClick={() => onChange(removeResponsibility(seats, seat.id, i))} className="flex size-6 items-center justify-center text-muted hover:text-ink">
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Add a responsibility to ${label}`}
                  placeholder="Add a responsibility + Enter"
                  className={cx(inputClass, "min-w-[200px] max-w-xs flex-1")}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    onChange(addResponsibility(seats, seat.id, e.currentTarget.value));
                    e.currentTarget.value = "";
                  }}
                />
                <input aria-label={`Add a seat below ${label}`} placeholder="Add a seat below + Enter" value={draft[seat.id] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [seat.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && add(seat.id)} className={cx(inputClass, "min-w-[200px] max-w-xs flex-1")} />
                <Button variant="outline" aria-label={`Add seat below ${label}`} onClick={() => add(seat.id)}>
                  + Seat
                </Button>
              </div>
            </div>
          )}
        </div>
        {open && kids.length > 0 && <ul className="m-0 flex list-none flex-col gap-2 p-0">{kids.map((k) => renderSeat(k, depth + 1))}</ul>}
      </li>
    );
  };

  const roots = childrenOf(seats, null);
  return (
    <Card aria-label="Accountability chart" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Add a top-level seat" placeholder="Add a top-level seat" value={draft.root ?? ""} onChange={(e) => setDraft((d) => ({ ...d, root: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && add(null)} className={cx(inputClass, "min-w-[200px] max-w-xs flex-1")} />
        <Button variant="primary" aria-label="Add top-level seat" onClick={() => add(null)}>
          + Seat
        </Button>
      </div>
      {roots.length === 0 ? <p className="m-0 rounded-[10px] border border-dashed border-field p-4 text-center text-sm text-muted">No seats yet. Add the first one above.</p> : <ul className="m-0 flex list-none flex-col gap-2 p-0">{roots.map((s) => renderSeat(s, 0))}</ul>}
    </Card>
  );
}
