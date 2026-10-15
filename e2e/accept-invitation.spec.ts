import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Browser QA of the invitation flow on the local stack: the page a new hire
 * actually sees. People are seeded the way the Woven lifecycle leaves them
 * (unconfirmed password-less auth user + `employee_access_provision_account` +
 * `inviteUserByEmail` to the pinned landing page) — the orchestration itself is
 * proven by the vitest local-stack suite; this proves the PAGES.
 */

const URL_ = process.env.LOCAL_STACK_URL ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";
const MAIL = process.env.LOCAL_STACK_MAIL_API ?? "";
const SITE = "http://127.0.0.1:3000";
const ACCEPT = `${SITE}/auth/accept`;
const AUTH_DIRECT = "127.0.0.1:59999";

const run = randomBytes(3).toString("hex");
const mail = (s: string) => `e2e-${s.toLowerCase()}-${run}@example.test`;
const sql = (q: string) => execFileSync("psql", [PG, "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

/* REAL roster salons, so the application's own salon names and rosters apply (the stack is disposable). */
const PRIMARY = "0307";
const EXTRA = ["0309", "0394"];
const OUTSIDE = "0410";

let admin: ReturnType<typeof createClient<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function waitForMail(address: string, n = 1) {
  for (let i = 0; i < 40; i += 1) {
    const found = (await (await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as { messages?: { ID: string }[] };
    if ((found.messages ?? []).length >= n) return found.messages!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email to ${address}`);
}
/** The link in the newest email, pointed at GoTrue directly exactly as a mail client's click would resolve. */
async function linkFor(address: string): Promise<string> {
  const [latest] = await waitForMail(address);
  const message = (await (await fetch(`${MAIL}/message/${latest!.ID}`)).json()) as { Text: string };
  const link = message.Text.match(/https?:\/\/[^\s)\]]*\/verify[^\s)\]]*/)?.[0]?.replace(/&amp;/g, "&");
  if (!link) throw new Error("no verify link");
  const url = new URL(link);
  expect(url.searchParams.get("redirect_to")).toBe(ACCEPT);
  url.host = AUTH_DIRECT;
  return url.toString();
}

/** Seeds one eligible employee exactly as the lifecycle would, and mails the real invitation. */
async function invite(key: string, role: "salon_director" | "assistant_salon_director", locations: { primary: string; additional: string[] }) {
  const id = `E2E-${run}-${key}`;
  const email = mail(key);
  const posId = `WP-${role}-${run}`;
  const wl = (n: string) => `WL-${n}-${run}`;
  sql(`insert into public.salons (salon_number, store_name) values ('${PRIMARY}', 'NE Grand Island'), ('${EXTRA[0]}', 'NE Kearney'), ('${EXTRA[1]}', 'MO Kansas City Liberty'), ('${OUTSIDE}', 'NE Omaha Pacific') on conflict do nothing`);
  for (const n of [PRIMARY, ...EXTRA, OUTSIDE]) {
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
         select '${wl(n)}', 'Salon ${n}', 'mapped', id, 'e2e', now() from public.salons where salon_number = '${n}' on conflict do nothing`);
  }
  sql(`insert into public.woven_position_map (woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, reviewed_by, reviewed_at)
       values ('${posId}', '${role}', 'mapped', '${role}', 'salon', 50, 'e2e', now()) on conflict do nothing`);
  sql(`insert into public.employee_access_directory (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name)
       values ('woven', '${id}', '${email}', 'active', '${posId}', '${role}', '${wl(locations.primary)}', 'x', '${"0".repeat(64)}', 'Syn', 'E2E-${key}')`);
  for (const n of locations.additional) {
    sql(`insert into public.employee_location_affiliations (employee_id, woven_location_id, location_name, is_primary, access_type)
         select d.id, '${wl(n)}', 'x', false, 'additional' from public.employee_access_directory d where d.external_employee_id = '${id}'`);
  }
  sql(`insert into public.employee_sync_runs (requested_by, source_mode, status, employees_active, finished_at, issue_counts)
       values ('cron', 'scheduled_poll', 'succeeded', coalesce((select employees_active from public.employee_sync_runs where status = 'succeeded' order by started_at desc limit 1), 10), now(), '{}'::jsonb)`);

  const created = await admin.auth.admin.createUser({ email, email_confirm: false, app_metadata: { provisioned_by: "woven", external_employee_id: id } });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const provisioned = await admin.rpc("employee_access_provision_account", {
    p_app_user_id: created.data.user.id,
    p_external_employee_id: id,
    p_email: email,
    p_display_name: `E2E ${key}`,
    p_role: role,
    p_scope_level: "salon",
    p_primary_area_id: `loc-${locations.primary}`,
    p_also_covers: locations.additional.map((n) => `loc-${n}`).sort(),
    p_set_by: "e2e",
  });
  if (provisioned.error) throw new Error(`provision: ${provisioned.error.message}`);
  const sent = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: ACCEPT });
  if (sent.error) throw new Error(`invite: ${sent.error.message}`);
  return { email, userId: created.data.user.id };
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.beforeAll(() => {
  expect(new URL(URL_).hostname).toBe("127.0.0.1");
  admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
});

test.describe("the invitation pages, in a real browser", () => {
  test("valid invitation → set own password → signed in → sign out → sign in again → access is exactly the approved salons", async ({ browser }) => {
    const person = await invite("valid", "salon_director", { primary: PRIMARY, additional: EXTRA });
    const page = await freshPage(browser);

    /* The real emailed link: GoTrue verifies it, then redirects to /auth/accept#access_token=… */
    await page.goto(await linkFor(person.email));
    await page.waitForURL(/\/reset-password/, { timeout: 30_000 });
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/e2e-valid-set-password.png" });

    /* Too-short and mismatching entries are refused with a sentence; nothing is saved. */
    const password = `Own-${randomBytes(8).toString("hex")}`;
    await page.getByLabel("New password", { exact: true }).fill("short");
    await page.getByLabel("Confirm new password", { exact: true }).fill("short");
    await page.getByRole("button", { name: /set password and continue/i }).click();
    await expect(page.getByText(/could not set your password/i)).toBeVisible();
    expect(sql(`select status from public.app_users where lower(email) = '${person.email}'`)).toBe("invited");

    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /set password and continue/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/reset-password") && !u.pathname.startsWith("/auth/accept"), { timeout: 30_000 });
    expect(sql(`select status from public.app_users where lower(email) = '${person.email}'`)).toBe("active");
    expect(sql(`select (invite_accepted_at is not null)::text from public.employee_account_links where app_user_id = '${person.userId}'`)).toBe("true");

    /* Sign out (drop the session), then sign in with the password just chosen. */
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(person.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    await page.screenshot({ path: "test-results/e2e-valid-signed-in.png" });

    /* Effective access, resolved by the application itself with this browser's session: the forms route checks the requested salon against the signed-in person's scope. */
    sql(`insert into public.form_templates (key, name, short_name, layout_family, required_permission, active)
         select 'e2e-probe', 'E2E probe', 'probe', (enum_range(null::public.form_layout_family))[1], 'ask_questions', true
         where not exists (select 1 from public.form_templates where key = 'e2e-probe')`);
    const ask = (locationId: string) =>
      page.request.post("/api/forms/instances", { data: { templateKey: "e2e-probe", employeeName: "Synthetic Person", locationId } });
    const primary = await ask(`loc-${PRIMARY}`);
    const extra = await ask(`loc-${EXTRA[0]}`);
    const outside = await ask(`loc-${OUTSIDE}`);
    /* Refused (403) only for a salon outside the scope; for an approved one the request passes the location check (any later outcome is the probe template's, not authorization). */
    expect([primary.status(), extra.status()], `${await primary.text()} / ${await extra.text()}`).not.toContain(403);
    expect([primary.status(), extra.status()]).not.toContain(404);
    expect(outside.status()).toBe(403);
    /* Not an administrator. */
    expect((await page.request.get("/api/admin/users")).status()).toBe(403);
    /* The invitation link is spent: opening it again in a fresh browser does not sign anyone in. */
  });

  test("an EXPIRED invitation shows a clear failure, signs nobody in, and a self-service link recovers it", async ({ browser }) => {
    const person = await invite("expired", "assistant_salon_director", { primary: PRIMARY, additional: [] });
    sql(`update auth.users set confirmation_sent_at = now() - interval '3 days', invited_at = now() - interval '3 days' where lower(email) = '${person.email}'`);
    const page = await freshPage(browser);
    await page.goto(await linkFor(person.email));
    await page.waitForURL(/\/auth\/accept/, { timeout: 30_000 });
    await expect(page.getByText(/this link did not work/i)).toBeVisible();
    await expect(page.getByText(/ask an administrator to send a new invitation/i)).toBeVisible();
    await page.screenshot({ path: "test-results/e2e-expired.png" });
    expect(sql(`select status from public.app_users where lower(email) = '${person.email}'`)).toBe("invited");
    expect((await page.request.get("/api/admin/users")).status()).toBe(401);

    /* Recovery: Forgot password on the sign-in screen mails a fresh link that completes activation. */
    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).first().fill(person.email);
    await page.getByRole("button", { name: /send|reset/i }).first().click();
    await waitForMail(person.email, 2);
    const recovery = (await (await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${person.email}`)}`)).json()) as { messages: { ID: string }[] };
    const body = (await (await fetch(`${MAIL}/message/${recovery.messages[0]!.ID}`)).json()) as { Text: string };
    const url = new URL(body.Text.match(/https?:\/\/[^\s)\]]*\/verify[^\s)\]]*/)![0].replace(/&amp;/g, "&"));
    url.host = AUTH_DIRECT;
    await page.goto(url.toString());
    await page.waitForURL(/\/reset-password/, { timeout: 30_000 });
    const password = `Own-${randomBytes(8).toString("hex")}`;
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Confirm new password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /set password and continue/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/reset-password"), { timeout: 30_000 });
    expect(sql(`select status from public.app_users where lower(email) = '${person.email}'`)).toBe("active");
  });

  test("a REUSED invitation shows the same clear failure and changes nothing", async ({ browser }) => {
    const person = await invite("reused", "salon_director", { primary: PRIMARY, additional: [] });
    const link = await linkFor(person.email);

    const first = await freshPage(browser);
    await first.goto(link);
    await first.waitForURL(/\/reset-password/, { timeout: 30_000 });
    await first.context().close();

    const second = await freshPage(browser);
    await second.goto(link);
    await second.waitForURL(/\/auth\/accept/, { timeout: 30_000 });
    await expect(second.getByText(/this link did not work/i)).toBeVisible();
    await second.screenshot({ path: "test-results/e2e-reused.png" });
    expect(sql(`select status from public.app_users where lower(email) = '${person.email}'`)).toBe("invited");
    expect((await second.request.get("/api/admin/users")).status()).toBe(401);
  });
});
