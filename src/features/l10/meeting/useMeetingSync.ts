"use client";
// Copied from the Leadership Hub (src/app/meetings/useMeetingSync.ts); keep in step with it. See src/features/l10/README.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { readDoc } from "@/features/l10/lib/doc";
import { mergeThreeWay } from "@/features/l10/lib/merge";
import type { SaveOutcome } from "@/features/l10/data.server";
import type { LoadedMeeting, MeetingDoc } from "@/features/l10/lib/types";

export type LoadFn = (key: string) => Promise<({ ok: true; loaded: LoadedMeeting } | { ok: false }) & { serverTime?: number }>;

export type SaveFn = (key: string, expectedVersion: number, doc: Record<string, unknown>) => Promise<SaveOutcome & { serverTime?: number }>;

export type SyncStatus =
  | { kind: "empty" } // nothing saved yet, nothing edited
  | { kind: "saved" }
  | { kind: "saving" }
  | { kind: "failed"; message: string }
  | { kind: "conflict" };

/** The save-status line, in plain words (shared by every page that edits a meeting document). */
export function statusText(s: SyncStatus): string {
  switch (s.kind) {
    case "empty":
      return "Nothing saved yet. Changes save as you go.";
    case "saved":
      return "All changes saved";
    case "saving":
      return "Saving…";
    case "failed":
      return `Not saved: ${s.message}`;
    case "conflict":
      return "Someone else changed this: choose below";
  }
}

export interface Conflict {
  /** Places where both people changed the same thing, in plain words. */
  places: string[];
  mine: MeetingDoc;
  theirs: MeetingDoc;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps one meeting's document in step with the database.
 *  - Opening a meeting never writes. Only an edit starts a save.
 *  - Every save names the version it was based on. If someone else saved first, their
 *    changes and yours are merged item by item; only a clash on the same value asks you.
 *  - The status is honest: "saved" only after the database confirmed it.
 */
export function useMeetingSync({ meetingKey, initial, save, load, serverTime, pollMs = 4000, debounceMs = 800 }: { meetingKey: string; initial: LoadedMeeting; save: SaveFn; load?: LoadFn; serverTime?: number; pollMs?: number; debounceMs?: number }) {
  const [doc, setDoc] = useState<MeetingDoc>(() => readDoc(initial.doc));
  const [status, setStatus] = useState<SyncStatus>({ kind: initial.version === 0 ? "empty" : "saved" });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [tick, setTick] = useState(0);

  const docRef = useRef<MeetingDoc>(doc);
  const baseRef = useRef<{ version: number; doc: MeetingDoc }>({ version: initial.version, doc: readDoc(initial.doc) });
  const savingRef = useRef(false);
  // How far this laptop's clock is from the server's. Starts from the time the page was rendered and is refined by every
  // save and refresh, so a clock that is wrong by minutes does not skew the shared meeting timer.
  const skewRef = useRef<number>(0);
  useEffect(() => {
    if (serverTime) skewRef.current = serverTime - Date.now();
  }, [serverTime]);
  const noteServerTime = useCallback((t?: number) => {
    if (typeof t === "number") skewRef.current = t - Date.now();
  }, []);
  const serverNow = useCallback(() => Date.now() + skewRef.current, []);
  const conflictRef = useRef<Conflict | null>(null);

  const edit = useCallback((fn: (d: MeetingDoc) => MeetingDoc) => {
    const next = fn(docRef.current);
    docRef.current = next;
    setDoc(next);
    // From the moment something changes, the page must not claim it is saved.
    setStatus((s) => (s.kind === "conflict" ? s : { kind: "saving" }));
    setTick((t) => t + 1);
  }, []);

  const flush = useCallback(async () => {
    if (savingRef.current || conflictRef.current) return;
    const sent = docRef.current;
    if (same(sent, baseRef.current.doc)) {
      setStatus({ kind: "saved" }); // edited back to what is already saved
      return;
    }
    savingRef.current = true;
    setStatus({ kind: "saving" });
    let res: SaveOutcome;
    try {
      const timed = await save(meetingKey, baseRef.current.version, sent as Record<string, unknown>);
      noteServerTime(timed.serverTime);
      res = timed;
    } catch {
      res = { ok: false, kind: "unavailable", message: "The save did not go through. Your changes are still on this page." };
    }
    savingRef.current = false;

    if (res.ok) {
      baseRef.current = { version: res.version, doc: sent };
      if (same(docRef.current, sent)) setStatus({ kind: "saved" });
      else setTick((t) => t + 1); // edited while saving: save again
      return;
    }
    if (res.kind === "stale") {
      const remote = readDoc(res.latest.doc);
      const base = baseRef.current.doc;
      const theirsFirst = mergeThreeWay(base, docRef.current, remote, "", "remote");
      const mineFirst = mergeThreeWay(base, docRef.current, remote, "", "local");
      const merged = readDoc(theirsFirst.merged as Record<string, unknown>);
      baseRef.current = { version: res.latest.version, doc: remote };
      docRef.current = merged;
      setDoc(merged);
      if (theirsFirst.conflicts.length === 0) {
        setTick((t) => t + 1); // their changes and mine are both in: save again on top of theirs
        return;
      }
      // Only the clashing values differ between the two choices; everything else is already merged.
      const c = { places: theirsFirst.conflicts, mine: readDoc(mineFirst.merged as Record<string, unknown>), theirs: merged };
      conflictRef.current = c;
      setConflict(c);
      setStatus({ kind: "conflict" });
      return;
    }
    setStatus({ kind: "failed", message: res.message });
  }, [meetingKey, save, noteServerTime]);

  useEffect(() => {
    if (tick === 0) return; // nothing edited yet: never write on open
    const t = setTimeout(() => void flush(), debounceMs);
    return () => clearTimeout(t);
  }, [tick, flush, debounceMs]);

  // Keep this screen in step with the rest of the meeting: look for a newer version every few seconds and when the
  // window regains focus. A screen with unsaved edits of its own is left alone; its next save merges instead.
  useEffect(() => {
    if (!load || !pollMs) return;
    let stopped = false;
    const pull = async () => {
      const clean = () => !savingRef.current && !conflictRef.current && same(docRef.current, baseRef.current.doc);
      if (!clean()) return;
      let res: Awaited<ReturnType<LoadFn>>;
      try {
        res = await load(meetingKey);
        noteServerTime(res.serverTime);
      } catch {
        return;
      }
      if (stopped || !res.ok || res.loaded.version <= baseRef.current.version || !clean()) return;
      const remote = readDoc(res.loaded.doc);
      baseRef.current = { version: res.loaded.version, doc: remote };
      docRef.current = remote;
      setDoc(remote);
      setStatus({ kind: "saved" });
    };
    const id = setInterval(() => void pull(), pollMs);
    const onFocus = () => void pull();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, meetingKey, pollMs, noteServerTime]);

  const resolveConflict = useCallback((choice: "mine" | "theirs") => {
    const c = conflictRef.current;
    if (!c) return;
    conflictRef.current = null;
    setConflict(null);
    const next = choice === "mine" ? c.mine : c.theirs;
    docRef.current = next;
    setDoc(next);
    if (choice === "mine") {
      setStatus({ kind: "saving" });
      setTick((t) => t + 1);
    } else {
      setStatus({ kind: "saved" });
    }
  }, []);

  const retry = useCallback(() => void flush(), [flush]);

  /** Saves now and says whether everything on the page is saved. */
  const flushNow = useCallback(async () => {
    while (savingRef.current) await new Promise((r) => setTimeout(r, 25));
    await flush();
    return !conflictRef.current && same(docRef.current, baseRef.current.doc);
  }, [flush]);

  // Leaving with a change that is not saved yet asks first.
  const unsaved = status.kind === "saving" || status.kind === "failed" || status.kind === "conflict";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return { doc, edit, status, conflict, resolveConflict, retry, flushNow, serverNow };
}
