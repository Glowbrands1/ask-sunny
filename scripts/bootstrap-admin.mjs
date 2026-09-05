#!/usr/bin/env node
/**
 * ============================================================================
 * BOOTSTRAP THE FIRST ADMINISTRATOR.
 * ============================================================================
 *
 * Run once per Supabase project, by a person who holds the secret key:
 *
 *   node scripts/bootstrap-admin.mjs "Name Here" name@company.com
 *
 * Needs three environment variables, and reads no others:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY            (or SUPABASE_SERVICE_ROLE_KEY)
 *   ASK_SUNNY_SITE_URL             where the invitation link should land
 *
 * ============================================================================
 * WHY THIS IS A SCRIPT AND NOT CODE IN THE APPLICATION
 * ============================================================================
 *
 * The obvious shortcuts are all wrong, and each one is wrong permanently rather
 * than temporarily:
 *
 *   `if (email === "someone@company.com") return "admin"` is a bypass that
 *   survives every later change to that person's profile. Disable their
 *   account and they are still an administrator.
 *
 *   A trigger granting admin to a hard-coded address does the same thing in
 *   the database, where it is harder to find.
 *
 *   Seeding a profile in a migration cannot work: `app_users.id` references
 *   `auth.users(id)`, so there is no id to seed until a credential exists.
 *
 * The first administrator is DATA. This script is how that data gets created,
 * and once it has run there is nothing special about the row it made — the same
 * person can be edited, demoted or disabled through User Management like
 * anybody else, subject to the last-administrator rule.
 *
 * ============================================================================
 * NO PASSWORD IS CREATED, ANYWHERE
 * ============================================================================
 *
 * `inviteUserByEmail` has Supabase generate a single-use link and mail it. The
 * person sets their own password. This script never sees one, never prints one,
 * and has no parameter for one — so there is no password to leak from a
 * terminal, a shell history, or a CI log.
 *
 * IDEMPOTENT. Running it twice is safe: the second run reports the existing
 * account and changes nothing. It will not promote or overwrite a profile that
 * already exists — silently escalating somebody because a script was re-run is
 * exactly the kind of surprise an administration tool must not produce.
 */

import { createClient } from "@supabase/supabase-js";

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const resend = argv.includes("--resend");
const [displayNameArg, emailArg] = argv.filter((entry) => entry !== "--resend");

if (!displayNameArg || !emailArg) {
  fail(
    'Usage: node scripts/bootstrap-admin.mjs "Full Name" person@company.com\n' +
      '       node scripts/bootstrap-admin.mjs --resend "Full Name" person@company.com\n' +
      "\n" +
      "  The name and email are arguments rather than constants, so this script\n" +
      "  hard-codes nobody.\n" +
      "\n" +
      "  --resend sends a fresh sign-in link to an account whose invitation is\n" +
      "  still PENDING. It exists for the one situation the app cannot fix\n" +
      "  itself: the first administrator has not accepted yet, so there is no\n" +
      "  active administrator to press the button in User Management. It never\n" +
      "  changes a role, a status or a scope.",
  );
}

const email = emailArg.trim().toLowerCase();
const displayName = displayNameArg.trim();

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail(`"${emailArg}" does not look like an email address.`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const secret =
  process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const site = process.env.ASK_SUNNY_SITE_URL?.trim();

const missing = [
  !url ? "NEXT_PUBLIC_SUPABASE_URL" : null,
  !secret ? "SUPABASE_SECRET_KEY" : null,
  !site ? "ASK_SUNNY_SITE_URL" : null,
].filter(Boolean);

if (missing.length > 0) {
  fail(
    `Missing environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.\n` +
      "  Set them for this command only — do not add the secret key to a file that is committed.",
  );
}

// A shape check on the key, so an obvious mix-up fails here rather than as a
// permission error six calls later. The VALUE is never printed.
if (secret.startsWith("sb_publishable_")) {
  fail(
    "SUPABASE_SECRET_KEY holds a PUBLISHABLE key. This script needs the secret key,\n" +
      "  which is the one that can create accounts. They are easy to swap.",
  );
}

/*
 * THE IMPLICIT LANDING PAGE, not the PKCE callback.
 *
 * `inviteUserByEmail` sends no code challenge — there is no PKCE branch in it —
 * so Supabase always returns the session as a URL FRAGMENT
 * (`#access_token=…`). A fragment is never transmitted to a server, so a route
 * handler cannot see it: pointing an invitation at `/auth/callback` gives that
 * route a request with no `code`, which it correctly reads as an invalid link.
 *
 * That is exactly how the first real invitation failed. `/auth/accept` is a
 * client page, which is the only thing that can read a fragment.
 */
let redirectTo;
try {
  redirectTo = `${new URL(site).origin}/auth/accept`;
} catch {
  fail(`ASK_SUNNY_SITE_URL is not a URL. Use the full origin, e.g. https://ask-sunny.vercel.app`);
}

const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

console.log(`\nAsk Sunny — bootstrap the first administrator`);
console.log(`  project : ${new URL(url).host}`);
console.log(`  person  : ${displayName} <${email}>`);
console.log(`  link to : ${new URL(redirectTo).origin}\n`);

/* 1. Is there already a profile? Then there is nothing to bootstrap. */
const existing = await admin
  .from("app_users")
  .select("id, email, display_name, role, status")
  .ilike("email", email)
  .maybeSingle();

if (existing.error) {
  fail(
    `Could not read app_users: ${existing.error.message}\n` +
      "  Has the 20260904006000_app_users migration been applied to this project?",
  );
}

if (existing.data) {
  const row = existing.data;

  if (!resend) {
    console.log(`• An Ask Sunny profile already exists for that address.`);
    console.log(`    role   : ${row.role}`);
    console.log(`    status : ${row.status}`);
    console.log(
      `\n  Nothing was changed. This script will not promote or overwrite an existing\n` +
        `  profile — use User Management for that, where the change is audited.\n` +
        `\n  To send a fresh link to a PENDING invitation, re-run with --resend.\n`,
    );
    process.exit(0);
  }

  /* ----------------------------------------------------------- --resend -- */

  if (row.status !== "invited") {
    /*
     * Deliberately narrow. An ACTIVE account has a working password and should
     * use "Forgot your password?" on the sign-in screen — which is
     * browser-initiated, and therefore the safer PKCE flow. A DISABLED account
     * must not be handed a way back in by a command-line tool.
     */
    fail(
      `That account is "${row.status}", not a pending invitation.\n` +
        (row.status === "active"
          ? "  An active account should use 'Forgot your password?' on the sign-in screen."
          : "  A disabled account must be re-enabled in User Management first."),
    );
  }

  console.log("• Sending a fresh link to a pending invitation…");

  /*
   * WHICH LINK, decided from the CREDENTIAL rather than the profile — the same
   * rule the application uses. An invitation whose link was already followed
   * leaves a confirmed auth user, and Supabase refuses to invite an address
   * that already has one; a reset is what such an account actually needs.
   */
  const credential = await admin.auth.admin.getUserById(row.id);
  const confirmed = Boolean(credential.data?.user?.email_confirmed_at);

  const sent = confirmed
    ? await admin.auth.resetPasswordForEmail(email, { redirectTo })
    : await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

  if (sent.error) {
    fail(`The email could not be sent: ${sent.error.message}`);
  }

  await admin.from("app_user_audit").insert({
    target_user_id: row.id,
    target_email: email,
    actor_user_id: null,
    actor_email: "bootstrap-admin script",
    action: confirmed ? "reset_requested" : "invite_resent",
  });

  console.log(`\n✓ Sent.`);
  console.log(`    kind   : ${confirmed ? "password reset" : "invitation"}`);
  console.log(`    status : ${row.status} (unchanged)`);
  console.log(`    role   : ${row.role} (unchanged)`);
  console.log(
    `\n  ${email} has been emailed a link. They choose their own password;\n` +
      `  nobody — including whoever ran this — can read it. The link itself is a\n` +
      `  single-use credential and is deliberately not printed here.\n` +
      `\n  Their profile becomes active when they finish setting the password.\n`,
  );
  process.exit(0);
}

/* 2. Create the credential. Supabase mails the link; we never see it. */
console.log("• Inviting the account through Supabase Auth…");
const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });

let subject = invited.data?.user?.id ?? null;

if (invited.error) {
  /*
   * The most likely cause is a credential that already exists with no profile
   * — a previous run that failed halfway, or a user created by hand. That is
   * recoverable: find the auth user and give it the profile it is missing,
   * rather than making somebody delete an account to re-run this.
   */
  console.log(`  (invite refused: ${invited.error.message})`);
  console.log("• Looking for an existing credential to attach a profile to…");

  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listed.error) fail(`Could not list auth users: ${listed.error.message}`);

  const match = listed.data.users.find(
    (candidate) => candidate.email?.toLowerCase() === email,
  );
  if (!match) {
    fail(
      "No credential exists for that address and the invitation was refused.\n" +
        "  Check the address, and check that email sending is configured for this project.",
    );
  }
  subject = match.id;
  console.log("  Found one. Creating the missing profile for it.");
}

if (!subject) fail("Supabase did not return a user id. Nothing was created.");

/* 3. Create the profile. This is what actually grants access. */
console.log("• Creating the application profile…");
const created = await admin
  .from("app_users")
  .insert({
    id: subject,
    email,
    display_name: displayName,
    role: "admin",
    /*
     * `invited`, not `active`. Status reflects the CREDENTIAL: this person has
     * not signed in yet, and `getAppUser` refuses an invited profile — so the
     * account genuinely does not work until they accept. It flips to active the
     * first time they complete the invitation.
     */
    status: "invited",
    scope_level: "global",
    scope_primary_area_id: null,
    scope_also_covers_area_ids: [],
  })
  .select("id, email, role, status, created_at")
  .single();

if (created.error) {
  fail(
    `The profile could not be created: ${created.error.message}\n` +
      "  The credential may now exist without a profile. Re-run this script — it\n" +
      "  will find the credential and create the profile.",
  );
}

/* 4. Record it, so the first administrator is as auditable as every later one. */
await admin.from("app_user_audit").insert({
  target_user_id: subject,
  target_email: email,
  actor_user_id: null,
  actor_email: "bootstrap-admin script",
  action: "invited",
  to_value: "admin",
});

console.log(`\n✓ Done.`);
console.log(`    profile : ${created.data.id}`);
console.log(`    role    : ${created.data.role}`);
console.log(`    status  : ${created.data.status}`);
console.log(
  `\n  ${displayName} has been emailed an invitation link. They set their own\n` +
    `  password; nobody — including whoever ran this — can read it.\n` +
    `\n  The account does not work until they accept: an invited profile is\n` +
    `  refused by the auth provider, and becomes active on first sign-in.\n`,
);
