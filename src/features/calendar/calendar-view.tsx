"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/feedback";
import { cn } from "@/lib/utils/cn";
import { monthGrid, monthOf, shiftMonth } from "@/lib/calendar/range";
import { VISIBILITY_LABEL, type ReminderInput, type ReminderSaveResult } from "@/lib/calendar/reminders";
import { KINDS, SOURCE_LABELS, type CalendarEvent, type CalendarKind, type CalendarView as View } from "@/lib/calendar/types";
import { WEEKDAY_NAMES, clock, meetingHref, noDaySet, scheduleLabel, shortDate, type MeetingDetails, type MeetingOccurrenceInput, type MeetingScheduleInput, type MeetingScheduleSaveResult } from "@/lib/calendar/meeting-details";
import { deleteReminderAction, saveMeetingOccurrenceAction, saveMeetingScheduleAction, saveReminderAction } from "./actions";
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
  holiday: { label: "Holidays", plural: "holidays", dot: "bg-[#d0679a]" },
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

/**
 * One L10's details (leadership-hub docs/calendar-design.md §5d, §5e): the day, Central time and length, who leads it and
 * who attends (names only), and Open the L10 (here, or in the Leadership Hub for a meeting this app only shows). Its
 * attendees and admins change its time here, every week or only on the date it was opened from (the owner, 27 Nov 2026:
 * "ability to edit times pls and make it recurring or just for that specific time"). It is stored in the Leadership Hub,
 * which checks who may and tells the other attendees, so all three apps follow it.
 */
export function MeetingPanel({
  meeting,
  hubUrl = null,
  canEdit = false,
  startEditing = false,
  saveSchedule = saveMeetingScheduleAction,
  saveOccurrence,
  date = null,
  onSaved,
  onClose,
}: {
  meeting: MeetingDetails;
  hubUrl?: string | null;
  canEdit?: boolean;
  startEditing?: boolean;
  saveSchedule?: (input: MeetingScheduleInput) => Promise<MeetingScheduleSaveResult>;
  saveOccurrence?: (input: MeetingOccurrenceInput) => Promise<MeetingScheduleSaveResult>;
  /** The date this panel was opened from (a day's meeting), for "Only this date". */
  date?: string | null;
  onSaved?: () => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(canEdit && startEditing);
  return (
    <Card role="region" aria-label={`${meeting.name} details`} className="p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-base font-semibold">{meeting.name}</h2>
          {meeting.team ? <p className="m-0 text-xs text-muted-foreground">{meeting.team}</p> : null}
        </div>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm" aria-label="Close meeting details">
          ✕
        </button>
      </div>
      <dl className="m-0 mt-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">When</dt>
        <dd className="m-0">{scheduleLabel(meeting)}</dd>
        <dt className="text-muted-foreground">Time</dt>
        <dd className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{meeting.startTime ? `${clock(meeting.startTime)} Central` : "Time not set"}</span>
          {/* The owner, 27 Nov 2026, on this panel: "need an edit here for the time not have to go inside the actual app pls
              so its easier and it just updates to alll". Saved to the Leadership Hub, so every app shows the new time. */}
          {canEdit && !editing ? (
            <button type="button" className="rounded-md border border-border-strong px-2 py-0.5 text-xs font-semibold" onClick={() => setEditing(true)}>
              {meeting.weekday === null ? "Add day and time" : "Edit time"}
            </button>
          ) : null}
        </dd>
        <dt className="text-muted-foreground">Length</dt>
        <dd className="m-0">{meeting.minutes ? `${meeting.minutes} min` : "Not set"}</dd>
        <dt className="text-muted-foreground">Leads it</dt>
        <dd className="m-0">{meeting.leader ?? "Not listed"}</dd>
        <dt className="text-muted-foreground">Attendees</dt>
        <dd className="m-0">
          {meeting.attendees.length ? (
            <ul aria-label={`${meeting.name} attendees`} className="m-0 flex list-none flex-wrap gap-x-3 gap-y-0.5 p-0">
              {meeting.attendees.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          ) : (
            "None listed"
          )}
        </dd>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <a href={meetingHref(meeting, hubUrl)} className="font-semibold underline">
          {meeting.opensInApp === false ? "Open the L10 in the Leadership Hub" : "Open the L10"}
        </a>
        {!canEdit ? <span className="text-muted-foreground">Only this meeting&apos;s attendees and admins can change its time.</span> : null}
      </div>
      {canEdit && editing ? (
        <ScheduleForm
          meeting={meeting}
          date={date}
          save={saveSchedule}
          saveOccurrence={saveOccurrence}
          onDone={(saved) => {
            setEditing(false);
            if (saved) onSaved?.();
          }}
        />
      ) : null}
    </Card>
  );
}

function ScheduleForm({
  meeting,
  date,
  save,
  saveOccurrence,
  onDone,
}: {
  meeting: MeetingDetails;
  date: string | null;
  save: (input: MeetingScheduleInput) => Promise<MeetingScheduleSaveResult>;
  saveOccurrence?: (input: MeetingOccurrenceInput) => Promise<MeetingScheduleSaveResult>;
  onDone: (saved: boolean) => void;
}) {
  // "Only this date" is offered when the panel was opened from a date the meeting falls on.
  const canOneOff = Boolean(date && saveOccurrence && meeting.weekday !== null);
  const [scope, setScope] = useState<"weekly" | "date">("weekly");
  const [weekday, setWeekday] = useState(meeting.weekday === null ? "" : String(meeting.weekday));
  const [time, setTime] = useState(meeting.startTime ?? "");
  const [minutes, setMinutes] = useState(meeting.minutes ? String(meeting.minutes) : "");
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oneOff = canOneOff && scope === "date";
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const length = minutes.trim() === "" ? null : Number(minutes);
    if (length !== null && (!Number.isInteger(length) || length < 5 || length > 480)) return setError("The length must be 5 to 480 minutes.");
    setBusy(true);
    setError(null);
    const r = oneOff
      ? await saveOccurrence!({ key: meeting.key, date: date!, time: cancelled ? null : time || null, minutes: cancelled ? null : length, cancelled })
      : await save({ key: meeting.key, weekday: weekday === "" ? null : Number(weekday), time: time || null, minutes: length });
    setBusy(false);
    if (!r.ok)
      return setError(
        r.reason === "forbidden"
          ? "Only this meeting's attendees and admins can change its time."
          : r.reason === "invalid"
            ? "Check the day, time and length."
            : r.reason === "signin"
              ? "Sign in again, then try once more."
              : "It couldn't be saved just now. Try again in a minute.",
      );
    onDone(true);
  };
  return (
    <form onSubmit={submit} aria-label={`Set ${meeting.name} day and time`} className="mt-3 grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-3">
      {canOneOff ? (
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0 sm:col-span-3">
          <legend className="mb-1 text-xs text-muted-foreground">Change it</legend>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="scope" checked={scope === "weekly"} onChange={() => setScope("weekly")} />
            Every week
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="scope" checked={scope === "date"} onChange={() => setScope("date")} />
            Only this date ({shortDate(date!)})
          </label>
        </fieldset>
      ) : null}
      {oneOff ? (
        <label className="flex items-center gap-1.5 sm:col-span-3">
          <input type="checkbox" checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />
          Cancel the meeting on {shortDate(date!)}
        </label>
      ) : (
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Day</span>
          <select value={weekday} onChange={(e) => setWeekday(e.target.value)} className="rounded border border-border-strong px-2 py-1">
            <option value="">No day set</option>
            {WEEKDAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      {oneOff && cancelled ? null : (
        <>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Start time (Central)</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded border border-border-strong px-2 py-1" />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Length (minutes)</span>
            <input type="number" min={5} max={480} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="rounded border border-border-strong px-2 py-1" />
          </label>
        </>
      )}
      {error ? (
        <p role="alert" className="m-0 text-sm text-red-700 sm:col-span-3">
          {error}
        </p>
      ) : null}
      <p className="m-0 text-xs text-muted-foreground sm:col-span-3">Saved in the Leadership Hub, so the Hub and both Ask apps show it. The meeting&apos;s other attendees are told.</p>
      <div className="flex gap-2 sm:col-span-3">
        <button type="submit" disabled={busy} className="rounded-md bg-foreground px-3 py-1 font-semibold text-background disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => onDone(false)} className="rounded-md px-3 py-1">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A form entry without the employee's name: opening it says only who can see the name (the owner, 27 Nov 2026). */
export const NAME_HIDDEN_NOTE = "Only admins, HR and the person who created this form can see who it is for.";
function NameHidden({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className="font-semibold underline-offset-2 hover:underline" aria-expanded={open}>
        {title}
      </button>
      {open ? (
        <span role="note" className="block text-xs text-muted-foreground">
          {NAME_HIDDEN_NOTE}
        </span>
      ) : null}
    </>
  );
}

function EventRow({
  e,
  onDelete,
  onMeeting,
  hasDetails,
  onEditTime,
}: {
  e: CalendarEvent;
  onDelete?: (e: CalendarEvent) => void;
  onMeeting?: (key: string, date?: string) => void;
  hasDetails?: (key: string) => boolean;
  /** Click a meeting's time to change it, every week or only this date (the owner, 27 Nov 2026). */
  onEditTime?: (key: string, date: string) => void;
}) {
  const when = e.startTime ? `${clockLabel(e.startTime)} CT${e.minutes ? ` · ${e.minutes} min` : ""}` : e.kind === "meeting" ? "Time not set" : "All day";
  const editable = e.kind === "meeting" && e.meetingKey && onEditTime && hasDetails?.(e.meetingKey);
  const title =
    e.kind === "reminder" || e.kind === "holiday" ? (
      <span className="font-semibold">{e.title}</span>
    ) : e.nameHidden ? (
      <NameHidden title={e.title} />
    ) : e.kind === "meeting" && e.meetingKey && onMeeting && hasDetails?.(e.meetingKey) ? (
      <button type="button" onClick={() => onMeeting(e.meetingKey!, e.date)} className="font-semibold underline-offset-2 hover:underline" aria-label={`${e.title}: details`}>
        {e.title}
      </button>
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
      {editable ? (
        <button
          type="button"
          onClick={() => onEditTime!(e.meetingKey!, e.date)}
          className="w-32 shrink-0 text-left font-mono text-xs text-muted-foreground tabular-nums underline decoration-dotted underline-offset-2"
          aria-label={`${e.title} on ${e.date}: edit time (${when})`}
        >
          {when}
          {e.oneOff ? " · this date" : ""}
        </button>
      ) : (
        <span className="w-32 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{when}</span>
      )}
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
  meetings = [],
  hubUrl = null,
  canEditSchedules = false,
  saveSchedule = saveMeetingScheduleAction,
  saveOccurrence = saveMeetingOccurrenceAction,
  save = saveReminderAction,
  remove = deleteReminderAction,
  onMonth,
  onRefresh,
}: {
  view: View;
  month: string;
  today: string;
  /** Each L10 this person may open here, with its schedule and attendees, from the Leadership Hub. */
  meetings?: MeetingDetails[];
  /** The Leadership Hub, for the meetings this app shows but opens there. */
  hubUrl?: string | null;
  /** The person may change a listed meeting's time: its attendees and admins (stored in the Hub, which checks again). */
  canEditSchedules?: boolean;
  saveSchedule?: (input: MeetingScheduleInput) => Promise<MeetingScheduleSaveResult>;
  saveOccurrence?: (input: MeetingOccurrenceInput) => Promise<MeetingScheduleSaveResult>;
  save?: (input: ReminderInput) => Promise<ReminderSaveResult>;
  remove?: (id: string) => Promise<{ ok: boolean }>;
  /**
   * The floating Calendar (calendar-popup.tsx) moves between months and reloads in place: with these, the month buttons
   * and every reload call them instead of changing the page's address. The Calendar page leaves them out.
   */
  onMonth?: (month: string) => void;
  onRefresh?: () => void;
}) {
  const router = useRouter();
  const reload = useCallback(() => (onRefresh ? onRefresh() : router.refresh()), [onRefresh, router]);
  const goMonth = (m: string) => (onMonth ? onMonth(m) : router.push(`?month=${m}`));
  const [openMeeting, setOpenMeeting] = useState<string | null>(null);
  const [editOnOpen, setEditOnOpen] = useState(false);
  // The occurrence the panel was opened from (a day's meeting), and a fresh panel on every open.
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [opens, setOpens] = useState(0);
  const meetingByKey = useMemo(() => new Map(meetings.map((m) => [m.key, m])), [meetings]);
  const opened = openMeeting ? meetingByKey.get(openMeeting) : undefined;
  // A meeting opens its panel only when its details were read; otherwise it stays a link to the L10, as before.
  const openPanel = (key: string, date: string | null, edit: boolean) => {
    setOpenDate(date);
    setEditOnOpen(edit);
    setOpenMeeting(key);
    setOpens((n) => n + 1);
  };
  const onMeeting = (key: string, date?: string) => openPanel(key, date ?? null, false);
  const onEditTime = (key: string, date: string) => openPanel(key, date, true);
  const hasDetails = (key: string) => meetingByKey.has(key);
  const unscheduled = noDaySet(meetings);
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    const onFocus = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [reload]);

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
    reload();
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
        {onMonth ? (
          <>
            <button type="button" onClick={() => goMonth(shiftMonth(month, -1))} aria-label="Previous month" className="rounded-md border border-border px-3 py-1.5 text-sm">
              ‹
            </button>
            <h2 className="m-0 min-w-44 text-center text-lg font-semibold">{monthLabel(month)}</h2>
            <button type="button" onClick={() => goMonth(shiftMonth(month, 1))} aria-label="Next month" className="rounded-md border border-border px-3 py-1.5 text-sm">
              ›
            </button>
            <button type="button" onClick={() => goMonth(monthOf(today))} className="rounded-md px-3 py-1.5 text-sm font-semibold">
              Today
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
        <NewEvent
          today={today}
          save={save}
          onSaved={(d) => {
            setPicked(d);
            if (monthOf(d) !== month) goMonth(monthOf(d));
            else reload();
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
                <EventRow key={e.id} e={e} onDelete={onDelete} onMeeting={onMeeting} hasDetails={hasDetails} onEditTime={canEditSchedules ? onEditTime : undefined} />
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
                <EventRow key={e.id} e={e} onDelete={onDelete} onMeeting={onMeeting} hasDetails={hasDetails} onEditTime={canEditSchedules ? onEditTime : undefined} />
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {opened ? (
        <MeetingPanel
          key={opens}
          meeting={opened}
          date={openDate}
          saveOccurrence={saveOccurrence}
          hubUrl={hubUrl}
          canEdit={canEditSchedules}
          startEditing={editOnOpen}
          saveSchedule={saveSchedule}
          onSaved={reload}
          onClose={() => setOpenMeeting(null)}
        />
      ) : null}

      {unscheduled.length ? (
        <Card role="region" aria-label="No day set" className="p-4">
          <h2 className="m-0 text-sm font-semibold">No day set</h2>
          <p className="m-0 mt-1 text-xs text-muted-foreground">
            {canEditSchedules ? "These L10s are not on the calendar until a day is set. Set one here; it is saved in the Leadership Hub." : "These L10s are not on the calendar until their day is set in the Leadership Hub."}
          </p>
          <ul className="m-0 mt-2 list-none divide-y divide-border p-0">
            {unscheduled.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <button type="button" onClick={() => onMeeting(m.key)} className="font-semibold underline-offset-2 hover:underline" aria-label={`${m.name}: details`}>
                  {m.name}
                </button>
                <span className="text-muted-foreground">
                  {m.attendees.length} {m.attendees.length === 1 ? "attendee" : "attendees"} · day not set
                </span>
                {canEditSchedules ? (
                  <button
                    type="button"
                    className="rounded-md border border-border-strong px-2 py-0.5 text-xs"
                    aria-label={`Set ${m.name} day and time`}
                    onClick={() => openPanel(m.key, null, true)}
                  >
                    Set day and time
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="m-0 text-xs text-muted-foreground">Times are Central. Pick a day to see everything on it. Time-off requests are not shown here.</p>
    </div>
  );
}
