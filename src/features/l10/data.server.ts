import "server-only";

import { pageAuthorizationEnforced, pageIdentity } from "@/lib/auth/page";
import { callHub, hubPartnerConfig, type HubAnswer } from "./partner/client.server";
import { isMeetingKey, type Roster } from "./lib/config";
import type { LoadedMeeting, MeetingInfo, RecapInput, RecapRow } from "./lib/types";
import type { AppNotification, NoteResult, NoteStatus } from "./notifications/types";

/**
 * THE DM L10 TAB'S DATA, READ AND WRITTEN IN THE LEADERSHIP HUB.
 *
 * Same function names and result shapes as the Hub's src/lib/meetings/data.server.ts, so the copied page code is
 * unchanged; the difference is where they go. Every call:
 *   1. takes the person from the VERIFIED session (`l10Viewer`): a live Supabase session whose app_users row is
 *      active. Signed out, invited, disabled or revoked (banned) accounts get nothing. Demo mode gets nothing.
 *   2. sends that person's email to the Hub, signed (partner/client.server.ts).
 *   3. lets the Hub's database decide: the Hub account with that email, its meeting role, and the allowlist.
 * Nothing here decides access on its own, and nothing is cached across people.
 */

export type Unavailable = { ok: false; reason: "not-configured" | "unavailable" | "forbidden" };

export type SaveOutcome =
  | { ok: true; version: number; updatedAt: string }
  | { ok: false; kind: "stale"; latest: LoadedMeeting }
  | { ok: false; kind: "forbidden" | "invalid" | "unavailable"; message: string };

export type EndOutcome = { ok: true; created: boolean } | { ok: false; kind: "forbidden" | "invalid" | "unavailable"; message: string };

export interface HistoryRow {
  version: number;
  savedAt: string;
  savedByName: string | null;
  isCurrent: boolean;
  isImport: boolean;
  source: string | null;
  bytes: number;
}

export interface L10Viewer {
  email: string;
  displayName: string;
  /** Ask Sunny's own user id and role, for its spend guard (never sent to the Hub). */
  userId: string;
  role: string;
}

/** The signed-in person, only when their identity is verified (never in demo mode or without the partner secret). */
export async function l10Viewer(): Promise<L10Viewer | null> {
  try {
    if (!hubPartnerConfig()) return null;
    if (!pageAuthorizationEnforced()) return null;
    const identity = await pageIdentity();
    if (!identity?.verified || !identity.email) return null;
    return { email: identity.email, displayName: identity.displayName, userId: identity.subject, role: identity.role };
  } catch {
    return null;
  }
}

function failure(a: HubAnswer): Unavailable {
  if (a.status === 404) return { ok: false, reason: "forbidden" };
  if (a.status === 0 && a.body.error === "not_configured") return { ok: false, reason: "not-configured" };
  return { ok: false, reason: "unavailable" };
}

/* ── Which meetings (the tab) ─────────────────────────────────────────── */

/**
 * The meetings the signed-in person may open here (the Hub's answer: allowlisted AND they hold the role). Empty for
 * everyone else and on any error, so the tab fails closed. Used by the (app) layout to show the tab.
 */
export async function listMyMeetings(): Promise<MeetingInfo[]> {
  const viewer = await l10Viewer();
  if (!viewer) return [];
  const a = await callHub("whoami", viewer.email);
  if (a.status !== 200 || !Array.isArray(a.body.meetings)) return [];
  return (a.body.meetings as MeetingInfo[]).filter((m) => m && typeof m.key === "string" && isMeetingKey(m.key));
}

/** Ask Sunny's name for each meeting's tab. */
export const L10_TAB_LABELS: Record<string, string> = { "stc-dm": "DM L10" };

export interface L10Tab {
  key: string;
  href: string;
  label: string;
}

const TAB_TTL_MS = 5 * 60_000;
const tabCache = new Map<string, { at: number; tabs: L10Tab[] }>();

/**
 * The sidebar's DM L10 tab(s) for the signed-in person: one Hub call per person at most every five minutes (the
 * layout renders on every navigation). This only decides whether the LINK shows; the page and every action ask the
 * Hub again, uncached. Empty on any error, so the tab fails closed.
 */
export async function l10TabsForLayout(now = Date.now()): Promise<L10Tab[]> {
  try {
    const viewer = await l10Viewer();
    if (!viewer) return [];
    const id = viewer.email.toLowerCase();
    const hit = tabCache.get(id);
    if (hit && now - hit.at < TAB_TTL_MS) return hit.tabs;
    const tabs = (await listMyMeetings()).map((m) => ({ key: m.key, href: `/meetings/${m.key}`, label: L10_TAB_LABELS[m.key] ?? m.name }));
    if (tabCache.size > 2000) tabCache.clear();
    tabCache.set(id, { at: now, tabs });
    return tabs;
  } catch {
    return [];
  }
}

export function resetL10TabCache(): void {
  tabCache.clear();
}

/* ── One meeting ──────────────────────────────────────────────────────── */

export interface OpenedMeeting {
  info: MeetingInfo;
  /** The Hub account this person acts as (its id is what the meeting clock and votes record). */
  viewer: { id: string; label: string; name: string; /** The Hub says this account is a hub admin (display only: every admin action is checked again by the Hub). */ isHubAdmin: boolean };
  loaded: LoadedMeeting;
  people: { id: string; name: string }[];
  roster: Roster;
}

/** Everything the page needs in one call. `forbidden` for a meeting the person may not open here (the page 404s). */
export async function openMeeting(key: string): Promise<{ ok: true; meeting: OpenedMeeting } | Unavailable> {
  if (!isMeetingKey(key)) return { ok: false, reason: "forbidden" };
  const viewer = await l10Viewer();
  if (!viewer) return hubPartnerConfig() ? { ok: false, reason: "forbidden" } : { ok: false, reason: "not-configured" };
  const a = await callHub("meeting", viewer.email, { key });
  if (a.status !== 200) return failure(a);
  const b = a.body as { info: MeetingInfo; viewer: { id: string; name: string | null; isHubAdmin?: boolean }; loaded: LoadedMeeting; people: { id: string; name: string }[]; roster: Roster };
  const name = (b.viewer.name ?? "").split(/\s+/)[0] || viewer.displayName.split(/\s+/)[0] || viewer.email;
  return {
    ok: true,
    meeting: {
      info: b.info,
      viewer: { id: b.viewer.id, label: viewer.email, name, isHubAdmin: b.viewer.isHubAdmin === true },
      loaded: b.loaded,
      people: Array.isArray(b.people) ? b.people : [],
      roster: {
        members: Array.isArray(b.roster?.members) ? b.roster.members : [],
        leader: b.roster?.leader ?? null,
        // The Hub's agenda and section hints for this meeting (the page checks their shape and falls back to its copy).
        ...(Array.isArray(b.roster?.agenda) ? { agenda: b.roster.agenda } : {}),
        ...(b.roster?.hints && typeof b.roster.hints === "object" ? { hints: b.roster.hints } : {}),
      },
    },
  };
}

export async function loadMeeting(key: string): Promise<{ ok: true; loaded: LoadedMeeting } | Unavailable> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("load", viewer.email, { key });
  return a.status === 200 ? { ok: true, loaded: a.body.loaded as LoadedMeeting } : failure(a);
}

export async function saveMeeting(key: string, expectedVersion: number, doc: Record<string, unknown>): Promise<SaveOutcome> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, kind: "forbidden", message: "You do not have access to save this meeting." };
  const a = await callHub("save", viewer.email, { key, expectedVersion, doc });
  if (a.status === 200) return { ok: true, version: a.body.version as number, updatedAt: a.body.updatedAt as string };
  if (a.status === 409) return { ok: false, kind: "stale", latest: a.body.latest as LoadedMeeting };
  if (a.status === 404) return { ok: false, kind: "forbidden", message: "You do not have access to save this meeting." };
  if (a.status === 400 || a.status === 413) return { ok: false, kind: "invalid", message: "This meeting could not be saved (it may be too large)." };
  return { ok: false, kind: "unavailable", message: "The save did not go through. Your changes are still on this page." };
}

export async function endMeeting(key: string, input: RecapInput): Promise<EndOutcome> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, kind: "forbidden", message: "You do not have access to end this meeting." };
  const a = await callHub("end", viewer.email, { key, recap: input });
  if (a.status === 200) return { ok: true, created: a.body.created === true };
  if (a.status === 404) return { ok: false, kind: "forbidden", message: "You do not have access to end this meeting." };
  if (a.status === 400) return { ok: false, kind: "invalid", message: "The recap could not be saved (check the ratings and length)." };
  return { ok: false, kind: "unavailable", message: "The recap was not saved. Nothing was lost: try again." };
}

export async function listRecaps(key: string): Promise<{ ok: true; recaps: RecapRow[] } | Unavailable> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("recaps", viewer.email, { key });
  return a.status === 200 && Array.isArray(a.body.recaps) ? { ok: true, recaps: a.body.recaps as RecapRow[] } : failure(a);
}

/* ── Version history ──────────────────────────────────────────────────── */

export async function listHistory(key: string, limit = 25, beforeVersion?: number): Promise<{ ok: true; rows: HistoryRow[] } | Unavailable> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("history-list", viewer.email, { key, limit, ...(beforeVersion ? { before: beforeVersion } : {}) });
  return a.status === 200 && Array.isArray(a.body.rows) ? { ok: true, rows: a.body.rows as HistoryRow[] } : failure(a);
}

export async function getVersionRange(key: string, from: number, to: number): Promise<{ ok: true; docs: Map<number, Record<string, unknown>> } | Unavailable> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("history-range", viewer.email, { key, from, to });
  if (a.status !== 200 || !Array.isArray(a.body.docs)) return failure(a);
  return { ok: true, docs: new Map((a.body.docs as { version: number; doc: Record<string, unknown> }[]).map((d) => [d.version, d.doc ?? {}])) };
}

export async function getVersion(key: string, version: number): Promise<{ ok: true; doc: Record<string, unknown> | null } | Unavailable> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("history-get", viewer.email, { key, version });
  if (a.status !== 200) return failure(a);
  const doc = a.body.doc;
  return { ok: true, doc: doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : null };
}

/* ── Notifications (the same notes and read state as the Hub's bell) ──── */

export async function listNotifications(limit = 100): Promise<{ ok: true; notifications: AppNotification[] } | Unavailable> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("notifications-list", viewer.email, { limit });
  return a.status === 200 && Array.isArray(a.body.notifications) ? { ok: true, notifications: a.body.notifications as AppNotification[] } : failure(a);
}

export async function unreadCount(): Promise<number | null> {
  const viewer = await l10Viewer();
  if (!viewer) return null;
  const a = await callHub("notifications-count", viewer.email);
  return a.status === 200 && typeof a.body.count === "number" ? a.body.count : null;
}

export async function markRead(ids: string[]): Promise<boolean> {
  const viewer = await l10Viewer();
  if (!viewer) return false;
  return (await callHub("notifications-mark-read", viewer.email, { ids })).status === 200;
}

export async function markAllRead(): Promise<boolean> {
  const viewer = await l10Viewer();
  if (!viewer) return false;
  return (await callHub("notifications-mark-all-read", viewer.email)).status === 200;
}

/* ── Notes (the assistant's note card; the Hub's send_note) ──────────── */

const NOTE_STATUSES: readonly NoteStatus[] = ["sent", "already_sent", "not_in_meeting", "muted", "self"];

/**
 * Sends the note on the assistant's card, as the verified signed-in person, through the Hub's send_note (same limits,
 * same bell). Recipients must be people the Hub lists for this meeting right now: anything else is refused here,
 * before the Hub is asked to send, and the Hub checks again.
 */
export async function sendNote(input: { meetingKey: string; recipientIds: string[]; text: string; ref: string }): Promise<NoteResult> {
  const opened = await openMeeting(input.meetingKey);
  if (!opened.ok) return { ok: false, reason: opened.reason === "forbidden" ? "forbidden" : "unavailable" };
  const listed = new Set(opened.meeting.people.map((p) => p.id));
  if (!input.recipientIds.every((id) => listed.has(id))) return { ok: false, reason: "invalid" };
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, reason: "forbidden" };
  const a = await callHub("send-note", viewer.email, { key: input.meetingKey, recipientIds: input.recipientIds, text: input.text, ref: input.ref });
  if (a.status === 404) return { ok: false, reason: "forbidden" };
  if (a.status === 400) return { ok: false, reason: "invalid" };
  if (a.status !== 200) return { ok: false, reason: "unavailable" };
  const body = a.body as { ok?: unknown; reason?: unknown; results?: unknown };
  if (body.ok !== true) {
    const reason = body.reason;
    return { ok: false, reason: reason === "limit" || reason === "invalid" || reason === "forbidden" ? reason : "unavailable" };
  }
  const results = (Array.isArray(body.results) ? body.results : []).flatMap((r: unknown) => {
    const o = r as { id?: unknown; name?: unknown; status?: unknown };
    return typeof o.id === "string" && NOTE_STATUSES.includes(o.status as NoteStatus)
      ? [{ id: o.id, name: typeof o.name === "string" ? o.name : "Someone", status: o.status as NoteStatus }]
      : [];
  });
  return { ok: true, results };
}

/* ── Hub admin actions (the Hub's rules: hub_admin only, checked by the Hub every time) ── */

export type RestoreOutcome = { ok: true; version: number } | { ok: false; message: string };

/** Restore an old version (the Hub's restoreVersionAction, run by the Hub for this person): saved as a NEW version. */
export async function restoreVersion(key: string, version: number): Promise<RestoreOutcome> {
  const viewer = await l10Viewer();
  if (!viewer || !isMeetingKey(key)) return { ok: false, message: "You do not have access to this meeting." };
  const a = await callHub("restore-version", viewer.email, { key, version });
  if (a.status === 404) return { ok: false, message: "You do not have access to this meeting." };
  if (a.status !== 200) return { ok: false, message: "The restore did not go through. Nothing was changed." };
  const b = a.body as { ok?: boolean; version?: number; message?: string };
  return b.ok === true && typeof b.version === "number" ? { ok: true, version: b.version } : { ok: false, message: typeof b.message === "string" ? b.message : "The restore did not go through. Nothing was changed." };
}

export type DeleteOutcome = { ok: true; already: boolean } | { ok: false; kind: "forbidden" | "invalid" | "unavailable"; message: string };

/** Soft-deletes one recap (the Hub's l10_delete_recap: hub admins only, recaps of this tab's meeting only). */
export async function deleteRecap(id: string): Promise<DeleteOutcome> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, kind: "forbidden", message: "Only hub admins can delete recaps." };
  const a = await callHub("delete-recap", viewer.email, { id });
  if (a.status === 404) return { ok: false, kind: "forbidden", message: "Only hub admins can delete recaps." };
  const b = a.body as { ok?: boolean; already?: boolean; kind?: string; message?: string };
  if (a.status === 200 && b.ok === true) return { ok: true, already: b.already === true };
  const kind = b.kind === "forbidden" || b.kind === "invalid" ? b.kind : "unavailable";
  return { ok: false, kind, message: typeof b.message === "string" ? b.message : "The recap was not deleted. Nothing changed: try again." };
}

/* ── Files on an issue (the Hub's own file code, run by the Hub for this person; Storage stays in the Hub) ── */

export type FileReply<T> = { ok: true; data: T } | { ok: false; error: { kind: string; message: string } };

const fileUnavailable = { ok: false as const, error: { kind: "unavailable", message: "The file could not be handled just now. Try again in a moment." } };

export async function fileOp<T>(op: "file-prepare" | "file-finish" | "file-open", args: Record<string, unknown>): Promise<FileReply<T>> {
  const viewer = await l10Viewer();
  if (!viewer) return { ok: false, error: { kind: "forbidden", message: "You do not have permission to add files to this meeting." } };
  const a = await callHub(op, viewer.email, args);
  if (a.status === 404) return { ok: false, error: { kind: "forbidden", message: "You do not have permission to add files to this meeting." } };
  if (a.status !== 200) return fileUnavailable;
  const b = a.body as { ok?: boolean; data?: T; error?: { kind?: unknown; message?: unknown } };
  if (b.ok === true && b.data !== undefined) return { ok: true, data: b.data };
  if (b.ok === false && b.error && typeof b.error.message === "string") return { ok: false, error: { kind: typeof b.error.kind === "string" ? b.error.kind : "unavailable", message: b.error.message } };
  return fileUnavailable;
}
