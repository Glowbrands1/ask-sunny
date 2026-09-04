# Architecture constraints

Decisions that are settled, and that later work is not free to reopen. Each one
is stated with the reasoning, because a constraint whose reason is lost gets
argued away by the next person who finds it inconvenient.

---

## 1. No external identity provider is a foundational dependency

**Ask Sunny must work fully without Microsoft Entra ID, and Entra access may
never be available.**

This is not a preference or a fallback plan. It is the assumption the system is
built on: nothing required to run Ask Sunny may depend on obtaining an Entra
tenant, an app registration, Graph permissions, or client credentials from
anybody.

What that means concretely, by subsystem:

| Subsystem | Works with no identity provider at all? | How |
|---|---|---|
| Reporting reads (`comp_sales_*`) | Yes | Server-side reads under the Supabase secret key. No caller identity is involved. |
| Salon Performance dashboard and drill-down | Yes | Server components; the data is fetched during render. |
| Report ingestion | Yes | Its own machine credential — see §2. |
| Knowledge / RAG | Yes | Supabase pgvector over documents uploaded through the app. |
| Automation / scheduled intake | Yes | The same machine credential, or a signed Resend inbound-email webhook. No delegated user token, no client-credentials flow, no Premium licence. |
| Per-person login, per-person scope | No — needs a provider | This is the one thing a provider adds, and it is the correct thing to be missing. |

The corollary matters as much as the rule: **no required future step may be
designed around Entra client credentials.** If a plan cannot be executed
without them, it is not a plan.

### If Entra is ever added

It is an **optional adapter**: one more implementation of `AuthProvider` in
`src/lib/auth/`, added if it becomes available and wanted, and removable again
without touching anything else. It would authenticate people. It would not
become the way ingestion, retrieval or reporting works, because those already
work.

Microsoft Graph appears in exactly one place in this codebase — the SharePoint
knowledge provider stub (`src/lib/knowledge/providers/sharepoint.ts`) — and that
integration is **optional and additive**. It would feed documents into the same
pgvector index that uploads already write to. If Microsoft access never arrives,
the knowledge base is unaffected.

---

## 2. Report ingestion authenticates with a machine credential

`REPORTING_INGEST_SECRET`, implemented in
`src/lib/reporting/ingest-credential.ts`, required on every call to
`POST /api/admin/reporting/ingest` in every environment.

A **machine** credential, not a person's: it identifies a pipeline, carries no
profile, role or scope, and grants exactly one capability. `authorizeRequest()`
is deliberately not used on that route, because it answers *"which person is
this, and may they do this?"* — a question with no answer for a scheduled job.

It is production-capable on its own. Rotation without downtime (the variable
holds a list, so old and new are live together), revocation (remove an entry and
redeploy, per credential id), constant-time verification (fixed-length SHA-256
digests, branchless comparison), rate limiting on failures only, a refused
minimum strength, no client exposure (`server-only`, no `NEXT_PUBLIC_` prefix),
and an auditable credential id that is never the secret. The full table and the
operational notes are in
[`reporting-ingestion-contract.md` §1](./reporting-ingestion-contract.md).

**Never in a query string.** The credential is presented as a header, because a
secret in a URL is written into every log between the caller and here and
survives rotation in all of them.

**Never reused as user authentication.** No employee holds this value. The
moment it grows a role it becomes a shared login, and it is pinned as a test
that its authorized outcome carries nothing but a status and a credential id.

It authenticates two routes: `/api/admin/reporting/ingest` (one named sheet,
for a person doing a controlled ingestion) and `/api/reporting/intake` (one
delivery, every compatible parser, for automation). The second is what a
scheduled caller posts to, and it is the reason automation needs no identity
provider: the sender proves it is the pipeline, not that it is somebody.

### The third door: inbound email

`POST /api/reporting/inbound-email` accepts the report as a **forwarded
email**, verified by a Resend webhook signature rather than by
`REPORTING_INGEST_SECRET`. It exists because the Power Automate HTTP action
requires a Premium licence, and it removes the last piece of Microsoft
tooling from the reporting path — an Outlook *forwarding rule* is a feature of
every mailbox, needs no licence, no app registration and no tenant consent.

Same principle as the machine credential: the delivery proves itself
cryptographically, and no identity provider is involved at any point. It ends
in the same `intakeReportWorkbook` orchestration, so no parser logic,
idempotency layer or supersession rule is duplicated. See
[`reporting-ingestion-contract.md` §1c](./reporting-ingestion-contract.md).

---

## 3. User authentication is provider-agnostic

Every provider is an adapter behind the `AuthProvider` interface in
`src/lib/auth/types.ts`. None is a foundational dependency. Profile, role and
scope live in this application's own tables, which is what makes a provider
swappable: changing it must not touch the org chart.

**Supabase Auth is the default choice for employee login unless another provider
is explicitly chosen, and it is now the IMPLEMENTED one** —
`SupabaseAuthProvider` in `src/lib/auth/supabase-provider.ts`. It was the
default for reasons rather than by elimination:

- Supabase is already the database, so `auth.uid()` is the subject the row level
  security policies in `supabase/migrations/20260829000400_rls.sql` are already
  written against.
- Adopting it needs no agreement from anyone outside this project.
- It is the point at which `knowledge_documents.uploaded_by` starts being
  populated and those policies begin doing real work.

Adding it moved no call site. Routes still call `authorizeRequest()`, pages
still call the page guards, and the UI still calls `useSession()` — which is
the evidence that this constraint was worth writing down before there was
anything to swap.

Two properties make it production-grade, and both are checks rather than
declarations:

- The session cookie is validated with `auth.getUser()`, which asks the auth
  server. `auth.getSession()` merely decodes the cookie without verifying its
  signature, so a forged cookie satisfies it — no authorization decision may
  rest on it.
- The role is read from `public.app_users` on the server, never from user
  metadata (which the account holder can edit), never from a token claim, and
  never from anything the browser sent. **A missing or non-active profile
  denies.** A valid credential with no profile is not a user of this
  application.

Where Supabase is not configured, `UnconfiguredAuthProvider` identifies nobody
and every per-person guard refuses. That is intended: per-person functionality
stays closed rather than falling open, while everything in the §1 table keeps
working. Live mode never falls back to the demo role switcher — provider
selection reads the live case first precisely so that a lost
`NEXT_PUBLIC_DEMO_MODE` cannot downgrade a real deployment to a presentation
aid.

---

## 4. Related invariants these rest on

Recorded here because a change to any of them would undermine the constraints
above.

- **The Supabase secret key never reaches a browser.** Reads run server-side;
  `import "server-only"` enforces it at build time rather than in review.
- **The reporting read layer is scoped to one period per render.** A new period
  brings its own salons, districts, measures and comparisons, and nothing from
  another period can reach a page.
- **A missing figure is never zero.** `Unavailable` with a reason, in the KPI
  cards, the tables and the comparison sections alike.
- **RLS cannot yet be narrowed by district.** The district and region columns
  hold manager *names*, which change. Narrowing a policy needs stable district
  and region codes from the source. Server-side reads under the secret key are
  the interim posture — safe, and not the destination.
- **Nothing guards the reporting dashboard.** The temporary shared-password
  review gate was removed at the owner's explicit instruction. Demo-mode
  sign-in admits anybody, so `/reports/salon-performance` and its drill-down
  are readable by whoever holds the URL. This is a deliberate, informed
  acceptance of that exposure for a stakeholder demo — not an oversight, and
  not a posture to inherit. Employee login (§3) is what closes it.
