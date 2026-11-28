import "server-only";

import { recordToday } from "@/lib/business-today";
import { createNotifications } from "@/lib/notifications/repository";
import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";

import {
  SALON_MANAGER_ROLES,
  SALON_SCOPE_LEVEL,
  WEBHOOK_SECRET_HEADER,
  NEW_HIRE_NOTICE_KIND,
  TERMINATION_NOTICE_KIND,
  bellRows,
  eventPayload,
  hireRecipients,
  inviteSentText,
  isRecentHire,
  newHireNoticeText,
  readNewHireNoticeConfig,
  salonAreas,
  terminationNoticeText,
  windowStart,
  type EmployeeEvent,
  type EmployeeEventPayload,
  type HiredEmployee,
} from "./new-hire-notices";

/**
 * Hired / terminated / link-sent notices (`new-hire-notices.ts`) with the real
 * services: the Woven directory and its change log, `app_users` for admins and
 * salon managers, `woven_employee_notices` for what was already announced,
 * `app_notifications` for the bell, and the webhook (Pau's n8n) for email.
 *
 * Never throws: a failure is logged and returned as a code, and never turns a
 * good sync or a sent invitation into an error. Outcomes carry codes and
 * counts only, never a name or an email.
 */

export type NewHireNoticeOutcome =
  | { status: "off" }
  | { status: "completed"; hired: number; terminated: number; bells: number; webhooks: number; webhookFailed: number; since: string }
  | { status: "failed"; code: string };

export interface EventClaim {
  event: EmployeeEvent;
  externalEmployeeId: string;
  eventDate: string;
  recipients: number;
}

export interface Manager {
  email: string;
  areas: readonly string[];
}

export interface NewHireNoticeDeps {
  /** Active employees hired on or after `since` (and not after today), with their locations. */
  recentHires(since: string, today: string): Promise<HiredEmployee[]>;
  /** Employees the sync recorded as terminated on or after `since`, with the date it counts from. */
  recentTerminations(since: string): Promise<{ employee: HiredEmployee; eventDate: string }[]>;
  /** One employee by Woven EmployeeID (for a sent invitation), or null. */
  employee(externalEmployeeId: string): Promise<HiredEmployee | null>;
  adminEmails(): Promise<string[]>;
  /** Active salon managers and the salon areas they cover. */
  salonManagers(): Promise<Manager[]>;
  /** Of these events, the keys this call claimed (not announced before, nor by a concurrent run). */
  claim(rows: readonly EventClaim[]): Promise<Set<string>>;
  release(keys: readonly string[]): Promise<void>;
  /** Of these keys, the ones already claimed whose webhook has not gone yet. */
  unsentWebhooks(keys: readonly string[]): Promise<Set<string>>;
  markWebhookSent(keys: readonly string[]): Promise<void>;
  ring(rows: ReturnType<typeof bellRows>): Promise<void>;
  postWebhook(url: string, secret: string | null, payload: EmployeeEventPayload): Promise<boolean>;
}

export const eventKey = (event: EmployeeEvent, externalEmployeeId: string, eventDate: string) => `${event}:${externalEmployeeId}:${eventDate}`;

const CHUNK = 500;

interface Candidate {
  claim: EventClaim;
  key: string;
  employee: HiredEmployee;
  bells: ReturnType<typeof bellRows>;
  payload: EmployeeEventPayload;
}

/** After a successful, stored Woven sync: announce new hires and terminations in the window. */
export async function announceNewHires(
  input: { env?: Record<string, string | undefined>; now?: Date },
  deps: NewHireNoticeDeps = realNoticeDeps(),
): Promise<NewHireNoticeOutcome> {
  const config = readNewHireNoticeConfig(input.env ?? process.env);
  if (!config.enabled) return { status: "off" };
  const today = recordToday(input.now ?? new Date());
  const since = windowStart(today, config.backfillDays);
  try {
    const candidates: Candidate[] = [];

    const hires = (await deps.recentHires(since, today)).filter((e) => isRecentHire(e, since, today));
    if (hires.length > 0) {
      const [admins, managers] = await Promise.all([deps.adminEmails(), deps.salonManagers()]);
      for (const employee of hires) {
        const areas = new Set(salonAreas(employee));
        const recipients = hireRecipients({
          admins,
          managers: managers.filter((m) => m.areas.some((a) => areas.has(a))).map((m) => m.email),
          hr: config.hrEmails,
          employeeEmail: employee.emailAddress,
        });
        // Nobody to tell and no webhook: leave it unclaimed, so it is announced once somebody can hear it.
        if (recipients.length === 0 && !config.webhookUrl) continue;
        const text = newHireNoticeText(employee);
        const eventDate = employee.hireDate!.slice(0, 10);
        candidates.push({
          claim: { event: "hired", externalEmployeeId: employee.externalEmployeeId, eventDate, recipients: recipients.length },
          key: eventKey("hired", employee.externalEmployeeId, eventDate),
          employee,
          bells: bellRows(NEW_HIRE_NOTICE_KIND, text, recipients),
          payload: eventPayload("hired", employee, text),
        });
      }
    }

    if (config.hrEmails.length > 0 || config.webhookUrl) {
      const hr = hireRecipients({ admins: [], managers: [], hr: config.hrEmails, employeeEmail: null });
      for (const { employee, eventDate } of await deps.recentTerminations(since)) {
        if (eventDate < since || eventDate > today) continue;
        const text = terminationNoticeText(employee);
        candidates.push({
          claim: { event: "terminated", externalEmployeeId: employee.externalEmployeeId, eventDate, recipients: hr.length },
          key: eventKey("terminated", employee.externalEmployeeId, eventDate),
          employee,
          bells: bellRows(TERMINATION_NOTICE_KIND, text, hr),
          payload: eventPayload("terminated", employee, text),
        });
      }
    }

    if (candidates.length === 0) return { status: "completed", hired: 0, terminated: 0, bells: 0, webhooks: 0, webhookFailed: 0, since };

    const claimed = await deps.claim(candidates.map((c) => c.claim));
    const fresh = candidates
      .filter((c) => claimed.has(c.key))
      .sort((a, b) => a.claim.eventDate.localeCompare(b.claim.eventDate) || a.key.localeCompare(b.key));
    const rows = fresh.flatMap((c) => c.bells);
    try {
      for (let i = 0; i < rows.length; i += CHUNK) await deps.ring(rows.slice(i, i + CHUNK));
    } catch (error) {
      await deps.release([...claimed]).catch(() => undefined);
      throw error;
    }

    let webhooks = 0;
    let webhookFailed = 0;
    if (config.webhookUrl) {
      const retry = await deps.unsentWebhooks(candidates.filter((c) => !claimed.has(c.key)).map((c) => c.key));
      const sent: string[] = [];
      for (const c of [...fresh, ...candidates.filter((c) => retry.has(c.key))]) {
        if (await deps.postWebhook(config.webhookUrl, config.webhookSecret, c.payload)) sent.push(c.key);
        else webhookFailed += 1;
      }
      if (sent.length) await deps.markWebhookSent(sent);
      webhooks = sent.length;
    }

    return {
      status: "completed",
      hired: fresh.filter((c) => c.claim.event === "hired").length,
      terminated: fresh.filter((c) => c.claim.event === "terminated").length,
      bells: rows.length,
      webhooks,
      webhookFailed,
      since,
    };
  } catch (error) {
    console.error("[new-hire-notices] the hire/termination notices were not sent:", error instanceof Error ? error.message : "unknown error");
    return { status: "failed", code: "new_hire_notices_failed" };
  }
}

/**
 * The hourly new-hire run emailed this person their sign-in link: tell the webhook (Pau's email). Once per person per
 * day. Off, or no webhook: nothing. Never throws.
 */
export async function announceInviteSent(
  input: { externalEmployeeId: string; sentTo: string; env?: Record<string, string | undefined>; now?: Date },
  deps: NewHireNoticeDeps = realNoticeDeps(),
): Promise<"off" | "sent" | "already_sent" | "failed"> {
  const config = readNewHireNoticeConfig(input.env ?? process.env);
  if (!config.enabled || !config.webhookUrl) return "off";
  try {
    const employee = await deps.employee(input.externalEmployeeId);
    if (!employee) return "failed";
    const eventDate = recordToday(input.now ?? new Date());
    const key = eventKey("invite_sent", employee.externalEmployeeId, eventDate);
    const claimed = await deps.claim([{ event: "invite_sent", externalEmployeeId: employee.externalEmployeeId, eventDate, recipients: 0 }]);
    if (!claimed.has(key)) return "already_sent";
    const ok = await deps.postWebhook(config.webhookUrl, config.webhookSecret, eventPayload("invite_sent", employee, inviteSentText(employee, input.sentTo)));
    if (ok) await deps.markWebhookSent([key]);
    return ok ? "sent" : "failed";
  } catch (error) {
    console.error("[new-hire-notices] the sign-in link notice was not sent:", error instanceof Error ? error.message : "unknown error");
    return "failed";
  }
}

/* ------------------------------------------------------- the real services -- */

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const IDS_PER_QUERY = 200;
const WEBHOOK_TIMEOUT_MS = 8000;
const EMPLOYEE_COLUMNS =
  "id, external_employee_id, first_name, last_name, preferred_first_name, email_address, employment_status, hire_date, termination_date, termination_last_day_worked, position_name, primary_woven_location_id, primary_location_name";

/** Woven location id → `loc-<salon number>`, for mapped locations. */
async function salonAreaByLocation(): Promise<Map<string, string>> {
  const db = getSupabaseAdmin();
  const [map, salons] = await Promise.all([
    db.from("woven_location_map").select("woven_location_id, status, salon_id").eq("status", "mapped"),
    db.from("salons").select("id, salon_number"),
  ]);
  if (map.error) throw new Error(`the Woven location map could not be read (${map.error.code ?? "error"})`);
  if (salons.error) throw new Error(`the salons could not be read (${salons.error.code ?? "error"})`);
  const number = new Map(((salons.data ?? []) as Record<string, unknown>[]).map((s) => [String(s.id), String(s.salon_number)]));
  const out = new Map<string, string>();
  for (const row of (map.data ?? []) as Record<string, unknown>[]) {
    const n = row.salon_id ? number.get(String(row.salon_id)) : undefined;
    if (n) out.set(String(row.woven_location_id), `loc-${n}`);
  }
  return out;
}

async function withLocations(people: Record<string, unknown>[], activeOnly: boolean): Promise<HiredEmployee[]> {
  const db = getSupabaseAdmin();
  const areas = await salonAreaByLocation();
  const locations = new Map<string, HiredEmployee["locations"][number][]>();
  const ids = people.map((p) => String(p.id));
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
    let query = db
      .from("employee_location_affiliations")
      .select("employee_id, woven_location_id, location_name, location_number, access_type, expires_on, active")
      .in("employee_id", ids.slice(i, i + IDS_PER_QUERY));
    if (activeOnly) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw new Error(`location access could not be read (${error.code ?? "error"})`);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const key = String(row.employee_id);
      const list = locations.get(key) ?? [];
      list.push({
        wovenLocationId: String(row.woven_location_id),
        locationName: str(row.location_name),
        locationNumber: str(row.location_number),
        accessType: String(row.access_type),
        expiresOn: str(row.expires_on),
        areaId: areas.get(String(row.woven_location_id)) ?? null,
      });
      locations.set(key, list);
    }
  }
  return people.map((p) => {
    const primaryId = str(p.primary_woven_location_id);
    const own = locations.get(String(p.id)) ?? [];
    // The primary is always counted for its salon's managers, even when its affiliation row is missing.
    const withPrimary =
      primaryId && !own.some((l) => l.wovenLocationId === primaryId)
        ? [...own, { wovenLocationId: primaryId, locationName: str(p.primary_location_name), locationNumber: null, accessType: "primary", expiresOn: null, areaId: areas.get(primaryId) ?? null }]
        : own;
    return {
      externalEmployeeId: String(p.external_employee_id),
      firstName: str(p.first_name),
      lastName: str(p.last_name),
      preferredFirstName: str(p.preferred_first_name),
      emailAddress: str(p.email_address),
      employmentStatus: String(p.employment_status),
      hireDate: str(p.hire_date),
      terminationDate: str(p.termination_date),
      terminationLastDayWorked: str(p.termination_last_day_worked),
      positionName: str(p.position_name),
      primaryLocationId: primaryId,
      primaryLocationName: str(p.primary_location_name),
      locations: withPrimary,
    };
  });
}

/** Woven EmployeeID → the status of the account linked to it here ("then sign in in X app disabled"). */
async function accountStatusByEmployee(ids: readonly string[]): Promise<Map<string, "active" | "invited" | "disabled">> {
  const out = new Map<string, "active" | "invited" | "disabled">();
  const db = getSupabaseAdmin();
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
    const { data: links, error } = await db
      .from("employee_account_links")
      .select("app_user_id, external_employee_id")
      .eq("management", "woven_linked")
      .in("external_employee_id", ids.slice(i, i + IDS_PER_QUERY));
    if (error) throw new Error(`the account links could not be read (${error.code ?? "error"})`);
    const byUser = new Map(((links ?? []) as Record<string, unknown>[]).map((l) => [String(l.app_user_id), String(l.external_employee_id)]));
    if (byUser.size === 0) continue;
    const { data: users, error: userError } = await db.from("app_users").select("id, status").in("id", [...byUser.keys()]);
    if (userError) throw new Error(`the accounts could not be read (${userError.code ?? "error"})`);
    for (const u of (users ?? []) as Record<string, unknown>[]) {
      const status = String(u.status);
      if (status === "active" || status === "invited" || status === "disabled") out.set(byUser.get(String(u.id))!, status);
    }
  }
  return out;
}

const splitKey = (key: string) => {
  const [event, ...rest] = key.split(":");
  const eventDate = rest.pop()!;
  return { event, externalEmployeeId: rest.join(":"), eventDate };
};

export function realNoticeDeps(): NewHireNoticeDeps {
  const db = () => getSupabaseAdmin();
  return {
    async recentHires(since, today) {
      const { data, error } = await db()
        .from("employee_access_directory")
        .select(EMPLOYEE_COLUMNS)
        .eq("source_system", "woven")
        .eq("employment_status", "active")
        .gte("hire_date", since)
        .lte("hire_date", today)
        .limit(2000);
      if (error) throw new Error(`the directory could not be read (${error.code ?? "error"})`);
      return withLocations((data ?? []) as Record<string, unknown>[], true);
    },

    async recentTerminations(since) {
      // The change log is keyed by the directory row (`employee_id`), not the Woven EmployeeID.
      const { data, error } = await db()
        .from("employee_directory_changes")
        .select("employee_id, detected_at")
        .eq("change_kind", "terminated")
        .gte("detected_at", `${since}T00:00:00Z`)
        .limit(2000);
      if (error) throw new Error(`the change log could not be read (${error.code ?? "error"})`);
      const changes = (data ?? []) as Record<string, unknown>[];
      if (changes.length === 0) return [];
      // The date counts from when the sync saw it: a termination Woven back-dates is still news the day it shows up.
      const dateOfRow = new Map<string, string>();
      for (const c of changes) {
        const rowId = String(c.employee_id);
        const seen = String(c.detected_at).slice(0, 10);
        if (!dateOfRow.has(rowId) || seen > dateOfRow.get(rowId)!) dateOfRow.set(rowId, seen);
      }
      const rowIds = [...dateOfRow.keys()];
      const people: Record<string, unknown>[] = [];
      for (let i = 0; i < rowIds.length; i += IDS_PER_QUERY) {
        const { data: rows, error: readError } = await db()
          .from("employee_access_directory")
          .select(EMPLOYEE_COLUMNS)
          .eq("source_system", "woven")
          .in("id", rowIds.slice(i, i + IDS_PER_QUERY));
        if (readError) throw new Error(`the directory could not be read (${readError.code ?? "error"})`);
        people.push(...((rows ?? []) as Record<string, unknown>[]));
      }
      const dateOf = new Map(people.map((p) => [String(p.external_employee_id), dateOfRow.get(String(p.id))!]));
      const employees = await withLocations(people, false);
      const accounts = await accountStatusByEmployee(employees.map((e) => e.externalEmployeeId));
      return employees.map((employee) => ({
        employee: { ...employee, appAccountStatus: accounts.get(employee.externalEmployeeId) ?? null },
        eventDate: dateOf.get(employee.externalEmployeeId)!,
      }));
    },

    async employee(externalEmployeeId) {
      const { data, error } = await db()
        .from("employee_access_directory")
        .select(EMPLOYEE_COLUMNS)
        .eq("source_system", "woven")
        .eq("external_employee_id", externalEmployeeId)
        .limit(1);
      if (error) throw new Error(`the directory could not be read (${error.code ?? "error"})`);
      const [employee] = await withLocations((data ?? []) as Record<string, unknown>[], true);
      return employee ?? null;
    },

    async adminEmails() {
      const { data, error } = await db().from("app_users").select("email").eq("status", "active").in("role", ADMIN_CONSOLE_ROLES);
      if (error) throw new Error(`the admins could not be read (${error.code ?? "error"})`);
      return ((data ?? []) as { email: unknown }[]).map((r) => str(r.email)).filter((e): e is string => !!e);
    },

    async salonManagers() {
      const { data, error } = await db()
        .from("app_users")
        .select("email, scope_primary_area_id, scope_also_covers_area_ids")
        .eq("status", "active")
        .eq("scope_level", SALON_SCOPE_LEVEL)
        .in("role", [...SALON_MANAGER_ROLES]);
      if (error) throw new Error(`the salon managers could not be read (${error.code ?? "error"})`);
      return ((data ?? []) as Record<string, unknown>[])
        .filter((r) => typeof r.email === "string")
        .map((r) => ({
          email: String(r.email),
          areas: [str(r.scope_primary_area_id), ...(Array.isArray(r.scope_also_covers_area_ids) ? r.scope_also_covers_area_ids.map(String) : [])].filter(
            (a): a is string => !!a,
          ),
        }));
    },

    async claim(rows) {
      if (rows.length === 0) return new Set();
      const { data, error } = await db()
        .from("woven_employee_notices")
        .upsert(
          rows.map((r) => ({ event: r.event, external_employee_id: r.externalEmployeeId, event_date: r.eventDate, recipients: r.recipients })),
          { onConflict: "event,external_employee_id,event_date", ignoreDuplicates: true },
        )
        .select("event, external_employee_id, event_date");
      if (error) throw new Error(`the notice record could not be written (${error.code ?? "error"})`);
      return new Set(
        ((data ?? []) as Record<string, unknown>[]).map((r) => eventKey(r.event as EmployeeEvent, String(r.external_employee_id), String(r.event_date).slice(0, 10))),
      );
    },

    async release(keys) {
      for (const key of keys) {
        const k = splitKey(key);
        await db().from("woven_employee_notices").delete().eq("event", k.event).eq("external_employee_id", k.externalEmployeeId).eq("event_date", k.eventDate);
      }
    },

    async unsentWebhooks(keys) {
      if (keys.length === 0) return new Set();
      const ids = [...new Set(keys.map((k) => splitKey(k).externalEmployeeId))];
      const { data, error } = await db()
        .from("woven_employee_notices")
        .select("event, external_employee_id, event_date")
        .in("external_employee_id", ids)
        .is("webhook_sent_at", null);
      if (error) throw new Error(`the notice record could not be read (${error.code ?? "error"})`);
      const wanted = new Set(keys);
      return new Set(
        ((data ?? []) as Record<string, unknown>[])
          .map((r) => eventKey(r.event as EmployeeEvent, String(r.external_employee_id), String(r.event_date).slice(0, 10)))
          .filter((k) => wanted.has(k)),
      );
    },

    async markWebhookSent(keys) {
      const at = new Date().toISOString();
      for (const key of keys) {
        const k = splitKey(key);
        await db()
          .from("woven_employee_notices")
          .update({ webhook_sent_at: at })
          .eq("event", k.event)
          .eq("external_employee_id", k.externalEmployeeId)
          .eq("event_date", k.eventDate);
      }
    },

    ring: (rows) => createNotifications(rows),

    async postWebhook(url, secret, payload) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(secret ? { [WEBHOOK_SECRET_HEADER]: secret } : {}) },
          body: JSON.stringify(payload),
          signal: controller.signal,
          cache: "no-store",
        });
        return response.ok;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
