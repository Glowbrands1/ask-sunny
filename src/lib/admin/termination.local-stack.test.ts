import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

import { createServerClient } from "@supabase/ssr";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * ============================================================================
 * DISABLE_TERMINATED AGAINST REAL POSTGRES AND SUPABASE AUTH (local stack)
 * ============================================================================
 *
 * Runs only on the disposable local stack (`ASK_SUNNY_LOCAL_STACK=1`), with
 * every migration applied as the non-superuser `postgres` role. Never against
 * the Ask Sunny project.
 *
 * Each scenario writes a fresh "latest successful directory run" and points
 * this suite's employees at it, so the planner, the guards and the executor's
 * re-checks all see exactly the state the scenario describes.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const ANON = process.env.LOCAL_ANON_KEY ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";
const MAIL = process.env.LOCAL_STACK_MAIL_API ?? "";

const run = randomBytes(4).toString("hex");
const SCOPE = `term-${run}`;
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

async function cookieHeaderFor(session: Session): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(URL_, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (entries) => entries.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function mailTo(address: string): Promise<number> {
  const response = await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${address}`)}`);
  const body = (await response.json()) as { messages_count?: number };
  return body.messages_count ?? 0;
}

/** The suite's people. `woven` is the employee's Woven state; `account` the Ask Sunny side. */
const PEOPLE = {
  target: { role: "salon_director", managed: true, woven: "active" }, // becomes Terminated in Woven
  colleague: { role: "salon_director", managed: true, woven: "active" }, // stays active (control)
  missingOnly: { role: "salon_director", managed: true, woven: "active" }, // disappears from Woven only
  oldDate: { role: "salon_director", managed: true, woven: "active" }, // Active with a past TerminationDate
  unmanaged: { role: "salon_director", managed: false, woven: "active" }, // terminated, status NOT managed
  owner: { role: "admin", managed: false, woven: "active" }, // protected administrator, terminated
  alreadyDisabled: { role: "assistant_salon_director", managed: true, woven: "active" }, // disabled by hand earlier
  rehire: { role: "salon_director", managed: true, woven: "active" }, // revoked earlier, Active again
  race: { role: "assistant_salon_director", managed: true, woven: "active" }, // two runs at once
  mass1: { role: "salon_director", managed: true, woven: "active" },
  mass2: { role: "salon_director", managed: true, woven: "active" },
  mass3: { role: "salon_director", managed: true, woven: "active" },
  test: { role: "employee", managed: true, woven: "active" }, // disposable test employee (ASK-SUNNY-TEST-)
} as const;
type Person = keyof typeof PEOPLE;

const email = (p: Person) => `term-${p}-${run}@local.test`;
const employeeId = (p: Person) => (p === "test" ? `ASK-SUNNY-TEST-${run}` : `TE-${run}-${p}`);
const PW = `Pw-${randomBytes(10).toString("hex")}`;

describe.skipIf(!ENABLED)("DISABLE_TERMINATED on the local stack", { timeout: 90_000 }, () => {
  const ids = {} as Record<Person, string>;
  let admin: SupabaseClient;
  let sessionA: Session;
  let sessionB: Session;
  let cookieA = "";
  let conversationId = "";
  let documentId = "";

  /** A fresh latest successful directory run; this suite's employees are "read" in it. */
  const freshRun = (opts: { issues?: Record<string, number>; hoursAgo?: number } = {}) => {
    const previous = Number(sql(`select coalesce((select employees_active from public.employee_sync_runs where status = 'succeeded' order by started_at desc limit 1), 1000)`));
    const finished = `now() - interval '${opts.hoursAgo ?? 0} hours'`;
    const id = sql(`insert into public.employee_sync_runs (requested_by, source_mode, status, employees_active, issue_counts, started_at, finished_at)
      values ('cron', 'scheduled_poll', 'succeeded', ${previous}, '${JSON.stringify(opts.issues ?? {})}'::jsonb, ${finished} - interval '1 minute', ${finished}) returning id`).split("\n")[0]!;
    sql(`update public.employee_access_directory set last_seen_run_id = '${id}' where external_employee_id like 'TE-${run}-%' or external_employee_id = '${employeeId("test")}'`);
    return id;
  };
  const wovenStatus = (p: Person, status: "active" | "terminated", extra = "") =>
    sql(`update public.employee_access_directory set employment_status = '${status}'${extra} where external_employee_id = '${employeeId(p)}'`);
  const state = (p: Person) =>
    sql(`select u.status || '|' || (a.banned_until is not null and a.banned_until > now())::text || '|' || coalesce(l.access_revoked_at::text, '-')
         from public.app_users u join auth.users a on a.id = u.id join public.employee_account_links l on l.app_user_id = u.id where u.id = '${ids[p]}'`);
  const planRow = async (p: Person) => {
    const { loadAccessPlan } = await import("@/lib/employees/woven/access/load");
    const plan = await loadAccessPlan();
    return { plan, row: plan.rows.find((r) => r.appUserId === ids[p]) };
  };
  const switches = (env: boolean, control: boolean) => {
    if (env) process.env.WOVEN_APPLY_ACTIONS = "DISABLE_TERMINATED";
    else delete process.env.WOVEN_APPLY_ACTIONS;
    sql(`update public.employee_access_controls set enabled = ${control}, changed_by = 'local-stack test' where action = 'DISABLE_TERMINATED'`);
  };

  beforeAll(async () => {
    expect(new URL(URL_).hostname).toBe("127.0.0.1");
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ANON;
    process.env.SUPABASE_SECRET_KEY = SERVICE;
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    for (const p of Object.keys(PEOPLE) as Person[]) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(p), password: PW, email_confirm: true });
      if (error || !data.user) throw new Error(`createUser ${p}: ${error?.message}`);
      ids[p] = data.user.id;
    }
    const salonScope = (p: Person) => (PEOPLE[p].role === "admin" ? `'global', null` : `'salon', 'loc-0307'`);
    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values ${(Object.keys(PEOPLE) as Person[])
      .map((p) => `('${ids[p]}', '${email(p)}', '${p}', '${PEOPLE[p].role}', 'active', ${salonScope(p)})`)
      .join(", ")}`);

    sql(`insert into public.salons (salon_number, store_name) values ('0307', 'NE Grand Island') on conflict do nothing`);
    sql(`insert into public.woven_location_map (woven_location_id, woven_location_name, status, salon_id, reviewed_by, reviewed_at)
         select 'WL-T-${run}', 'NE Grand Island', 'mapped', id, 'test', now() from public.salons where salon_number = '0307'`);
    const positions: Record<string, string> = { salon_director: "SD", assistant_salon_director: "ASD", employee: "TC", admin: "OWN" };
    sql(`insert into public.woven_position_map (woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, reviewed_by, reviewed_at) values
         ('WP-SD-T-${run}', 'Salon Director', 'mapped', 'salon_director', 'salon', 30, 'test', now()),
         ('WP-ASD-T-${run}', 'Assistant Salon Director', 'mapped', 'assistant_salon_director', 'salon', 20, 'test', now()),
         ('WP-TC-T-${run}', 'Tanning Consultant', 'mapped', 'employee', 'salon', 10, 'test', now()),
         ('WP-OWN-T-${run}', 'Owner', 'unmapped', null, null, null, null, null)`);
    sql(`insert into public.employee_access_directory
         (source_system, external_employee_id, email_address, employment_status, position_id, position_name, primary_woven_location_id, primary_location_name, record_hash, first_name, last_name, missing_sync_count)
         values ${(Object.keys(PEOPLE) as Person[])
           .map((p) => `('woven', '${employeeId(p)}', '${email(p)}', 'active', 'WP-${positions[PEOPLE[p].role]}-T-${run}', 'x', 'WL-T-${run}', 'NE Grand Island', '${"0".repeat(64)}', 'Pat', '${p}', 0)`)
           .join(", ")}`);
    sql(`insert into public.employee_role_overrides (app_user_id, external_employee_id, locked_role, locked_scope_level, reason, set_by)
         values ('${ids.owner}', '${employeeId("owner")}', 'admin', 'global', 'Protected owner', 'test')`);
    sql(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by, managed_status, managed_location, managed_role) values ${(Object.keys(PEOPLE) as Person[])
      .filter((p) => p !== "owner")
      .map((p) => `('${ids[p]}', 'woven_linked', '${employeeId(p)}', 'admin_manual', 'test', ${PEOPLE[p].managed}, ${PEOPLE[p].managed}, ${PEOPLE[p].managed})`)
      .join(", ")}`);
    /* The owner's link comes from the override, flags off, exactly like the Production backfill. */
    sql(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by) values ('${ids.owner}', 'woven_linked', '${employeeId("owner")}', 'override_backfill', 'test')`);

    /* The rehire was revoked earlier (through the real path), and the hand-disabled account was disabled by an admin. */
    const { patchUser } = await import("@/lib/admin/user-directory");
    await patchUser(ids.rehire, { status: "disabled" }, { id: ids.owner, email: email("owner"), role: "admin" });
    sql(`update public.employee_account_links set terminated_at = now() - interval '30 days', access_revoked_at = now() - interval '30 days', revoked_woven_status = 'terminated' where app_user_id = '${ids.rehire}'`);
    await patchUser(ids.alreadyDisabled, { status: "disabled" }, { id: ids.owner, email: email("owner"), role: "admin" });

    /* The target: signed in on two devices, has a conversation, and their colleague can read a knowledge document. */
    documentId = randomUUID();
    sql(`insert into public.knowledge_documents (id, knowledge_scope_id, title, original_filename, mime_type, file_type, storage_path, size_bytes, status, indexed, indexed_at)
         values ('${documentId}', '${SCOPE}', 'Closing checklist', 'close.pdf', 'application/pdf', 'pdf', '${SCOPE}/close.pdf', 10, 'indexed', true, now())`);
    sql(`insert into public.knowledge_chunks (document_id, knowledge_scope_id, chunk_index, content, locator, embedding_model, embedding)
         values ('${documentId}', '${SCOPE}', 0, 'Lock the back door.', 'p1', 'local', array_fill(0.1::real, array[384])::extensions.vector)`);
    conversationId = randomUUID();
    sql(`insert into public.chat_conversations (id, user_id, client_conversation_id, title) values ('${conversationId}', '${ids.target}', 'term-${run}', 'Closing questions')`);
    const a = await anonClient().auth.signInWithPassword({ email: email("target"), password: PW });
    const b = await anonClient().auth.signInWithPassword({ email: email("target"), password: PW });
    if (!a.data.session || !b.data.session) throw new Error("target sign-in failed");
    sessionA = a.data.session;
    sessionB = b.data.session;
    cookieA = await cookieHeaderFor(sessionA);
    const { data: readable } = await tokenClient(sessionA.access_token).from("knowledge_documents").select("id").eq("knowledge_scope_id", SCOPE);
    expect(readable?.map((d) => d.id)).toEqual([documentId]);

    /* Woven: the target, the unmanaged account and the protected owner are explicitly Terminated. */
    wovenStatus("target", "terminated", ", termination_date = current_date - 1");
    wovenStatus("unmanaged", "terminated");
    wovenStatus("owner", "terminated");
    wovenStatus("alreadyDisabled", "terminated");
    sql(`update public.employee_access_directory set missing_sync_count = 2 where external_employee_id = '${employeeId("missingOnly")}'`);
    sql(`update public.employee_access_directory set termination_date = '2025-01-15', data_issues = '{status_termination_conflict}' where external_employee_id = '${employeeId("oldDate")}'`);
    freshRun();
  });

  /* ------------------------------------------------------------ the plan -- */

  it("the plan proposes DISABLE_TERMINATED only for explicit Terminated + linked + status managed + not protected", async () => {
    const { plan } = await planRow("target");
    const proposals = plan.rows.filter((r) => r.actions.includes("DISABLE_TERMINATED") && Object.values(ids).includes(r.appUserId ?? "")).map((r) => r.appUserId);
    expect(proposals.sort()).toEqual([ids.target, ids.alreadyDisabled].sort());
    expect((await planRow("missingOnly")).row?.actions).toEqual(["FLAG_MISSING_FROM_WOVEN"]); // disappearance only
    expect((await planRow("oldDate")).row?.actions).not.toContain("DISABLE_TERMINATED"); // old TerminationDate, Active
    expect((await planRow("unmanaged")).row?.actions).toEqual(["FLAG_PROTECTED_ACCOUNT"]); // status not managed
    expect((await planRow("owner")).row?.actions).toEqual(["FLAG_PROTECTED_ACCOUNT"]); // protected
    expect((await planRow("rehire")).row?.actions).toEqual(["FLAG_REHIRE_REVIEW"]); // revoked + Active again
  });

  /* ----------------------------------------------------------- the switch -- */

  it("OFF by default: without both keys the scheduled run does nothing at all", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    expect(sql(`select enabled::text from public.employee_access_controls where action = 'DISABLE_TERMINATED'`)).toBe("false");
    switches(false, false);
    expect(await applyDisableTerminated({ source: "cron" })).toEqual({ status: "off", reason: "env_switch_off" });
    switches(true, false);
    expect(await applyDisableTerminated({ source: "cron" })).toEqual({ status: "off", reason: "control_off" });
    switches(false, true);
    expect(await applyDisableTerminated({ source: "cron" })).toEqual({ status: "off", reason: "env_switch_off" });
    switches(false, false);
    expect(state("target")).toBe("active|false|-");
  });

  /* ------------------------------------------------------------- guards -- */

  it("a failed terminated-status read blocks every revocation, and the blocked run is recorded", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    switches(true, true);
    freshRun({ issues: { terminated_status_read_failed_timeout: 1 } });
    const outcome = await applyDisableTerminated({ source: "cron" });
    expect(outcome).toMatchObject({ status: "blocked", guardCodes: expect.arrayContaining(["terminated_read_failed"]) });
    expect(state("target")).toBe("active|false|-");
    const runId = (outcome as { accessRunId: string }).accessRunId;
    expect(sql(`select mode || '|' || status from public.employee_access_runs where id = '${runId}'`)).toBe("apply|aborted");
    expect(sql(`select string_agg(distinct result, ',') from public.employee_access_actions where access_run_id = '${runId}'`)).toBe("blocked");
  });

  it("a stale directory (last successful read over 26 hours ago) blocks every revocation", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    freshRun();
    /* Every read the stack holds is now 40 hours old: the latest successful run is stale. The next scenario adds a fresh one. */
    sql(`update public.employee_sync_runs set started_at = started_at - interval '40 hours', finished_at = finished_at - interval '40 hours'`);
    expect(await applyDisableTerminated({ source: "cron" })).toMatchObject({ status: "blocked", guardCodes: ["directory_sync_stale"] });
    expect(state("target")).toBe("active|false|-");
  });

  it("an abnormal mass termination is blocked whole — nobody is revoked", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    for (const p of ["mass1", "mass2", "mass3"] as const) wovenStatus(p, "terminated");
    freshRun();
    expect(await applyDisableTerminated({ source: "cron" })).toMatchObject({ status: "blocked", guardCodes: expect.arrayContaining(["terminations_exceed_threshold"]) });
    for (const p of ["target", "mass1", "mass2", "mass3"] as const) expect(state(p), p).toBe("active|false|-");
    for (const p of ["mass1", "mass2", "mass3"] as const) wovenStatus(p, "active");
  });

  it("the owner's per-run cap blocks a run that would exceed it", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    freshRun();
    sql(`update public.employee_access_controls set max_per_run = 1, changed_by = 'local-stack test' where action = 'DISABLE_TERMINATED'`);
    expect(await applyDisableTerminated({ source: "cron" })).toMatchObject({ status: "blocked", guardCodes: ["apply_batch_limit_exceeded"] });
    sql(`update public.employee_access_controls set max_per_run = 3, changed_by = 'local-stack test' where action = 'DISABLE_TERMINATED'`);
    expect(state("target")).toBe("active|false|-");
  });

  /* ------------------------------------------------------- the revocation -- */

  it("explicit Terminated: disabled, banned, every session and refresh token revoked, link recorded, audited, run recorded", async () => {
    const { applyDisableTerminated, WOVEN_TERMINATION_ACTOR } = await import("./woven-termination");
    freshRun();
    expect(Number(sql(`select count(*) from auth.sessions where user_id = '${ids.target}'`))).toBe(2);
    const outcome = await applyDisableTerminated({ source: "cron" });
    expect(outcome).toMatchObject({ status: "completed", applied: 2, skipped: 0, failed: 0 });

    expect(state("target")).toMatch(/^disabled\|true\|\d{4}-/);
    expect(Number(sql(`select count(*) from auth.sessions where user_id = '${ids.target}'`))).toBe(0);
    expect(Number(sql(`select count(*) from auth.refresh_tokens where user_id = '${ids.target}'`))).toBe(0);
    expect(sql(`select revoked_woven_status || '|' || (terminated_at::date = current_date - 1)::text from public.employee_account_links where app_user_id = '${ids.target}'`)).toBe(
      "terminated|true",
    );
    expect(sql(`select string_agg(action || '|' || coalesce(actor_email, ''), ';' order by created_at) from public.app_user_audit where target_user_id = '${ids.target}'`)).toBe(
      `status_changed|${WOVEN_TERMINATION_ACTOR.email};access_revoked|${WOVEN_TERMINATION_ACTOR.email}`,
    );
    expect(sql(`select count(*) || '|' || string_agg(status, ',') from public.employee_access_operations where app_user_id = '${ids.target}'`)).toBe("1|applied");
    const runId = (outcome as { accessRunId: string }).accessRunId;
    expect(sql(`select mode || '|' || status from public.employee_access_runs where id = '${runId}'`)).toBe("apply|completed");
    expect(sql(`select string_agg(result, ',') from public.employee_access_actions where access_run_id = '${runId}'`)).toBe("applied,applied");

    /* Nobody else changed. */
    for (const p of ["colleague", "missingOnly", "oldDate", "unmanaged", "owner", "race", "test"] as const) expect(state(p), p).toBe("active|false|-");
    expect(state("rehire")).toMatch(/^disabled\|true\|/);
  });

  it("an account an admin had already disabled is completed idempotently: still disabled, banned, link recorded", () => {
    expect(state("alreadyDisabled")).toMatch(/^disabled\|true\|\d{4}-/);
  });

  it("the password no longer signs in, and neither revoked session refreshes", async () => {
    const signIn = await anonClient().auth.signInWithPassword({ email: email("target"), password: PW });
    expect(signIn.data.session).toBeNull();
    expect(signIn.error?.message ?? "").toMatch(/banned/i);
    for (const session of [sessionA, sessionB]) {
      const { data } = await anonClient().auth.refreshSession({ refresh_token: session.refresh_token });
      expect(data.session).toBeNull();
    }
  });

  it("the leftover access token cannot use Ask Sunny's API or read knowledge; an active colleague still can", async () => {
    const { authorizeRequest } = await import("@/lib/auth/server");
    await expect(
      authorizeRequest(new Request("http://127.0.0.1:3000/api/x", { headers: { cookie: cookieA } }), "ask_questions"),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    const { data: documents } = await tokenClient(sessionA.access_token).from("knowledge_documents").select("id").eq("knowledge_scope_id", SCOPE);
    expect(documents ?? []).toEqual([]);
    const colleague = await anonClient().auth.signInWithPassword({ email: email("colleague"), password: PW });
    const { data: visible } = await tokenClient(colleague.data.session!.access_token).from("knowledge_documents").select("id").eq("knowledge_scope_id", SCOPE);
    expect(visible?.map((d) => d.id)).toEqual([documentId]);
  });

  it("Forgot Password sends nothing for the terminated account (same answer as always)", async () => {
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const before = await mailTo(email("target"));
    const response = await POST(
      new Request("http://127.0.0.1:3000/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email("target") }),
      }),
    );
    expect(await response.json()).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await mailTo(email("target"))).toBe(before);
  });

  it("history is preserved: auth user, profile, conversation and audit trail all remain", async () => {
    const { data } = await admin.auth.admin.getUserById(ids.target);
    expect(data.user?.id).toBe(ids.target);
    expect(sql(`select count(*) from public.app_users where id = '${ids.target}'`)).toBe("1");
    expect(sql(`select count(*) from public.chat_conversations where id = '${conversationId}'`)).toBe("1");
    expect(Number(sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.target}'`))).toBe(2);
  });

  it("a repeated run changes nothing: the plan now says access already revoked", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    freshRun();
    expect(await applyDisableTerminated({ source: "cron" })).toMatchObject({ status: "completed", applied: 0, skipped: 0, failed: 0 });
    expect((await planRow("target")).row?.reasons).toContain("access_already_revoked");
    expect(sql(`select count(*) from public.employee_access_operations where app_user_id = '${ids.target}'`)).toBe("1");
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.target}'`)).toBe("2");
  });

  it("two runs at once revoke the same person exactly once", async () => {
    const { applyDisableTerminated } = await import("./woven-termination");
    wovenStatus("race", "terminated");
    freshRun();
    const [a, b] = await Promise.all([applyDisableTerminated({ source: "cron" }), applyDisableTerminated({ source: "cron" })]);
    const applied = [a, b].map((o) => (o.status === "completed" ? o.applied : 0));
    expect(applied.sort()).toEqual([0, 1]);
    expect(state("race")).toMatch(/^disabled\|true\|\d{4}-/);
    expect(sql(`select count(*) from public.employee_access_operations where app_user_id = '${ids.race}' and status = 'applied'`)).toBe("1");
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.race}' and action = 'access_revoked'`)).toBe("1");
  });

  it("protected and rehire accounts are never touched; a rehire is never re-enabled", async () => {
    expect(state("owner")).toBe("active|false|-");
    expect(state("unmanaged")).toBe("active|false|-");
    expect(state("rehire")).toMatch(/^disabled\|true\|/);
    expect((await planRow("rehire")).row?.actions).toEqual(["FLAG_REHIRE_REVIEW"]);
  });

  /* ---------------------------------------------------- disposable test -- */

  it("the test entry refuses any account that is not linked to a disposable test employee", async () => {
    const { applyDisableTerminatedForTestAccount } = await import("./woven-termination");
    await expect(applyDisableTerminatedForTestAccount(ids.colleague)).rejects.toMatchObject({ status: 400 });
    expect(state("colleague")).toBe("active|false|-");
  });

  it("the test entry runs the real path for ONE test account without the switches, and nothing else", async () => {
    const { applyDisableTerminatedForTestAccount } = await import("./woven-termination");
    switches(false, false);
    wovenStatus("test", "terminated");
    wovenStatus("mass1", "terminated"); // a real-looking termination in the same read must NOT be touched by a test run
    freshRun();
    expect(await applyDisableTerminatedForTestAccount(ids.test)).toMatchObject({ status: "completed", applied: 1 });
    expect(state("test")).toMatch(/^disabled\|true\|\d{4}-/);
    expect(state("mass1")).toBe("active|false|-");
    expect(sql(`select requested_by from public.employee_access_runs where mode = 'apply' order by created_at desc limit 1`)).toBe("admin:test-termination");
    wovenStatus("mass1", "active");
  });

  /* ----------------------------------------------------- the database -- */

  it("privileges: switch read-only to the server, ledger only through its functions, revocation fields write-once", () => {
    const asService = (statement: string) => sqlFails(`begin; set local role service_role; ${statement}; rollback;`);
    expect(asService(`select count(*) from public.employee_access_controls`)).toBeNull();
    expect(asService(`update public.employee_access_controls set enabled = true, changed_by = 'x'`)).toMatch(/permission denied/);
    expect(asService(`insert into public.employee_access_operations (action, app_user_id, external_employee_id, trigger_source) values ('DISABLE_TERMINATED', '${ids.colleague}', 'x', 'cron')`)).toMatch(/permission denied/);
    expect(asService(`update public.employee_access_operations set status = 'applied'`)).toMatch(/permission denied/);
    expect(asService(`delete from public.employee_access_control_changes`)).toMatch(/permission denied/);
    /* Write-once, even for the table owner. */
    expect(sqlFails(`begin; update public.employee_account_links set access_revoked_at = now() where app_user_id = '${ids.target}'; rollback;`)).toMatch(/write-once/);
    /* The change log is append-only and records every switch change. */
    expect(sqlFails(`begin; delete from public.employee_access_control_changes; rollback;`)).toMatch(/append-only/);
    expect(Number(sql(`select count(*) from public.employee_access_control_changes where action = 'DISABLE_TERMINATED'`))).toBeGreaterThan(2);
    /* A shadow run can never hold an applied result, nor an apply run a shadow one. */
    const shadowRun = sql(`select id from public.employee_access_runs where mode = 'shadow' limit 1`);
    if (shadowRun) {
      expect(sqlFails(`begin; insert into public.employee_access_actions (access_run_id, app_user_id, action, is_primary, result) values ('${shadowRun}', '${ids.target}', 'DISABLE_TERMINATED', true, 'applied'); rollback;`)).toMatch(
        /cannot hold/,
      );
    }
    const applyRun = sql(`select id from public.employee_access_runs where mode = 'apply' limit 1`);
    expect(sqlFails(`begin; insert into public.employee_access_actions (access_run_id, app_user_id, action, is_primary, result) values ('${applyRun}', '${ids.target}', 'DISABLE_TERMINATED', true, 'shadow'); rollback;`)).toMatch(
      /cannot hold/,
    );
  });
});
