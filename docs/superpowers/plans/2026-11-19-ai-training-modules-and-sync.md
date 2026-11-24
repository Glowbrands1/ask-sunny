# AI Training: modules and cross-app publish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editors can create a module from the lesson editor, and can opt in on each save to publish the same lesson/module/page change to the sibling app (Ask Sunny ↔ Ask Bubbles).

**Architecture:** The sending app, after its own save, reads the saved rows (with parent track and module) in the importer's snake_case shape and POSTs them to the other app's `/api/ai-training/sync`. The receiver checks a shared bearer key and that the actor is on its own editor list, validates with the existing `parseImportFiles`, and upserts with the existing `importRows` (parents first). Built in Ask Sunny, then ported to Ask Bubbles as one commit per task.

**Tech Stack:** Next.js App Router (read `node_modules/next/dist/docs/` before writing a route handler), Supabase JS admin client, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-11-19-ai-training-modules-and-sync-design.md`

## Global Constraints

- Only `canEditAiTraining(identity)` (`src/lib/ai-training/editors.ts`) may create modules or publish across apps — on the sender AND the receiver.
- Env vars: `AI_TRAINING_SYNC_URL` (other app's base URL, no trailing slash), `AI_TRAINING_SYNC_KEY` (min 24 chars, same value in both apps). Either unset → the box is hidden and the route answers 404.
- Deletes, lesson reordering (`moveLessonAction`), submissions and reviews never cross apps.
- The local save never fails because of the other app.
- Checkbox labels: Sunny "Also publish to Ask Bubbles", Bubbles "Also publish to Ask Sunny"; starts unticked; last choice kept in `localStorage` key `ai-training:publish-to-other`, every access in try/catch.
- Failure copy: `Saved here, but not published to <Other app>: <reason>`.
- Repos are public: no real emails in code, tests or fixtures (use `@example.com`).

## Review Focus

- The other app has a *different* lesson with the same track + web address → receiver returns 409 with "another lesson in this track already uses that web address"; sender shows it in the failure copy. (Test in Task 3.)
- The other app is down or slow → push times out at 10 s, local save still reported as saved. (Test in Task 2.)
- A lesson in "No module" is published → payload has `modules: []`, receiver must not fail on a null `module_id`. (Test in Task 2.)
- "+ New module…" chosen but name left as just `Module 6: ` or blank → "Module name" required error, nothing saved. (Test in Task 1.)
- Editor on Sunny's list but not on Bubbles' list → receiver 403 "not an AI Training editor in Ask Bubbles". (Test in Task 3.)

---

### Task 1: "+ New module…" in the lesson editor; module panel on top

**Files:**
- Modify: `src/lib/ai-training/repository.ts` (`saveModule` returns `Promise<string>`: the id, new or existing; insert uses `.select("id").single()`)
- Modify: `src/features/ai-training/actions.ts` (`saveLessonAction` input gains `newModuleTitle?: string | null`)
- Modify: `src/features/ai-training/lesson-editor.tsx`
- Modify: `src/features/ai-training/manage-screen.tsx` (render `<Modules>` above the lesson groups instead of after them)
- Create: `src/lib/ai-training/module-name.ts`
- Test: `src/lib/ai-training/ai-training.test.ts`, `src/features/ai-training/lesson-editor.dom.test.tsx` (create)

**Interfaces:**
- Produces: `nextModuleName(modules: { adminOnly: boolean }[]): string` → `"Module N: "` where N = non-admin-only count + 1. `saveModule(...): Promise<string>`.
- `saveLessonAction`: when `newModuleTitle` is a string, validate with `textField(newModuleTitle, "Module name", 300)` and also reject a title that is only `Module <n>:` with nothing after; create the module in `trackId` (adminOnly false), then save the lesson with that module id.

- [ ] **Step 1: Failing tests**
  - `nextModuleName([{adminOnly:false}×5, {adminOnly:true}])` → `"Module 6: "`; `nextModuleName([])` → `"Module 1: "`.
  - DOM test: the Module select lists `+ New module…` last; choosing it shows a textbox labelled "New module name" with value `Module N: `; choosing an existing module hides it.
  - Source test (same style as existing): `saveLessonAction` body contains `newModuleTitle` and calls `saveModule(null,` before `saveLesson(`.
- [ ] **Step 2:** `npx vitest run src/lib/ai-training src/features/ai-training` → the new tests FAIL.
- [ ] **Step 3:** Implement. Select value for the new option: `"__new__"`; send `moduleId: null, newModuleTitle` when chosen.
- [ ] **Step 4:** Same command → PASS; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Commit `AI Training: create a module from the lesson editor`.

### Task 2: Sender — bundle the saved rows and push them

**Files:**
- Create: `src/lib/ai-training/sync.ts` (pure + fetch; no Next imports)
- Modify: `src/lib/ai-training/repository.ts` (add bundle reader)
- Modify: `src/features/ai-training/actions.ts`
- Test: `src/lib/ai-training/sync.test.ts`

**Interfaces:**
- `export interface SyncBundle { actorEmail: string; tracks: Raw[]; modules: Raw[]; lessons: Raw[]; content_pages: Raw[] }` (snake_case DB columns, the keys `parseImportFiles` reads).
- `syncConfig(env = process.env): { url: string; key: string; otherAppName: string } | null` — null when either var is missing or key < 24 chars. `otherAppName` from `AI_TRAINING_SYNC_APP_NAME` (default `"the other app"`; set "Ask Bubbles"/"Ask Sunny" in Vercel).
- `pushToOtherApp(bundle: SyncBundle, cfg, fetchImpl = fetch): Promise<{ ok: true } | { ok: false; reason: string }>` — POST `${url}/api/ai-training/sync`, JSON body, `Authorization: Bearer ${key}`, `AbortSignal.timeout(10_000)`; non-2xx → reason from response JSON `error`, else `HTTP <status>`; network/timeout → `"it could not be reached"`.
- Repository: `loadSyncBundle(target: { lessonId?: string; moduleId?: string; pageKey?: string }): Promise<Omit<SyncBundle, "actorEmail">>` — lesson → its track, its module (if any), the lesson; module → its track and the module; page → the page row.
- Actions: `saveLessonAction`, `setLessonStatusAction`, `saveModuleAction`, `savePageAction` gain `publishToOther?: boolean`. After the local save: if true and `syncConfig()` set, push; on failure return `{ ok: true, value, warning: "Saved here, but not published to <name>: <reason>" }`. Extend `ActionResult` ok-branch with optional `warning?: string`. Also export `syncAvailable(): Promise<{ otherAppName: string } | null>` (editor-only) for the UI.

- [ ] **Step 1: Failing tests** (`sync.test.ts`, fake fetch):
  - `syncConfig({})` → null; key of 10 chars → null; valid → object.
  - push sends the bearer header and the bundle; 409 `{error:"x"}` → `{ok:false, reason:"x"}`; fetch rejecting → `"it could not be reached"`; fetch never resolving with fake timers past 10 s → same reason.
  - Bundle with `modules: []` and a lesson with `module_id: null` round-trips through `parseImportFiles` with no problems.
- [ ] **Step 2:** `npx vitest run src/lib/ai-training/sync.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS + tsc clean. Existing source test "checks every Server Function's caller" still passes.
- [ ] **Step 5:** Commit `AI Training: publish a saved change to the other app (sender)`.

### Task 3: Receiver — `/api/ai-training/sync`

**Files:**
- Create: `src/app/api/ai-training/sync/route.ts` (`POST` only, `export const dynamic = "force-dynamic"`)
- Create: `src/lib/ai-training/sync-receive.ts` (`receiveSync(request, deps)`, testable without Next)
- Test: `src/lib/ai-training/sync-receive.test.ts`

**Interfaces:**
- `receiveSync(req: { headers: Headers; json(): Promise<unknown> }, deps: { config: ReturnType<typeof syncConfig>; editors: string[]; importRows: typeof importRows }): Promise<{ status: number; body: { ok: true; counts: Record<string, number> } | { error: string } }>`
- Order: config null → 404 `{error:"not found"}`; bearer missing/wrong (constant-time compare of SHA-256 digests via `node:crypto` `timingSafeEqual`) → 401; `actorEmail` not in `editors` → 403 `"not an AI Training editor in <this app>"`; `parseImportFiles([{ name: "sync.json", text: JSON.stringify(body) }])` with problems → 400 joined problems; body over 1 MB → 413; upsert tracks → modules → lessons → pages; a thrown error whose message contains "duplicate" or code 23505 → 409 `"another lesson in this track already uses that web address"` (module clash: `"a module with that name already exists"`); else 500 generic.
- Route: wires `syncConfig()`, `aiTrainingEditorEmails()`, `importRows`, returns `Response.json(body, { status })`. Not under `middleware` (it excludes `/api`).

- [ ] **Step 1: Failing tests:** each status above with fakes; upsert call order is tracks, modules, lessons, pages; editor match ignores case.
- [ ] **Step 2:** `npx vitest run src/lib/ai-training/sync-receive.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; add `"ai-training/sync"` to whatever public-API inventory test lists unauthenticated routes, if one fails (comment why).
- [ ] **Step 5:** Commit `AI Training: receive a published change from the other app`.

### Task 4: The checkbox in the UI

**Files:**
- Create: `src/features/ai-training/publish-to-other.tsx` (`usePublishToOther(): [boolean, (v: boolean) => void]` with the localStorage key; `<PublishToOtherBox otherAppName checked onChange />`)
- Modify: `lesson-editor.tsx` (next to Save), `manage-screen.tsx` (module add/rename row, page editor, publish/unpublish button), page routes pass `syncAvailable()` result down as `otherAppName: string | null`.
- Test: `src/features/ai-training/publish-to-other.dom.test.tsx`

- [ ] **Step 1: Failing tests:** box hidden when `otherAppName` null; label `Also publish to Ask Bubbles`; unticked by default; ticking persists across remount; localStorage throwing still renders unticked; a result with `warning` shows the warning text and not an error style.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement, passing `publishToOther` into each action. **Step 4:** PASS, lint, tsc.
- [ ] **Step 5:** Commit `AI Training: "Also publish to the other app" box`.

### Task 5: Config, docs, port, ship

- [ ] Add the three vars to `.env.example` (comments, no values). Generate one 48-char random key; set `AI_TRAINING_SYNC_KEY`, `AI_TRAINING_SYNC_URL`, `AI_TRAINING_SYNC_APP_NAME` on Vercel `ask-sunny` (URL `https://askbubbles.vercel.app`, name "Ask Bubbles") and `askbubbles` (URL `https://ask-sunny.vercel.app`, name "Ask Sunny"), Production + Preview, type encrypted.
- [ ] `npm run lint`, `npx tsc --noEmit -p .`, touched tests; push; open Sunny PR.
- [ ] Port each commit to Ask Bubbles (`Port from Ask Sunny (<sha>): …`), same checks, open PR; cross-link both.
- [ ] After merge + deploy: live round trip with a **draft** lesson titled `Sync test – delete me` published Sunny → Bubbles, check it appears in Bubbles Manage, then delete it in each app. Confirm counts back to 53 lessons in both DBs.
