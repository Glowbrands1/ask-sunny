# Turning on real authentication

Everything in this document is a step that must be taken **outside the
repository** — in Vercel, in the Supabase dashboard, or from a terminal holding
the secret key. The code is finished and merged; none of it takes effect until
these are done.

The order matters. Step 3 fails without step 1, and step 4 is unverifiable
without step 2.

---

## 1. Vercel environment variables (Preview)

| Variable | Value | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | Selects live mode. **Unset means demo** — see the warning below. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Must include the scheme. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Browser-safe. Never the secret key. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` | Already set if Sales Totals ingestion is working. |
| `NEXT_PUBLIC_SITE_URL` | *optional* | Only if invitation links must point at a fixed host rather than the deployment that sent them. |

> **`NEXT_PUBLIC_DEMO_MODE=false` does more than switch on authentication.** It
> also puts Chat, Knowledge and Forms into live mode, where they use the
> configured services instead of seeded content and report missing
> configuration rather than falling back. If `ANTHROPIC_API_KEY` is not set on
> the Preview environment, Ask Sunny will say so rather than answering from the
> demo corpus. Check `/api/health` after deploying — it lists every missing
> variable by name.

Two failure modes worth knowing, because both look like something else:

- **A URL without `https://`.** Every presence check reads it as configured and
  the Supabase client then throws on every request. The app now refuses it as
  unconfigured and names the variable, but the fix is still to add the scheme.
- **The secret key in the `NEXT_PUBLIC_` slot.** Anything prefixed
  `NEXT_PUBLIC_` is compiled into the browser bundle, so this hands every
  visitor a key that bypasses row level security. `/api/health` reports it as a
  configuration problem and the app refuses to serve.

---

## 2. Supabase Auth redirect URLs

**Dashboard → Authentication → URL Configuration.**

Add the Preview origin to **Redirect URLs**, including a wildcard for the
per-deployment hostnames Vercel generates:

```
https://<your-preview-host>/auth/callback
https://*.vercel.app/auth/callback
```

This is the actual restriction on where a sign-in link may land. Ask Sunny asks
for the origin the request came from — so a person clicking a link lands on the
deployment they were invited from — but Supabase decides whether to honour it.
**A link to an origin that is not on this list will not work,** and the failure
looks like an expired link.

---

## 3. Create the first administrator

Nobody exists yet: `auth.users` and `app_users` are both empty. Run this once,
from a terminal that has the secret key:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_SECRET_KEY="sb_secret_…" \
ASK_SUNNY_SITE_URL="https://<your-preview-host>" \
npm run bootstrap:admin -- "Curt Bowen" "Curt.Bowen@suntancity.com"
```

What it does, and what it deliberately does not:

- Supabase generates the invitation link and emails it. **No password is
  created, printed or stored** — Curt sets his own. There is no password
  anywhere in this script, so there is nothing to leak into a shell history or
  a CI log.
- The profile is created with `role = admin` and `status = invited`. **The
  account does not work until he accepts**: an invited profile is refused by the
  auth provider, and flips to active on first sign-in.
- Running it twice is safe. The second run reports the existing account and
  changes nothing — it will not promote or overwrite a profile, because
  silently escalating somebody on a re-run is exactly the surprise an
  administration tool must not produce.
- The name and email are **arguments**. Nothing about Curt is hard-coded
  anywhere in Ask Sunny; once this row exists it is an ordinary profile, and he
  can be edited, demoted or disabled through User Management like anybody else.

If the invitation is refused because a credential already exists without a
profile — a half-finished earlier run — the script finds that credential and
creates the missing profile rather than requiring anything to be deleted.

---

## 4. Preview QA

Everything below is server-enforced. Checking it from the browser is the point:
a hidden link is not a boundary, and these steps confirm the boundary rather
than the link.

**As Curt (Admin)**

1. Sign in. Landing page is the Overview.
2. The rail shows every section including Admin.
3. **User Management** lists exactly one person: himself.
4. His own role dropdown and Disable button are **disabled** — nobody changes
   their own role or status — and the row is marked "Last administrator".
5. The **Permissions** tab is read-only: every checkbox disabled, no Save
   button, and a notice explaining that the policy is fixed in this release.
   Check that the **Admin** column shows *Manage users* as **ticked**.
6. Invite a second person as **Employee**. They appear as *Invited*.
7. Sign out. Confirm the app is gone — not just the shell.

**As the Employee**

8. Accept the invitation, set a password, land on **Ask Sunny** (`/chat`) —
   *not* the Overview, which they cannot see.
9. The rail shows **only** Ask Sunny, Knowledge Base and Videos. No empty
   section headings.
10. Type `/` in the address bar. Expect a redirect to `/chat?denied=view_overview`,
    not the Overview.
11. Try `/reports/salon-performance`, `/forms/monitoring`, `/admin/users` the
    same way. All redirect.
12. Confirm they can read the knowledge base and cannot upload to it.

**Password recovery**

13. Sign out, use **Forgot your password?**, and confirm the same message
    appears whether or not the address exists.
14. Follow the emailed link, set a new password, confirm you land in the app.
15. Follow the *same* link again. It must now report that the link is no longer
    valid.

**The reporting pipeline — check it still works**

16. `/api/reporting/inbound-email` is authenticated by Resend's webhook
    signature and has **no user**. A report arriving at 6am has nobody's cookie
    attached. The auth middleware excludes `/api` entirely and a test asserts
    it, but confirm a Sales Totals delivery still lands after this change —
    breaking the pipeline while adding authentication is a silent failure
    nobody notices for days.

---

## What is deliberately not built

**Editable permission policy.** The matrix shows the policy and cannot change
it. Doing that properly means persisting a matrix, versioning it, auditing
every change, and deciding what happens to somebody already signed in under the
old policy. A half-built version is worse than none: an administrator ticks a
box, sees it saved, and nothing changes anywhere. Roles are assigned per person
in User Management; the policy itself is fixed in this release and enforced
server-side on every request.

**Email address changes.** The address is the credential's identity. Changing
it in the profile alone would leave somebody signing in as one person and
appearing in the directory as another, which reads as an application bug rather
than an edit.
