// Copied from the Leadership Hub (src/lib/notifications/logic.ts); keep in step with it. See src/features/l10/README.md.
import { PREF_KINDS, type AppNotification, type NotificationKind, type NotificationPrefs, type PrefKind } from "./types";

/** Defaults, mirroring app.notification_default in the database (decision 1). */
export const DEFAULT_PREFS: NotificationPrefs = {
  mention: true,
  todo_assigned: true,
  rock_added: true,
  rock_changed: true,
  issue_added: false,
  issue_solved: true,
  recap_saved: true,
  ai_suggestion: true,
  edited: false,
  message: true,
};

export const KIND_LABEL: Record<PrefKind, { title: string; hint: string }> = {
  mention: { title: "Someone mentions me", hint: "When a person picks your name with @ in a meeting." },
  todo_assigned: { title: "A to-do is given to me", hint: "When someone else adds or reassigns a to-do to you." },
  rock_added: { title: "A rock is added for me", hint: "When a rock is created with you as its owner." },
  rock_changed: { title: "A rock of mine changes", hint: "Its status changes, or a milestone is added, ticked or removed." },
  issue_added: { title: "An issue is added", hint: "Any new issue in a meeting you attend. Can be chatty." },
  issue_solved: { title: "An issue is solved", hint: "In a meeting you attend." },
  recap_saved: { title: "A recap is saved", hint: "When a meeting you attend ends and its recap is saved." },
  ai_suggestion: { title: "An assistant suggestion is waiting", hint: "Only once assistant suggestions exist; nothing is sent today." },
  edited: { title: "Someone edits something of mine", hint: "Off by default. Not sent yet." },
  message: { title: "Someone sends me a note", hint: "A short note a teammate sends you, for example through the Leadership Assistant." },
};

export function isPrefKind(v: unknown): v is PrefKind {
  return typeof v === "string" && (PREF_KINDS as readonly string[]).includes(v);
}

const KINDS: readonly string[] = [...PREF_KINDS, "more"];

/** What the note says, without the excerpt. Plain text. */
export function headline(n: Pick<AppNotification, "kind" | "actor_name" | "count">): string {
  const who = n.actor_name?.trim() || "Someone";
  const base: Record<NotificationKind, string> = {
    mention: `${who} mentioned you`,
    todo_assigned: `${who} gave you a to-do`,
    rock_added: `${who} added a rock for you`,
    rock_changed: `${who} changed a rock of yours`,
    issue_added: `${who} added an issue`,
    issue_solved: `${who} solved an issue`,
    recap_saved: `A recap was saved`,
    ai_suggestion: `A suggestion is waiting for you`,
    edited: `${who} edited something of yours`,
    message: `${who} sent you a note`,
    more: `More activity`,
  };
  const text = base[n.kind] ?? "Activity";
  return n.count > 1 && n.kind !== "more" ? `${text} (${n.count} times)` : text;
}

/** The meeting page a note opens. The meeting's own access check still applies. */
export function noteHref(n: Pick<AppNotification, "meeting_key">): string {
  return /^[a-z][a-z-]*$/.test(n.meeting_key) ? `/meetings/${n.meeting_key}` : "/meetings";
}

/** "Just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The number on the bell: nothing at 0, "99+" above 99. */
export function badgeText(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** Validates what the database returned; anything unexpected is dropped rather than shown. */
export function parseNotifications(data: unknown): AppNotification[] | null {
  if (!Array.isArray(data)) return null;
  const out: AppNotification[] = [];
  for (const r of data) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.kind !== "string" || !KINDS.includes(o.kind) || typeof o.meeting_key !== "string") continue;
    out.push({
      id: o.id,
      kind: o.kind as NotificationKind,
      meeting_key: o.meeting_key,
      meeting_name: typeof o.meeting_name === "string" ? o.meeting_name : o.meeting_key,
      item_id: typeof o.item_id === "string" ? o.item_id : "",
      excerpt: typeof o.excerpt === "string" ? o.excerpt.slice(0, o.kind === "message" ? 500 : 140) : "",
      actor_id: typeof o.actor_id === "string" ? o.actor_id : null,
      actor_name: typeof o.actor_name === "string" ? o.actor_name : null,
      count: typeof o.count === "number" && o.count >= 1 ? Math.floor(o.count) : 1,
      created_at: typeof o.created_at === "string" ? o.created_at : "",
      updated_at: typeof o.updated_at === "string" ? o.updated_at : typeof o.created_at === "string" ? o.created_at : "",
      read_at: typeof o.read_at === "string" ? o.read_at : null,
    });
  }
  return out;
}

export function parsePrefs(data: unknown): NotificationPrefs | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = data as Record<string, unknown>;
  const prefs = { ...DEFAULT_PREFS };
  for (const k of PREF_KINDS) if (typeof o[k] === "boolean") prefs[k] = o[k];
  return prefs;
}
