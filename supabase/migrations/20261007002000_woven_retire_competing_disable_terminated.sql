-- ============================================================================
-- RECONCILE: retire the competing DISABLE_TERMINATED schema (PR #89)
-- ============================================================================
--
-- WHY. Production received `20261007001000_woven_disable_terminated_apply.sql`
-- from PR #89 (never merged; SHA-256 3f6253ab…f0a6) while main carries the
-- canonical lifecycle of PR #88 (`20261006002000_woven_account_lifecycle.sql`).
-- Two termination executors must not coexist. This file removes everything
-- #89 added that main does not define, so the database matches main exactly.
--
-- ORDER: after 20261006002000 (it refuses to run otherwise). The objects BOTH
-- files define — the link-update guard, the action-result check, the run-mode
-- check — are re-created by 20261006002000 itself (CREATE OR REPLACE / drop-
-- and-add), so they need nothing here. Applied to Production as:
--
--     1. 20261006002000_woven_account_lifecycle.sql   (verbatim, as merged)
--     2. this file
--
-- On a database that never had #89 (every fresh environment), every statement
-- below is a no-op and the final assertions pass.
--
-- WHAT IS RETIRED (#89 only):
--   table     employee_access_controls          (its switch; seeded OFF)
--   table     employee_access_control_changes   (log of that switch)
--   table     employee_access_operations        (its idempotency ledger)
--   function  employee_access_controls_log_change()
--   function  employee_access_claim_operation(text, uuid, text, text)
--   function  employee_access_finish_operation(uuid, text, jsonb, text, text)
--   function  employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb)
--   trigger   employee_access_actions_match_run  (+ its function)
--   grant     service_role UPDATE (terminated_at, access_revoked_at,
--             revoked_woven_status) on employee_account_links — main writes
--             those only through its SECURITY DEFINER functions
--
-- WHAT IS KEPT: every run, action, link, account, audit row and auth user.
-- Nothing in app_users, auth.*, sessions or invitations is read or written.
--
-- DATA. The three #89 tables are dropped ONLY if they hold nothing but the
-- OFF switch #89's own migration seeded (no operation ever attempted, the
-- switch never turned on, no change logged by anyone but that migration).
-- Otherwise this file refuses and changes nothing. The seed rows as they
-- stand in Production on 7 Oct 2026 are recorded in docs/woven-access-sync.md.
--
-- No CASCADE anywhere: an unexpected dependency fails the migration instead of
-- silently dropping something else. Applied only with approval, in one
-- transaction. Idempotent.

-- ------------------------------------------------------- 0. preconditions ---

do $$
begin
  /* 20261006002000 first: it owns the objects both files define. */
  if to_regprocedure('public.employee_access_begin_apply_run(text, uuid, text)') is null
     or to_regprocedure('public.employee_access_disable_terminated(uuid, text, text)') is null then
    raise exception 'reconcile: apply 20261006002000_woven_account_lifecycle.sql first; nothing changed'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  if to_regclass('public.employee_access_operations') is not null then
    if exists (select 1 from public.employee_access_operations) then
      raise exception 'reconcile: employee_access_operations holds operations; they must be reviewed before it is retired; nothing changed'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  if to_regclass('public.employee_access_controls') is not null then
    if exists (
      select 1 from public.employee_access_controls c
       where c.enabled or c.changed_by <> 'migration:20261007001000'
    ) then
      raise exception 'reconcile: an employee_access_controls switch was turned on or changed by a person; nothing changed'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;

  if to_regclass('public.employee_access_control_changes') is not null then
    if exists (
      select 1 from public.employee_access_control_changes x
       where x.enabled_to or x.changed_by <> 'migration:20261007001000'
    ) then
      raise exception 'reconcile: employee_access_control_changes records a change by a person; nothing changed'
        using errcode = 'object_not_in_prerequisite_state';
    end if;
  end if;
end;
$$;

-- ------------------------------------- 1. the second termination executor ---

drop trigger if exists employee_access_actions_match_run on public.employee_access_actions;
drop function if exists public.employee_access_actions_match_run();

drop function if exists public.employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb);
drop function if exists public.employee_access_claim_operation(text, uuid, text, text);
drop function if exists public.employee_access_finish_operation(uuid, text, jsonb, text, text);

drop table if exists public.employee_access_operations;
drop table if exists public.employee_access_control_changes;
drop table if exists public.employee_access_controls;
drop function if exists public.employee_access_controls_log_change();

-- ------------------------------- 2. the link's column grants, as on main ---

/* service_role may UPDATE exactly the three managed flags on a link (20261006001000). */
revoke update (terminated_at, access_revoked_at, revoked_woven_status) on public.employee_account_links from service_role;

-- ------------------------------------------- 3. the result must be main's ---

do $$
declare
  v_grants text;
begin
  if to_regclass('public.employee_access_controls') is not null
     or to_regclass('public.employee_access_control_changes') is not null
     or to_regclass('public.employee_access_operations') is not null
     or to_regprocedure('public.employee_access_record_apply_run(text, uuid, text, text[], jsonb, jsonb)') is not null
     or exists (select 1 from pg_trigger t where t.tgname = 'employee_access_actions_match_run') then
    raise exception 'reconcile: a #89 object survived';
  end if;

  select string_agg(c.column_name, ',' order by c.column_name) into v_grants
    from information_schema.column_privileges c
   where c.table_schema = 'public' and c.table_name = 'employee_account_links'
     and c.grantee = 'service_role' and c.privilege_type = 'UPDATE';
  if v_grants is distinct from 'managed_location,managed_role,managed_status' then
    raise exception 'reconcile: service_role UPDATE on employee_account_links is %, expected the three managed flags', v_grants;
  end if;

  /* main's guard (lifecycle columns, no write-once) and main's result vocabulary. */
  if position('invite_delivery_status' in (select p.prosrc from pg_proc p where p.oid = 'public.employee_account_links_guard_update()'::regprocedure)) = 0 then
    raise exception 'reconcile: employee_account_links_guard_update is not the 20261006002000 version';
  end if;
  if position('planned' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'employee_access_actions_result_check')) = 0
     or position('blocked' in (select pg_get_constraintdef(oid) from pg_constraint where conname = 'employee_access_actions_result_check')) > 0 then
    raise exception 'reconcile: employee_access_actions_result_check is not the 20261006002000 version';
  end if;
end;
$$;
