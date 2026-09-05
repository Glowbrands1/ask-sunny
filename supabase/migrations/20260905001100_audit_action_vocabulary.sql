-- ============================================================================
-- THE AUDIT TABLE'S VOCABULARY, AND A SILENT FAILURE IT WAS CAUSING.
-- ============================================================================
--
-- `app_user_audit.action` carries a CHECK constraint listing the actions it
-- accepts. Two separate problems met there:
--
--   1. `accept_invitation()` writes 'invitation_accepted', which the list did
--      not contain. The very first real activation would have failed — caught
--      by probing the function against this database before shipping it,
--      rather than by a person clicking Accept.
--
--   2. `sendRecovery` in the TypeScript layer has been writing
--      'invitation_resent' and 'password_reset_sent', and the list contains
--      neither. Those inserts have been failing SILENTLY since they were
--      written, because `audit()` never reads the error it gets back — a
--      deliberate choice (a failed audit must not undo a completed change)
--      that also made this invisible.
--
--      The audit trail has therefore been recording nothing at all about
--      recovery emails while appearing to. That half is fixed in the
--      application, which now emits the two names this list already had; a
--      test asserts every action string in the code appears here, so the two
--      cannot drift apart again.
--
-- Only ADDITIVE here: the five existing values are untouched, so no historical
-- row is invalidated.

alter table public.app_user_audit
  drop constraint if exists app_user_audit_action_check;

alter table public.app_user_audit
  add constraint app_user_audit_action_check
  check (action in (
    'invited',
    'invite_resent',
    'invitation_accepted',
    'reset_requested',
    'role_changed',
    'status_changed'
  ));
