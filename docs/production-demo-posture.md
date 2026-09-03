# The Production deployment, and what it is not

`main` is deployed to Vercel Production so a stakeholder can open one stable
URL. That is the whole reason it exists, and the posture below is a **demo
posture** — recorded here so nobody later mistakes "it is in Production" for
"the production data architecture is settled".

---

## 1. Production reads the Ask Sunny **Dev** Supabase project

Deliberately, and with explicit approval, for the stakeholder demo.

| | |
|---|---|
| Project | `Ask Sunny Dev` (`rbkylaavthsjepsczccv`), region `us-east-1` |
| Read by | Preview **and** Production |
| Why | The reporting data is there. Standing up a second project would mean re-ingesting the source workbooks to show the same numbers. |

**No separate Production Supabase project was created**, because creating one
to satisfy a naming convention would be worse than the honest version: an empty
project, or a copy nobody maintains, presented as production infrastructure.

**What this posture is not.** One database serves two environments, so a
migration applied for a Preview experiment is immediately live to a stakeholder
looking at Production, and there is no environment in which a destructive
change can be rehearsed. That is acceptable for a demo of a read-only dashboard
and is **not** acceptable once anyone depends on these figures. The separation —
a Production project, its own credentials, and a promotion path for migrations —
is the next infrastructure decision, not a task that has been done.

---

## 2. The reporting dashboard is public

Stated first and plainly, because it is the single most consequential fact
about this deployment.

`/reports/salon-performance` and its salon drill-down render **real
salon-level financials** — comparable-store revenue, by location, by district.
**Nothing guards them.**

The temporary stakeholder-review password gate that used to stand in front of
them was **removed at the owner's explicit instruction**, with the exposure
spelled out and accepted. It is not an oversight and it was not lost in a
refactor.

There is no second line of defence to fall back on:

| | |
|---|---|
| Review gate | Removed |
| Employee login | Not built — demo-mode sign-in admits anybody who clicks "Preview demo" |
| Vercel deployment protection | Not enabled on this project as far as this repo knows |
| Supabase RLS | Enabled and forced, but reads run server-side under the secret key, so it does not narrow what the page shows |

**So the deployment URL is the only thing between a competitor and this data.**
Anyone who has the link — forwarded, pasted into a chat, guessed from a
predictable hostname, or found in a browser history on a shared machine — can
read it. Treat the URL as the secret, and share it accordingly.

### Closing it

Employee login, not another shared password. Supabase Auth is the default
choice — [`architecture-constraints.md` §3](./architecture-constraints.md). A
shared password was already tried and removed; the thing worth building is the
one that identifies a person, so a district manager sees their own district and
an audit line says who looked.

Until then, the honest operational answer is: keep the URL to the people who
should have it, and expect no technical control to help if it escapes.

---

## 3. Demo mode does not reach the reporting dashboard

`NEXT_PUBLIC_DEMO_MODE=true` in Production. It is the only `NEXT_PUBLIC_`
variable inlined into the client bundle, and it selects seeded content and the
mock AI provider for the prototype surface — chat, knowledge, forms.

**Salon Performance ignores it entirely.** Nothing under
`src/app/(app)/reports/salon-performance/`, `src/lib/reporting/` or
`src/features/reports/salon-performance/` reads `isDemoMode()`. The dashboard
reads Supabase in either mode, which is why the demo can show real figures
while the rest of the app stays seeded.

`/reports` is a *different page* — a prototype tab with demo content that
happens to share the name. It is not the dashboard.

---

## 4. The ingestion APIs are not relaxed for the demo

Both remain fully credentialed in Production:

| Route | Proves itself with | Unauthenticated result |
|---|---|---|
| `POST /api/reporting/intake` | `REPORTING_INGEST_SECRET` (header only, never a query string) | `401`, before the body is read |
| `POST /api/reporting/inbound-email` | Resend webhook signature over the raw body | `401`, before any attachment listing, download or database call |
| `POST /api/admin/reporting/ingest` | `REPORTING_INGEST_SECRET` | `401` |

Each also answers `GET` with a **readiness** report: which variables are
configured and which parsers are registered, as booleans and names. No value of
any secret, and no salon figure, appears in any response from these routes.

A missing credential yields `503` naming the *variable* — never its value —
because that failure is ours to fix and is the one a retry cannot cure.

---

## 5. Inbound email path

The address the Outlook forwarding rule targets is unchanged by the promotion:

```
ask-sunny-reports@intiozorie.resend.app
```

What *does* change is where Resend delivers the webhook. The endpoint is
environment-specific and is the one piece of external configuration a promotion
requires:

| | Endpoint |
|---|---|
| Preview | `https://<preview-deployment>.vercel.app/api/reporting/inbound-email` |
| Production | `https://<production-domain>/api/reporting/inbound-email` |

Keep both settings as they are: **`email.received` only**, and the **existing
signing secret** — `RESEND_WEBHOOK_SECRET` must continue to match it. Rotating
the secret is not part of moving the endpoint, and doing both at once turns one
change into two failure modes.

---

## 6. Variables Production needs

Names only. Values belong in the Vercel dashboard and nowhere else — not in a
commit, not in a log, not in a URL.

| Variable | Required for | Missing behaviour |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | every reporting read | dashboard cannot load |
| `SUPABASE_SECRET_KEY` | every reporting read | dashboard cannot load |
| `NEXT_PUBLIC_DEMO_MODE` | prototype surface | unset behaves as `true` |
| `RESEND_WEBHOOK_SECRET` | inbound email | every delivery refused |
| `RESEND_API_KEY` | inbound email | `503`, nothing downloaded |
| `REPORTING_APPROVED_SENDERS` | inbound email | nobody admitted |
| `REPORTING_INGEST_SECRET` | HTTP intake | route refuses everybody |
| `ANTHROPIC_API_KEY` | live AI answers | mock provider (demo mode) |

Only `NEXT_PUBLIC_`-prefixed variables reach a browser. Every other row is
server-only, and `import "server-only"` makes that a build failure rather than
a review comment.

---

## 7. Future automation is unaffected

Nothing in this promotion narrows what comes next, and none of it depends on
Microsoft Entra — see [`architecture-constraints.md`](./architecture-constraints.md).

- The three ingestion doors are unchanged and still route into the same
  `intakeReportWorkbook` orchestration.
- Idempotency is unchanged: identical bytes are recognised by `file_sha256`,
  and a `(file, parser, version)` that already succeeded short-circuits.
- A **new report date appends a new period** rather than overwriting the
  previous one, so the dashboard's period history grows on its own as reports
  arrive. Supersession is scoped to a period, a salon and a source sheet.
- Employee login remains provider-agnostic, with Supabase Auth the default
  choice. It is what will put a control back in front of the reporting
  dashboard — see §2, which has none today.
