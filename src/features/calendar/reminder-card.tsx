"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { REMINDER_TITLE_MAX, SAVE_FAIL, VISIBILITIES, VISIBILITY_HINT, VISIBILITY_LABEL, whenLabel, type ReminderInput, type ReminderSaveResult, type Visibility } from "@/lib/calendar/reminders";
import { saveReminderAction } from "./actions";

type Proposal = { title: string; date: string; time: string | null; visibility: Visibility };
type Done = { state: "saved"; proposal: Proposal } | { state: "dismissed" };

const storeKey = (ref: string) => `ask-sunny:reminder-card:${ref}`;
function readDone(ref: string): Done | null {
  try {
    const raw = window.localStorage.getItem(storeKey(ref));
    return raw ? (JSON.parse(raw) as Done) : null;
  } catch {
    return null;
  }
}
function writeDone(ref: string, done: Done) {
  try {
    window.localStorage.setItem(storeKey(ref), JSON.stringify(done));
  } catch {
    /* storage off: the server still keeps one reminder per card (owner + ref) */
  }
}

/**
 * THE CHAT'S REMINDER CARD ("add a reminder to my calendar for January 20 titled Order lamps"). The AI proposed it
 * (propose_reminder); nothing is on the calendar until the manager presses Add to calendar, which saves it as them
 * through the Calendar's own server action. The card then says what was added, when and who can see it. One reminder
 * per card, however many times it is pressed.
 */
export function ReminderProposalCard({ proposal, refId, save = saveReminderAction }: { proposal: Proposal; refId: string; save?: (input: ReminderInput) => Promise<ReminderSaveResult> }) {
  const ref = refId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "r-card";
  const [title, setTitle] = useState(proposal.title);
  const [date, setDate] = useState(proposal.date);
  const [time, setTime] = useState(proposal.time ?? "");
  const [visibility, setVisibility] = useState<Visibility>(proposal.visibility);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  useEffect(() => {
    const saved = readDone(ref);
    if (saved) setDone(saved); // eslint-disable-line react-hooks/set-state-in-effect
  }, [ref]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await save({ title: title.trim(), date, time: time || null, visibility, ref });
      if (!r.ok) return setError(SAVE_FAIL[r.reason]);
      const result: Done = { state: "saved", proposal: { title: title.trim(), date, time: time || null, visibility } };
      writeDone(ref, result);
      setDone(result);
    } catch {
      setError(SAVE_FAIL.unavailable);
    } finally {
      setBusy(false);
    }
  };

  if (done?.state === "dismissed") return <p className="mt-2 text-xs text-muted-foreground">Reminder not added.</p>;
  if (done?.state === "saved") {
    const p = done.proposal;
    return (
      <section aria-label="Reminder added" className="mt-3 grid gap-1 rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-sm">
        <p className="m-0 text-xs font-semibold tracking-wide text-primary uppercase">Added to your calendar</p>
        <p className="m-0 font-semibold">{p.title}</p>
        <p className="m-0 text-muted-foreground">{whenLabel(p.date, p.time)}</p>
        <p className="m-0 text-muted-foreground">
          {VISIBILITY_LABEL[p.visibility]}: {VISIBILITY_HINT[p.visibility]}{" "}
          <Link href={`/calendar?month=${p.date.slice(0, 7)}`} className="underline">
            Open the calendar
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Reminder to add" className="mt-3 grid gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-sm">
      <p className="m-0 text-xs font-semibold tracking-wide text-primary uppercase">Calendar reminder · not added yet</p>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        Title
        <Input value={title} maxLength={REMINDER_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
          Time (CT, optional)
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        Who can see it
        <Select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABEL[v]}
            </option>
          ))}
        </Select>
      </label>
      {error ? (
        <p role="alert" className="m-0 text-status-failed">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !title.trim() || !date} onClick={submit}>
          {busy ? "Adding…" : "Add to calendar"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const d: Done = { state: "dismissed" };
            writeDone(ref, d);
            setDone(d);
          }}
        >
          Don&apos;t add
        </Button>
      </div>
    </section>
  );
}
