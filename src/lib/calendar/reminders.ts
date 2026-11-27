import { z } from "zod";

/** What "+ New event" and the chat's reminder card send; labels shared by the page and the card. Client-safe. */
export const REMINDER_TITLE_MAX = 200;
export const VISIBILITIES = ["only_me", "my_team"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const VISIBILITY_LABEL: Record<Visibility, string> = { only_me: "Only me", my_team: "My team" };
export const VISIBILITY_HINT: Record<Visibility, string> = {
  only_me: "Only you see it.",
  my_team: "You and the leaders above and below you (the managers of your salons, their DM and RM) see it.",
};

export const REMINDER_INPUT = z.object({
  title: z.string().trim().min(1).max(REMINDER_TITLE_MAX),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  visibility: z.enum(VISIBILITIES),
  ref: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
});
export type ReminderInput = z.infer<typeof REMINDER_INPUT>;
export type ReminderSaveResult = { ok: true; id: string; already: boolean } | { ok: false; reason: "invalid" | "limit" | "signin" | "unavailable" };

export const SAVE_FAIL: Record<Extract<ReminderSaveResult, { ok: false }>["reason"], string> = {
  invalid: `Check the reminder: a title (1 to ${REMINDER_TITLE_MAX} characters) and a date.`,
  limit: "You've added the most reminders allowed this hour (60). Try again later.",
  signin: "Sign in to add reminders.",
  unavailable: "The reminder couldn't be saved just now. Try again in a minute.",
};

/** "Wed, Jan 20, 2027, all day" / "Fri, Dec 4, 2026, 2:00 PM CT". */
export function whenLabel(date: string, time: string | null): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  if (!time) return `${day}, all day`;
  const [h, m] = time.split(":").map(Number);
  return `${day}, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} CT`;
}
