/**
 * ============================================================================
 * A TO-DO'S DUE DATE, AS THE MEETING SHOWS IT (Pau, 20 Nov 2026: "pls help add due date for both sunny and bubble")
 * ============================================================================
 *
 * A user's question: "I added my own To-Do's in the Ask Sunny L10, but I'm unable to include a Due Date. It simply states
 * 'Next wk'." A To-Do already carries an optional `dueDate` (YYYY-MM-DD, a business calendar date in Central time, the
 * same as rocks and milestones; saved in the Hub's meeting document); the DM L10 had no way to set it and neither layout
 * could change it. With no date the To-Do keeps its "Next wk" label, as before.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** A real calendar date "YYYY-MM-DD", or null (2026-02-31 is not one). */
export function calendarDate(value: string | undefined | null): { year: number; month: number; day: number; weekday: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return { year, month, day, weekday: at.getUTCDay() };
}

/** "Due Thu, Nov 27" for a set date (read as a calendar day, never shifted by a clock); else the To-Do's own label ("Next wk"). */
export function todoDueLabel(todo: { dueDate?: string; due?: string }): string {
  const date = calendarDate(todo.dueDate);
  if (!date) return todo.due ?? "";
  return `Due ${WEEKDAYS[date.weekday]}, ${MONTHS[date.month - 1]} ${date.day}`;
}

/** The To-Do with this due date set ("YYYY-MM-DD"), or cleared back to "Next wk" when empty. */
export function withTodoDueDate<T extends { dueDate?: string; due?: string }>(todo: T, value: string): T {
  if (calendarDate(value)) return { ...todo, dueDate: value, due: value };
  const { dueDate: _cleared, ...rest } = todo;
  return { ...rest, due: "Next wk" } as T;
}
