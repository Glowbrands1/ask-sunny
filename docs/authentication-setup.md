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
| `NEXT_PUBLIC_SITE_URL` | *leave unset on Preview* | Only pins **invitation** links to a fixed host. Password recovery ignores it. See step 2. |

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

**Dashboard → Authentication → URL Configuration.** This is the one dashboard
change password recovery needs. **No email template edit is required** — the app
reads both link shapes Supabase can produce, so the stock **Reset Password**
template works as-is.

### Site URL

```
https://ask-sunny.vercel.app
```

Site URL is the **fallback** Supabase redirects to when it declines a
`redirectTo`, so a wrong value here surfaces as a working link that lands on the
wrong host — historically `localhost:3000`.

### Redirect URLs

Add these eight entries. **Exact paths, no query strings, no globstar on
production** — that last point is Supabase's own recommendation and it matters
here for a specific reason, given below.

```
https://ask-sunny.vercel.app/reset-password
https://ask-sunny.vercel.app/auth/accept
https://ask-sunny.vercel.app/auth/recovery
https://ask-sunny-*-glo-brands.vercel.app/reset-password
https://ask-sunny-*-glo-brands.vercel.app/auth/accept
https://ask-sunny-*-glo-brands.vercel.app/auth/recovery
http://localhost:3000/reset-password
http://localhost:3000/auth/accept
```

| Path | Who lands there |
| --- | --- |
| `/reset-password` | **Password recovery.** Both link shapes — see below. |
| `/auth/accept` | Invitations, and *Send sign-in link* in User Management. |
| `/auth/recovery` | Nothing new. Recovery links already in somebody's inbox. |

`/auth/recovery` can be dropped once every link issued before this change has
expired (Supabase recovery links expire after an hour by default). Until then,
removing it breaks links that are still live.

This list is the **actual restriction** on where a sign-in link may land. Ask
Sunny asks for the origin the request came from — so a person clicking a link
lands on the deployment they were invited from — but Supabase decides whether to
honour it. **A link to an origin that is not on this list will not work,** and
the failure looks like an expired link.

### Why the preview wildcard is scoped, and not `https://*.vercel.app/**`

**The publishable key is public — it is compiled into the browser bundle, by
design.** So anyone can call `resetPasswordForEmail(someone@suntancity.com, {
redirectTo: … })` against this project with a `redirectTo` of their choosing.
The allowlist is the only thing that stops Supabase honouring it.

That makes a broad wildcard an **account-takeover vector rather than a
convenience**: with `https://*.vercel.app/**` allowed, an attacker points the
`redirectTo` at their own Vercel deployment, and the victim receives a genuine
Supabase email whose link hands their recovery session to that attacker. Nothing
about the email looks wrong, because nothing about it *is* wrong.

`https://ask-sunny-*-glo-brands.vercel.app/<exact path>` narrows this to
deployments of this project on this team. Note the residual risk, because `*`
matches hyphens: somebody who registered a Vercel team slug ending in
`-glo-brands` and a project named `ask-sunny` could still produce a matching
hostname. If that is not acceptable, drop the wildcard rows and add each preview
host explicitly while it is in use.

The `http://localhost:3000` rows are for local development. Remove them if local
work is not expected to exercise auth.

### Why recovery lands on `/reset-password`, a client page

Supabase returns a recovery session in one of **two shapes**, and which one
arrives is decided by the client that *asked* for the link, not by any setting:

| Who asked | Flow | Link shape |
| --- | --- | --- |
| The browser, via **Forgot your password?** | PKCE | `?code=…` (query string) |
| The server: an **invitation**, or **Send sign-in link** | implicit | `#access_token=…` (URL fragment) |

That split is structural. `@supabase/ssr`'s `createBrowserClient` sets
`flowType: "pkce"` itself; a plain `createClient`, which every server path uses,
defaults to `flowType: "implicit"`. And `inviteUserByEmail` sends no code
challenge at all.

**A URL fragment is never transmitted to a server.** Recovery previously landed
on `/auth/recovery`, a route handler, which reads `?code=` off the query string
and can therefore never see an implicit link. It saw a request with no `code`,
correctly concluded the link was spent, and redirected to `/login` — and
**browsers re-attach a fragment to a redirect target that has none**, so the live
recovery session rode along to the sign-in screen and sat there unread. The
symptom was `#access_token=…` visible in the address bar on the normal login
page, which is exactly what it looked like.

Both shapes genuinely occur on this project: the auth schema holds PKCE flow
states for recovery *and* recovery tokens with no `pkce_` prefix. So recovery now
lands on `/reset-password`, a **client** page, which reads whichever shape
arrives, scrubs it out of the address bar and the back button before anything
else runs, and calls `supabase.auth.updateUser({ password })`.

**No query string is requested**, which is the part of the earlier fix that was
right: a path with no `?` cannot be affected by query handling, by glob matching
across `?`, or by a parameter something appends later. Where the person goes
afterwards is compiled into the page, so there is also no redirect parameter for
an emailed link to point elsewhere.

`/auth/callback` and `/auth/recovery` are kept and still work. Nothing points at
either any more, but links already sitting in an inbox do, and `/auth/recovery`
now forwards a request it cannot read to `/reset-password` rather than to
sign-in — so an implicit fragment on an old link reaches a page that can read it.

### A note on `NEXT_PUBLIC_SITE_URL`

**Leave it unset on Preview.** Password recovery does not read it — the browser
asks for `window.location.origin`, so a preview link always returns to the
preview that sent it. But *invitations* do read it, and setting it on Preview
would send somebody invited from a preview deployment to production instead.
Setting it on Production is optional and harmless.

---

### Recommended while you are in there

**Authentication → Policies → enable leaked password protection.** Supabase
checks new passwords against HaveIBeenPwned. Ask Sunny now has a password-
setting flow, so this is the moment it starts earning its keep, and the database
linter flags it as a WARN until it is on. It is a dashboard toggle — nothing in
this repository can set it.

### One advisory that stays, deliberately

The linter reports `public.accept_invitation()` as a `SECURITY DEFINER` function
callable by signed-in users. That is the design, not an oversight: it is how an
invited profile activates itself, and it is exactly what the linter cannot see
that makes it safe — the function **takes no arguments**, so its subject is
`auth.uid()` from the verified JWT and no caller can name a different profile.
It writes `status` only, refuses anything but `invited` -> `active`, and is
revoked from `anon` and from `PUBLIC`.

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
- To send a **fresh link to a pending invitation**, add `--resend`:

  ```bash
  npm run bootstrap:admin -- --resend "Full Name" person@company.com
  ```

  It refuses unless the profile is still `invited`, and never changes a role,
  status or scope. It exists for the one situation the app cannot fix itself —
  the first administrator has not accepted yet, so there is no active
  administrator to press the button in User Management.
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

**Accepting the invitation**

0. Follow the emailed link. It lands on `/auth/accept`, which establishes the
   session and sends you to **Set a new password**. Choose one.

   Check the address bar the moment the page loads: **no `#access_token=` may be
   visible**, and pressing Back must not reveal one either.

   Setting the password also moves the profile from `invited` to `active` — an
   invited profile is refused by the auth provider, so this step is what turns a
   working credential into a working account. If it is skipped, the person holds
   a password that signs them into Supabase and an application that still turns
   them away.

**As the first Admin**

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
14. Follow the emailed link. It must land on **`/reset-password`** showing
    **Create a new password** — *not* the sign-in screen. Check the address bar
    the moment the page loads: **no `#access_token=` and no `?code=` may be
    visible**, and pressing Back must not reveal one either.

    The link may arrive in either shape and both must work. Landing on `/login`
    with `#access_token=` still in the URL is the exact failure this flow was
    rebuilt to remove; landing on `/` with a `?code=` means Supabase declined the
    redirect target, so check the allowlist in step 2.
15. Set a new password. Confirm the show/hide toggle reveals only the field it
    belongs to, that a short password and a mismatched confirmation are both
    refused *before* anything is sent, and that a success message appears before
    you are taken into the app.
16. Follow the *same* link again. It must report that the link is no longer
    valid and offer **Request a new link**, which goes to `/forgot-password`.
17. Confirm any other device signed in to that account has been signed out — a
    password change revokes every other session, deliberately, and keeps the one
    that just changed it.

**The reporting pipeline — check it still works**

18. `/api/reporting/inbound-email` is authenticated by Resend's webhook
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
