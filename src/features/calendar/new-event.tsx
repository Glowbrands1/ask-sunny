"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/overlays";
import { REMINDER_TITLE_MAX, SAVE_FAIL, VISIBILITIES, VISIBILITY_HINT, VISIBILITY_LABEL, type ReminderInput, type ReminderSaveResult, type Visibility } from "@/lib/calendar/reminders";

const newRef = () => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * "+ New event": a personal reminder. "Only me" by default; "My team" shows it to the leaders above and below the
 * person. Saved as the signed-in person (the server action reads who they are from the session).
 */
export function NewEvent({ today, save, onSaved }: { today: string; save: (input: ReminderInput) => Promise<ReminderSaveResult>; onSaved: (date: string) => void }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("only_me");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState(newRef);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await save({ title: title.trim(), date, time: time || null, visibility, ref });
    setBusy(false);
    if (!r.ok) return setError(SAVE_FAIL[r.reason]);
    setOpen(false);
    onSaved(date);
    setTitle("");
    setDate(today);
    setTime("");
    setVisibility("only_me");
    setRef(newRef());
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        + New event
      </Button>
      <DialogContent title="New reminder" className="p-6">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label htmlFor={`${uid}-title`}>Title</Label>
          <Input id={`${uid}-title`} value={title} maxLength={REMINDER_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="Order lamps" autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor={`${uid}-date`}>Date</Label>
              <Input id={`${uid}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${uid}-time`}>Time (CT, optional)</Label>
              <Input id={`${uid}-time`} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">Who can see it</legend>
            {VISIBILITIES.map((v) => (
              <label key={v} className="flex items-start gap-2 text-sm">
                <input type="radio" name={`${uid}-vis`} checked={visibility === v} onChange={() => setVisibility(v)} className="mt-1" />
                <span>
                  {VISIBILITY_LABEL[v]} <span className="text-xs text-muted-foreground">{VISIBILITY_HINT[v]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="m-0 text-sm text-status-failed">
              {error}
            </p>
          ) : null}
          <DialogActions>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim() || !date}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
