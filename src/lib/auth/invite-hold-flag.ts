/**
 * INVITE_LINK_HOLD_ENABLED (QA / Pau, 28 Oct 2026). Default off.
 *
 * Invited accounts stayed `invited`: the email was confirmed seconds after the
 * invitation went out — a mail scanner fetching Supabase's stock invite link,
 * which verifies on GET — so the person's own click found a spent link and
 * never reached the page that accepts the invitation.
 *
 * On, `/auth/invite-start` holds an invitation token on GET and verifies it
 * only on the Continue POST (the recovery routes' pattern). Off, both invite
 * routes hold nothing, verify nothing, and send the visitor to sign in. Read
 * on the server at request time; nothing links to the routes until the
 * Supabase Invite template is changed.
 */
export function inviteLinkHoldEnabled(): boolean {
  const raw = process.env.INVITE_LINK_HOLD_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
