import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * ============================================================================
 * THE ACCOUNT LIFECYCLE AGAINST REAL SERVICES — disposable users only
 * ============================================================================
 *
 * Runs only on the disposable local stack (`scripts/local-stack/up.sh`,
 * `ASK_SUNNY_LOCAL_STACK=1`): Postgres with every migration applied as the
 * non-superuser `postgres`, Supabase Auth (GoTrue v2.180), PostgREST, and
 * Mailpit catching every email. Never the Ask Sunny project — the suite
 * refuses any URL that is not 127.0.0.1. Every person here is invented.
 *
 * It drives the REAL engine (`applyAccessLifecycle` with `realApplyDeps`) and
 * the REAL accept-invitation route, and proves end to end:
 *
 *   CREATE_USER   auth user with no password, unconfirmed → profile invited +
 *                 link provisioned (status managed, role/location not) →
 *                 Supabase emails the invitation to the Woven email → the
 *                 person follows it, chooses their own password → Ask Sunny's
 *                 accept route → active, invite_accepted_at recorded.
 *   refusals      duplicate email, unmapped position, missing email, status
 *                 conflict, terminated: no account; a second run, or two runs
 *                 at once: still one account; an invitation that cannot be
 *                 sent leaves a recoverable account the next run invites.
 *   LINK_EXISTING one exact email match → the link only; the account unchanged.
 *   DISABLE_TERMINATED  explicit Woven Terminated → disabled, banned, sessions
 *                 revoked: no password sign-in, no refresh, no Forgot
 *                 Password, no knowledge; history kept. Missing-only, a past
 *                 TerminationDate on an Active employee, a failed terminated
 *                 read, a protected account: never revoked. Rehire: never
 *                 reactivated.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const ANON = process.env.LOCAL_ANON_KEY ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";
const MAIL = process.env.LOCAL_STACK_MAIL_API ?? "";
/* GoTrue's own port: the invitation link is followed exactly as a browser would, straight to Supabase Auth. */
const AUTH_DIRECT = "127.0.0.1:59999";
const REDIRECT = "http://127.0.0.1:3000/auth/accept";

/* The cookie jar `next/headers` hands the accept-invitation route — the signed-in person's own session. */
let requestCookies: { name: string; value: string }[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => requestCookies, set: () => undefined }),
}));

const run = randomBytes(3).toString("hex");
const id = (suffix: string) => `LC-${run}-${suffix}`;
const mail = (suffix: string) => `lc-${suffix.toLowerCase()}-${run}@gmail.test`;
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
const tokenClient = (accessToken: string) =>
  createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });

async function messagesTo(address: string): Promise<{ ID: string }[]> {
  const response = await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${address}`)}`);
  const body = (await response.json()) as { messages?: { ID: string }[] };
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

/** Opens the newest email to `address`, follows its link the way a browser does, and returns the session in the URL fragment. */
async function followInvitation(address: string): Promise<{ landing: string; session: { access_token: string; refresh_token: string }; text: string }> {
  const [latest] = await messagesTo(address);
  const message = (await (await fetch(`${MAIL}/message/${latest!.ID}`)).json()) as { Text: string; HTML: string; Subject: string };
  const link = message.Text.match(/https?:\/\/[^\s)\]]*\/verify[^\s)\]]*/)?.[0]?.replace(/&amp;/g, "&");
  if (!link) throw new Error("no verify link in the invitation");
  const url = new URL(link);
  url.host = AUTH_DIRECT;
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location") ?? "";
  const fragment = new URLSearchParams(location.split("#")[1] ?? "");
  return {
    landing: location.split("#")[0]!,
    session: { access_token: fragment.get("access_token") ?? "", refresh_token: fragment.get("refresh_token") ?? "" },
    text: `${message.Subject}\n${message.Text}\n${message.HTML}`,
  };
}

/** The cookies @supabase/ssr itself would set in the browser for a session. */
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

describe.skipIf(!ENABLED)("the Woven account lifecycle on real services (local stack)", { timeout: 90_000 }, () => {
  let admin: SupabaseClient;
  const OURS = [
    "NEW", "LINKME", "DUP1", "DUP2", "UNMAPPED", "NOEMAIL", "CONFLICT", "GONE", "RACE", "NOINVITE",
    "LEAVER", "MISSING", "PASTDATE", "READFAIL", "ADMIN", "STEADY", "QUIET", "BARE", "ADMINMATCH",
  ].map(id);
  const ids: Record<string, string> = {};
  const leaverPassword = `L-${randomBytes(12).toString("hex")}`;
  let leaverSession: Session;
  let documentId = "";
  let conversationId = "";
  const SCOPE = `lc-${run}`;

  const latestActive = () => Number(sql("select coalesce((select employees_active from public.employee_sync_runs where status = 'succeeded' order by started_at desc limit 1), 10)"));
  /** A fresh, successful directory sync — the directory is current. */
  const freshSync = (issues: Record<string, number> = {}) =>
    sql(`insert into public.employee_sync_runs (requested_by, source_mode, status, employees_active, finished_at, issue_counts)
         values ('cron', 'scheduled_poll', 'succeeded', ${latestActive()}, now(), '${JSON.stringify(issues)}'::jsonb)`);

  const configFor = (actions: ("CREATE_USER" | "SEND_INVITE" | "LINK_EXISTING" | "DISABLE_TERMINATED")[], only: string[] = OURS) => ({
    mode: "apply" as const,
    applyActions: actions,
    employeeAllowlist: only,
    problem: null,
  });
  async function apply(actions: ("CREATE_USER" | "SEND_INVITE" | "LINK_EXISTING" | "DISABLE_TERMINATED")[], redirectTo: string | null = REDIRECT, only?: string[]) {
    const { applyAccessLifecycle } = await import("./apply");
    const { realApplyDeps } = await import("./apply-run");
    return applyAccessLifecycle({ requestedBy: "local-stack-test", redirectTo, config: configFor(actions, only) }, realApplyDeps());
  }
  async function planRow(suffix: string) {
    const { loadAccessPlan } = await import("./load");
    return (await loadAccessPlan()).rows.find((r) => r.key === `employee:${id(suffix)}`)!;
  }
  const accountsWithEmail = (email: string) => Number(sql(`select count(*) from public.app_users where lower(email) = lower('${email}')`));
  const authUsersWithEmail = (email: string) => Number(sql(`select count(*) from auth.users where lower(email) = lower('${email}')`));

  beforeAll(async () => {
    expect(new URL(URL_).hostname).toBe("127.0.0.1");
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ANON;
    process.env.SUPABASE_SECRET_KEY = SERVICE;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    sql(`insert into public.salons (salon_number, store_name) values ('0307', 'NE Grand Island'), ('0394', 'KC Liberty') on conflict do nothing`);
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
         select 'WL-${run}', 'NE Grand Island', 'mapped', id, 'test', now() from public.salons where salon_number = '0307'`);
    sql(`insert into public.woven_position_map (woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, reviewed_by, reviewed_at)
         values ('WPSD-${run}', 'Salon Director', 'mapped', 'salon_director', 'salon', 30, 'test', now()),
                ('WPASD-${run}', 'Assistant Salon Director', 'mapped', 'assistant_salon_director', 'salon', 40, 'test', now()),
                ('WPUNM-${run}', 'Operations', 'unmapped', null, null, null, null, null)`);

    const hash = "0".repeat(64);
    const row = (suffix: string, email: string | null, position = "WPSD", status = "active", extra = "") => {
      const [issues, missing, termination] = extra ? extra.split("|") : ["{}", "0", ""];
      return `('woven', '${id(suffix)}', ${email ? `'${email}'` : "null"}, '${status}', '${position}-${run}', 'Salon Director', 'WL-${run}', 'NE Grand Island', '${hash}', 'Pat', 'Person-${suffix}', '${issues}', ${missing}, ${termination ? `'${termination}'` : "null"})`;
    };
    sql(`insert into public.employee_access_directory
         (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name, data_issues, missing_sync_count, termination_date)
         values
         ${row("NEW", mail("NEW"))},
         ${row("LINKME", mail("LINKME"))},
         ${row("DUP1", mail("DUP"))},
         ${row("DUP2", mail("DUP").toUpperCase())},
         ${row("UNMAPPED", mail("UNMAPPED"), "WPUNM")},
         ${row("NOEMAIL", null)},
         ${row("CONFLICT", mail("CONFLICT"), "WPASD", "active", "{status_termination_conflict}|0|2025-05-17")},
         ${row("GONE", mail("GONE"), "WPSD", "terminated")},
         ${row("RACE", mail("RACE"))},
         ${row("NOINVITE", mail("NOINVITE"))},
         ${row("LEAVER", mail("LEAVER"))},
         ${row("MISSING", mail("MISSING"), "WPSD", "terminated", "{}|2|")},
         ${row("PASTDATE", mail("PASTDATE"), "WPSD", "active", "{status_termination_conflict}|0|2025-01-31")},
         ${row("READFAIL", mail("READFAIL"))},
         ${row("ADMIN", mail("ADMIN"), "WPSD", "terminated")},
         ${row("STEADY", mail("STEADY"))},
         ${row("QUIET", mail("QUIET"))},
         ${row("BARE", mail("BARE"))},
         ${row("ADMINMATCH", mail("ADMINMATCH"))}`);

    /* Existing accounts: one to be discovered by email; four already linked (three status-managed SDs, one administrator). */
    const make = async (email: string, password?: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
      return data.user.id;
    };
    for (const suffix of ["LINKME", "LEAVER", "MISSING", "PASTDATE", "READFAIL", "ADMIN", "STEADY", "ADMINMATCH"]) {
      ids[suffix] = await make(mail(suffix), suffix === "LEAVER" ? leaverPassword : undefined);
    }
    const profile = (suffix: string, role = "salon_director") =>
      role === "admin"
        ? `('${ids[suffix]}', '${mail(suffix)}', 'Person ${suffix}', 'admin', 'active', 'global', null)`
        : `('${ids[suffix]}', '${mail(suffix)}', 'Person ${suffix}', '${role}', 'active', 'salon', 'loc-0307')`;
    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values
         ${["LINKME", "LEAVER", "MISSING", "PASTDATE", "READFAIL", "STEADY"].map((s) => profile(s)).join(",")}, ${profile("ADMIN", "admin")}, ${profile("ADMINMATCH", "admin")}`);
    /* "Manual silent provisioning": a confirmed Auth user with a password somebody else set, and no Ask Sunny profile. */
    const bare = await admin.auth.admin.createUser({ email: mail("BARE"), password: `Set-by-someone-${randomBytes(6).toString("hex")}`, email_confirm: true });
    if (bare.error || !bare.data.user) throw new Error(`bare: ${bare.error?.message}`);
    ids.BARE = bare.data.user.id;
    const link = (suffix: string, managed = true) =>
      `('${ids[suffix]}', 'woven_linked', '${id(suffix)}', 'admin_manual', ${managed}, false, false, 'test')`;
    sql(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, managed_status, managed_location, managed_role, set_by) values
         ${["LEAVER", "MISSING", "PASTDATE", "READFAIL", "STEADY"].map((s) => link(s)).join(",")}, ${link("ADMIN", false)}`);

    /* The leaver is signed in, has a conversation, and can read the knowledge library — before termination. */
    const signIn = await anonClient().auth.signInWithPassword({ email: mail("LEAVER"), password: leaverPassword });
    if (!signIn.data.session) throw new Error(`sign-in: ${signIn.error?.message}`);
    leaverSession = signIn.data.session;
    conversationId = randomUUID();
    sql(`insert into public.chat_conversations (id, user_id, client_conversation_id, title) values ('${conversationId}', '${ids.LEAVER}', 'lc-${run}', 'Closing checklist')`);
    documentId = randomUUID();
    sql(`insert into public.knowledge_documents (id, knowledge_scope_id, title, original_filename, mime_type, file_type, storage_path, size_bytes, status, indexed, indexed_at)
         values ('${documentId}', '${SCOPE}', 'Closing checklist', 'close.pdf', 'application/pdf', 'pdf', '${SCOPE}/close.pdf', 10, 'indexed', true, now())`);

    freshSync();
  });

  /* ------------------------------------------------------- planning -- */

  it("plans the lifecycle from the real database: one CREATE_USER per eligible employee, LINK_EXISTING for the exact match, REVIEW for the rest", async () => {
    const outcomes = Object.fromEntries(
      await Promise.all(["NEW", "LINKME", "DUP1", "DUP2", "UNMAPPED", "NOEMAIL", "CONFLICT", "GONE", "STEADY"].map(async (s) => [s, (await planRow(s)).lifecycle])),
    );
    expect(outcomes).toEqual({
      NEW: "CREATE_USER",
      LINKME: "LINK_EXISTING",
      DUP1: "REVIEW_REQUIRED",
      DUP2: "REVIEW_REQUIRED",
      UNMAPPED: "REVIEW_REQUIRED",
      NOEMAIL: "REVIEW_REQUIRED",
      CONFLICT: "REVIEW_REQUIRED",
      GONE: "NO_CHANGE",
      STEADY: "NO_CHANGE",
    });
  });

  /* ---------------------------------------------- CREATE_USER + invite -- */

  it("CREATE_USER: an unconfirmed auth user with NO password, an invited profile, a provisioned link — and one invitation email to the Woven email", async () => {
    const outcome = await apply(["CREATE_USER", "SEND_INVITE"], REDIRECT, [id("NEW")]);
    expect(outcome.status).toBe("completed");

    const userId = sql(`select id from auth.users where lower(email) = '${mail("NEW")}'`);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    /* Unconfirmed, tied to the EmployeeID. No password was sent by Ask Sunny (Supabase keeps a random hash nobody knows): nobody can sign in yet. */
    expect(sql(`select (email_confirmed_at is null)::text || ',' || (invited_at is not null)::text || ',' || (raw_app_meta_data->>'external_employee_id') from auth.users where id = '${userId}'`)).toBe(
      `true,true,${id("NEW")}`,
    );
    const guess = await anonClient().auth.signInWithPassword({ email: mail("NEW"), password: "anything-at-all-1A!" });
    expect(guess.data.session).toBeNull();
    expect(sql(`select role||','||status||','||scope_level||','||scope_primary_area_id from public.app_users where id = '${userId}'`)).toBe("salon_director,invited,salon,loc-0307");
    expect(
      sql(`select management||','||external_employee_id||','||link_method||','||managed_status||','||managed_location||','||managed_role||','||invite_delivery_status||','||invite_attempts||','||(invite_sent_at is not null) from public.employee_account_links where app_user_id = '${userId}'`),
    ).toBe(`woven_linked,${id("NEW")},provisioned,true,false,false,sent,1,true`);
    expect(sql(`select string_agg(action, ',' order by created_at) from public.app_user_audit where target_user_id = '${userId}'`)).toBe("woven_provisioned,invited");

    expect(await waitForMail(mail("NEW"), 1)).toBe(1);
  });

  it("INVITE: the person follows the link, chooses their OWN password, and Ask Sunny's accept route activates them; invite_accepted_at is recorded", async () => {
    const userId = sql(`select id from auth.users where lower(email) = '${mail("NEW")}'`);
    const invitation = await followInvitation(mail("NEW"));
    expect(invitation.landing).toBe(REDIRECT);
    expect(invitation.session.access_token).not.toBe("");
    /* Nothing in the email is a password: there is none to send. */
    expect(invitation.text).not.toMatch(/password\s*[:=]/i);

    /* The accept page: set the session, choose a password. */
    const person = anonClient();
    await person.auth.setSession(invitation.session);
    const chosen = `Own-${randomBytes(10).toString("hex")}`;
    expect((await person.auth.updateUser({ password: chosen })).error).toBeNull();

    /* Ask Sunny's accept route, with the browser's session cookie. */
    requestCookies = await cookiesFor(invitation.session);
    const { POST } = await import("@/app/api/auth/accept-invitation/route");
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ activated: true });

    expect(sql(`select status from public.app_users where id = '${userId}'`)).toBe("active");
    expect(sql(`select (invite_accepted_at is not null)::text from public.employee_account_links where app_user_id = '${userId}'`)).toBe("true");
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${userId}' and action = 'invitation_accepted'`)).toBe("1");
    /* The password they chose works; it was never in any email or table of ours. */
    const signIn = await anonClient().auth.signInWithPassword({ email: mail("NEW"), password: chosen });
    expect(signIn.error).toBeNull();
    expect(sql(`select count(*) from public.app_user_audit where coalesce(from_value,'') || coalesce(to_value,'') like '%${chosen}%'`)).toBe("0");
  });

  it("a repeated run creates nothing and sends nothing: the provisioned link is found by EmployeeID", async () => {
    const outcome = await apply(["CREATE_USER", "SEND_INVITE", "LINK_EXISTING"], REDIRECT, [id("NEW")]);
    expect(outcome).toMatchObject({ status: "completed", tally: { applied: {}, failed: {} } });
    expect(authUsersWithEmail(mail("NEW"))).toBe(1);
    expect(accountsWithEmail(mail("NEW"))).toBe(1);
    expect((await messagesTo(mail("NEW"))).length).toBe(1);
    expect((await planRow("NEW")).lifecycle).toBe("NO_CHANGE");
  });

  it("blocked creations: duplicate email, unmapped position, missing email, status conflict (Active + historical TerminationDate) and Terminated — no account, no auth user, no email", async () => {
    await apply(["CREATE_USER", "SEND_INVITE"], REDIRECT, [id("DUP1"), id("DUP2"), id("UNMAPPED"), id("NOEMAIL"), id("CONFLICT"), id("GONE")]);
    for (const suffix of ["DUP", "UNMAPPED", "CONFLICT", "GONE"]) {
      expect(authUsersWithEmail(mail(suffix)), suffix).toBe(0);
      expect(accountsWithEmail(mail(suffix)), suffix).toBe(0);
      expect((await messagesTo(mail(suffix))).length, suffix).toBe(0);
    }
    expect(sql(`select count(*) from public.employee_account_links where external_employee_id in ('${id("NOEMAIL")}', '${id("UNMAPPED")}', '${id("CONFLICT")}', '${id("GONE")}', '${id("DUP1")}', '${id("DUP2")}')`)).toBe("0");
  });

  it("the database re-checks too: provisioning a status-conflict employee directly is refused, whatever the caller sends", () => {
    expect(
      sqlFails(`select public.employee_access_provision_account(gen_random_uuid(), '${id("CONFLICT")}', '${mail("CONFLICT")}', 'X', 'assistant_salon_director', 'loc-0307', 'test')`),
    ).toMatch(/provision_auth_user_mismatch|provision_status_conflict/);
  });

  it("two runs at once: one takes the lock, the other is refused — exactly ONE account and ONE auth user", async () => {
    const results = await Promise.all([apply(["CREATE_USER", "SEND_INVITE"], REDIRECT, [id("RACE")]), apply(["CREATE_USER", "SEND_INVITE"], REDIRECT, [id("RACE")])]);
    expect(results.map((r) => r.status).sort()).toEqual(expect.arrayContaining(["completed"]));
    expect(results.filter((r) => r.status === "busy" || r.status === "completed")).toHaveLength(2);
    expect(authUsersWithEmail(mail("RACE"))).toBe(1);
    expect(accountsWithEmail(mail("RACE"))).toBe(1);
    expect(sql(`select count(*) from public.employee_account_links where external_employee_id = '${id("RACE")}'`)).toBe("1");
  });

  it("the provisioning function itself is concurrency-safe: two simultaneous calls for the same auth user → one 'created', one 'already_provisioned'", async () => {
    /* A second, independent employee prepared like an interrupted attempt: the auth user exists, no profile yet. */
    sql(`insert into public.employee_access_directory (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name)
         values ('woven', '${id("TWIN")}', '${mail("TWIN")}', 'active', 'WPSD-${run}', 'Salon Director', 'WL-${run}', 'NE Grand Island', '${"0".repeat(64)}', 'Pat', 'Twin')`);
    const { data } = await admin.auth.admin.createUser({ email: mail("TWIN"), email_confirm: false, app_metadata: { provisioned_by: "woven", external_employee_id: id("TWIN") } });
    const call = () =>
      admin.rpc("employee_access_provision_account", {
        p_app_user_id: data.user!.id,
        p_external_employee_id: id("TWIN"),
        p_email: mail("TWIN"),
        p_display_name: "Pat Twin",
        p_role: "salon_director",
        p_primary_area_id: "loc-0307",
        p_set_by: "test",
      });
    const [a, b] = await Promise.all([call(), call()]);
    expect([a.data, b.data].sort()).toEqual(["already_provisioned", "created"]);
    expect(accountsWithEmail(mail("TWIN"))).toBe(1);
  });

  it("an invitation that cannot be sent leaves a recoverable, invited account; the next run sends it", async () => {
    await apply(["CREATE_USER", "SEND_INVITE"], null, [id("NOINVITE")]);
    const userId = sql(`select id from auth.users where lower(email) = '${mail("NOINVITE")}'`);
    expect(sql(`select status from public.app_users where id = '${userId}'`)).toBe("invited");
    expect(sql(`select invite_delivery_status||','||invite_error||','||invite_attempts from public.employee_account_links where app_user_id = '${userId}'`)).toBe(
      "failed,redirect_not_configured,1",
    );
    expect((await messagesTo(mail("NOINVITE"))).length).toBe(0);
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${userId}' and action = 'invite_failed'`)).toBe("1");

    const retry = await apply(["CREATE_USER", "SEND_INVITE"], REDIRECT, [id("NOINVITE")]);
    expect(retry).toMatchObject({ status: "completed", tally: { applied: { INVITE_RETRY: 1 } } });
    expect(sql(`select invite_delivery_status||','||coalesce(invite_error,'-')||','||invite_attempts from public.employee_account_links where app_user_id = '${userId}'`)).toBe("sent,-,2");
    expect(await waitForMail(mail("NOINVITE"), 1)).toBe(1);
    expect(authUsersWithEmail(mail("NOINVITE"))).toBe(1);
  });

  it("SEND_INVITE off: CREATE_USER creates the invited account and emails NOTHING; switching SEND_INVITE on later sends it", async () => {
    await apply(["CREATE_USER"], REDIRECT, [id("QUIET")]);
    const userId = sql(`select id from auth.users where lower(email) = '${mail("QUIET")}'`);
    expect(sql(`select status from public.app_users where id = '${userId}'`)).toBe("invited");
    expect(sql(`select invite_delivery_status||','||invite_attempts||','||(invite_sent_at is null) from public.employee_account_links where app_user_id = '${userId}'`)).toBe("not_sent,0,true");
    await new Promise((r) => setTimeout(r, 800));
    expect((await messagesTo(mail("QUIET"))).length).toBe(0);
    await apply(["SEND_INVITE"], REDIRECT, [id("QUIET")]);
    expect(await waitForMail(mail("QUIET"), 1)).toBe(1);
    expect(sql(`select invite_delivery_status from public.employee_account_links where app_user_id = '${userId}'`)).toBe("sent");
  });

  it("a bare Auth user someone else created (confirmed, with a password, no profile) → REVIEW_REQUIRED; the lifecycle never touches it", async () => {
    const before = sql(`select to_jsonb(u) - 'updated_at' from auth.users u where id = '${ids.BARE}'`);
    expect(await planRow("BARE")).toMatchObject({ lifecycle: "REVIEW_REQUIRED", lifecycleReason: "auth_user_exists_without_profile", actions: ["FLAG_AUTH_USER_EXISTS"] });
    await apply(["CREATE_USER", "SEND_INVITE"], REDIRECT, [id("BARE")]);
    expect(authUsersWithEmail(mail("BARE"))).toBe(1);
    expect(accountsWithEmail(mail("BARE"))).toBe(0);
    expect(sql(`select count(*) from public.employee_account_links where external_employee_id = '${id("BARE")}'`)).toBe("0");
    expect(sql(`select to_jsonb(u) - 'updated_at' from auth.users u where id = '${ids.BARE}'`)).toBe(before);
    expect((await messagesTo(mail("BARE"))).length).toBe(0);
    /* And the database refuses it directly: the credential was not created for this employee. */
    expect(sqlFails(`select public.employee_access_provision_account('${ids.BARE}', '${id("BARE")}', '${mail("BARE")}', 'X', 'salon_director', 'loc-0307', 'test')`)).toMatch(/provision_auth_user_mismatch/);
  });

  /* ------------------------------------------------------ LINK_EXISTING -- */

  it("LINK_EXISTING never for a protected or ambiguous match — the planner holds it AND the database refuses it", async () => {
    expect(await planRow("ADMINMATCH")).toMatchObject({ lifecycle: "REVIEW_REQUIRED", actions: ["FLAG_PROTECTED_ACCOUNT"] });
    expect(sqlFails(`select public.employee_access_link_existing('${ids.ADMINMATCH}', '${id("ADMINMATCH")}', 'test')`)).toMatch(/link_protected_account/);
    /* Ambiguous: DUP1 and DUP2 share an email; give one an account with it and try to link it directly. */
    const { data } = await admin.auth.admin.createUser({ email: mail("DUP"), email_confirm: true });
    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values ('${data.user!.id}', '${mail("DUP")}', 'Dup', 'salon_director', 'active', 'salon', 'loc-0307')`);
    expect((await planRow("DUP1")).lifecycle).toBe("REVIEW_REQUIRED");
    expect(sqlFails(`select public.employee_access_link_existing('${data.user!.id}', '${id("DUP1")}', 'test')`)).toMatch(/link_duplicate_email/);
    expect(sql(`select count(*) from public.employee_account_links where app_user_id in ('${ids.ADMINMATCH}', '${data.user!.id}')`)).toBe("0");
  });


  it("LINK_EXISTING: the exact email match is linked (status managed for a salon SD), and the account itself is untouched", async () => {
    const before = sql(`select to_jsonb(u)::text from public.app_users u where id = '${ids.LINKME}'`);
    const outcome = await apply(["LINK_EXISTING"], REDIRECT, [id("LINKME")]);
    expect(outcome).toMatchObject({ status: "completed", tally: { applied: { LINK_EXISTING: 1 } } });
    expect(sql(`select management||','||external_employee_id||','||link_method||','||managed_status||','||managed_location||','||managed_role from public.employee_account_links where app_user_id = '${ids.LINKME}'`)).toBe(
      `woven_linked,${id("LINKME")},email_discovery,true,false,false`,
    );
    expect(sql(`select to_jsonb(u)::text from public.app_users u where id = '${ids.LINKME}'`)).toBe(before);
    expect(authUsersWithEmail(mail("LINKME"))).toBe(1);
    expect((await planRow("LINKME")).account?.via).toBe("link");
  });

  /* -------------------------------------------------- DISABLE_TERMINATED -- */

  it("before termination the leaver reads the knowledge library (control)", async () => {
    const { data } = await tokenClient(leaverSession.access_token).from("knowledge_documents").select("id").eq("knowledge_scope_id", SCOPE);
    expect(data?.map((d) => d.id)).toEqual([documentId]);
  });

  it("not revoked: missing from Woven only (even with Terminated on file), or Active with a past TerminationDate", async () => {
    await apply(["DISABLE_TERMINATED"]);
    for (const suffix of ["MISSING", "PASTDATE"]) {
      expect(sql(`select status from public.app_users where id = '${ids[suffix]}'`), suffix).toBe("active");
      expect(sql(`select (banned_until is null)::text from auth.users where id = '${ids[suffix]}'`), suffix).toBe("true");
    }
    expect((await planRow("MISSING")).lifecycle).toBe("REVIEW_REQUIRED");
    expect((await planRow("PASTDATE")).lifecycle).toBe("NO_CHANGE");
    /* And the database refuses them directly. */
    expect(sqlFails(`select public.employee_access_disable_terminated('${ids.MISSING}', '${id("MISSING")}', 'test')`)).toMatch(/disable_not_terminated_in_latest_read/);
    expect(sqlFails(`select public.employee_access_disable_terminated('${ids.PASTDATE}', '${id("PASTDATE")}', 'test')`)).toMatch(/disable_not_terminated_in_latest_read/);
  });

  it("not revoked: a protected administrator Terminated in Woven is REVIEW_REQUIRED, never disabled", async () => {
    expect((await planRow("ADMIN")).lifecycle).toBe("REVIEW_REQUIRED");
    expect(sql(`select status from public.app_users where id = '${ids.ADMIN}'`)).toBe("active");
    expect(sqlFails(`select public.employee_access_disable_terminated('${ids.ADMIN}', '${id("ADMIN")}', 'test')`)).toMatch(/disable_status_not_managed/);
  });

  it("not revoked: when the terminated-status read FAILED, the run aborts — even for an explicit Terminated", async () => {
    sql(`update public.employee_access_directory set employment_status = 'terminated' where external_employee_id = '${id("READFAIL")}'`);
    freshSync({ terminated_status_read_failed_http: 1 });
    const outcome = await apply(["DISABLE_TERMINATED"]);
    expect(outcome).toMatchObject({ status: "aborted", guardCodes: expect.arrayContaining(["terminated_read_failed"]) });
    expect(sql(`select status from public.app_users where id = '${ids.READFAIL}'`)).toBe("active");
    /* A FAILED latest sync: the database refuses on its own as well. */
    sql(`insert into public.employee_sync_runs (requested_by, source_mode, status, employees_active, finished_at, error_code) values ('cron', 'scheduled_poll', 'failed', 0, now(), 'woven_unreachable')`);
    expect(sqlFails(`select public.employee_access_disable_terminated('${ids.READFAIL}', '${id("READFAIL")}', 'test')`)).toMatch(/disable_directory_not_current/);
    /* Put the READFAIL employee back to Active and restore a healthy directory for the rest of the suite. */
    sql(`update public.employee_access_directory set employment_status = 'active' where external_employee_id = '${id("READFAIL")}'`);
    freshSync();
  });

  it("explicit Woven Terminated → disabled, banned, every session revoked; audited", async () => {
    sql(`update public.employee_access_directory set employment_status = 'terminated', termination_date = '2026-10-05' where external_employee_id = '${id("LEAVER")}'`);
    freshSync();
    expect((await planRow("LEAVER")).lifecycle).toBe("DISABLE_TERMINATED");
    const outcome = await apply(["DISABLE_TERMINATED"], REDIRECT, [id("LEAVER")]);
    expect(outcome).toMatchObject({ status: "completed", tally: { applied: { DISABLE_TERMINATED: 1 } } });

    expect(sql(`select status from public.app_users where id = '${ids.LEAVER}'`)).toBe("disabled");
    expect(sql(`select (banned_until > now())::text from auth.users where id = '${ids.LEAVER}'`)).toBe("true");
    expect(sql(`select count(*) from auth.sessions where user_id = '${ids.LEAVER}'`)).toBe("0");
    expect(sql(`select count(*) from auth.refresh_tokens where user_id = '${ids.LEAVER}'`)).toBe("0");
    expect(
      sql(`select (terminated_at is not null)::text||','||(access_revoked_at is not null)::text||','||revoked_woven_status from public.employee_account_links where app_user_id = '${ids.LEAVER}'`),
    ).toBe("true,true,terminated");
    expect(sql(`select string_agg(action, ',' order by created_at) from public.app_user_audit where target_user_id = '${ids.LEAVER}'`)).toBe("status_changed,access_revoked");
  });

  it("the leaver cannot sign in with their password, cannot refresh, gets no Forgot Password email, and reads no knowledge", async () => {
    const password = await anonClient().auth.signInWithPassword({ email: mail("LEAVER"), password: leaverPassword });
    expect(password.data.session).toBeNull();
    expect(password.error).not.toBeNull();

    const refreshed = await anonClient().auth.refreshSession({ refresh_token: leaverSession.refresh_token });
    expect(refreshed.data.session).toBeNull();

    const before = (await messagesTo(mail("LEAVER"))).length;
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const reset = await POST(
      new Request("http://127.0.0.1:3000/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: mail("LEAVER") }),
      }),
    );
    expect(await reset.json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 1000));
    expect((await messagesTo(mail("LEAVER"))).length).toBe(before);

    const { data } = await tokenClient(leaverSession.access_token).from("knowledge_documents").select("id").eq("knowledge_scope_id", SCOPE);
    expect(data ?? []).toEqual([]);
  });

  it("history preserved: auth user, profile, link, conversation and audit trail all remain — nothing deleted", async () => {
    expect((await admin.auth.admin.getUserById(ids.LEAVER!)).data.user?.id).toBe(ids.LEAVER);
    expect(sql(`select count(*) from public.app_users where id = '${ids.LEAVER}'`)).toBe("1");
    expect(sql(`select count(*) from public.employee_account_links where app_user_id = '${ids.LEAVER}'`)).toBe("1");
    expect(sql(`select count(*) from public.chat_conversations where id = '${conversationId}'`)).toBe("1");
  });

  it("already disabled → idempotent: a second run changes nothing and writes no new audit", async () => {
    const audits = sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.LEAVER}'`);
    const outcome = await apply(["DISABLE_TERMINATED"], REDIRECT, [id("LEAVER")]);
    expect(outcome).toMatchObject({ status: "completed", tally: { applied: {}, failed: {} } });
    expect((await planRow("LEAVER")).lifecycle).toBe("NO_CHANGE");
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.LEAVER}'`)).toBe(audits);
    /* Calling the function again directly is also harmless. */
    expect(sql(`select public.employee_access_disable_terminated('${ids.LEAVER}', '${id("LEAVER")}', 'test')`)).toBe("already_disabled");
  });

  it("rehire: Woven shows the leaver Active again → REVIEW_REQUIRED; the account stays disabled and banned", async () => {
    sql(`update public.employee_access_directory set employment_status = 'active' where external_employee_id = '${id("LEAVER")}'`);
    freshSync();
    const row = await planRow("LEAVER");
    expect(row).toMatchObject({ lifecycle: "REVIEW_REQUIRED", lifecycleReason: "active_in_woven_after_revocation" });
    await apply(["CREATE_USER", "SEND_INVITE", "LINK_EXISTING", "DISABLE_TERMINATED"], REDIRECT, [id("LEAVER")]);
    expect(sql(`select status from public.app_users where id = '${ids.LEAVER}'`)).toBe("disabled");
    expect(sql(`select (banned_until > now())::text from auth.users where id = '${ids.LEAVER}'`)).toBe("true");
    expect(authUsersWithEmail(mail("LEAVER"))).toBe(1);
  });

  it("every apply run is on record, each action with its result; the record cannot be edited", () => {
    expect(Number(sql(`select count(*) from public.employee_access_runs where mode = 'apply' and requested_by = 'local-stack-test' and status in ('completed', 'aborted')`))).toBeGreaterThan(5);
    expect(sql(`select count(*) from public.employee_access_runs where status = 'running'`)).toBe("0");
    expect(Number(sql(`select count(*) from public.employee_access_actions where result = 'applied' and action = 'DISABLE_TERMINATED' and external_employee_id = '${id("LEAVER")}'`))).toBe(1);
    expect(sqlFails(`update public.employee_access_actions set result = 'applied' where external_employee_id = '${id("LEAVER")}'`)).toMatch(/append-only/);
    expect(sqlFails(`update public.employee_access_runs set status = 'completed' where mode = 'apply' and status = 'completed'`)).toMatch(/append-only/);
    expect(sqlFails(`delete from public.employee_access_runs where mode = 'apply'`)).toMatch(/append-only/);
  });

  it("the browser roles can call none of the lifecycle functions", async () => {
    const asAnon = await anonClient().rpc("employee_access_disable_terminated", { p_app_user_id: ids.STEADY, p_external_employee_id: id("STEADY"), p_set_by: "x" });
    expect(asAnon.error).not.toBeNull();
    for (const fn of [
      "employee_access_provision_account(uuid, text, text, text, text, text, text)",
      "employee_access_link_existing(uuid, text, text)",
      "employee_access_disable_terminated(uuid, text, text)",
      "employee_access_auth_user_by_email(text)",
    ]) {
      expect(sql(`select has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE')::text || has_function_privilege('anon', 'public.${fn}', 'EXECUTE')::text`), fn).toBe("falsefalse");
    }
    expect(sql(`select status from public.app_users where id = '${ids.STEADY}'`)).toBe("active");
  });
});

/* ---------------------------------------------------------------------------
 * The one-time data change for the 16 approved SD/ASD links, rehearsed on
 * disposable copies of those EmployeeIDs (no real person, no real account).
 * ------------------------------------------------------------------------- */
describe.skipIf(!ENABLED)("data change: managed_status for the 16 approved SD/ASD links (local stack)", { timeout: 90_000 }, () => {
  const FILE = "supabase/data-changes/20261006_woven_status_managed_sd_asd.sql";
  const APPROVED = [...readApproved()];
  function readApproved(): string[] {
    const text = execFileSync("cat", [FILE], { encoding: "utf8" });
    return [...text.matchAll(/'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',?\s+--/g)].map((m) => m[1]!);
  }
  const runFile = () => execFileSync("psql", [PG.replace("supabase_admin@", "postgres:postgres@"), "-v", "ON_ERROR_STOP=1", "-q", "-1", "-f", FILE], { encoding: "utf8", stdio: "pipe" });
  const runFileFails = () => {
    try {
      runFile();
      return null;
    } catch (error) {
      return String((error as { stderr?: string }).stderr ?? error);
    }
  };
  const flags = () =>
    sql(`select string_agg(managed_status::text||managed_location::text||managed_role::text, ',' order by external_employee_id) from public.employee_account_links where external_employee_id in (${APPROVED.map((x) => `'${x}'`).join(",")})`);
  let dmUser = "";
  const userIds: string[] = [];

  beforeAll(async () => {
    expect(APPROVED).toHaveLength(16);
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    sql(`insert into public.salons (salon_number, store_name) values ('0307', 'NE Grand Island') on conflict do nothing`);
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
         select 'WL-DC-${run}', 'NE Grand Island', 'mapped', id, 'test', now() from public.salons where salon_number = '0307'`);
    sql(`insert into public.woven_position_map (woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, reviewed_by, reviewed_at)
         values ('WPSD-DC-${run}', 'Salon Director', 'mapped', 'salon_director', 'salon', 30, 'test', now()),
                ('WPDM-DC-${run}', 'District Manager', 'mapped', 'district_manager', 'district', 20, 'test', now())`);
    for (const [index, employeeId] of APPROVED.entries()) {
      /* Re-runnable on the same stack: reuse a copy left by an earlier run. */
      const existing = sql(`select app_user_id from public.employee_account_links where external_employee_id = '${employeeId}'`);
      if (existing) {
        userIds.push(existing);
        sql(`update public.employee_account_links set managed_status = false where app_user_id = '${existing}'`);
        sql(`update public.app_users set status = 'active' where id = '${existing}'`);
        continue;
      }
      const email = `dc-${index}-${run}@gmail.test`;
      const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
      userIds.push(data.user!.id);
      sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values ('${data.user!.id}', '${email}', 'Copy ${index}', 'salon_director', 'active', 'salon', 'loc-0307')`);
      sql(`insert into public.employee_access_directory (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name)
           values ('woven', '${employeeId}', '${email}', 'active', 'WPSD-DC-${run}', 'Salon Director', 'WL-DC-${run}', 'NE Grand Island', '${"0".repeat(64)}', 'Copy', '${index}')
           on conflict do nothing`);
      sql(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by) values ('${data.user!.id}', 'woven_linked', '${employeeId}', 'admin_manual', 'test')`);
    }
    /* A linked District Manager that is NOT in the approved list. */
    const { data } = await admin.auth.admin.createUser({ email: `dc-dm-${run}@gmail.test`, email_confirm: true });
    dmUser = data.user!.id;
    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values ('${dmUser}', 'dc-dm-${run}@gmail.test', 'DM copy', 'district_manager', 'active', 'global', null)`);
    sql(`insert into public.employee_access_directory (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name)
         values ('woven', 'DC-DM-${run}', 'dc-dm-${run}@gmail.test', 'active', 'WPDM-DC-${run}', 'District Manager', 'WL-DC-${run}', 'NE Grand Island', '${"0".repeat(64)}', 'DM', 'Copy')`);
    sql(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by) values ('${dmUser}', 'woven_linked', 'DC-DM-${run}', 'admin_confirmed_email', 'test')`);
  });

  it("refuses, changing nothing, unless all 16 still qualify (one disabled here)", () => {
    sql(`update public.app_users set status = 'disabled' where id = '${userIds[0]}'`);
    expect(runFileFails()).toMatch(/15 of 16 approved links qualify; nothing changed/);
    expect(flags().split(",").every((f) => f === "falsefalsefalse")).toBe(true);
    sql(`update public.app_users set status = 'active' where id = '${userIds[0]}'`);
  });

  it("sets managed_status = true, role and location false, on exactly the 16 — and is safe to run twice", () => {
    runFile();
    expect(flags()).toBe(Array(16).fill("truefalsefalse").join(","));
    expect(sql(`select managed_status::text from public.employee_account_links where app_user_id = '${dmUser}'`)).toBe("false");
    const before = sql(`select string_agg(updated_at::text, ',') from public.employee_account_links where external_employee_id in (${APPROVED.map((x) => `'${x}'`).join(",")})`);
    runFile();
    expect(sql(`select string_agg(updated_at::text, ',') from public.employee_account_links where external_employee_id in (${APPROVED.map((x) => `'${x}'`).join(",")})`)).toBe(before);
    /* One managed_flags_changed audit per changed link — and none from the second, no-op run. */
    expect(sql(`select count(*) from public.app_user_audit where action = 'managed_flags_changed' and to_value = 'status:on,location:off,role:off' and target_user_id in (${userIds.map((x) => `'${x}'`).join(",")})`)).toBe("16");
    /* No account was changed by it. */
    expect(sql(`select count(*) from public.app_users where id in (${userIds.map((x) => `'${x}'`).join(",")}) and status <> 'active'`)).toBe("0");
  });
});
