import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * ============================================================================
 * ADOPTION AND CREDENTIAL RESET AGAINST REAL POSTGRES AND SUPABASE AUTH
 * ============================================================================
 *
 * Runs only on the disposable local stack (`scripts/local-stack/up.sh`,
 * `ASK_SUNNY_LOCAL_STACK=1`), where every migration has been applied as the
 * non-superuser `postgres` role, exactly as in the Supabase project. Never
 * against the Ask Sunny project.
 *
 * Proves, for migration 20261006001000 and the code on top of it:
 *   - service_role may update the three managed flags and nothing else on a
 *     link; even the table owner cannot change a link's identity;
 *   - the owner's policy is enforced on the server (salon tier: all three;
 *     District Manager: status only; protected: nothing), every change is
 *     audited, and a concurrent change is refused, never overwritten;
 *   - setting flags changes no account and no credential;
 *   - credential reset clears the password and ends every session in one
 *     step, sends the recovery email, and the person can then choose their own
 *     password — the old one never works again.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const ANON = process.env.LOCAL_ANON_KEY ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";
const MAIL = process.env.LOCAL_STACK_MAIL_API ?? "";

const run = randomBytes(4).toString("hex");
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

async function mailTo(address: string): Promise<number> {
  const response = await fetch(`${MAIL}/search?query=${encodeURIComponent(`to:${address}`)}`);
  const body = (await response.json()) as { messages_count?: number };
  return body.messages_count ?? 0;
}

const EMAIL = {
  admin: `adopt-admin-${run}@local.test`,
  sd: `adopt-sd-${run}@gmail.test`,
  dm: `adopt-dm-${run}@local.test`,
  dm2: `adopt-dm2-${run}@local.test`,
  protectedAdmin: `adopt-owner-${run}@local.test`,
  unmanaged: `adopt-unmanaged-${run}@local.test`,
  handover: `adopt-handover-${run}@gmail.test`,
};
const OLD_PW = `Old-${randomBytes(12).toString("hex")}`;
const NEW_PW = `New-${randomBytes(12).toString("hex")}`;

describe.skipIf(!ENABLED)("adoption and credential reset on the local stack", { timeout: 60_000 }, () => {
  const ids: Record<keyof typeof EMAIL, string> = { admin: "", sd: "", dm: "", dm2: "", protectedAdmin: "", unmanaged: "", handover: "" };
  let actor: { id: string; email: string; role: "admin" };
  let refreshTokenBefore = "";

  const fingerprint = (who: string[]) => {
    const list = who.map((id) => `'${id}'`).join(",");
    return createHash("sha256")
      .update(sql(`select coalesce(string_agg(to_jsonb(u)::text, '|' order by id), '') from public.app_users u where id in (${list})`))
      .update(sql(`select coalesce(string_agg(to_jsonb(u)::text, '|' order by id), '') from auth.users u where id in (${list})`))
      .digest("hex");
  };

  beforeAll(async () => {
    expect(new URL(URL_).hostname).toBe("127.0.0.1");
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL_;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ANON;
    process.env.SUPABASE_SECRET_KEY = SERVICE;

    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const key of Object.keys(EMAIL) as (keyof typeof EMAIL)[]) {
      const { data, error } = await admin.auth.admin.createUser({
        email: EMAIL[key],
        email_confirm: true,
        ...(key === "handover" ? { password: OLD_PW } : {}),
      });
      if (error || !data.user) throw new Error(String(error?.message));
      ids[key] = data.user.id;
    }
    actor = { id: ids.admin, email: EMAIL.admin, role: "admin" };

    const profile = (key: keyof typeof EMAIL, role: string, scope: "salon" | "global") =>
      `('${ids[key]}', '${EMAIL[key]}', '${key}', '${role}', 'active', '${scope}', ${scope === "salon" ? "'loc-0307'" : "null"})`;
    sql(`insert into public.app_users (id, email, display_name, role, status, scope_level, scope_primary_area_id) values
      ${profile("admin", "admin", "global")}, ${profile("sd", "salon_director", "salon")}, ${profile("dm", "district_manager", "global")},
      ${profile("dm2", "district_manager", "global")}, ${profile("protectedAdmin", "admin", "global")},
      ${profile("unmanaged", "salon_director", "salon")}, ${profile("handover", "salon_director", "salon")}`);

    const link = (key: keyof typeof EMAIL, management = "woven_linked") =>
      management === "woven_linked"
        ? `('${ids[key]}', 'woven_linked', 'AD-${run}-${key}', 'admin_manual', 'test')`
        : `('${ids[key]}', 'not_woven_managed', null, 'admin_manual', 'test')`;
    sql(`insert into public.employee_account_links (app_user_id, management, external_employee_id, link_method, set_by) values
      ${link("sd")}, ${link("dm")}, ${link("dm2")}, ${link("protectedAdmin")}, ${link("unmanaged", "not_woven_managed")}, ${link("handover")}`);

    /* The handover account is in use: two signed-in devices. */
    const first = await anonClient().auth.signInWithPassword({ email: EMAIL.handover, password: OLD_PW });
    const second = await anonClient().auth.signInWithPassword({ email: EMAIL.handover, password: OLD_PW });
    if (!first.data.session || !second.data.session) throw new Error("handover sign-in failed");
    refreshTokenBefore = first.data.session.refresh_token;
  });

  /* ------------------------------------------------------------ privileges -- */

  it("service_role holds UPDATE on exactly the three managed-flag columns; the new functions are granted exactly", () => {
    expect(
      sql(`select coalesce(string_agg(a.attname || ':' || x.grantee::regrole::text || ':' || x.privilege_type, ',' order by a.attname), '')
           from pg_attribute a, aclexplode(a.attacl) x
           where a.attrelid = 'public.employee_account_links'::regclass and a.attacl is not null`),
    ).toBe("managed_location:service_role:UPDATE,managed_role:service_role:UPDATE,managed_status:service_role:UPDATE");
    const functionGrants = (signature: string) =>
      sql(`select coalesce(string_agg(g, ',' order by g), '') from (
             select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type as g
             from pg_proc p, aclexplode(p.proacl) a
             where p.oid = 'public.${signature}'::regprocedure and a.grantee <> p.proowner) x`);
    expect(functionGrants("auth_clear_user_credentials(uuid)")).toBe("service_role:EXECUTE");
    expect(functionGrants("employee_account_links_guard_update()")).toBe("");
  });

  it("service_role can change a flag but nothing else; even the owner cannot change a link's identity", () => {
    const asService = (statement: string) => sqlFails(`begin; set local role service_role; ${statement}; rollback;`);
    expect(asService(`update public.employee_account_links set managed_status = true where app_user_id = '${ids.dm}'`)).toBeNull();
    for (const statement of [
      `update public.employee_account_links set reason = 'x' where app_user_id = '${ids.dm}'`,
      `update public.employee_account_links set external_employee_id = 'other' where app_user_id = '${ids.dm}'`,
      `update public.employee_account_links set management = 'not_woven_managed' where app_user_id = '${ids.dm}'`,
      `delete from public.employee_account_links where app_user_id = '${ids.dm}'`,
    ]) {
      expect(asService(statement), statement).toMatch(/permission denied/);
    }
    /* The table owner holds every privilege; the trigger still refuses an identity change. */
    expect(sqlFails(`begin; update public.employee_account_links set external_employee_id = 'other' where app_user_id = '${ids.dm}'; rollback;`)).toMatch(
      /only managed_status, managed_location and managed_role can change/,
    );
    /* A not-Woven-managed account can never have a flag, whoever writes it. */
    expect(sqlFails(`begin; update public.employee_account_links set managed_status = true where app_user_id = '${ids.unmanaged}'; rollback;`)).toMatch(
      /employee_account_links_unmanaged_manages_nothing/,
    );
  });

  it("the browser roles cannot run the credential function, even signed in", async () => {
    const { error } = await anonClient().rpc("auth_clear_user_credentials", { p_user_id: ids.handover });
    expect(error?.message ?? "").toMatch(/permission denied|not find the function/i);
    expect(sqlFails(`begin; set local role authenticated; select public.auth_clear_user_credentials('${ids.handover}'); rollback;`)).toMatch(
      /permission denied/,
    );
  });

  /* ---------------------------------------------------------------- policy -- */

  it("salon tier: all three flags; audited before → after; a repeat is a no-op", async () => {
    const { setManagedFlags } = await import("@/lib/admin/woven-managed-flags");
    const before = fingerprint(Object.values(ids));
    const result = await setManagedFlags({ appUserId: ids.sd, flags: { status: true, location: true, role: true } }, actor);
    expect(result.changed).toBe(true);
    expect(sql(`select managed_status::text || managed_location::text || managed_role::text from public.employee_account_links where app_user_id = '${ids.sd}'`)).toBe(
      "truetruetrue",
    );
    expect(sql(`select string_agg(action || '|' || from_value || '|' || to_value, ';') from public.app_user_audit where target_user_id = '${ids.sd}'`)).toBe(
      "managed_flags_changed|status:off,location:off,role:off|status:on,location:on,role:on",
    );
    const again = await setManagedFlags({ appUserId: ids.sd, flags: { status: true, location: true, role: true } }, actor);
    expect(again.changed).toBe(false);
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.sd}'`)).toBe("1");
    /* No account or credential changed. */
    expect(fingerprint(Object.values(ids))).toBe(before);
  });

  it("District Manager: status only — location or role is refused, never silently dropped", async () => {
    const { setManagedFlags } = await import("@/lib/admin/woven-managed-flags");
    await expect(setManagedFlags({ appUserId: ids.dm, flags: { status: true, location: true, role: false } }, actor)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/location/),
    });
    expect(sql(`select managed_status::text || managed_location::text from public.employee_account_links where app_user_id = '${ids.dm}'`)).toBe("falsefalse");
    const ok = await setManagedFlags({ appUserId: ids.dm, flags: { status: true, location: false, role: false } }, actor);
    expect(ok.changed).toBe(true);
  });

  it("a protected (administrative) account can have nothing managed; a not-Woven-managed account is refused", async () => {
    const { setManagedFlags } = await import("@/lib/admin/woven-managed-flags");
    await expect(setManagedFlags({ appUserId: ids.protectedAdmin, flags: { status: true, location: false, role: false } }, actor)).rejects.toMatchObject({
      status: 400,
    });
    await expect(setManagedFlags({ appUserId: ids.unmanaged, flags: { status: true, location: false, role: false } }, actor)).rejects.toMatchObject({
      status: 409,
    });
    expect(sql(`select count(*) from public.app_user_audit where target_user_id in ('${ids.protectedAdmin}', '${ids.unmanaged}')`)).toBe("0");
  });

  it("two administrators changing the same account at once: exactly one change is stored and audited", async () => {
    const { setManagedFlags } = await import("@/lib/admin/woven-managed-flags");
    const results = await Promise.allSettled([
      setManagedFlags({ appUserId: ids.dm2, flags: { status: true, location: false, role: false } }, actor),
      setManagedFlags({ appUserId: ids.dm2, flags: { status: true, location: false, role: false } }, { ...actor, email: `other-${EMAIL.admin}` }),
    ]);
    const changed = results.filter((r) => r.status === "fulfilled" && r.value.changed).length;
    expect(changed).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as { status?: number }).status).toBe(409);
      else if (!r.value.changed) expect(r.value.after.status).toBe(true);
    }
    expect(sql(`select count(*) from public.app_user_audit where target_user_id = '${ids.dm2}' and action = 'managed_flags_changed'`)).toBe("1");
  });

  /* ---------------------------------------------------- credential reset -- */

  it("credential reset: the password is cleared and every session ended in one step, and the recovery email is sent", async () => {
    const { resetCredentials } = await import("@/lib/admin/credential-reset");
    expect(Number(sql(`select count(*) from auth.sessions where user_id = '${ids.handover}'`))).toBe(2);
    const mailBefore = await mailTo(EMAIL.handover);
    const profileBefore = sql(`select to_jsonb(u) - 'updated_at' from public.app_users u where id = '${ids.handover}'`);

    const result = await resetCredentials(ids.handover, `${URL_}/auth/accept`, actor);
    expect(result).toMatchObject({ email: EMAIL.handover, sessionsEnded: 2, sent: "password_reset" });

    expect(Number(sql(`select count(*) from auth.sessions where user_id = '${ids.handover}'`))).toBe(0);
    expect(Number(sql(`select count(*) from auth.refresh_tokens where user_id = '${ids.handover}'`))).toBe(0);
    expect(sql(`select encrypted_password = '' from auth.users where id = '${ids.handover}'`)).toBe("t");
    expect(await mailTo(EMAIL.handover)).toBe(mailBefore + 1);
    expect(sql(`select string_agg(action || '|' || coalesce(to_value, ''), ';' order by created_at) from public.app_user_audit where target_user_id = '${ids.handover}'`)).toBe(
      "reset_requested|;credentials_reset|cleared;password_reset_sent",
    );
    /* The Ask Sunny profile — role, salon, status — is untouched. */
    expect(sql(`select to_jsonb(u) - 'updated_at' from public.app_users u where id = '${ids.handover}'`)).toBe(profileBefore);
  });

  it("afterwards the old password and the old refresh token are refused", async () => {
    const signIn = await anonClient().auth.signInWithPassword({ email: EMAIL.handover, password: OLD_PW });
    expect(signIn.data.session).toBeNull();
    expect(signIn.error?.message ?? "").toMatch(/invalid/i);
    const refresh = await anonClient().auth.refreshSession({ refresh_token: refreshTokenBefore });
    expect(refresh.data.session).toBeNull();
  });

  it("the person can then choose their own password through recovery, and only that one works", async () => {
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    /* Stands in for clicking the emailed link: the same recovery token type, verified the same way. */
    const link = await admin.auth.admin.generateLink({ type: "recovery", email: EMAIL.handover });
    const person = anonClient();
    const verified = await person.auth.verifyOtp({ token_hash: link.data.properties?.hashed_token ?? "", type: "recovery" });
    expect(verified.error).toBeNull();
    const updated = await person.auth.updateUser({ password: NEW_PW });
    expect(updated.error).toBeNull();

    expect((await anonClient().auth.signInWithPassword({ email: EMAIL.handover, password: NEW_PW })).data.session).not.toBeNull();
    expect((await anonClient().auth.signInWithPassword({ email: EMAIL.handover, password: OLD_PW })).data.session).toBeNull();
  });

  it("refuses your own account and a disabled account, and changes nothing when it refuses", async () => {
    const { resetCredentials } = await import("@/lib/admin/credential-reset");
    await expect(resetCredentials(ids.admin, `${URL_}/auth/accept`, actor)).rejects.toMatchObject({ code: "self_change" });
    sql(`update public.app_users set status = 'disabled' where id = '${ids.unmanaged}'`);
    const before = sql(`select encrypted_password from auth.users where id = '${ids.unmanaged}'`);
    await expect(resetCredentials(ids.unmanaged, `${URL_}/auth/accept`, actor)).rejects.toMatchObject({ status: 409 });
    expect(sql(`select encrypted_password from auth.users where id = '${ids.unmanaged}'`)).toBe(before);
  });
});
