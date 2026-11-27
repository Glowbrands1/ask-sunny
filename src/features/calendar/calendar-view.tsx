"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils/cn";
import { monthGrid, monthOf, shiftMonth } from "@/lib/calendar/range";
import { VISIBILITY_LABEL, type ReminderInput, type ReminderSaveResult } from "@/lib/calendar/reminders";
import { KINDS, SOURCE_LABELS, type CalendarEvent, type CalendarKind, type CalendarView as View } from "@/lib/calendar/types";
import { deleteReminderAction, saveReminderAction } from "./actions";
import { NewEvent } from "./new-event";

/**
 * THE CALENDAR (Pau, 26 Nov 2026; the same page as the Leadership Hub's and Ask Bubbles', from one design:
 * Glowbrands1/leadership-hub docs/calendar-design.md).
 *
 * A month at a time, Sunday first, Central time. Filter chips per type with this month's count. A busy day writes out
 * two events and counts the rest per type ("+8 follow-ups"), never "+12 more". Picking a day lists everything on it.
 * Phones get the month as a list. Refreshes itself every two minutes, so a change in any of the three apps shows here.
 */
export const REFRESH_MS = 120_000;
export const SHOWN_PER_DAY = 2;

const KIND: Record<CalendarKind, { label: string; plural: string; dot: string }> = {
  meeting: { label: "Meetings", plural: "meetings", dot: "bg-[#6d5bd0]" },
  "form-follow-up": { label: "Form follow-ups", plural: "follow-ups", dot: "bg-[#c4453c]" },
  "hr-approval": { label: "HR approvals", plural: "approvals", dot: "bg-[#c98a12]" },
  "google-reviews": { label: "Review reminders", plural: "review checks", dot: "bg-[#2f8f5b]" },
  reminder: { label: "Reminders", plural: "reminders", dot: "bg-[#2f6fd0]" },
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
export function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${iso}T12:00:00Z`));
}
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00Z`));
}
export function cellSummary(events: CalendarEvent[], shown = SHOWN_PER_DAY): { shown: CalendarEvent[]; more: { kind: CalendarKind; count: number }[] } {
  const rest = events.slice(shown);
  return { shown: events.slice(0, shown), more: KINDS.map((kind) => ({ kind, count: rest.filter((e) => e.kind === kind).length })).filter((m) => m.count > 0) };
}

function EventRow({ e, onDelete }: { e: CalendarEvent; onDelete?: (e: CalendarEvent) => void }) {
  const when = e.startTime ? `${clockLabel(e.startTime)} CT${e.minutes ? ` · ${e.minutes} min` : ""}` : e.kind === "meeting" ? "Time not set" : "All day";
  const title =
    e.kind === "reminder" ? (
      <span className="font-semibold">{e.title}</span>
    ) : e.href.startsWith("https://") ? (
      <a href={e.href} className="font-semibold underline-offset-2 hover:underline" rel="noopener noreferrer">
        {e.title}
      </a>
    ) : (
      <Link href={e.href} className="font-semibold underline-offset-2 hover:underline">
        {e.title}
      </Link>
    );
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", KIND[e.kind].dot)} />
      <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{when}</span>
      <span className="min-w-0 flex-1">
        {title}
        {e.location ? <span className="text-muted-foreground"> · {e.location}</span> : null}
        {e.kind === "reminder" ? <span className="text-muted-foreground"> · {e.by ? `from ${e.by}` : VISIBILITY_LABEL[e.visibility ?? "only_me"]}</span> : null}
      </span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {e.source !== "ask-sunny" ? <span>{SOURCE_LABELS[e.source]}</span> : null}
        {e.status === "overdue" ? <Badge tone="failed">Overdue</Badge> : e.status === "due" ? <Badge tone="attention">Due today</Badge> : null}
        {onDelete && e.kind === "reminder" && e.mine && e.reminderId && e.source === "ask-sunny" ? (
          <button type="button" className="rounded px-1.5 py-0.5 text-xs underline" onClick={() => onDelete(e)} aria-label={`Delete reminder ${e.title}`}>
            Delete
          </button>
        ) : null}
      </span>
    </li>
  );
}

export function CalendarView({
  view,
  month,
  today,
  save = saveReminderAction,
  remove = deleteReminderAction,
}: {
  view: View;
  month: string;
  today: string;
  save?: (input: ReminderInput) => Promise<ReminderSaveResult>;
  remove?: (id: string) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => router.refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onFocus = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [router]);

  const [hidden, setHidden] = useState<ReadonlySet<CalendarKind>>(new Set());
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(monthOf(today) === month ? today : null);
  const { days } = monthGrid(month);
  const visible = useMemo(() => view.events.filter((e) => !hidden.has(e.kind) && !removed.has(e.id)), [view.events, hidden, removed]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of visible) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [visible]);
  const counts = useMemo(
    () => Object.fromEntries(KINDS.map((k) => [k, view.events.filter((e) => e.kind === k && monthOf(e.date) === month).length])) as Record<CalendarKind, number>,
    [view.events, month],
  );
  const toggle = (k: CalendarKind) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const onDelete = async (e: CalendarEvent) => {
    if (!e.reminderId || !window.confirm(`Delete the reminder "${e.title}"?`)) return;
    setDeleteError(null);
    const r = await remove(e.reminderId);
    if (!r.ok) return setDeleteError("The reminder couldn't be deleted just now. Try again in a minute.");
    setRemoved((s) => new Set(s).add(e.id));
    router.refresh();
  };
  const pickedEvents = picked ? (byDay.get(picked) ?? []) : [];
  const monthDays = [...byDay.keys()].filter((d) => monthOf(d) === month).sort();

  return (
    <div className="grid gap-4">
      {deleteError ? <Notice tone="attention">{deleteError}</Notice> : null}
      {view.notes.map((n) => (
        <p key={n} role="status" className="m-0 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm">
          {n}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`?month=${shiftMonth(month, -1)}`} aria-label="Previous month" className="rounded-md border border-border px-3 py-1.5 text-sm">
          ‹
        </Link>
        <h2 className="m-0 min-w-44 text-center text-lg font-semibold">{monthLabel(month)}</h2>
        <Link href={`?month=${shiftMonth(month, 1)}`} aria-label="Next month" className="rounded-md border border-border px-3 py-1.5 text-sm">
          ›
        </Link>
        <Link href={`?month=${monthOf(today)}`} className="rounded-md px-3 py-1.5 text-sm font-semibold">
          Today
        </Link>
        <NewEvent
          today={today}
          save={save}
          onSaved={(d) => {
            setPicked(d);
            if (monthOf(d) !== month) router.push(`?month=${monthOf(d)}`);
            else router.refresh();
          }}
        />
        <div role="group" aria-label="Show event types" className="flex flex-wrap gap-2 sm:ml-auto">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={!hidden.has(k)}
              onClick={() => toggle(k)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", hidden.has(k) ? "border-border text-muted-foreground line-through" : "border-border-strong")}
            >
              <span aria-hidden className={cn("size-2 rounded-full", KIND[k].dot)} />
              {KIND[k].label}
              <span className="font-mono text-muted-foreground tabular-nums">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <div className="grid grid-cols-7 border-b border-border text-xs text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const events = byDay.get(d) ?? [];
            const { shown, more } = cellSummary(events);
            return (
              <button
                key={d}
                type="button"
                onClick={() => setPicked(d)}
                aria-label={`${dayLabel(d)}: ${events.length} ${events.length === 1 ? "event" : "events"}`}
                aria-pressed={picked === d}
                className={cn(
                  "grid min-h-24 content-start gap-0.5 border-r border-b border-border p-1.5 text-left text-xs [&:nth-child(7n)]:border-r-0",
                  monthOf(d) !== month && "text-muted-foreground opacity-60",
                  picked === d && "bg-surface-muted",
                )}
              >
                <span className={cn("font-mono tabular-nums", d === today && "font-bold text-primary")}>
                  {Number(d.slice(8))}
                  {d === today ? " Today" : ""}
                </span>
                {shown.map((e) => (
                  <span key={e.id} className="flex min-w-0 items-center gap-1">
                    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", KIND[e.kind].dot)} />
                    <span className="truncate">
                      {e.startTime ? `${clockLabel(e.startTime).replace(":00", "")} ` : ""}
                      {e.title}
                    </span>
                  </span>
                ))}
                {more.map((m) => (
                  <span key={m.kind} className="text-muted-foreground">
                    +{m.count} {m.count === 1 ? KIND[m.kind].plural.replace(/s$/, "") : KIND[m.kind].plural}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>

      {picked ? (
        <Card role="region" aria-label={dayLabel(picked)} className="hidden p-4 md:block">
          <h2 className="m-0 text-sm font-semibold">{dayLabel(picked)}</h2>
          {pickedEvents.length ? (
            <ul className="m-0 list-none divide-y divide-border p-0">
              {pickedEvents.map((e) => (
                <EventRow key={e.id} e={e} onDelete={onDelete} />
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2 text-sm text-muted-foreground">Nothing on this day.</p>
          )}
        </Card>
      ) : null}
      <div className="grid gap-3 md:hidden">
        {monthDays.length === 0 ? <p className="m-0 text-sm text-muted-foreground">Nothing on your calendar in {monthLabel(month)}.</p> : null}
        {monthDays.map((d) => (
          <Card key={d} className="p-4">
            <h2 className="m-0 text-sm font-semibold">
              {dayLabel(d)}
              {d === today ? <span className="ml-2 text-xs font-normal text-muted-foreground">Today</span> : null}
            </h2>
            <ul className="m-0 list-none divide-y divide-border p-0">
              {(byDay.get(d) ?? []).map((e) => (
                <EventRow key={e.id} e={e} onDelete={onDelete} />
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <p className="m-0 text-xs text-muted-foreground">Times are Central. Pick a day to see everything on it. Time-off requests are not shown here.</p>
    </div>
  );
}
