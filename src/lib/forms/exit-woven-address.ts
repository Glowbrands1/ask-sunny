import "server-only";

import type { AccessScope } from "@/types";

import type { DirectoryRosterRow } from "./employee-roster";
import { normalizeTypedName } from "./employee-match";
import { authorizedSalonIds } from "./location-scope";

/**
 * ============================================================================
 * THE EXIT FORM'S PERMANENT ADDRESS, FROM WOVEN (port from Ask Bubbles; Pau, 25 Nov 2026)
 * ============================================================================
 *
 * "can we auto add the permanent address in exit form? from woven?" — yes, and only there.
 *
 * THE DIRECTORY STILL NEVER HOLDS AN ADDRESS. The employee sync reads no address (`employees/woven/contract.ts`) and
 * `safety.test.ts` still fails on any address column. This module is the one place an address is read: ONE employee's
 * Woven details, fetched live while their exit form is drafted, and the formatted line goes onto that form's Permanent
 * Address and nowhere else — not a table, not a log, not the prompt.
 *
 * CLEAR OR NOTHING. The form's employee must be exactly one Woven person, by full name,  at a salon the manager may see
 * (terminated people included: they are the ones leaving). The details body must carry at least a street and a city. Any doubt, error or slow answer leaves the line blank, as it always was.
 *
 * THE MANAGER'S OWN ADDRESS WINS. The route writes this only into an empty Permanent Address, after the address the
 * manager typed (`readPermanentAddress`), and says so in the draft's notice so it is checked before the form is sent.
 *
 * Off unless WOVEN_EXIT_ADDRESS_ENABLED is set (an integration switch, like WOVEN_SYNC_ENABLED). Same name in the
 * sibling app, Ask Bubbles.
 */

export const WOVEN_EXIT_ADDRESS_ENABLED_ENV = "WOVEN_EXIT_ADDRESS_ENABLED";

/** Said with the draft whenever the address came from Woven. */
export const WOVEN_EXIT_ADDRESS_NOTICE =
  "Permanent Address was filled in from Woven. Confirm it is the employee's current address before sending the form.";

/** How long the draft waits for Woven before leaving the line blank. */
export const WOVEN_EXIT_ADDRESS_BUDGET_MS = 6_000;

type Env = Readonly<Record<string, string | undefined>>;

export function wovenExitAddressEnabled(env: Env = process.env): boolean {
  const raw = (env[WOVEN_EXIT_ADDRESS_ENABLED_ENV] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

/* ------------------------------------------------------------ the person -- */

/**
 * The directory id of the ONE person named `employeeName` (first or preferred first name, and last name; case, accents
 * and spacing aside) at a salon `scope` may see. Null for nobody, for two, for no scope, or for an area scope the
 * location roster cannot resolve. Terminated people count. Pure.
 */
export function exitEmployeeDirectoryId(
  rows: readonly DirectoryRosterRow[],
  employeeName: string | null | undefined,
  scope: AccessScope | null,
): string | null {
  const wanted = normalizeTypedName(employeeName ?? "");
  if (!wanted || !scope) return null;
  const allowed = scope.level === "global" ? null : new Set(authorizedSalonIds(scope));
  if (allowed && allowed.size === 0) return null;

  const found = new Set<string>();
  for (const row of rows) {
    const last = row.lastName?.trim() ?? "";
    if (!last) continue;
    if (allowed && !row.salonIds.some((id) => allowed.has(id))) continue;
    const names = [row.firstName, row.preferredFirstName]
      .map((first) => first?.trim() ?? "")
      .filter((first) => first.length > 0)
      .map((first) => normalizeTypedName(`${first} ${last}`));
    if (names.includes(wanted)) found.add(row.id);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/* ----------------------------------------------------------- the address -- */

const text = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : typeof value === "number" ? String(value) : "";

function pick(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const found = Object.keys(record).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const value = found ? text(record[found]) : "";
    if (value) return value;
  }
  return "";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/*
 * Woven's spec does not publish the address model's properties, so the usual spellings are read. The details body's
 * `Address` (or `HomeAddress`) object — never `LocationAddress`, which is the salon's.
 */
const ADDRESS_OBJECT = ["Address", "HomeAddress", "MailingAddress"] as const;
const STREET = ["Address1", "AddressLine1", "Line1", "Street", "Street1", "StreetAddress"] as const;
const STREET_2 = ["Address2", "AddressLine2", "Line2", "Street2", "Apartment", "Unit"] as const;
const CITY = ["City", "Town"] as const;
const STATE = ["StateAbbreviation", "StateCode", "State", "StateName", "Province", "Region"] as const;
const ZIP = ["Zip", "ZipCode", "PostalCode", "Postal", "Zip5"] as const;

/**
 * "123 Main St, Apt 4, Kearney, NE 68847" from a Woven employee details body, or null when it carries no address with
 * at least a street and a city. Pure. Reads nothing else from the body.
 */
export function wovenAddressLine(details: unknown): string | null {
  if (!isRecord(details)) return null;
  for (const key of ADDRESS_OBJECT) {
    const found = Object.keys(details).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const address = found ? details[found] : null;
    if (!isRecord(address)) continue;
    const street = pick(address, STREET);
    const city = pick(address, CITY);
    if (!street || !city || !/\d/.test(street)) continue;
    const stateZip = [pick(address, STATE), pick(address, ZIP)].filter(Boolean).join(" ");
    const line = [street, pick(address, STREET_2), city, stateZip].filter(Boolean).join(", ");
    return line.length <= 200 ? line : null;
  }
  return null;
}

/* -------------------------------------------------------------- the read -- */

export interface WovenExitAddressDeps {
  /** The whole directory, as the roster reads it. */
  readDirectory: () => Promise<DirectoryRosterRow[]>;
  /** The Woven employee id (`external_employee_id`) of one directory row, or null. */
  wovenIdOf: (directoryId: string) => Promise<string | null>;
  /** One employee's Woven details body. */
  readDetails: (wovenEmployeeId: string) => Promise<unknown>;
}

async function liveDeps(): Promise<WovenExitAddressDeps | null> {
  const { readWovenConfig } = await import("@/lib/employees/woven/config");
  const config = readWovenConfig();
  if (!config.credentials) return null;
  const { WovenClient } = await import("@/lib/employees/woven/client");
  const { readDirectoryRoster } = await import("./employee-roster");
  const { getSupabaseAdmin } = await import("@/lib/supabase/server");
  const client = new WovenClient({
    baseUrl: config.baseUrl,
    credentials: config.credentials,
    companyId: config.companyId,
    platform: config.platform,
    deadlineAt: Date.now() + WOVEN_EXIT_ADDRESS_BUDGET_MS,
  });
  return {
    readDirectory: readDirectoryRoster,
    wovenIdOf: async (directoryId) => {
      const { data, error } = await getSupabaseAdmin()
        .from("employee_access_directory")
        .select("external_employee_id")
        .eq("id", directoryId)
        .maybeSingle();
      if (error || !data) return null;
      return text((data as Record<string, unknown>).external_employee_id) || null;
    },
    readDetails: async (wovenEmployeeId) => {
      return client.getEmployeeDetails(wovenEmployeeId);
    },
  };
}

function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The exit form employee's home address from Woven, formatted for the Permanent Address line, or null. Never throws:
 * a Woven or directory outage leaves the line blank and the draft goes on.
 */
export async function wovenExitAddress(
  input: { employeeName: string | null | undefined; scope: AccessScope | null },
  deps?: WovenExitAddressDeps,
): Promise<string | null> {
  if (!deps && !wovenExitAddressEnabled()) return null;
  try {
    return await withinBudget(
      (async () => {
        const live = deps ?? (await liveDeps());
        if (!live) return null;
        const directoryId = exitEmployeeDirectoryId(await live.readDirectory(), input.employeeName, input.scope);
        if (!directoryId) return null;
        const wovenId = await live.wovenIdOf(directoryId);
        if (!wovenId) return null;
        return wovenAddressLine(await live.readDetails(wovenId));
      })(),
      WOVEN_EXIT_ADDRESS_BUDGET_MS,
    );
  } catch {
    return null;
  }
}
