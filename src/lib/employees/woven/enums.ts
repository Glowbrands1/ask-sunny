import {
  ACTIVE_STATUS_LABELS,
  EMPLOYEE_STATUS_ENUM_NAMES,
  ENUM_FIELD,
  TERMINATED_STATUS_LABELS,
  TERMINATION_TYPE_ENUM_NAMES,
  WEBHOOK_TRIGGER_ENUM_PATTERN,
} from "./contract";
import type { EmploymentStatus } from "./types";

/**
 * ============================================================================
 * WOVEN'S INTEGER ENUMS, RESOLVED FROM WOVEN ITSELF
 * ============================================================================
 *
 * The OpenAPI export types `Status`, `TerminationType`, `Platform` and the
 * webhook triggers as bare int32s with no names. `GET /lists/enums` returns
 * Woven's own `EnumerationType[]` — `{EnumerationName, PropertyName,
 * PropertyDisplayName, PropertyValue}` — so the meaning is read from Woven at
 * sync time rather than guessed in code.
 *
 * FAIL-SAFE. A status integer with no recognised label is `unknown`, and
 * `unknown` is never read as terminated. If the list cannot be read or names
 * no employee-status enumeration, EVERY status is `unknown` and the resolver
 * says so (`source: "none"`), which is what lets the sync refuse a real run
 * rather than save a directory of unknowns.
 */

export interface WovenEnumEntry {
  enumerationName: string;
  propertyName: string;
  displayName: string | null;
  value: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses `/lists/enums`. Entries that are not well-formed are skipped, never guessed at. */
export function parseEnums(body: unknown): WovenEnumEntry[] | null {
  if (!Array.isArray(body)) return null;
  const out: WovenEnumEntry[] = [];
  for (const raw of body) {
    if (!isRecord(raw)) continue;
    const enumerationName = raw[ENUM_FIELD.enumerationName];
    const propertyName = raw[ENUM_FIELD.propertyName];
    const value = raw[ENUM_FIELD.propertyValue];
    if (typeof enumerationName !== "string" || typeof propertyName !== "string") continue;
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    const display = raw[ENUM_FIELD.propertyDisplayName];
    out.push({
      enumerationName: enumerationName.trim().slice(0, 80),
      propertyName: propertyName.trim().slice(0, 80),
      displayName: typeof display === "string" ? display.trim().slice(0, 80) : null,
      value,
    });
  }
  return out;
}

function matchesName(entry: WovenEnumEntry, names: readonly string[]): boolean {
  const lowered = entry.enumerationName.toLowerCase();
  return names.some((name) => name.toLowerCase() === lowered);
}

function labelOf(entry: WovenEnumEntry): string {
  return (entry.displayName || entry.propertyName).trim();
}

export interface StatusResolver {
  /** `enums` when an employee-status enumeration was found; `none` otherwise. */
  readonly source: "enums" | "none";
  /** The enumeration name that was used, for the live check's report. */
  readonly enumerationName: string | null;
  /** Integer → Woven's own label. Vocabulary, not personal data. */
  readonly labels: Readonly<Record<number, string>>;
  resolve(code: number | null): EmploymentStatus;
}

export function statusResolver(entries: readonly WovenEnumEntry[] | null): StatusResolver {
  const relevant = (entries ?? []).filter((e) => matchesName(e, EMPLOYEE_STATUS_ENUM_NAMES));
  const labels: Record<number, string> = {};
  const status = new Map<number, EmploymentStatus>();
  for (const entry of relevant) {
    labels[entry.value] = labelOf(entry);
    const names = [entry.propertyName, entry.displayName ?? ""].map((n) => n.trim().toLowerCase());
    if (names.some((n) => (TERMINATED_STATUS_LABELS as readonly string[]).includes(n))) status.set(entry.value, "terminated");
    else if (names.some((n) => (ACTIVE_STATUS_LABELS as readonly string[]).includes(n))) status.set(entry.value, "active");
    else status.set(entry.value, "unknown");
  }
  return {
    source: relevant.length > 0 ? "enums" : "none",
    enumerationName: relevant[0]?.enumerationName ?? null,
    labels,
    resolve(code) {
      if (code === null) return "unknown";
      return status.get(code) ?? "unknown";
    },
  };
}

/** TerminationType integer → Woven's label, when the enumeration is present. */
export function terminationTypeLabels(entries: readonly WovenEnumEntry[] | null): Record<number, string> {
  const out: Record<number, string> = {};
  for (const entry of entries ?? []) if (matchesName(entry, TERMINATION_TYPE_ENUM_NAMES)) out[entry.value] = labelOf(entry);
  return out;
}

/**
 * Every enumeration that looks like a webhook-trigger vocabulary, with its
 * member names. This is how the live check answers "does Woven have an
 * employee-created / terminated / changed trigger?" from Woven itself.
 */
export function webhookTriggerVocabulary(entries: readonly WovenEnumEntry[] | null): Record<string, { value: number; name: string }[]> {
  const out: Record<string, { value: number; name: string }[]> = {};
  for (const entry of entries ?? []) {
    if (!WEBHOOK_TRIGGER_ENUM_PATTERN.test(entry.enumerationName)) continue;
    (out[entry.enumerationName] ??= []).push({ value: entry.value, name: labelOf(entry) });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.value - b.value);
  return out;
}

/** Trigger names that mention employees, across every webhook-trigger vocabulary. */
export function employeeWebhookTriggers(entries: readonly WovenEnumEntry[] | null): string[] {
  return Object.values(webhookTriggerVocabulary(entries))
    .flat()
    .map((t) => t.name)
    .filter((name) => /employee|team ?member|termin|hire|position|location/i.test(name));
}
