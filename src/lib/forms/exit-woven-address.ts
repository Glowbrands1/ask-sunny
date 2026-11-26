import "server-only";

import { mayReadHomeAddress } from "@/lib/employees/woven/home-address-access";
import type { AccessScope, Role } from "@/types";

import type { DirectoryRosterRow } from "./employee-roster";
import { normalizeTypedName } from "./employee-match";
import { isCompleteMailingAddress } from "./exit-submission-rules";
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
  /** The location the exit form is filed at, when it has one: it tells two people with one name apart. */
  formLocationId: string | null = null,
): string | null {
  const wanted = normalizeTypedName(employeeName ?? "");
  if (!wanted || !scope) return null;
  const allowed = scope.level === "global" ? null : new Set(authorizedSalonIds(scope));
  if (allowed && allowed.size === 0) return null;

  const found = new Set<string>();
  const active = new Set<string>();
  for (const row of rows) {
    const last = row.lastName?.trim() ?? "";
    if (!last) continue;
    if (allowed && !row.salonIds.some((id) => allowed.has(id))) continue;
    const names = [row.firstName, row.preferredFirstName]
      .map((first) => first?.trim() ?? "")
      .filter((first) => first.length > 0)
      .map((first) => normalizeTypedName(`${first} ${last}`));
    if (names.includes(wanted)) {
      found.add(row.id);
      if (row.employmentStatus !== "terminated") active.add(row.id);
    }
  }
  if (found.size === 1) return [...found][0]!;
  /*
   * A REHIRE IS TWO WOVEN ROWS WITH ONE NAME (Pau, 25 Nov 2026: "i have access to that in woven why didn't my address
   * populate"): the old, terminated row and the current one. Exactly one still employed is that person.
   */
  if (active.size === 1) return [...active][0]!;
  /*
   * TWO CURRENT RECORDS WITH ONE NAME (production, 26 Nov 2026: one employee has a corporate record and a location
   * record in Woven): the one at the location the exit form is filed at is the person, when exactly one is there.
   */
  if (formLocationId) {
    const pool = active.size > 0 ? active : found;
    const here = rows.filter((row) => pool.has(row.id) && row.salonIds.includes(formLocationId));
    if (here.length === 1) return here[0]!.id;
  }
  return null;
}

/** How many same-name records the exit form will read to see whether they are one person. */
const MAX_SAME_NAME_RECORDS = 3;

/**
 * Every directory id `employeeName` matches at a location `scope` may see: the still-employed ones, or all of them
 * when none is. Pure.
 */
export function exitEmployeeCandidates(
  rows: readonly DirectoryRosterRow[],
  employeeName: string | null | undefined,
  scope: AccessScope | null,
): string[] {
  const wanted = normalizeTypedName(employeeName ?? "");
  if (!wanted || !scope) return [];
  const allowed = scope.level === "global" ? null : new Set(authorizedSalonIds(scope));
  if (allowed && allowed.size === 0) return [];
  const matches = rows.filter((row) => {
    const last = row.lastName?.trim() ?? "";
    if (!last) return false;
    if (allowed && !row.salonIds.some((id) => allowed.has(id))) return false;
    return [row.firstName, row.preferredFirstName]
      .map((first) => first?.trim() ?? "")
      .filter((first) => first.length > 0)
      .some((first) => normalizeTypedName(`${first} ${last}`) === wanted);
  });
  const active = matches.filter((row) => row.employmentStatus !== "terminated");
  return (active.length > 0 ? active : matches).map((row) => row.id);
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
  // A body wrapped in one envelope ({ Employee: {...} } / { data: {...} }) is read through it.
  for (const wrapper of ["Employee", "EmployeeDetails", "Data", "Result"]) {
    const found = Object.keys(details).find((candidate) => candidate.toLowerCase() === wrapper.toLowerCase());
    if (found && isRecord(details[found])) {
      const inner = wovenAddressLine(details[found]);
      if (inner) return inner;
    }
  }
  for (const record of addressRecords(details)) {
    const line = addressLineOf(record);
    if (line) return line;
  }
  /*
   * THE WHOLE ADDRESS AS ONE STRING (production, 26 Nov 2026: Woven's details body carries `Address` as a single value
   * with no City, State or Zip beside it). Taken only when it reads as a complete mailing address — street number,
   * city, state and ZIP — so a street alone never fills the line.
   */
  for (const key of ADDRESS_OBJECT) {
    const found = Object.keys(details).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const value = found ? details[found] : null;
    if (typeof value !== "string") continue;
    const line = value.replace(/\s*[\r\n]+\s*/g, ", ").replace(/\s+/g, " ").replace(/,\s*,/g, ",").trim();
    if (line.length <= 200 && isCompleteMailingAddress(line)) return line;
  }
  return null;
}

/** Every place a details body may keep the home address: an object, a list of them, or flat on the employee itself. */
function addressRecords(details: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const key of [...ADDRESS_OBJECT, "Addresses"]) {
    const found = Object.keys(details).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    const value = found ? details[found] : null;
    if (isRecord(value)) records.push(value);
    else if (Array.isArray(value)) records.push(...value.filter(isRecord));
  }
  /*
   * FLAT ON THE EMPLOYEE: `Address` as the street line, with City, State and Zip beside it. `LocationAddress` (the
   * salon's) is never one of these keys.
   */
  const flat = Object.keys(details).find((candidate) => candidate.toLowerCase() === "address");
  if (flat && typeof details[flat] === "string") records.push({ ...details, Address1: details[flat] });
  else records.push(details);
  return records;
}

function addressLineOf(address: Record<string, unknown>): string | null {
  const street = pick(address, STREET);
  const city = pick(address, CITY);
  if (!street || !city || !/\d/.test(street)) return null;
  const stateZip = [pick(address, STATE), pick(address, ZIP)].filter(Boolean).join(" ");
  const line = [street, pick(address, STREET_2), city, stateZip].filter(Boolean).join(", ");
  return line.length <= 200 ? line : null;
}

/**
 * The property NAMES (never values) of the address-shaped parts of a details body, for the log when no address could
 * be read, so the reader can be fixed without anyone's address leaving Woven.
 */
export function wovenAddressShape(details: unknown): string {
  if (!isRecord(details)) return typeof details;
  const top = Object.keys(details).filter((key) => /address|city|state|zip|postal|employee|data|result/i.test(key));
  const nested = top
    .filter((key) => isRecord(details[key]) || Array.isArray(details[key]))
    .map((key) => {
      const value = details[key];
      const inner = Array.isArray(value) ? (isRecord(value[0]) ? value[0] : {}) : (value as Record<string, unknown>);
      return `${key}{${Object.keys(inner).slice(0, 30).join(",")}}`;
    });
  /* A plain value is described by its type and size only: never the text itself. */
  const plain = top
    .filter((key) => /address/i.test(key) && !/email/i.test(key) && !isRecord(details[key]) && !Array.isArray(details[key]))
    .map((key) => {
      const value = details[key];
      if (typeof value !== "string") return `${key}=${value === null ? "null" : typeof value}`;
      const trimmed = value.trim();
      return `${key}=string(length ${trimmed.length}, ${/\d/.test(trimmed) ? "has digits" : "no digits"}, ${/\b\d{5}(?:-\d{4})?\b/.test(trimmed) ? "has ZIP" : "no ZIP"}, ${(trimmed.match(/,/g) ?? []).length} commas)`;
    });
  return [top.join(","), ...nested, ...plain].filter(Boolean).join(" ");
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
  input: {
    employeeName: string | null | undefined;
    scope: AccessScope | null;
    role: Role | null;
    locationId?: string | null;
  },
  deps?: WovenExitAddressDeps,
): Promise<string | null> {
  if (!deps && !wovenExitAddressEnabled()) return null;
  /*
   * WHY IT CAME BACK EMPTY IS LOGGED, AS A REASON CODE (Pau, 25 Nov 2026: "why didn't my address populate in form?").
   * Never a name, an id or an address: only which step stopped, and for an unreadable body its property names.
   */
  const why = (reason: string) => {
    console.info(`exit-woven-address: no address (${reason})`);
    return null;
  };
  /*
   * ONLY ADMINS AND MANAGERS (Curt, 26 Nov 2026: "only Admins and Managers both apps"): the address is filled only
   * for an admin, a District or Regional Manager or a Salon Director. Anyone else's draft leaves the line blank.
   */
  if (!mayReadHomeAddress(input.role)) return why("role may not read home addresses");
  try {
    const result = await withinBudget(
      (async () => {
        const live = deps ?? (await liveDeps());
        if (!live) return why("no Woven credentials");
        const directory = await live.readDirectory();
        const directoryId = exitEmployeeDirectoryId(directory, input.employeeName, input.scope, input.locationId ?? null);
        if (!directoryId) {
          /*
           * ONE PERSON, SEVERAL WOVEN RECORDS (Pau, 26 Nov 2026: "admins and has 2 location or more … they can get
           * address too"): when the name matches a few current records the form's location cannot settle, each is
           * read; if every one that has an address gives the same address, that is the person's home address. Any
           * disagreement fills nothing.
           */
          const candidates = exitEmployeeCandidates(directory, input.employeeName, input.scope);
          if (candidates.length < 2 || candidates.length > MAX_SAME_NAME_RECORDS) {
            return why("not exactly one Woven person by that full name at the manager's salons");
          }
          const addresses = new Set<string>();
          for (const candidate of candidates) {
            const candidateWovenId = await live.wovenIdOf(candidate);
            if (!candidateWovenId) continue;
            const line = wovenAddressLine(await live.readDetails(candidateWovenId));
            if (line) addresses.add(line);
          }
          if (addresses.size === 1) return [...addresses][0]!;
          return why(
            addresses.size === 0
              ? `${candidates.length} Woven records by that full name, none with an address`
              : `${candidates.length} Woven records by that full name with different addresses`,
          );
        }
        const wovenId = await live.wovenIdOf(directoryId);
        if (!wovenId) return why("directory row has no Woven id");
        const details = await live.readDetails(wovenId);
        return wovenAddressLine(details) ?? why(`no street and city in the details body; shape: ${wovenAddressShape(details)}`);
      })(),
      WOVEN_EXIT_ADDRESS_BUDGET_MS,
    );
    return result === null ? null : result;
  } catch (error) {
    return why(`error: ${error instanceof Error ? error.name : "unknown"}`);
  }
}

/**
 * ============================================================================
 * ONE PERSON'S HOME ADDRESS, ON REQUEST (Pau, 26 Nov 2026: "can we list their address here" — the Employee
 * Directory; "Show address" on each row, admins only, nothing saved)
 * ============================================================================
 *
 * The same live read the exit form uses, for one Woven employee id the directory already holds. The address is
 * returned to the caller and nowhere else: not stored, not logged. Why it is missing is a reason code.
 */
export type WovenAddressLookup =
  | { readonly status: "found"; readonly address: string }
  | { readonly status: "none"; readonly reason: "no_credentials" | "no_address" | "incomplete_address" | "unavailable" };

export async function wovenAddressForEmployee(
  wovenEmployeeId: string,
  deps?: Pick<WovenExitAddressDeps, "readDetails">,
): Promise<WovenAddressLookup> {
  try {
    const live = deps ?? (await liveDeps());
    if (!live) return { status: "none", reason: "no_credentials" };
    const details = await withinBudget(live.readDetails(wovenEmployeeId), WOVEN_EXIT_ADDRESS_BUDGET_MS);
    if (details === null) return { status: "none", reason: "unavailable" };
    const address = wovenAddressLine(details);
    if (address) return { status: "found", address };
    return { status: "none", reason: hasAnyAddress(details) ? "incomplete_address" : "no_address" };
  } catch {
    return { status: "none", reason: "unavailable" };
  }
}

/** Whether the body carries any address text at all (to tell "none in Woven" from "not a complete address"). */
function hasAnyAddress(details: unknown): boolean {
  if (!isRecord(details)) return false;
  return Object.keys(details).some((key) => {
    if (!/address/i.test(key) || /email|location/i.test(key)) return false;
    const value = details[key];
    if (typeof value === "string") return value.trim() !== "";
    return isRecord(value) && Object.values(value).some((part) => typeof part === "string" && part.trim() !== "");
  });
}

