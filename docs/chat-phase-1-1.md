# Phase 1.1 — Chat cleanup + Knowledge preview / re-download

Branch: `feature/chat-native-forms-marissa-feedback`
Started from: `f31aacb`
Status: **implemented, automated gate green, Preview QA outstanding.**

Three requests from Paulyne's manual Preview review. **No forms behaviour, no
Supabase schema change, no migration, no chat-persistence change, nothing
deployed, nothing merged.** The Knowledge bucket stays private.

---

## A — Chat source material removed

There were **two** source surfaces, not one:

1. `message-bubble.tsx` — a heading plus a card per excerpt under every grounded
   answer (document title, page locator, category, excerpt preview).
2. `context-panel.tsx` — **"Sources for this answer"** in the right-hand rail,
   rendering the same material a second time.

Phase 1 touched neither. Removing only the first would have left the request
half-done, and the rail is the one whose heading Paulyne quoted.

Both are gone. Not collapsed, not behind a "View sources" affordance, not
reduced to a count badge — each of those would be a smaller version of the thing
that was asked to go.

**The grounding backend is untouched.** `citations` are still produced by
retrieval, still returned by `/api/chat`, still carried on `ChatMessage`, still
stored. Ranking, embeddings, vector search, policy grounding, coverage and the
insufficient-coverage notice are all unchanged — and the notice is explicitly
tested, because it is Sunny telling a manager that what they just read is general
guidance rather than company policy, and it would have been easy to lose along
with the bibliography.

`SourceCard` / `SourceCardList` are **kept as dormant infrastructure**. Nothing
renders them now; the component and its tests remain for whenever sources come
back in a different shape.

## B — "Coming later" controls: root cause

**They are not in the code, and were not at `f31aacb`.** A whole-repository
search for `Paperclip`, `ImagePlus`, `Mic`, `Coming later`, `Attach a file`,
`Attach an image` and `Voice input` finds, outside tests:

| Match | What it is |
|---|---|
| `composer.tsx:36` | A comment describing what Phase 1 removed |
| `integrations-screen.tsx:155` | `"Configure (coming later)"` — the **admin Integrations** screen, not chat |
| `data/demo/chat.ts:315` | `**Coming later**` inside the body of a **demo answer** about video transcription — prose, not a control, and demo-mode only |

There is exactly **one** composer, one chat screen, and no mobile-specific chat
component.

**Most likely cause: the screenshot is of a different branch's Preview.** Phase 1
shipped on `feature/chat-native-forms-marissa-feedback`; earlier sessions worked
against `ask-sunny-git-feature-ask-sunny-forms-templat-…` — the
`feature/ask-sunny-forms-template-engine` Preview, which is at `22e63da` and
contains no Phase 1 work. Opening the familiar URL would show exactly the
composer described.

**This is not proven.** `list_projects` returns an empty array for the Glo Brands
Vercel team through this connection, so no deployment can be matched to a SHA
from here. What is proven is the code claim.

**Nothing was changed to "fix" this** — correct code must not be edited to
reproduce a stale screenshot. Instead the requirement is now pinned across the
whole chat feature, so a second surface reintroducing it fails a test.

## C / D — Knowledge Base: download original and preview

### The defect

`DocumentDetail` rendered its download button only when `document.blobKey` was
set — a field **only IndexedDB prototype uploads carry**; `rowToDocument` never
sets it. So on a real, Supabase-stored document the button did not render and the
panel said:

> "This is a seeded demo record, so there is no file to download."

about a file the manager had uploaded minutes earlier. Not merely unhelpful —
false. And the row's overflow menu offered only *View details* and *Delete*.

### What was built

**`src/lib/knowledge/original-file.ts`** — resolves a short-lived signed URL for
the current version's stored original.

**`GET /api/knowledge/documents/[id]/file?scope=…&mode=download|preview`** —
returns `{ url, fileName, fileType, mimeType, previewable, expiresInSeconds }`
with `cache-control: no-store`.

Signed URL rather than streaming bytes, matching `/api/videos/[id]/playback`: the
bucket stays private, Supabase serves the object with range requests intact, and
a 50 MB PDF does not travel through a serverless function sized for JSON.

**UI** — Preview and Download original in the row overflow menu **and** in the
detail panel, both live-mode only.

### Authorization: `view_knowledge`

The permission the Knowledge Base page itself already requires. The library
listing already returns every document's title, category, size and uploader to
anybody holding it, and retrieval goes further — a grounded answer quotes the
document's own words. Being able to open the file grants nothing new.
`manage_knowledge` stays what it is: upload, re-index, delete. **No permission
was created or broadened.**

**A finding worth stating plainly:** *every* role in the current matrix holds
`view_knowledge`, Employee included. So permission is not what refuses anyone
here — **authentication and scope are**, and both are tested. A test records this
so the next reader is not misled, and a separate test proves the route refuses a
role that lacks the permission, so the boundary works when a restricted role is
eventually added.

### Remediation 1 — the corpus is the build's, not the caller's

**Independent QA found an Important authorization gap in the route as first
shipped, and it was real.** The route read the knowledge corpus from `?scope=`
and validated only that the value was *shaped* like a scope id. `bcs-core` is
shaped like one because it **is** one — `src/lib/brand/index.ts:53` defines Beach
Comber Suns alongside Sun Tan City.

So an authenticated Sun Tan City manager, holding `view_knowledge` legitimately,
could request a Beach Comber Suns document by id with `?scope=bcs-core` and be
handed a signed URL for another company's file. `authorizeRequest` did not stop
it and was never going to: it proves *who* the caller is and *what* they may do,
not *which* company's corpus this deployment serves.

**The first suite missed it because the fixture made the attack inexpressible.**
Only the Sun Tan City row was seeded, so a foreign document id matched nothing
whatever the route did with the scope — the "cross-scope" test passed for the
wrong reason.

**Fixed:** `scopeId` is `ACTIVE_BRAND.knowledgeScopeId`, read from the build.
`?scope=` is not read, not validated and not consulted — it is no longer an input
at all. The client stopped sending it too, and the now-meaningless `scopeId` prop
was removed from `DocumentFileActions` and `DocumentDetail`: a value a client
keeps sending is a value somebody eventually starts trusting again.

**Not derived from `AccessScope`.** Salon, district and region scope describe
which locations a manager covers *inside* one brand; the knowledge corpus is the
brand. Conflating them would break the moment a second brand shipped.

**Proof it was exploitable:** with the fix reverted, the adversarial test's
request for the foreign document returns **200** — the foreign row is found and a
signed URL is minted. With the fix, 404 and nothing signed.

### The security boundary

- The browser sends a **document id, a scope and a mode**. There is no parameter
  for a storage path, and a `path=` smuggled into the query string is ignored —
  tested.
- The row is selected on **`id` AND `knowledge_scope_id` together**, so editing
  the id in a URL returns nothing rather than another corpus's document. The test
  harness enforces the same rule, so a route that dropped the scope filter fails.
- The path read off the row is **re-validated** with `assertPathWithinScope`
  before signing — a row edited outside this app must not become a way out of its
  scope.
- Failures never echo a storage path, a bucket name, a provider error or the
  secret key.

### Preview: PDF only, and no pretending

| Type | Behaviour |
|---|---|
| **PDF** | Embedded `<object>` of the signed URL, plus "Open in a new tab" and "Download original" |
| **DOCX, TXT, MD, anything else** | "Preview isn't available for this file type" + Download original |

**Why `<object>` rather than `<iframe>`.** Desktop browsers render a PDF inline
from a signed URL well, and that is what "let me see what I uploaded" means.
Mobile Safari and several Android browsers **do not** — blank frame, one page, or
a download prompt. `<object>` children render exactly when the embed cannot, so
the fallback is structural rather than a guess. The same two controls also sit
outside the embed, so the mobile path is not something a person has to discover.

**No CSP blocks it** — `next.config.ts` sets no `frame-src`, verified.

**Extracted text is never rendered as a preview.** It would be easy and it would
be a lie: the extraction is a retrieval artefact with no layout, tables or
signatures, and a manager checking "did the right file upload" would be shown
something that is not the file. A test asserts the service never touches
`knowledge_chunks`, `character_count` or the extractor.

### Version behaviour

`storage_path` on the row **is** the current version's object — `buildStoragePath`
puts the version in the path and every upload rewrites the column. So Preview and
Download both act on the current version, with no version parameter.

Earlier versions' objects still exist under the same document prefix (which is
how `deleteDocument` sweeps them). Historical download is therefore *possible*
later, but it needs a deliberate, separately authorized feature — the detail
panel lists earlier versions as metadata only, and nothing today associates a
version number with its object path outside the delete sweep. Not added.

---

## Files changed

| File | Change |
|---|---|
| `src/features/chat/message-bubble.tsx` | Source block and its heading helper removed |
| `src/features/chat/context-panel.tsx` | "Sources for this answer" section removed |
| `src/lib/knowledge/original-file.ts` | **New** — signed-URL service |
| `src/app/api/knowledge/documents/[id]/file/route.ts` | **New** — the route |
| `src/features/knowledge/document-file-actions.tsx` | **New** — actions + preview dialog |
| `src/features/knowledge/lifecycle-service.ts` | `documentFileLink` added |
| `src/features/knowledge/document-detail.tsx` | Real download replaces the `blobKey` branch |
| `src/features/knowledge/knowledge-screen.tsx` | Row menu gains Preview / Download original |
| 4 test files | New / extended |

**Not changed:** upload processing, extraction, chunking, embeddings, indexing,
version creation, reindex, search, citations, deletion semantics, chat
persistence, the `ChatMessage` model, forms, location authorization.

## Verification

**Suite: 2363 passed, 7 skipped, 119 files** — up from 2305/7/116. The increase is
the 58 new tests; no existing test was modified except `chat-layout.test.ts`,
which was extended. `tsc --noEmit`, `eslint` and `next build` all clean.

### Mutation checks

| Mutation | Failed |
|---|---|
| Restore `SourceCardList` in chat | **3** |
| Restore a "Coming later" attachment control | **7** |
| Remove authorization from the download route | **4** |
| Trust a browser-supplied storage path | **2** |
| Read extracted text in the preview service | **1** |
| Mark DOCX previewable | **1** |
| Render an unsupported type as an embed anyway | **1** |
| **Remediation 1:** read the corpus from `?scope=` again | **5** |

**One defective test was found and corrected by this process.** The first version
of "renders no source heading" used `expect(textContent).not.toMatch(/\bSources?\b/i)`
and **passed against a bubble that was rendering the heading**: `textContent`
concatenates adjacent nodes without separators, so the heading arrives inside
`...bodySources1Attendance...` where no word boundary exists. It now matches
plain substrings and asserts the eyebrow element is absent, and fails under the
mutation as it should.

## Preview QA still required

Not observed by a person. jsdom proves none of it.

**Chat** — source block gone on a real grounded answer; no attachment controls;
answers, follow-ups and the not-covered notice still look right.

**Knowledge, desktop** — the row action is obvious; Preview shows the *actual*
uploaded PDF; Download saves the real file under its own name; closing the
preview returns to the same filters and scroll position.

**Knowledge, mobile** — row menu reachable; preview fits the viewport with no
horizontal page overflow; **the `<object>` fallback path on iOS Safari**, which is
the case most likely to differ from desktop; download usable.

**File types** — PDF previews; a DOCX shows the fallback and still downloads.

## Out-of-scope findings

1. **`data/demo/chat.ts:315`** carries `**Coming later**` inside a demo answer
   about video transcription. Demo-mode prose, not a control, and factually true.
   Left alone; belongs to the deferred demo/live copy phase.
2. **`integrations-screen.tsx:155`** — `"Configure (coming later)"` in the admin
   Integrations screen. Explicitly out of scope; not chat.
3. **`GET /api/knowledge/documents` authorizes `ask_questions`**, not
   `view_knowledge`, to list the library. Probably an oversight — the page needs
   `view_knowledge` — but every role holds both today, so it changes nothing in
   practice. Not touched: it is an existing route outside this brief.
4. **The same caller-supplied-corpus pattern exists on four pre-existing knowledge
   routes**, found while remediating this one and deliberately not changed:

   | Route | Reads corpus from |
   |---|---|
   | `GET /api/knowledge/documents` | `?scope=` |
   | `DELETE /api/knowledge/documents/[id]` | `?scope=` |
   | `POST /api/knowledge/documents/[id]/reindex` | `body.scopeId` |
   | `POST /api/knowledge/search` | `body.scopeId` |

   All four predate Phase 1.1 and the remediation brief says to close only the
   newly introduced boundary, so they are reported rather than fixed. **The
   DELETE one deserves attention first:** it is the same shape as the gap just
   closed, on a destructive action rather than a read.
