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

## Questions for Woven, before any build

1. Is there an API, or an endpoint in the Operations API or another product, that lists Policies, Procedures, File Library items and Learning content? Can it filter by category, audience or location?
2. Does each item carry a stable id, a version or modified date, and a published or retired state?
3. Can the file itself be downloaded (PDF, DOCX), or only its metadata and link?
4. Does the API respect per-item visibility (location, role), and can a service identity be scoped to "company-wide, published" only?
5. Are there webhooks for publish, update and retire, or does it have to be polled?
6. What are the rate limits, and is it covered by the existing subscription or a new product?

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
