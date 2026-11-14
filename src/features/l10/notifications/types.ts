// Copied from the Leadership Hub (src/lib/notifications/types.ts); keep in step with it. See src/features/l10/README.md.
/** One in-app note, as public.notifications_list returns it. */
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  meeting_key: string;
  meeting_name: string;
  item_id: string;
  /** Plain text, at most 140 characters (500 for a note; the database enforces it; the page renders it as text only). */
  excerpt: string;
  actor_id: string | null;
  actor_name: string | null;
  /** How many changes this one note stands for (unread notes about the same item are folded). */
  count: number;
  created_at: string;
  updated_at: string;
  read_at: string | null;
}

/** Kinds a person can switch on or off. */
export const PREF_KINDS = ["mention", "todo_assigned", "rock_added", "rock_changed", "issue_added", "issue_solved", "recap_saved", "ai_suggestion", "edited", "message"] as const;
export type PrefKind = (typeof PREF_KINDS)[number];
/**
 * The kinds shown on the settings page: only what the hub actually sends today. "An assistant suggestion is waiting"
 * and "Someone edits something of mine" are kept in the database but nothing produces them, so they are not offered.
 */
export const VISIBLE_PREF_KINDS: readonly PrefKind[] = PREF_KINDS.filter((k) => k !== "ai_suggestion" && k !== "edited");
/** "more" is the "and N more" note that replaces a flood; it has no switch. */
export type NotificationKind = PrefKind | "more";

export type NotificationPrefs = Record<PrefKind, boolean>;

export type NotificationsResult = { ok: true; notifications: AppNotification[] } | { ok: false; reason: "not-configured" | "unavailable" };

/** What happened to one recipient of a note (public.send_note). */
export type NoteStatus = "sent" | "already_sent" | "not_in_meeting" | "muted" | "self";
export type NoteResult =
  | { ok: true; results: { id: string; name: string; status: NoteStatus }[] }
  | { ok: false; reason: "limit" | "forbidden" | "invalid" | "unavailable" };
