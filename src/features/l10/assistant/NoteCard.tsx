"use client";
// Copied from the Leadership Hub (src/components/assistant/NoteCard.tsx); keep in step with it.

import { useEffect, useId, useState } from "react";
import { Button, cx } from "@/features/l10/ui/ui";
import { sendNoteAction } from "@/features/l10/notifications/actions";
import type { NoteResult } from "@/features/l10/notifications/types";
import { NOTE_MAX, NOTE_MAX_PEOPLE, isNoteDraft, noteRef, outcomeText, type NoteDraft, type NotePerson } from "./notes";
import { CheckIcon, CloseIcon, SendIcon } from "./icons";

type Done = { state: "sent"; results: { id: string; name: string; status: string }[]; message: string } | { state: "dismissed" };

const storeKey = (ref: string) => `lh-assistant:note:${ref}`;
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
    /* private window or storage off: the database still refuses a second send of the same note */
  }
}

const FAIL: Record<Extract<NoteResult, { ok: false }>["reason"], string> = {
  limit: "You've sent the most notes allowed this hour (30). Try again later.",
  forbidden: "You can't send notes in this meeting.",
  invalid: `Check the note: 1 to ${NOTE_MAX} characters, and 1 to ${NOTE_MAX_PEOPLE} people.`,
  unavailable: "The note couldn't be sent just now. Try again in a minute.",
};

/** The draftNote tool call as Ask Sunny's panel has it (the AI SDK's tool part: its id and its output). */
interface ToolPartLike {
  toolCallId?: string;
  result?: unknown;
}

/**
 * The note the assistant drafted, as a card the person checks and sends themselves. Nothing is sent until Send is
 * pressed; then the server action sends it as the signed-in person (the Hub's send_note, through the partner API). Recipients can only be people on
 * the meeting's member list (real hub accounts). The card remembers that it was sent or dismissed on this device, and
 * the database never delivers the same draft twice.
 */
export function NoteCard({ part }: { part: ToolPartLike }) {
  const draft = isNoteDraft(part.result) ? part.result : null;
  if (!draft) return null;
  return <NoteCardBody draft={draft} refId={noteRef(part.toolCallId ?? "")} />;
}

function NoteCardBody({ draft, refId }: { draft: NoteDraft; refId: string }) {
  const uid = useId();
  const [to, setTo] = useState<NotePerson[]>(draft.to);
  const [unclear, setUnclear] = useState(draft.unclear);
  const [message, setMessage] = useState(draft.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  useEffect(() => {
    // Read after mount (the server render has no storage); a card reopened from chat history keeps its outcome.
    const saved = readDone(refId);
    if (saved) setDone(saved); // eslint-disable-line react-hooks/set-state-in-effect
  }, [refId]);

  const add = (p: NotePerson) => setTo((xs) => (xs.some((x) => x.id === p.id) || xs.length >= NOTE_MAX_PEOPLE ? xs : [...xs, p]));
  const remove = (id: string) => setTo((xs) => xs.filter((x) => x.id !== id));
  const pick = (asked: string, p: NotePerson) => {
    add(p);
    setUnclear((xs) => xs.filter((u) => u.asked !== asked));
  };
  const others = draft.people.filter((p) => !to.some((x) => x.id === p.id));
  const text = message.trim();
  const canSend = !busy && to.length > 0 && text.length > 0 && text.length <= NOTE_MAX;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendNoteAction(draft.meeting.key, to.map((p) => p.id), text, refId);
      if (!res.ok) {
        setError(FAIL[res.reason]);
        return;
      }
      const result: Done = { state: "sent", results: res.results, message: text };
      writeDone(refId, result);
      setDone(result);
    } catch {
      setError(FAIL.unavailable);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    const result: Done = { state: "dismissed" };
    writeDone(refId, result);
    setDone(result);
  };

  if (done?.state === "dismissed") {
    return (
      <p className="my-2 text-xs font-semibold text-muted" data-testid="note-card-dismissed">
        Note not sent.
      </p>
    );
  }

  if (done?.state === "sent") {
    return (
      <section aria-label="Note sent" data-testid="note-card" className="my-2 flex w-full max-w-xl flex-col gap-2 rounded-2xl bg-white/80 p-4 ring-1 ring-white">
        <p className="m-0 text-xs font-bold tracking-wide text-bronze-deep uppercase">Hub notification</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-label="Who got the note">
          {done.results.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              {r.status === "sent" || r.status === "already_sent" ? <CheckIcon width={16} height={16} className="shrink-0 text-bronze-deep" /> : <span aria-hidden className="size-4 shrink-0" />}
              <span className="font-semibold">{r.name}</span>
              <span className={cx("text-muted", r.status !== "sent" && r.status !== "already_sent" && "text-warn-ink")}>{outcomeText(r.status)}</span>
            </li>
          ))}
        </ul>
        <p className="m-0 border-l-2 border-gold pl-3 text-sm whitespace-pre-line text-[#444]">{done.message}</p>
      </section>
    );
  }

  return (
    <section aria-label="Note to send" data-testid="note-card" className="my-2 flex w-full max-w-xl flex-col gap-3 rounded-2xl bg-white/80 p-4 ring-1 ring-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="m-0 text-xs font-bold tracking-wide text-bronze-deep uppercase">Hub notification · not sent yet</p>
        <p className="m-0 text-xs text-muted">{draft.meeting.name} members</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-semibold">To</span>
        {to.map((p) => (
          <span key={p.id} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-sunny py-1 pr-1 pl-3 text-sm font-semibold ring-1 ring-bronze/30">
            {p.name}
            <button type="button" aria-label={`Remove ${p.name}`} onClick={() => remove(p.id)} className="inline-flex size-7 items-center justify-center rounded-full hover:bg-ink/10">
              <CloseIcon width={14} height={14} />
            </button>
          </span>
        ))}
        {others.length > 0 && to.length < NOTE_MAX_PEOPLE && (
          <select
            aria-label="Add person"
            value=""
            onChange={(e) => {
              const p = draft.people.find((x) => x.id === e.target.value);
              if (p) add(p);
            }}
            className="min-h-9 rounded-full bg-white px-3 text-sm font-semibold text-bronze-deep ring-1 ring-line"
          >
            <option value="">+ Add person</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {unclear.map((u) => (
        <div key={u.asked} role="group" aria-label={`Who is ${u.asked}?`} className="flex flex-wrap items-center gap-1.5 rounded-xl bg-cream px-3 py-2 text-sm">
          {u.options.length ? (
            <>
              <span>
                Who is <b>&ldquo;{u.asked}&rdquo;</b>?
              </span>
              {u.options.map((p) => (
                <Button key={p.id} variant="outline" className="min-h-9 px-3 py-1 text-sm" onClick={() => pick(u.asked, p)}>
                  {p.name}
                </Button>
              ))}
            </>
          ) : (
            <span>
              Nobody named <b>&ldquo;{u.asked}&rdquo;</b> is in {draft.meeting.name}. Use <b>Add person</b> to choose.
            </span>
          )}
        </div>
      ))}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${uid}-msg`} className="text-sm font-semibold">
          Note
        </label>
        <textarea
          id={`${uid}-msg`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={NOTE_MAX}
          rows={4}
          className="w-full resize-y rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-bronze"
        />
        <span className="self-end text-xs text-muted">
          {text.length}/{NOTE_MAX}
        </span>
      </div>

      <p className="m-0 text-xs text-muted">They&rsquo;ll get it in the bell, from you. Nothing is sent until you press Send.</p>
      {error && (
        <p role="alert" className="m-0 text-sm font-semibold text-warn-ink">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!canSend} onClick={send} className="inline-flex items-center gap-2">
          <SendIcon width={16} height={16} />
          {busy ? "Sending…" : to.length > 1 ? `Send to ${to.length} people` : "Send notification"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={dismiss}>
          Don&rsquo;t send
        </Button>
      </div>
    </section>
  );
}
