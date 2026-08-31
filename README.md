# Ask Sunny

**Phase 1 front-end prototype — a manager operating platform for JV & Associates (Sun Tan City).**

Ask Sunny is not a chatbot with a sidebar. It is one place for a salon manager to
run their day: an assistant grounded in the company's own knowledge base, plus
forms, follow-ups, training, reporting, Google reviews, and the external tools
managers otherwise go hunting for.

This repository contains the front end only. Every external system it will
eventually talk to — Claude, SharePoint, Woven, Power BI, Google Business
Profile, Microsoft 365 — is present as a typed interface and an honest
placeholder. Nothing is faked, and nothing calls out to a paid service.

---

## Table of contents

1. [Install and run](#install-and-run)
2. [How demo mode works](#how-demo-mode-works)
3. [What is real, what is mocked](#what-is-real-what-is-mocked)
4. [Architecture](#architecture)
5. [Provider architecture](#provider-architecture)
6. [Storage architecture](#storage-architecture)
7. [Knowledge architecture](#knowledge-architecture)
8. [AI provider architecture](#ai-provider-architecture)
9. [Role permissions](#role-permissions)
10. [Design system and brand tokens](#design-system-and-brand-tokens)
11. [Multi-brand plan — Buff City Soap](#multi-brand-plan--buff-city-soap)
12. [Environment variables](#environment-variables)
13. [Live mode](#live-mode)
14. [Authentication architecture](#authentication-architecture)
15. [Security hardening](#security-hardening)
16. [Testing](#testing)
17. [Future integrations](#future-integrations)
18. [Production migration plan](#production-migration-plan)
19. [Future roadmap](#future-roadmap)

---

## Install and run

Requirements: Node.js 20+ and npm. Nothing else — no Docker, no database, no
accounts, no paid services.

```bash
npm install
```

```bash
npm run dev
```

Then open <http://localhost:3000> and choose **Preview demo**.

Other scripts:

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm test
```

Copy `.env.example` to `.env.local` before running. Every value ships empty and
the app runs fine that way: demo mode requires no database, no API key and no
account.

---

## How demo mode works

`NEXT_PUBLIC_DEMO_MODE=true` turns on two presentation aids:

- **Preview demo** on the login screen. The email and password fields are
  disabled and no password is ever stored, compared, hashed, or transmitted.
  "Preview demo" grants access to the app without authentication.
- **Demo role switcher** in the profile menu (bottom of the sidebar). It swaps
  the active role between Salon Director, District Manager, Regional Manager and
  Owner. Navigation and page access visibly change — a Salon Director has no
  admin section and cannot open Form Templates; an Owner sees everything.

The switcher is deliberately isolated in `src/components/shell/user-menu.tsx`
under a "Demo role" heading, so removing it later means deleting that one block
and the `DEMO_SWITCHABLE_ROLES` export.

Set `NEXT_PUBLIC_DEMO_MODE=false` and both disappear.

**Reset demo data** in the profile menu clears everything stored in the browser
and restores the seeded set — useful between rehearsals.

### Demo dates

Everything relative in the prototype ("due in 3 days", "3 follow-ups need
attention") is measured against a single anchor constant, `DEMO_ANCHOR` in
`src/lib/utils/date.ts`, rather than the wall clock. That keeps the demo
deterministic — identical on the server and in the browser, so there is no
hydration drift, and identical every time it is presented. **Move that one
constant to refresh the demo before a presentation.**

---

## What is real, what is mocked

### Real, working software

- Every screen, every route, every interaction, at every breakpoint.
- **Document upload** — drag-and-drop or file picker, stored as a Blob in
  IndexedDB. The document appears in the library and **survives a page refresh**.
  Re-uploading under an existing title creates a new version and supersedes the
  old one.
- **Versioning** — prior-version metadata is kept and shown in the details view.
- **Form creation** — the full guided flow, and every AI-drafted field is
  directly editable in the printed-form preview before saving.
- **Form monitoring** — inline-editable follow-up dates, status derivation, mark
  followed up, archive. Saved forms persist.
- **Permissions** — the roles × features matrix is editable and persisted, and
  changes immediately affect navigation and page access.
- **Search and filtering** everywhere, plus a global search across documents,
  videos, forms, salons and screens.
- **Chat** — conversation history, answer modes, source cards, video
  recommendations, and the scripted chat-to-form handoff.
- Print styling for generated forms.

### Mocked (behind a real interface)

- **Answers.** `MockAIProvider` matches the question against a seeded answer
  bank and returns the response for the active answer mode, with genuine
  `SourceCitation` objects.
- **Retrieval.** `LocalKnowledgeProvider` scores seeded chunks by keyword
  overlap. The citation plumbing it feeds is the real plumbing.
- **Video matching.** Matched on each video's equipment / keywords / tags /
  category — the same fields production will match on.
- **Reporting figures, review counts, AI spend.** All seeded demo data, labelled
  as such in the UI.

### Built but not yet connected

The live path is implemented end to end in code and **has never been run against
a real service**, because no Supabase project and no API credentials exist yet:

- SQL migrations under `supabase/migrations/` — written, never applied.
- `SupabaseStorageProvider`, `SupabaseKnowledgeProvider` — written, never run.
- `SupabaseEmbeddingProvider` + the `embed` Edge Function — written, tested
  against a mocked network only.
- `ClaudeProvider` and `/api/chat` — written, never called with a real key.

Nothing above is claimed to work. Connecting them is a configuration and
migration step, not a redesign.

### Still deferred

Production authentication (the demo role switcher is a presentation aid and is
**not** security), video transcription, SharePoint / Woven / Power BI / Google /
Microsoft 365 connections, and deployment.

---

## Architecture

```
src/
  app/                       # routes (App Router)
    (app)/                   # authenticated shell: every in-app screen
    login/                   # login prototype
  components/
    ui/                      # primitives: button, card, badge, field, controls…
    shell/                   # sidebar, app shell, global search, user menu
    brand-mark.tsx           # the wordmark — swap for an official asset here
    source-card.tsx          # "where this answer came from"
    stat-card.tsx  rich-text.tsx  video-card.tsx  permission-gate.tsx
  features/
    auth/ chat/ dashboard/ knowledge/ videos/
    forms/ reports/ reviews/ resources/ admin/
  lib/
    ai/                      # AIProvider + MockAIProvider (+ where Claude goes)
    knowledge/               # KnowledgeProvider, mock retrieval, SharePoint stub
    storage/                 # StorageProvider + LocalPrototypeStorageProvider
    permissions/             # role → permission configuration
    session/                 # who is using the app (no credentials)
    store/                   # mutable app state + persistence
    brand/                   # BrandConfig — STC now, BCS drafted
    utils/                   # cn, dates, formatting, ids, client stores
  data/demo/                 # ALL seeded content — never inline in a component
  types/                     # domain types
```

Two rules hold the design together:

1. **UI never touches an implementation.** Components consume `AIProvider`,
   `KnowledgeProvider` and `StorageProvider`. No component imports an SDK, a
   model name, an API key or a storage client.
2. **All demo content lives in `src/data/demo/`.** Replacing demo data with live
   data is a change there, not a hunt through the UI.

### Routes

| Route | Screen |
| --- | --- |
| `/login` | Login prototype + demo access |
| `/` | Overview (manager home) |
| `/chat` | Ask Sunny |
| `/reports` | Reports & Analytics |
| `/reviews` | Google Reviews |
| `/knowledge` | Knowledge Base |
| `/videos` | Training Videos |
| `/forms/create` | Create a Form |
| `/forms/monitoring` | Form Monitoring |
| `/forms/templates` | Form Templates |
| `/resources` | Manager Resources |
| `/admin/ai-usage` | AI Usage *(admin)* |
| `/admin/users` | User Management + Permissions *(admin)* |
| `/admin/integrations` | Integrations *(admin)* |

---

## Provider architecture

Three interfaces carry everything that varies between demo and production:

| Interface | Demo mode | Live mode |
| --- | --- | --- |
| `AIProvider` | `MockAIProvider` | `ClaudeProvider` (posts to `/api/chat`) |
| `KnowledgeProvider` | `LocalKnowledgeProvider` | `RemoteKnowledgeProvider` → `SupabaseKnowledgeProvider` server-side |
| `StorageProvider` | `LocalPrototypeStorageProvider` | `SupabaseStorageProvider` server-side; `SharePointStorageProvider` still a stub |

Each is resolved in exactly one place (`getAIProvider()`,
`getKnowledgeProvider()`, `getStorageProvider()`), and those three functions are
where the demo/live decision is made. No component imports an SDK, a model name
or a key.

`EmbeddingProvider` is a fourth interface, added for retrieval: Anthropic does
not provide an embedding model, so `SupabaseEmbeddingProvider` sits behind
`getEmbeddingProvider()` and nothing outside `lib/embeddings` names the backend.
That seam has already earned itself once: the embedding backend moved from an
external vendor to a model running inside Supabase's Edge Runtime, and no
caller changed.

---

## Storage architecture

`StorageProvider` (`src/lib/storage/types.ts`) covers record collections, keyed
values, and file blobs.

`LocalPrototypeStorageProvider` implements it on IndexedDB with a small
dependency-free wrapper (`src/lib/storage/indexeddb.ts`). Three object stores:
`records` (collections, indexed by collection name), `values` (keyed settings),
and `blobs` (uploaded files).

Persistence in `src/lib/store/app-store.tsx` runs through **sync effects** — one
per collection — rather than writing inside state updaters. Updaters must stay
pure (React invokes them more than once in development), and "keep an external
system in step with React state" is exactly what an effect is for.

Every method degrades gracefully when IndexedDB is unavailable: the UI still
renders from seeded data, it just does not persist, and the Integrations screen
reports it honestly.

`SupabaseStorageProvider` (`src/lib/storage/supabase-provider.ts`) implements
the same interface against Postgres plus the **private**
`knowledge-documents` bucket. It is marked `server-only` because it holds a
service-role client, so `getStorageProvider()` — which runs in the browser —
cannot return it. In live mode the browser keeps IndexedDB for local UI state
and the knowledge library is served by `/api/knowledge/*`; confidential company
documents are never copied into browser storage.

Two guards worth naming: every blob key is checked against its scope prefix
before it reaches Supabase, so a crafted path cannot address another corpus; and
`clearAll()` throws, because "Reset demo data" must never be able to truncate the
company knowledge base.

---

## Knowledge architecture

### Today

Seeded corpus of ~58 documents across 10 categories in
`src/data/demo/knowledge.ts`, with retrievable chunks for the six grounding
documents chat answers from. Every excerpt is generic placeholder prose written
for this prototype, labelled "Demo content" in the UI. **No real company policy
language appears anywhere in this repository.**

Scale and shape mirror the corpus in use today — a focused set, *not* the full
Woven library (600+ documents, much of it maintenance and SDS material that
should not be ingested).

### In live mode

The ingestion pipeline (`src/lib/ingestion/`) and the retrieval RPC
(`supabase/migrations/`) are built. See [Live mode](#live-mode) for the flow.

`KnowledgeDocument` needed no new fields: `status`, `indexed`, `version`,
`previousVersions` and `source` already describe production. The database's
four-state lifecycle (`uploading` / `processing` / `indexed` / `failed`) maps
onto the existing `DocumentStatus` union in `src/lib/knowledge/mappers.ts` —
both in-flight states show as the existing **Processing** badge. No separate
frontend status model was invented, and `SourceCitation` / `SourceCard` are
untouched.

---

## AI provider architecture

`MockAIProvider` (`src/lib/ai/mock-provider.ts`) does three things:

1. Matches a question against the seeded answer bank and returns the response
   for the active answer mode, with real citations.
2. Recommends videos by matching equipment / keywords / tags / category.
3. Runs the scripted chat-to-form flow: collect what is missing, then hand a
   pre-filled draft to the Create a Form workspace.

It also implements `draftForm()`, which fills only the fields a template marks
`ai_populate`. Signature fields are excluded **structurally**, not by
convention — no configuration can turn them on.

### ClaudeProvider

`ClaudeProvider` (`src/lib/ai/claude-provider.ts`) contains no SDK, no model name
and no key — it posts to `/api/chat`, which does retrieval and the Anthropic call
server-side. `features/chat/` still calls `provider.ask(...)` and gets an
`AskResponse` back, exactly as with the mock.

Sunny's production system instruction lives in `src/lib/ai/prompts.ts`. It is
pure string construction with no SDK involved, so the exact prompt Claude
receives is testable — and it is tested. It requires Sunny to distinguish company
knowledge from general management guidance, forbids stating any policy not in the
provided sources, and requires an explicit "the knowledge base does not have
this" over a plausible-sounding invention.

**The chat-to-form flow was not rewritten.** It moved to
`src/lib/forms/chat-flow.ts` unchanged and is now shared by both providers.
Which template applies and which fields exist stay deterministic: a coaching form
ends up in an employment file, so a language model does not choose its frame.
Claude drafts prose *inside* fields via `/api/forms/draft`, and `applyFillRules`
runs on its output — signature fields stay blank whatever the model returns, even
one mismarked as AI-populatable.

Streaming: keep `ask()` and add `askStream()` alongside it, so the mock provider
stays valid.

---

## Role permissions

Six roles: Assistant Salon Director · Salon Director · District Manager ·
Regional Manager · Owner · Developer/Admin.

Seventeen permission keys:

`ask_questions` · `create_coaching` · `view_daily_stats` ·
`create_coaching_form` · `create_corrective_action` · `create_epp` ·
`create_policy_review` · `view_form_monitoring` · `manage_form_templates` ·
`view_videos` · `manage_videos` · `view_reports` · `view_google_reviews` ·
`manage_knowledge` · `view_ai_usage` · `manage_users` · `manage_integrations`

The role → permission configuration lives in `src/lib/permissions/index.ts` and
is editable from **User Management → Permissions**, persisted to browser
storage. Admin console access is fixed to Owner + Developer and is not editable
from the matrix — those cells are locked and explain why on hover.

**This is not security.** In the prototype permissions gate navigation and page
content on the client, which is right for a demo. In production the same
permission keys gate the route on the server.

### End-state login model

Every person gets an individual login. Salon-level accounts sign in under the
salon email address as a Salon Director; District and Regional Managers get
personal logins. This replaces the single shared credential in use today, and it
is what makes per-user chat history, scoped reporting and an audit trail
possible.

`src/lib/session/` holds *who is using the app* and nothing else. There is no
password handling, no credential storage, and no homemade hashing anywhere in
this repository. The only thing persisted is the presenter's demo session.

---

## Design system and brand tokens

`src/app/globals.css` defines two layers:

1. **Raw palette tokens** (`--stc-*`) — brand colour values, approximated from
   the Sun Tan City brand board. Never consumed by components.
2. **Semantic aliases** (`--background`, `--primary`, `--accent`, …) — the only
   thing components use.

Official hex codes have not been supplied, and STC has released a brand refresh
the client may or may not adopt, so **every colour is replaceable in that one
file**. Rules baked into the tokens: coral appears only as a tiny highlight,
gold is an accent and never a large background, and there are no gradients.

Type is Manrope via `next/font`. Status is always a dot or icon plus text, never
colour alone.

The wordmark lives in `src/components/brand-mark.tsx` — a text wordmark and a
simple CSS/SVG radiance mark, no mascot. Replace that one component when an
official asset exists.

---

## Multi-brand plan — Buff City Soap

`BrandConfig` (`src/lib/brand/index.ts`) carries the brand name, assistant name,
wordmark, vocabulary, a palette token map, and a knowledge scope id. The app
shell writes `paletteTokens` onto the root element as inline CSS custom
properties, overriding the defaults in `globals.css`.

A Buff City Soap instance is therefore:

1. Add a `BrandConfig` with the Tokyo Green palette (a draft is already in the
   file as a worked example).
2. Point `ACTIVE_BRAND` at it.
3. Seed that brand's knowledge corpus under its `knowledgeScopeId`.

No component changes. Only the STC config ships in this build.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill it in there. `.env.local` is
gitignored; `.env.example` contains placeholder names only and never a value.

```
# Mode
NEXT_PUBLIC_DEMO_MODE=true

# Supabase (public — inlined into the browser bundle)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

# Server-only. Never prefix these with NEXT_PUBLIC_.
SUPABASE_SECRET_KEY=
ANTHROPIC_API_KEY=

# Server-only, and normally unset. See "Authentication architecture".
# ALLOW_UNAUTHENTICATED_LIVE_ACCESS=
```

### Supabase keys

Supabase's current API keys are a publishable/secret pair; the legacy `anon` and
`service_role` JWTs are being retired, and a newly created project is issued
both sets.

| Variable | Key | Exposure |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` | browser — RLS applies |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **server only** — bypasses RLS |

`SUPABASE_SERVICE_ROLE_KEY` still works as a fallback when only the legacy key
is available.

The publishable key is **reported but not required**: no code path reads it yet,
because every Supabase call runs server-side under the secret key. It becomes
required when authentication ships and the browser starts talking to Supabase
directly. Requiring it today would make `/api/health` assert something untrue.

Swapping the two is caught rather than shipped. A `sb_secret_...` value under
the `NEXT_PUBLIC_` name would be compiled into the bundle and handed to every
visitor, so `configurationProblems()` flags it, `/api/health` lists it, and the
live routes return 503 instead of serving.

**Demo mode needs none of them.** `NEXT_PUBLIC_DEMO_MODE` defaults to demo when
unset, and the app runs fully with every other variable empty.

`ANTHROPIC_API_KEY` and `SUPABASE_SECRET_KEY` are read
only from modules marked `import "server-only"`, which makes importing them from
a client component a **build error** rather than a code review question. This is
verified: building with sentinel values and grepping `.next/static` finds none of
them.

Check what is configured at any time:

```bash
curl localhost:3000/api/health
```

It reports variable **names** only, never values, and states plainly that it has
verified nothing — a present key is not a working key. It also lists
`configurationProblems`: misconfigurations that block live mode even when every
variable is set.

---

## Live mode

`NEXT_PUBLIC_DEMO_MODE=false` switches every provider to its live
implementation. The three resolvers are the only places this decision is made:

| Resolver | demo | live |
| --- | --- | --- |
| `getAIProvider()` | `MockAIProvider` | `ClaudeProvider` → `/api/chat` |
| `getKnowledgeProvider()` | `LocalKnowledgeProvider` | `RemoteKnowledgeProvider` → `/api/knowledge/*` |
| `getStorageProvider()` | IndexedDB | IndexedDB for local UI state; documents go to Supabase server-side |

**Live mode never degrades into demo mode.** There is no try/catch anywhere that
swaps a live provider for the mock. A missing key or an unreachable service
produces an error naming what is missing. A manager acting on a fabricated
policy because a service was down is the failure this codebase is arranged to
make impossible, and it is covered by tests.

### The grounded answer path

```
question
  -> embed the question                  gte-small, in a Supabase Edge Function
  -> retrieve top-k chunks               match_knowledge_chunks() / pgvector
  -> build grounding context             each excerpt labelled [S1]..[Sn]
  -> Claude                              Anthropic SDK, server-side only
  -> markers the model used              [S2][S1] -> rows 2 and 1
  -> SourceCitation[]                    built from those ROWS
```

The model is never asked for a citation object. It marks which numbered source
supports each claim; the server decides what those numbers mean and builds every
`SourceCitation` from the retrieved database rows. A hallucinated title, page
number or document id has no code path into a source card, and an out-of-range
marker is discarded.

### Ingestion

```
file -> validate -> private Storage -> extract -> chunk -> embed -> pgvector
```

- **Validate** — server-side, by extension *and* declared MIME type. PDF, DOCX,
  TXT/MD. Anything else returns the reason it was rejected.
- **Extract** — `unpdf` gives per-page text so "Page 14" is true; `mammoth`
  gives headings so "Coaching Standards" is true; text files split on headings.
- **Chunk** — ~400 tokens, ~12% overlap, deterministic. Page and section
  boundaries are not crossed unless a segment is too small to stand alone, and
  overlap is carried as whole sentences. The size is set by the embedding
  model's 512-token input limit, not by taste.
- **Embed** — `gte-small` inside the `embed` Edge Function, batched. Documents
  and questions go through the identical request, which is what keeps a stored
  chunk and the question asked against it in the same vector space. An
  unchanged re-upload hashes identically and skips embedding entirely.
- **Persist** — a document flips to indexed **only after every chunk is
  stored**. Retrieval filters on `indexed = true` and on the current version, so
  a half-processed or superseded document can never be cited. A failure is
  recoverable: re-uploading re-runs the pipeline.

### Model configuration

Model names live in `src/lib/config/models.ts` and nowhere else — Claude model
and effort, embedding model, its output dimension, chunking parameters and
retrieval thresholds. The embedding dimension is tied to the pgvector column
width the migrations declare; if they ever disagree, `/api/health` reports
`embeddingDimensionMismatch` and the routes refuse to run rather than writing
vectors the index cannot search.

---

## Authentication architecture

**No identity provider has been chosen or implemented.** What exists is the seam
one slots into, and the guards that keep protected functionality closed until it
does.

`AuthProvider` (`src/lib/auth/types.ts`) answers "who is making this request?".
Two honest implementations, and deliberately no third that pretends:

| Provider | Mode | `isProductionGrade` | Behaviour |
| --- | --- | --- | --- |
| `DemoAuthProvider` | demo | **false** | Returns the demo role's identity, marked `verified: false` |
| `UnconfiguredAuthProvider` | live | **false** | Identifies nobody |

`authorizeRequest()` (`src/lib/auth/server.ts`) is what every protected route
calls, in this order:

1. Production-grade provider? → **501** if not (live mode)
2. Identity present? → **401** if not
3. Identity actually `verified`? → **401** if not
4. Role holds the permission? → **403** if not

Step 1 is what makes "live mode refuses protected functionality" true rather
than aspirational. Step 3 is what stops a demo identity satisfying step 2 — the
demo switcher can never become authentication by accident, because it says of
itself that it is not.

The server checks `DEFAULT_PERMISSION_MATRIX`, **not** the browser's copy. The
matrix in IndexedDB is an editable demo convenience; a client that edited it
must not thereby grant itself server-side access.

### The pre-authentication escape hatch

`ALLOW_UNAUTHENTICATED_LIVE_ACCESS=true` lets live mode serve protected routes
without an identity provider. It exists for exactly one purpose: the acceptance
test that proves upload → retrieval → answer works against real credentials,
before auth is built.

**It cannot operate in production.** The flag is gated on `NODE_ENV`, not on a
warning:

```
unauthenticatedAccessAllowed()
  → NODE_ENV === "production" ?  return false      (flag never read)
  → otherwise                 ?  flag === "true"
```

`next build` and `next start` both set `NODE_ENV=production`, so every real
deployment of this app is a production runtime and the bypass is inert there
whatever the variable says. `authorizeRequest()` carries a second, independent
production check on the branch that fabricates the unauthenticated identity, so
a future edit to the helper cannot silently reopen the door.

| Runtime | Flag set | Result |
| --- | --- | --- |
| `next dev` / test | `true` | Bypass active, warns once |
| `next dev` / test | unset | Refused (501) |
| **production** | **`true`** | **Refused (501)**, plus a `SECURITY:` error saying the flag was ignored |
| production | unset | Refused (501) |

`/api/health` reports `available`, `active` and `ignoredInProduction`
separately, and the admin screen shows the runtime it is judging by.

---

## Security hardening

| Concern | Where it is handled |
| --- | --- |
| Request validation | `src/lib/api/validation.ts` — one module, so a new route cannot forget a check an older one remembered |
| Error responses | `src/lib/api/respond.ts` — a single mapping; anything unrecognised becomes a generic 500 rather than reflecting its message |
| Log safety | `src/lib/api/redact.ts` — strips credential shapes, truncates, drops stacks and cause chains |
| Rate limiting | `src/lib/api/rate-limit.ts` — interface plus in-memory implementation |
| Path/scope validation | `src/lib/ingestion/paths.ts`, re-checked on every read and delete |

**Logging policy.** No question, answer, grounding prompt, document text or
credential reaches a log line. The realistic leak path is a Postgres constraint
violation quoting the offending row — which for `knowledge_chunks` means a
fragment of a company document — so every message passes through `redact()`
before it is logged *or* returned.

**Rate limiting, stated honestly.** Counters live in each server instance's
memory, so they reset on deploy and are not shared across instances. This guards
against a runaway client burning Anthropic credit and Edge Function
invocations; it is **not**
protection against a distributed attacker. `/api/health` reports
`distributed: false` and the admin screen says so. Real abuse protection arrives
with authentication and a shared store — the interface is what that swap
targets.

**Scope validation.** Every document lookup filters on `id` *and*
`knowledge_scope_id`, so an id alone can never reach another brand's corpus.
Storage paths are re-validated with `assertPathWithinScope()` on every read and
delete, including paths read back from a database row.

---

## Testing

```bash
npm test
```

Tests cover what can be verified without an external account, and nothing in the
suite touches a network:

| Area | What is asserted |
| --- | --- |
| Chunking | Determinism, target size, overlap on whole sentences, page boundaries not crossed, locator metadata retained, run-on text force-split |
| File validation | Each supported type accepted; unsupported types, extension/MIME mismatches, oversized and empty files rejected with a useful reason |
| Path safety | `../` traversal stripped, collision-safe paths, cross-scope access refused |
| Extraction | TXT/Markdown heading segmentation, DOCX heading segmentation, entity decoding, BOM handling |
| Provider selection | Correct provider per mode, and **live mode never falling back to the mock** |
| Configuration | Missing variables reported by name, never by value |
| Citation mapping | Every citation field built from a retrieved row; relevance clamped; storage paths never exposed |
| Grounding prompt | Anti-fabrication rules present; invented markers discarded |
| Embeddings | Batching, document vs query input types, dimension mismatch rejected, honest degradation, key never leaves the auth header |
| Form fill rules | Signature fields never written, even when mismarked as AI-populatable |
| Authorization | Live mode refusing every protected permission; a demo identity never satisfying it; the escape hatch being off unless exactly `true`, warning once, and doing nothing in demo mode |
| Document lifecycle | Retry vs re-index flag, encoded ids, server reasons surfaced, a failed delete never removing the document locally |
| Log redaction | Every credential shape stripped; long content truncated; cause chains dropped |
| Rate limiting | Limit, countdown, window reset, per-key isolation |
| Chat failure states | Each failure mapped to the right kind, and `retryable` correct per kind |
| Admin health mapping | Problem outranking configured; demo mode not alarming; security warnings not contradicting each other |
| No-secret-leak | The health payload carrying names only |

What the tests deliberately do **not** claim: that Supabase or Claude work.
Those need credentials.

---

## Future integrations

Each appears on the Integrations screen with an honest status. Exactly one is
connected: browser storage.

| Integration | Purpose | What it needs |
| --- | --- | --- |
| **Claude (Anthropic)** | Live grounded answers, form drafting, video matching | An API key, set server-side |
| **Microsoft SharePoint** | Sync approved company documents into the library | Entra ID app registration, Graph permission scoped to the approved library |
| **Microsoft Power BI** | Embed existing dashboards inside Reports & Analytics | A Power BI workspace and Microsoft access. Reports arrive as Excel files today |
| **Google Business Profile** | Automatic review counts and ratings | API access plus location ownership verification. Nothing is scraped |
| **Woven** | Where documents live today | No confirmed bulk export or public API yet; webhooks may exist, their support contact will confirm. Only an approved subset should ever be ingested |
| **Email / Microsoft 365** | Follow-up reminders, sharing generated forms | Mail send permission |
| **Local prototype storage** | Working uploads and persistence with no server | Nothing — connected |

### SharePoint specifically

`src/lib/knowledge/providers/sharepoint.ts` is a typed stub whose methods
throw. It documents the whole plan: register the app, scope the permission to
one approved library, enumerate files as `KnowledgeDocument` records with
`source: "sharepoint"`, and run changed files through the same ingestion
pipeline the upload path uses — so a SharePoint document and an uploaded one are
indistinguishable at retrieval time.

### Google Reviews specifically

"Reviews gained this week" is currently produced by opening every location's
Google listing, writing down the total, and subtracting last week's total. The
Google Reviews screen calculates it instead. Connecting the Google Business
Profile API makes those pulls automatic; reviews gained is simply the difference
between two pulls.

---

## Production migration plan

### Done in code

1. ~~Git repository~~ — done.
2. ~~Production Knowledge Base storage~~ — `SupabaseStorageProvider` written.
3. ~~Document parsing / chunking~~ — PDF, DOCX and TXT with page and section
   labels preserved for citations.
4. ~~Claude API~~ — `ClaudeProvider` plus `/api/chat`.
5. ~~Vector retrieval~~ — embeddings and pgvector, with `match_knowledge_chunks`.
6. ~~Citations~~ — real retrieval results feed the existing `SourceCitation`
   plumbing. The UI did not change.

None of items 2–6 has been run against a real service. See
[Built but not yet connected](#built-but-not-yet-connected).

### Blocked on accounts the client owns

7. **Hosting / project ownership** — the client creates the hosting account
   (Vercel, Hetzner, or similar) so the project is owned by JBA from day one.
8. **Supabase project** — created by the client with JBA as owner, then
   `supabase db push` applies the migrations in `supabase/migrations/`.
9. **API credentials** — an Anthropic key, server-side. Embeddings need none:
   they run inside the Supabase project.

### Still to build

10. **Authentication** — individual logins for every person, likely Microsoft
    Entra ID or Supabase Auth. Per-salon accounts sign in under salon emails.
    Replace `src/lib/session/`; leave profile data untouched. **Until this
    lands, the API routes are unauthenticated and must not be exposed on a
    public deployment with a live knowledge base behind them.**
11. **SharePoint synchronization** — scheduled sync or change notifications over
    the approved library only.
12. **Form persistence / PDF generation** — move generated forms to the database
    and render into the official fillable PDFs.
13. **Power BI** — embed dashboards once Microsoft access is available.
14. **Google Reviews** — Google Business Profile API, replacing the manual count.
15. **Audit logs / monitoring** — who asked what, who changed which document,
    who created which form; plus error and cost monitoring.

Note: the client will create the hosting and database accounts when sent a setup
guide, so steps 7–9 are theirs to action.

---

## Future roadmap

Not built in this phase, listed so nothing is lost:

- **Best Practices** — unfinished in the reference platform and explicitly
  deprioritised by the client. Not built. Recorded here only.
- **Video transcription** — will let Sunny answer from what is said inside a
  video, not only from its metadata. `transcriptStatus` already exists on every
  video record.
- **File attachments in chat** — attach a PDF, Daily Stats export, Word or Excel
  file that stays in context for the rest of the conversation. Shown as a
  disabled affordance today, never as something that works.
- **Voice input.**
- **Real PDF generation** for saved forms (print styling works today).
- **Email follow-up reminders.**
- **Admin-managed Manager Resources** — the tiles are already modelled as data
  rather than hard-coded links.

---

## A note on demo content

Every policy excerpt, metric, review, employee name and salon name in this
repository is fictional demo content written for the prototype, and is labelled
as such throughout the UI. Nothing here represents real Sun Tan City policy or
real salon performance.
