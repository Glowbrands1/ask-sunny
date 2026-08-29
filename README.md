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
13. [Future integrations](#future-integrations)
14. [Production migration plan](#production-migration-plan)
15. [Future roadmap](#future-roadmap)

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

Copy `.env.example` to `.env.local` before running. Both values ship ready to
use — `ANTHROPIC_API_KEY` is intentionally empty and the app runs fine without
it.

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

### Intentionally deferred

No database, no production authentication, no password storage, no Anthropic API
call, no embeddings or vector store, no video transcription, no SharePoint /
Woven / Power BI / Google / Microsoft 365 connection, no server infrastructure,
no deployment, no paid dependencies. Each has a seam; none has a stub that
pretends to work.

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

Three interfaces carry everything the prototype defers:

| Interface | Today | Later |
| --- | --- | --- |
| `AIProvider` | `MockAIProvider` | `ClaudeProvider` |
| `KnowledgeProvider` | `LocalKnowledgeProvider` | vector retrieval service |
| `StorageProvider` | `LocalPrototypeStorageProvider` | `SupabaseStorageProvider`, `SharePointStorageProvider` |

Each is resolved in exactly one place (`getAIProvider()`,
`getKnowledgeProvider()`, `getStorageProvider()`), so swapping an implementation
is a change to a single function.

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

**To move to Supabase:** implement `SupabaseStorageProvider` against the same
interface and return it from `getStorageProvider()`. No Knowledge Base, Videos or
Forms component changes.

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

### How uploads connect to answers later

The upload path already produces the record the pipeline will consume:

```
uploaded document
     │
     ├─▶ text extraction     (pdf-parse / mammoth / sheetjs / plain text)
     ├─▶ chunking            (~800 tokens, ~15% overlap, keep page/section
     │                        labels so citations stay precise)
     ├─▶ embeddings          (an embedding model, batched)
     ├─▶ vector storage      (pgvector on Supabase, or a managed vector DB)
     │
     └─▶ retrieval at question time
              └─▶ top-k chunks + document/locator metadata
                       └─▶ sent to Claude as grounding context
                                └─▶ answer + SourceCitation[] rendered as
                                    source cards (already built)
```

`KnowledgeDocument` already carries `status`, `indexed`, `version`,
`previousVersions` and `source`, and `KnowledgeChunk` already has an optional
`embedding` field. `SourceCitation` and the `SourceCard` component do not change
— only what produces them.

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

### Where Claude plugs in

Create `src/lib/ai/claude-provider.ts` implementing `AIProvider`, then extend
`getAIProvider()`. The full sketch is in the comment block at the top of
`src/lib/ai/index.ts`. In outline:

1. Retrieve grounding context through the `KnowledgeProvider`.
2. POST to an internal route handler (`src/app/api/chat/route.ts`) — **never**
   call Anthropic from the browser and never expose `ANTHROPIC_API_KEY` to the
   client. The handler reads the key from `process.env` server-side and calls the
   Messages API with: a system prompt carrying Sunny's role, tone and the
   standing manager note; the retrieved chunks labelled with document title and
   locator; the conversation history; an answer-length instruction derived from
   the answer mode; and a tool definition for the form handoff so the model
   returns structured values rather than prose.
3. Map the response back into `AskResponse`.

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

`.env.example`:

```
# Future — leave empty. Server-only; never exposed to the browser.
ANTHROPIC_API_KEY=

# Demo mode — when true, the login screen offers direct "Preview demo" access.
NEXT_PUBLIC_DEMO_MODE=true
```

The app **must** run with `ANTHROPIC_API_KEY` empty; `MockAIProvider` is used
whenever it is absent. No other variables are required in this phase.

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

In this order:

1. **Git repository** — put the code under version control.
2. **Hosting / project ownership** — the client creates the hosting account
   (Vercel, Hetzner, or similar) so the project is owned by JBA from day one.
3. **Supabase or the selected database/storage** — created by the client, with
   JBA as owner.
4. **Authentication** — individual logins for every person, likely Microsoft
   Entra ID or Supabase Auth. Per-salon accounts sign in under salon emails.
   Replace `src/lib/session/`; leave profile data untouched.
5. **Production Knowledge Base storage** — implement `SupabaseStorageProvider`
   and return it from `getStorageProvider()`.
6. **Document parsing / chunking** — text extraction and chunking on upload,
   preserving page and section labels for citations.
7. **Claude API** — implement `ClaudeProvider` plus the server route handler.
8. **Vector retrieval** — embeddings and a vector store (pgvector or managed);
   replace `LocalKnowledgeProvider`.
9. **Citations** — wire real retrieval results into the existing
   `SourceCitation` plumbing. The UI does not change.
10. **SharePoint synchronization** — scheduled sync or change notifications over
    the approved library only.
11. **Form persistence / PDF generation** — move generated forms to the database
    and render into the official fillable PDFs.
12. **Power BI** — embed dashboards once Microsoft access is available.
13. **Google Reviews** — Google Business Profile API, replacing the manual count.
14. **Audit logs / monitoring** — who asked what, who changed which document,
    who created which form; plus error and cost monitoring.

Note: the client will create the hosting and database accounts when sent a setup
guide, so steps 2 and 3 are theirs to action.

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
