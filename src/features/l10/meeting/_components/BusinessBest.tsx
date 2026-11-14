"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/BusinessBest.tsx); keep in step with it. See src/features/l10/README.md.

import { Button, cx } from "@/features/l10/ui/ui";
import type { Attendee } from "@/features/l10/lib/types";

const initials = (name: string) => name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

/** Segue: round-robin, check off each person as they share. */
export function BusinessBest({ attendees, onChange }: { attendees: Attendee[]; onChange: (next: Attendee[]) => void }) {
  const shared = attendees.filter((a) => a.shared).length;
  const set = (fn: (a: Attendee) => Attendee) => onChange(attendees.map(fn));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream px-4 py-2 text-sm">
        <span className="text-muted">Round-robin: check off each attendee as they share.</span>
        <div className="flex items-center gap-2">
          <span className="font-semibold">
            {shared}/{attendees.length} shared
          </span>
          <Button variant="link" onClick={() => set((a) => ({ ...a, shared: false }))}>
            Clear
          </Button>
          <Button variant="outline" onClick={() => set((a) => ({ ...a, shared: true }))}>
            All
          </Button>
        </div>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        {attendees.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              aria-pressed={a.shared}
              onClick={() => set((x) => (x.id === a.id ? { ...x, shared: !x.shared } : x))}
              className={cx(
                "flex min-h-11 w-full items-center gap-3 rounded-[10px] border p-4 text-left shadow-card transition",
                a.shared ? "border-bronze bg-sunny" : "border-line bg-white hover:bg-cream",
              )}
            >
              <span className={cx("flex size-10 flex-none items-center justify-center rounded-full text-sm font-bold", a.shared ? "bg-ink text-gold" : "bg-cream text-ink")}>
                {initials(a.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{a.name}</span>
                {a.role && <span className="block truncate text-xs text-muted">{a.role}</span>}
              </span>
              <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-bold", a.shared ? "bg-ink text-gold" : "bg-cream text-muted")}>{a.shared ? "Shared" : "Not yet"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
