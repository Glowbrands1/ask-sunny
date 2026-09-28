# Woven knowledge content → Ask Sunny: design note (not implemented)

**Status: design only. Nothing is built, and nothing should be built until Woven
confirms a supported API for this content.**

## What exists in Woven

The Sun Tan City / JB & Associates tenant holds:

- Policies
- Procedures
- a File Library
- Learning content
- Communications

The team app shows all of them. No Operations API endpoint has been confirmed
for any of them. The only product in the API portal is the Operations API,
whose confirmed surface is employees.

## The rule: supported API or nothing

**No scraping.** Ask Sunny will not drive the Woven UI, reuse a browser session,
or parse rendered pages to extract documents. That approach:

- breaks without notice;
- needs a person's credentials to act as a machine;
- cannot respect Woven's own permissions on each item;
- and is very likely outside the tenant's terms.

The Google review work shows the cost: an extension that scrapes what a person
already sees is now the fallback, not the design.

## What the portal does and does not establish

The API portal lists **one product, the Operations API**.

Its learning-configuration endpoints, native-video endpoints, and course or
practical completion webhook events concern learning *administration and
progress*. None of them is an API for the **content** of:
- published Policies;
- Procedures (SOPs);
- File Library documents;
- lesson or course content.

Ask Sunny will not build knowledge ingestion on them. Completion events are
also personal learning records, not general knowledge, and belong outside the
knowledge base.

The tenant's own numbers, from the team-app audit:
- **Policies:** 22, all Published, some with PDF attachments and versions.
- **File Library:** 647 entries, with Published or Unpublished status, audience, tags and history. Some are shared from the Sun Tan City brand.
- **Procedures:** by category (General Operations, Maintenance, Safety, Training), with location scope and assigned positions.
- **Learning authoring:** Draft items only.

## Questions for Woven support, before any build

1. **Scope of products.** Is there any supported API, in the Operations API or another product, for published Policies, Procedures (SOPs), File Library items, and lesson or course content? What is it called, is it licensed separately, and can this tenant subscribe?
2. **Listing.** Can it list items with a stable id, title, category or library, tags, publish state (Published, Unpublished, Draft), version or history id, and last-updated time? Can it filter to Published only?
3. **Content.** Can it return the body text of a policy or procedure, and download attachments and File Library files (PDF, DOCX)? Or only metadata and a link? Is a UI "direct URL" a supported, authenticated download for an API user?
4. **Audience.** Does each item expose its intended audience (team, position, location)? Does the API enforce that audience for the calling user?
5. **Brand-shared content.** Are brand-shared files (from Sun Tan City, outside this account's sharing control) included, and are there terms on redistributing them into another system?
6. **Changes.** Is there a modified-since filter or change feed for content? Are there webhooks for publish, update, unpublish and retire, and not only course or practical completions? What are the payload, authentication, retries and delivery guarantees?
7. **Learning endpoints.** Do the learning-configuration or native-video endpoints expose lesson text, transcripts or video files for published training, or only configuration and progress?
8. **Limits.** What are the rate limits and pagination for content endpoints, and does the existing subscription key cover them?
9. **Service user.** Can the same dedicated, read-only application user be scoped to "published, company-wide content" only?

**Content that needs item-by-item approval even if an API exists:**
- Direct Deposit Authorization;
- bonus and pay policies;
- personal leave policies;
- anything tied to an individual, such as acknowledgements, learning progress or completions.

## If a supported API exists: the shape it would take

It would reuse what Ask Sunny already has rather than add a parallel system.

- **Source value.** `knowledge_documents.source` already has a `woven` enum value (`20260829000200_knowledge_schema.sql`) and a `DocumentSource` type, reserved for this. Nothing reads or writes it today.
- **Selective, not the whole library.** The existing integrations note records 600+ documents, of which "only a focused subset should ever be ingested". Ingestion would be an allowlist of Woven categories or items that an administrator approves, never "everything".
- **Same ingestion pipeline.** Downloaded files would go through the existing upload → extract → chunk → embed path (`src/lib/ingestion`, the `embed` Edge Function), so citations, re-indexing and access checks behave exactly as for uploaded documents.
- **Identity and change.** Each Woven item would map to one `knowledge_documents` row keyed on the Woven item id. A newer modified date or version triggers re-ingestion. A retired or unpublished item is archived, not deleted, following the supersession discipline used in reporting.
- **Scheduling.** A Vercel Cron route beside the employee sync, behind its own `WOVEN_KNOWLEDGE_SYNC_ENABLED` switch, reusing the same `WovenClient` (token, pacing, retries) and the `employee_sync_runs`-style run ledger pattern.
- **Visibility.** Only content Woven marks company-wide and published is ingested until per-item visibility can be carried into Ask Sunny's own access model. Ask Sunny must never show a document to someone Woven would not.

## If no supported API exists

- Keep the current state: Ask Sunny links out to Woven for training (`NEXT_PUBLIC_WOVEN_TRAINING_URL`).
- For documents Ask Sunny needs to answer questions from, an administrator uploads an approved export through the existing Knowledge Base upload, with `source = upload`. This is manual, auditable and within terms.
