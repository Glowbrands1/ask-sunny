import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * AUTOMATIC INVITATIONS (ASD / SD / DM / RM) ON REAL SERVICES — synthetic people only
 * ============================================================================
 *
 * Disposable local stack only (`scripts/local-stack/up.sh`): real Postgres with
 * every migration, real Supabase Auth (GoTrue), real PostgREST, and Mailpit
 * catching every email. Refuses any URL that is not 127.0.0.1. Every employee
 * is invented and every address is `@example.test`. No real person is emailed.
 *
 * It drives the REAL engine (`applyAccessLifecycle` + `realApplyDeps`), follows
 * the REAL invitation links GoTrue mailed (a real `/verify` request, real
 * token, real expiry), and calls the REAL accept route and `authorizeRequest`
 * with the signed-in person's own cookie — so "effective access" is what the
 * application itself resolves, not what the test believes.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const ANON = process.env.LOCAL_ANON_KEY ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";
const MAIL = process.env.LOCAL_STACK_MAIL_API ?? "";
const AUTH_DIRECT = "127.0.0.1:59999";
const REDIRECT = "http://127.0.0.1:3000/auth/accept";

let requestCookies: { name: string; value: string }[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => requestCookies, set: () => undefined }),
}));

const run = randomBytes(3).toString("hex");
const id = (s: string) => `AI-${run}-${s}`;
const mail = (s: string) => `ai-${s.toLowerCase()}-${run}@example.test`;
const sql = (query: string) => execFileSync("psql", [PG, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const sqlFails = (query: string) => {
  try {
    sql(query);
    return null;
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
};
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

async function messagesTo(address: string): Promise<{ ID: string }[]> {
  const body = (await (await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as { messages?: { ID: string }[] };
  return body.messages ?? [];
}
async function waitForMail(address: string, atLeast: number): Promise<number> {
  for (let i = 0; i < 30; i += 1) {
    const n = (await messagesTo(address)).length;
    if (n >= atLeast) return n;
    await new Promise((r) => setTimeout(r, 200));
  }
  return (await messagesTo(address)).length;
}

interface Followed {
  landing: string;
  error: string | null;
  session: { access_token: string; refresh_token: string } | null;
  text: string;
}
/** Opens the NEWEST (or the `index`-th newest) email to `address` and follows its link as a browser would. */
async function followInvitation(address: string, index = 0, expectedRedirect = REDIRECT): Promise<Followed> {
  const found = await messagesTo(address);
  const message = (await (await fetch(`${MAIL}/message/${found[index]!.ID}`)).json()) as { Text: string; HTML: string; Subject: string; To: { Address: string }[] };
  expect(message.To.map((t) => t.Address.toLowerCase())).toEqual([address.toLowerCase()]);
  const link = message.Text.match(/https?:\/\/[^\s)\]]*\/verify[^\s)\]]*/)?.[0]?.replace(/&amp;/g, "&");
  if (!link) throw new Error("no verify link in the email");
  const url = new URL(link);
  /* The redirect the email will land on is the one WE asked for, never a host of the sender's choosing. */
  expect(url.searchParams.get("redirect_to")).toBe(expectedRedirect);
  url.host = AUTH_DIRECT;
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  const fragment = new URLSearchParams(location.split("#")[1] ?? "");
  const access = fragment.get("access_token");
  return {
    landing: location.split("#")[0]!.split("?")[0]!,
    error: fragment.get("error_code") ?? new URL(location, "http://x").searchParams.get("error_code"),
    session: access ? { access_token: access, refresh_token: fragment.get("refresh_token") ?? "" } : null,
    text: `${message.Subject}\n${message.Text}\n${message.HTML}`,
  };
}
async function cookiesFor(session: { access_token: string; refresh_token: string }) {
  const jar = new Map<string, string>();
  const client = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (entries) => entries.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  await client.auth.setSession(session);
  return [...jar].map(([name, value]) => ({ name, value }));
}

describe.skipIf(!ENABLED)("automatic Woven invitations, end to end (local stack)", { timeout: 120_000 }, () => {
  let admin: SupabaseClient;
  const S = { a: `91${run.slice(0, 2)}`, b: `92${run.slice(0, 2)}`, c: `93${run.slice(0, 2)}`, d: `94${run.slice(0, 2)}` };
  const PEOPLE = ["ASD", "SD", "SDMULTI", "DM", "DMMULTI", "DMSPAN", "RM", "RMMULTI", "TC", "ADMINPOS", "UNMAPPEDPOS", "NOEMAIL", "BADLOC", "BADEXTRA", "EXISTING", "EXPIRED", "TERM", "SELFSERVE"].map(id);
  const chosen: Record<string, string> = {};
  const userIdOf = (s: string) => sql(`select id from auth.users where lower(email) = '${mail(s)}'`);
  const authUsers = (s: string) => Number(sql(`select count(*) from auth.users where lower(email) = '${mail(s)}'`));
  const profile = (s: string) => sql(`select role||','||status||','||scope_level||','||coalesce(scope_primary_area_id,'')||','||coalesce(array_to_string(scope_also_covers_area_ids, '|'), '') from public.app_users where lower(email) = '${mail(s)}'`);

  const latestActive = () => Number(sql("select coalesce((select employees_active from public.employee_sync_runs where status = 'succeeded' order by started_at desc limit 1), 10)"));
  const freshSync = () => sql(`insert into public.employee_sync_runs (requested_by, source_mode, status, employees_active, finished_at, issue_counts) values ('cron', 'scheduled_poll', 'succeeded', ${latestActive()}, now(), '{}'::jsonb)`);

  type Cap = "CREATE_USER" | "SEND_INVITE" | "LINK_EXISTING" | "DISABLE_TERMINATED";
  async function apply(actions: Cap[], redirectTo: string | null = REDIRECT) {
    const { applyAccessLifecycle } = await import("./apply");
    const { realApplyDeps } = await import("./apply-run");
    return applyAccessLifecycle({ requestedBy: "auto-invite-test", redirectTo, config: { mode: "apply", applyActions: actions, employeeAllowlist: PEOPLE, problem: null } }, realApplyDeps());
  }
  async function planRow(s: string) {
    const { loadAccessPlan } = await import("./load");
    return (await loadAccessPlan()).rows.find((r) => r.key === `employee:${id(s)}`)!;
  }

  /** Follow the invitation, choose an own password, accept through the real route, sign in, and return the signed-in cookie. */
  async function activate(s: string): Promise<string> {
    const followed = await followInvitation(mail(s));
    expect(followed.landing).toBe(REDIRECT);
    expect(followed.session, `${s}: the invitation link yielded no session (${followed.error})`).not.toBeNull();
    const person = anonClient();
    await person.auth.setSession(followed.session!);
    const password = `Own-${randomBytes(10).toString("hex")}`;
    expect((await person.auth.updateUser({ password })).error).toBeNull();
    requestCookies = await cookiesFor(followed.session!);
    const { POST } = await import("@/app/api/auth/accept-invitation/route");
    expect((await POST()).status).toBe(200);
    chosen[s] = password;
    const signedIn = await anonClient().auth.signInWithPassword({ email: mail(s), password });
    expect(signedIn.error).toBeNull();
    return (await cookiesFor({ access_token: signedIn.data.session!.access_token, refresh_token: signedIn.data.session!.refresh_token })).map((c) => `${c.name}=${c.value}`).join("; ");
  }
  async function identityFor(cookie: string, permission: "ask_questions" | "manage_users" = "ask_questions") {
    const { authorizeRequest } = await import("@/lib/auth/server");
    return authorizeRequest(new Request("http://127.0.0.1:3000/api/x", { headers: { cookie } }), permission);
  }

  beforeAll(async () => {
    expect(new URL(URL_).hostname).toBe("127.0.0.1");
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ANON;
    process.env.SUPABASE_SECRET_KEY = SERVICE;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    /* Four synthetic salons: a and b in district Alpha, c in district Beta (same region), d in another region. */
    const district = { a: `Alpha ${run}`, b: `Alpha ${run}`, c: `Beta ${run}`, d: `Gamma ${run}` };
    const region = { a: `Region One ${run}`, b: `Region One ${run}`, c: `Region One ${run}`, d: `Region Two ${run}` };
    sql(`insert into public.salons (salon_number, store_name) values ${Object.entries(S).map(([k, n]) => `('${n}', 'Synthetic ${k}')`).join(",")} on conflict do nothing`);
    /* A period far in the future so it is the NEWEST for these synthetic salons; (grain, period_end) is unique, so the day varies per run. */
    sql(`insert into public.report_periods (grain, period_start, period_end, fiscal_year, label_raw)
         select 'mtd', d, d, 2090, 'synthetic ${run}' from (select date '2090-01-01' + (${Number.parseInt(run, 16)} % 300) as d) x
         where not exists (select 1 from public.report_periods where label_raw = 'synthetic ${run}')`);
    for (const [k, n] of Object.entries(S)) {
      sql(`set session_replication_role = replica;
           insert into public.salon_period_attributes (salon_id, period_id, ingestion_id, district_label, region_label)
           select s.id, (select id from public.report_periods where label_raw = 'synthetic ${run}'), gen_random_uuid(), '${district[k as keyof typeof district]}', '${region[k as keyof typeof region]}'
             from public.salons s where s.salon_number = '${n}';`);
    }
    for (const [k, n] of Object.entries(S)) {
      sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
           select 'WL-${k}-${run}', 'Synthetic ${k}', 'mapped', id, 'test', now() from public.salons where salon_number = '${n}'`);
    }
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, reviewed_by, reviewed_at) values
         ('WL-UNMAPPED-${run}', 'Unmapped place', 'unmapped', null, null), ('WL-CORP-${run}', 'Corporate', 'ignored', 'test', now())`);
    sql(`insert into public.woven_position_map (woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, reviewed_by, reviewed_at) values
         ('WP-ASD-${run}', 'Assistant Salon Director', 'mapped', 'assistant_salon_director', 'salon', 40, 'test', now()),
         ('WP-SD-${run}', 'Salon Director', 'mapped', 'salon_director', 'salon', 50, 'test', now()),
         ('WP-DM-${run}', 'District Manager', 'mapped', 'district_manager', 'district', 60, 'test', now()),
         ('WP-RM-${run}', 'Regional Manager', 'mapped', 'regional_manager', 'region', 70, 'test', now()),
         ('WP-TC-${run}', 'Tanning Consultant', 'mapped', 'employee', 'salon', 10, 'test', now()),
         ('WP-ADMIN-${run}', 'Synthetic Administrator', 'mapped', 'admin', 'global', 90, 'test', now()),
         ('WP-UNM-${run}', 'Operations', 'unmapped', null, null, null, null, null)`);

    const hash = "0".repeat(64);
    const emp = (s: string, pos: string, loc: string, email: string | null = mail(s)) =>
      `('woven', '${id(s)}', ${email ? `'${email}'` : "null"}, 'active', 'WP-${pos}-${run}', '${pos}', 'WL-${loc}-${run}', 'x', '${hash}', 'Syn', 'Person-${s}')`;
    sql(`insert into public.employee_access_directory (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name) values
         ${[
           emp("ASD", "ASD", "a"), emp("SD", "SD", "a"), emp("SDMULTI", "SD", "a"), emp("DM", "DM", "a"), emp("DMMULTI", "DM", "a"), emp("DMSPAN", "DM", "a"),
           emp("RM", "RM", "a"), emp("RMMULTI", "RM", "a"), emp("TC", "TC", "a"), emp("ADMINPOS", "ADMIN", "a"), emp("UNMAPPEDPOS", "UNM", "a"),
           emp("NOEMAIL", "SD", "a", null), emp("BADLOC", "SD", "UNMAPPED"), emp("BADEXTRA", "SD", "a"), emp("EXISTING", "SD", "a"), emp("EXPIRED", "ASD", "b"), emp("TERM", "DM", "b"), emp("SELFSERVE", "SD", "b"),
         ].join(",")}`);
    const affiliate = (s: string, loc: string, type: "additional" | "temporary_or_expiring_access") =>
      sql(`insert into public.employee_location_affiliations (employee_id, woven_location_id, location_name, is_primary, access_type, expires_on)
           select d.id, 'WL-${loc}-${run}', 'x', false, '${type}', ${type === "additional" ? "null" : "'2031-01-01'"} from public.employee_access_directory d where d.external_employee_id = '${id(s)}'`);
    affiliate("SDMULTI", "b", "additional");
    affiliate("SDMULTI", "c", "additional");
    affiliate("SDMULTI", "d", "temporary_or_expiring_access");
    affiliate("DMMULTI", "b", "additional");
    affiliate("DMSPAN", "c", "additional");
    affiliate("RMMULTI", "b", "additional");
    affiliate("RMMULTI", "c", "additional");
    affiliate("BADEXTRA", "UNMAPPED", "additional");

    /* An existing ACTIVE account with the same email as EXISTING — a manual account somebody already set up. */
    const made = await admin.auth.admin.createUser({ email: mail("EXISTING"), password: `Manual-${randomBytes(6).toString("hex")}`, email_confirm: true });
    if (made.error || !made.data.user) throw new Error(`existing: ${made.error?.message}`);
    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values ('${made.data.user.id}', '${mail("EXISTING")}', 'Existing Manual', 'district_manager', 'active', 'district', 'dist-manual-${run}')`);
    freshSync();
  });

  it("PLAN: every eligible role is CREATE_USER; every excluded or incomplete case is held, with its reason", async () => {
    const rows = Object.fromEntries(await Promise.all(PEOPLE.map(async (p) => [p.slice(`AI-${run}-`.length), await planRow(p.slice(`AI-${run}-`.length))] as const)));
    for (const s of ["ASD", "SD", "SDMULTI", "DM", "DMMULTI", "RM", "RMMULTI", "EXPIRED", "TERM", "SELFSERVE"]) expect(rows[s]!.lifecycle, s).toBe("CREATE_USER");
    expect(rows.DMSPAN).toMatchObject({ lifecycle: "REVIEW_REQUIRED", lifecycleReason: "locations_span_several_districts" });
    expect(rows.TC).toMatchObject({ lifecycle: "NO_CHANGE", lifecycleReason: "position_not_auto_provisioned" });
    expect(rows.ADMINPOS).toMatchObject({ lifecycle: "NO_CHANGE", lifecycleReason: "position_not_auto_provisioned" });
    expect(rows.UNMAPPEDPOS.lifecycle).toBe("REVIEW_REQUIRED");
    expect(rows.NOEMAIL.lifecycle).toBe("REVIEW_REQUIRED");
    expect(rows.BADLOC).toMatchObject({ lifecycle: "REVIEW_REQUIRED", lifecycleReason: "primary_location_unmapped" });
    expect(rows.BADEXTRA).toMatchObject({ lifecycle: "REVIEW_REQUIRED", lifecycleReason: "additional_location_unmapped" });
    expect(rows.EXISTING.lifecycle).not.toBe("CREATE_USER");
  });

  it("with SEND_INVITE OFF, CREATE_USER prepares the accounts and mails NOBODY (the production posture until the canary)", async () => {
    const outcome = await apply(["CREATE_USER"]);
    expect(outcome.status).toBe("completed");
    for (const s of ["ASD", "SD", "SDMULTI", "DM", "DMMULTI", "RM", "RMMULTI", "EXPIRED", "TERM", "SELFSERVE"]) {
      expect(authUsers(s), s).toBe(1);
      expect((await messagesTo(mail(s))).length, s).toBe(0);
      expect(sql(`select invite_delivery_status from public.employee_account_links where external_employee_id = '${id(s)}'`), s).toBe("not_sent");
    }
  });

  it("with SEND_INVITE ON: exactly ONE invitation to each eligible employee's work email — and none to anyone else", async () => {
    const outcome = await apply(["CREATE_USER", "SEND_INVITE"]);
    expect(outcome.status).toBe("completed");
    for (const s of ["ASD", "SD", "SDMULTI", "DM", "DMMULTI", "RM", "RMMULTI", "EXPIRED", "TERM", "SELFSERVE"]) {
      expect(await waitForMail(mail(s), 1), s).toBe(1);
      expect(sql(`select invite_delivery_status||','||invite_attempts from public.employee_account_links where external_employee_id = '${id(s)}'`), s).toBe("sent,1");
    }
    for (const s of ["DMSPAN", "TC", "ADMINPOS", "UNMAPPEDPOS", "NOEMAIL", "BADLOC", "BADEXTRA"]) {
      expect(authUsers(s), `${s} must have no auth user`).toBe(0);
      expect((await messagesTo(mail(s))).length, `${s} must receive nothing`).toBe(0);
      expect(sql(`select count(*) from public.app_users where lower(email) = '${mail(s)}'`), s).toBe("0");
    }
    /* The existing manual account is untouched: same role, scope, status, and its own password still works. */
    expect(profile("EXISTING")).toBe(`district_manager,active,district,dist-manual-${run},`);
    expect((await messagesTo(mail("EXISTING"))).length).toBe(0);
  });

  it("FIELD MAPPING: email, EmployeeID, role, scope, primary area — and no extra area is ever written", () => {
    expect(profile("ASD")).toBe(`assistant_salon_director,invited,salon,loc-${S.a},`);
    expect(profile("SD")).toBe(`salon_director,invited,salon,loc-${S.a},`);
    /* Additional salons are validated and recorded in the audit, NOT granted. */
    expect(profile("SDMULTI")).toBe(`salon_director,invited,salon,loc-${S.a},`);
    expect(profile("DM")).toBe(`district_manager,invited,district,dist-alpha-${run},`);
    expect(profile("DMMULTI")).toBe(`district_manager,invited,district,dist-alpha-${run},`);
    expect(profile("RM")).toBe(`regional_manager,invited,region,reg-region-one-${run},`);
    expect(profile("RMMULTI")).toBe(`regional_manager,invited,region,reg-region-one-${run},`);
    for (const s of ["ASD", "SDMULTI", "DMMULTI", "RMMULTI"]) {
      expect(sql(`select u.email||','||l.external_employee_id||','||l.link_method||','||l.managed_status||l.managed_location||l.managed_role from public.app_users u join public.employee_account_links l on l.app_user_id = u.id where lower(u.email) = '${mail(s)}'`), s).toBe(
        `${mail(s)},${id(s)},provisioned,truefalsefalse`,
      );
    }
    expect(sql(`select to_value from public.app_user_audit where action = 'woven_provisioned' and target_email = '${mail("SDMULTI")}'`)).toBe(`salon_director salon loc-${S.a} salons:${[S.a, S.b, S.c].sort().join(",")}`);
  });

  it("REPEATED Woven sync: no second account, no second email, no attempt counted", async () => {
    for (let i = 0; i < 3; i += 1) {
      freshSync();
      const outcome = await apply(["CREATE_USER", "SEND_INVITE", "LINK_EXISTING"]);
      expect(outcome).toMatchObject({ status: "completed", tally: { applied: {}, failed: {} } });
    }
    for (const s of ["ASD", "SD", "DM", "RM"]) {
      expect(authUsers(s), s).toBe(1);
      expect((await messagesTo(mail(s))).length, s).toBe(1);
      expect(sql(`select invite_attempts from public.employee_account_links where external_employee_id = '${id(s)}'`), s).toBe("1");
    }
  });

  it("the database refuses what the planner never proposes: an excluded role, a wrong scope, a wrong area, a position that is not approved", async () => {
    const call = (over: Record<string, unknown>) =>
      admin.rpc("employee_access_provision_account", { p_app_user_id: crypto.randomUUID(), p_external_employee_id: id("TC"), p_email: mail("TC"), p_display_name: "x", p_role: "salon_director", p_scope_level: "salon", p_primary_area_id: `loc-${S.a}`, p_set_by: "t", ...over });
    for (const role of ["employee", "admin", "owner", "developer", "someone_else"]) {
      expect((await call({ p_role: role, p_scope_level: "global" })).error?.message, role).toMatch(/provision_role_not_auto_provisioned|provision_scope_not_valid_for_role|invalid input value/);
    }
    expect((await call({ p_role: "district_manager", p_scope_level: "salon" })).error?.message).toMatch(/provision_scope_not_valid_for_role/);
    expect((await call({ p_role: "salon_director", p_scope_level: "global" })).error?.message).toMatch(/provision_scope_not_valid_for_role/);
    /* An eligible role asked for an employee whose APPROVED position is Tanning Consultant → refused (before anything is written). */
    const attempt = await call({});
    expect(attempt.error).not.toBeNull();
    expect(sql(`select count(*) from public.app_users where lower(email) = '${mail("TC")}'`)).toBe("0");
  });

  it("ACTIVATION + EFFECTIVE ACCESS — ASD: signs in as ASD at ONE salon, cannot manage users", async () => {
    const cookie = await activate("ASD");
    const ctx = await identityFor(cookie);
    expect(ctx.identity).toMatchObject({ role: "assistant_salon_director", scope: { level: "salon", primaryAreaId: `loc-${S.a}`, alsoCoversAreaIds: [] } });
    await expect(identityFor(cookie, "manage_users")).rejects.toThrow();
    expect(sql(`select status from public.app_users where lower(email) = '${mail("ASD")}'`)).toBe("active");
    expect(sql(`select (invite_accepted_at is not null)::text from public.employee_account_links where external_employee_id = '${id("ASD")}'`)).toBe("true");
  });

  it("ACTIVATION + EFFECTIVE ACCESS — SD with several locations: still ONLY the primary salon (additional salons are not granted)", async () => {
    const cookie = await activate("SDMULTI");
    const { identity } = await identityFor(cookie);
    expect(identity).toMatchObject({ role: "salon_director", scope: { level: "salon", primaryAreaId: `loc-${S.a}`, alsoCoversAreaIds: [] } });
    const { authorizedSalonNumbers } = await import("@/lib/reporting/scope/authorized-salons");
    expect(authorizedSalonNumbers(identity.scope)).toEqual([S.a]);
    await expect(identityFor(cookie, "manage_users")).rejects.toThrow();
  });

  it("ACTIVATION + EFFECTIVE ACCESS — DM with several locations: exactly the salons of ONE district, as reporting says", async () => {
    const cookie = await activate("DMMULTI");
    const { identity } = await identityFor(cookie);
    expect(identity).toMatchObject({ role: "district_manager", scope: { level: "district", primaryAreaId: `dist-alpha-${run}`, alsoCoversAreaIds: [] } });
    const { areaSalonNumbersFromReporting } = await import("@/lib/reporting/scope/reporting-areas");
    expect(await areaSalonNumbersFromReporting("district", [identity.scope.primaryAreaId!])).toEqual([S.a, S.b].sort());
    await expect(identityFor(cookie, "manage_users")).rejects.toThrow();
  });

  it("ACTIVATION + EFFECTIVE ACCESS — RM with several locations: the salons of ONE region, not the other region", async () => {
    const cookie = await activate("RMMULTI");
    const { identity } = await identityFor(cookie);
    expect(identity).toMatchObject({ role: "regional_manager", scope: { level: "region", primaryAreaId: `reg-region-one-${run}`, alsoCoversAreaIds: [] } });
    const { areaSalonNumbersFromReporting } = await import("@/lib/reporting/scope/reporting-areas");
    const salons = await areaSalonNumbersFromReporting("region", [identity.scope.primaryAreaId!]);
    expect(salons).toEqual([S.a, S.b, S.c].sort());
    expect(salons).not.toContain(S.d);
    await expect(identityFor(cookie, "manage_users")).rejects.toThrow();
  });

  it("ACTIVATION — SD and DM and RM single-location people also sign in with the right role", async () => {
    for (const [s, role] of [["SD", "salon_director"], ["DM", "district_manager"], ["RM", "regional_manager"]] as const) {
      const { identity } = await identityFor(await activate(s));
      expect(identity.role, s).toBe(role);
    }
  });

  it("REUSED link: following an invitation a second time gives no session and changes nothing", async () => {
    const again = await followInvitation(mail("ASD"));
    expect(again.session).toBeNull();
    expect(again.error).toMatch(/otp_expired|invalid|access_denied/i);
    expect(sql(`select status from public.app_users where lower(email) = '${mail("ASD")}'`)).toBe("active");
    expect((await messagesTo(mail("ASD"))).length).toBe(1);
  });

  it("ACTIVATED accounts are never re-invited: a later sync, and a forced retry, send nothing", async () => {
    sql(`update public.employee_account_links set invite_delivery_status = 'failed', invite_error = 'provider_error' where external_employee_id = '${id("SD")}'`);
    freshSync();
    await apply(["CREATE_USER", "SEND_INVITE"]);
    expect((await messagesTo(mail("SD"))).length).toBe(1);
    expect(sql(`select password_set from (select (encrypted_password is not null and encrypted_password <> '') as password_set from auth.users where lower(email) = '${mail("SD")}') x`)).toBe("t");
  });

  it("EXPIRED link: the real token is rejected by Supabase; an administrator resend mails a fresh link that works", async () => {
    sql(`update auth.users set confirmation_sent_at = now() - interval '3 days', invited_at = now() - interval '3 days' where lower(email) = '${mail("EXPIRED")}'`);
    const stale = await followInvitation(mail("EXPIRED"));
    expect(stale.session).toBeNull();
    expect(stale.error).toMatch(/otp_expired|invalid|access_denied/i);
    expect(sql(`select status from public.app_users where lower(email) = '${mail("EXPIRED")}'`)).toBe("invited");

    /* No automatic resend on a repeated sync (would be a duplicate): */
    freshSync();
    await apply(["CREATE_USER", "SEND_INVITE"]);
    expect((await messagesTo(mail("EXPIRED"))).length).toBe(1);

    /* The supported recovery: the existing administrator "Send sign-in link", which re-invites an unconfirmed account. */
    const { sendRecovery } = await import("@/lib/admin/user-directory");
    const sent = await sendRecovery(userIdOf("EXPIRED"), REDIRECT, { id: userIdOf("ASD"), email: mail("ASD"), role: "admin" });
    expect(sent.kind).toBe("invitation");
    expect(await waitForMail(mail("EXPIRED"), 2)).toBe(2);
    await activate("EXPIRED");
    expect(sql(`select status from public.app_users where lower(email) = '${mail("EXPIRED")}'`)).toBe("active");
  });

  it("SELF-SERVICE recovery from an expired invitation: 'Forgot your password?' on the sign-in screen mails a link that completes activation", async () => {
    sql(`update auth.users set confirmation_sent_at = now() - interval '3 days', invited_at = now() - interval '3 days' where lower(email) = '${mail("SELFSERVE")}'`);
    expect((await followInvitation(mail("SELFSERVE"))).error).toMatch(/otp_expired/);
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const response = await POST(new Request("http://127.0.0.1:3000/api/auth/forgot-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: mail("SELFSERVE") }) }));
    expect(response.status).toBe(200);
    expect(await waitForMail(mail("SELFSERVE"), 2)).toBe(2);
    const fresh = await followInvitation(mail("SELFSERVE"), 0, "http://127.0.0.1:3000/reset-password");
    expect(fresh.landing).toBe("http://127.0.0.1:3000/reset-password");
    expect(fresh.session).not.toBeNull();
    /* The reset page sets the password and then calls the same accept route, which activates the invited profile. */
    const person = anonClient();
    await person.auth.setSession(fresh.session!);
    const password = `Own-${randomBytes(10).toString("hex")}`;
    expect((await person.auth.updateUser({ password })).error).toBeNull();
    requestCookies = await cookiesFor(fresh.session!);
    const accept = await import("@/app/api/auth/accept-invitation/route");
    expect((await accept.POST()).status).toBe(200);
    expect(sql(`select status from public.app_users where lower(email) = '${mail("SELFSERVE")}'`)).toBe("active");
    expect((await anonClient().auth.signInWithPassword({ email: mail("SELFSERVE"), password })).error).toBeNull();
  });

  it("an ACTIVATED account gets a password reset — never a second invitation — from the same administrator action", async () => {
    const { sendRecovery } = await import("@/lib/admin/user-directory");
    const sent = await sendRecovery(userIdOf("DM"), REDIRECT, { id: userIdOf("ASD"), email: mail("ASD"), role: "admin" });
    expect(sent.kind).toBe("password_reset");
  });

  it("TERMINATION SAFEGUARD: Woven's explicit Terminated disables an automatically created District Manager — bans, revokes sessions", async () => {
    await activate("TERM");
    sql(`update public.employee_access_directory set employment_status = 'terminated' where external_employee_id = '${id("TERM")}'`);
    freshSync();
    const outcome = await apply(["DISABLE_TERMINATED"]);
    expect(outcome.status).toBe("completed");
    expect(sql(`select status from public.app_users where lower(email) = '${mail("TERM")}'`)).toBe("disabled");
    const attempt = await anonClient().auth.signInWithPassword({ email: mail("TERM"), password: chosen.TERM! });
    expect(attempt.data.session).toBeNull();
    /* ... and a terminated person is never (re)invited: */
    expect((await planRow("TERM")).lifecycle).not.toBe("CREATE_USER");
  });

  it("LOGGING: statuses, delivery results and mapping failures are on record; no token, link or password is", () => {
    expect(sql(`select count(*) from public.employee_access_actions where external_employee_id = '${id("DMSPAN")}' and reason_codes @> array['locations_span_several_districts']`)).not.toBe("0");
    expect(sql(`select count(*) from public.employee_access_actions where external_employee_id = '${id("BADEXTRA")}' and reason_codes @> array['additional_location_unmapped']`)).not.toBe("0");
    const dump = sql(`select coalesce(string_agg(coalesce(from_value,'')||' '||coalesce(to_value,'')||' '||action, ' '), '') from public.app_user_audit where target_email like '%-${run}@example.test'`)
      + sql(`select coalesce(string_agg(coalesce(invite_error,'')||' '||invite_delivery_status, ' '), '') from public.employee_account_links where external_employee_id like 'AI-${run}-%'`)
      + sql(`select coalesce(string_agg(coalesce(result_code,'')||' '||array_to_string(reason_codes,','), ' '), '') from public.employee_access_actions where external_employee_id like 'AI-${run}-%'`);
    expect(dump).not.toMatch(/access_token|refresh_token|token_hash|\/verify|eyJ[A-Za-z0-9_-]{10,}/);
    for (const password of Object.values(chosen)) expect(dump).not.toContain(password);
    expect(sqlFails(`update public.employee_access_actions set result = 'applied' where external_employee_id = '${id("DMSPAN")}'`)).toMatch(/append-only/);
  });

  it("the manual path is untouched: an administrator can still invite an EXCLUDED role by hand", async () => {
    const { inviteUser } = await import("@/lib/admin/user-directory");
    const result = await inviteUser(
      { email: mail("MANUALTC"), displayName: "Manual Tanning Consultant", role: "employee", scope: { level: "salon", primaryAreaId: `loc-${S.a}`, alsoCoversAreaIds: [] }, redirectTo: REDIRECT },
      { id: userIdOf("ASD"), email: mail("ASD"), role: "admin" },
    );
    expect(result).toBeTruthy();
    expect(sql(`select role||','||status from public.app_users where lower(email) = '${mail("MANUALTC")}'`)).toBe("employee,invited");
    expect(await waitForMail(mail("MANUALTC"), 1)).toBe(1);
  });
});
