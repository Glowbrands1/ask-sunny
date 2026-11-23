import "server-only";

import { randomUUID } from "node:crypto";

import { SIBLING_HR_APP, siblingAppUrl } from "@/lib/config/app-switcher";
import { ACTIVE_BRAND } from "@/lib/brand";
import type { FormsActor } from "@/lib/forms/access";
import { listHrQueue } from "@/lib/forms/hr-approval";
import { listHrApprovers } from "@/lib/forms/hr-approval-approvers";
import { hrApprovalEnabled, type HrApprovalState } from "@/lib/forms/hr-approval-rules";

import { SIBLING_HR_HEADERS, signSiblingHrRequest } from "./sibling-hr-signature";

/**
 * ============================================================================
 * HR'S QUEUE, ACROSS THE TWO APPS (owner, 23 Nov 2026: "1 tab for sunny 1 tab for bubbles")
 * ============================================================================
 *
 * Two halves, the same in both apps:
 *
 *   hrQueueForPartner     what THIS app answers the sibling's signed request: the forms waiting for this approver
 *   fetchSiblingHrQueue   what this app asks the SIBLING for, on its Pending HR approval tab
 *
 * WHO IS ANSWERED. Only an email that is an active account here AND an active HR approver here
 * (`form_hr_approvers`), with HR approval on here. Anyone else gets an empty list that says so; the route never says
 * why. The asking app sends only its own signed-in approver's verified email.
 *
 * WHAT IS SENT. The minimum the tab shows: the form line (form, employee, location), who sent it, its state, when,
 * how long it has waited, whether it is overdue, and the in-app path of its review page. Never a value of the form,
 * never HR's notes, never an account id.
 *
 * APPROVING STAYS IN THE APP THAT OWNS THE FORM: the list links to the sibling's own review page, where its own
 * sign-in and checks apply. Nothing here writes.
 */

const SIBLING_HR_SECRET_ENV = "SIBLING_HR_SECRET";
const FORM_LIMIT = 200;
const TIMEOUT_MS = 4_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,150}$/;

export interface PartnerHrForm {
  line: string;
  from: string;
  state: HrApprovalState;
  requestedAt: string | null;
  waiting: string;
  overdue: boolean;
  /** The review page's path in the app that owns the form: `/forms/hr-approval/<id>`. */
  path: string;
}

export interface PartnerHrAnswer {
  /** The answering app's own name, so the asking app never has to spell the sibling's name. */
  app: string;
  approver: boolean;
  forms: PartnerHrForm[];
}

/* ------------------------------------------------------------------ answering --- */

/** What this app answers the sibling for one approver's email. Empty, `approver: false`, for anybody else. */
export async function hrQueueForPartner(emailInput: unknown, now: Date = new Date()): Promise<PartnerHrAnswer> {
  const app = ACTIVE_BRAND.productName;
  const none: PartnerHrAnswer = { app, approver: false, forms: [] };
  if (!hrApprovalEnabled() || typeof emailInput !== "string") return none;
  const email = emailInput.trim().toLowerCase();
  if (!EMAIL.test(email)) return none;
  // Matched against this app's active approvers (each an active account, its email lowercased): never a search.
  const id = (await listHrApprovers()).find((approver) => approver.email === email)?.id;
  if (!id) return none;

  // `listHrQueue` reads only `hrApprover`: this account was just shown to be an active approver here.
  const actor = { id, role: null, verified: true, scope: null, visibility: null, hrApprover: true } as unknown as FormsActor;
  const rows = await listHrQueue(actor, now);
  return {
    app,
    approver: true,
    forms: rows.slice(0, FORM_LIMIT).map((row) => ({
      line: row.line,
      from: row.createdByName,
      state: row.state,
      requestedAt: row.requestedAt,
      waiting: row.waiting,
      overdue: row.overdue,
      path: `/forms/hr-approval/${row.id}`,
    })),
  };
}

/* --------------------------------------------------------------------- asking --- */

export interface SiblingHrForm extends Omit<PartnerHrForm, "path"> {
  /** The absolute address of the form's review page in the sibling app. */
  href: string;
}

export type SiblingHrQueue =
  /** No SIBLING_HR_SECRET here: the sibling tab is not offered at all. */
  | { status: "off" }
  /** The sibling did not answer, or answered something this app does not accept. */
  | { status: "error" }
  | { status: "ok"; app: string; approver: boolean; forms: SiblingHrForm[] };

const STATES: readonly HrApprovalState[] = ["pending", "changes_requested", "rejected", "approved"];

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

/** The sibling's answer, checked field by field: anything unexpected is dropped, never shown. */
export function parseSiblingHrAnswer(raw: unknown, baseUrl: string): SiblingHrQueue {
  if (!raw || typeof raw !== "object") return { status: "error" };
  const body = raw as { app?: unknown; approver?: unknown; forms?: unknown };
  const app = str(body.app, 60);
  if (!app || typeof body.approver !== "boolean" || !Array.isArray(body.forms)) return { status: "error" };
  const forms: SiblingHrForm[] = [];
  for (const item of body.forms.slice(0, FORM_LIMIT)) {
    if (!item || typeof item !== "object") continue;
    const form = item as Record<string, unknown>;
    const line = str(form.line, 300);
    const path = str(form.path, 80);
    const state = STATES.find((known) => known === form.state);
    const id = path?.startsWith("/forms/hr-approval/") ? path.slice("/forms/hr-approval/".length) : null;
    if (!line || !state || !id || !UUID.test(id)) continue;
    forms.push({
      line,
      from: str(form.from, 120) ?? "A manager",
      state,
      requestedAt: str(form.requestedAt, 40),
      waiting: str(form.waiting, 60) ?? "",
      overdue: form.overdue === true,
      href: `${baseUrl}/forms/hr-approval/${id}`,
    });
  }
  return { status: "ok", app, approver: body.approver, forms };
}

/**
 * The forms waiting for this approver in the sibling app. Call it only for a VERIFIED identity that is an active
 * approver here; it sends that identity's email and nothing else.
 */
export async function fetchSiblingHrQueue(
  email: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<SiblingHrQueue> {
  const secret = process.env[SIBLING_HR_SECRET_ENV]?.trim();
  if (!secret) return { status: "off" };
  const baseUrl = siblingAppUrl();
  const body = JSON.stringify({ approverEmail: email.trim().toLowerCase(), nonce: randomUUID() });
  const timestamp = String(options.now ?? Date.now());
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/api/partner/hr-queue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIBLING_HR_HEADERS.caller]: SIBLING_HR_APP.thisAppId,
        [SIBLING_HR_HEADERS.timestamp]: timestamp,
        [SIBLING_HR_HEADERS.signature]: signSiblingHrRequest(secret, SIBLING_HR_APP.thisAppId, timestamp, body),
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { status: "error" };
    return parseSiblingHrAnswer(await response.json(), baseUrl);
  } catch {
    return { status: "error" };
  }
}
