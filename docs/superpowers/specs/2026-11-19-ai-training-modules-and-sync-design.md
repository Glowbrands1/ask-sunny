# AI Training: easier modules and "publish to the other app"

Approved by the client 2026-11-19. Ask Sunny and Ask Bubbles both carry the same
AI Training content (imported from the old Lovable app with the same ids). The
four named editors (`AI_TRAINING_EDITOR_EMAILS`, #1108 / Bubbles #963) want to
create modules without hunting for the control, and to push an edit made in one
app to the other when they choose.

## Goals
- From the lesson editor, create a new module ("Module 6: …") without leaving it.
- Make the module controls easy to find on Manage → Lessons.
- When saving content, optionally publish the same change to the other app, both directions.

## Non-goals / anti-goals
- No automatic sync. Nothing reaches the other app unless the editor ticks the box.
- Deletes never cross apps (a slip must not remove content from both).
- Reordering with the up/down arrows does not cross apps.
- Submissions and reviews never cross apps.
- Nobody outside the editor list can create modules or publish across apps.

## Approaches considered
1. **Opt-in "Also publish to <other app>" box on each save (chosen).** One click, both directions, the editor decides each time.
2. Fully automatic sync of every edit. Rejected: a mistake or test lesson lands in both apps; the client said "only when editing".
3. Export / Import buttons. Rejected: manual, copies everything rather than one change.

## Design

### Modules
- Lesson editor Module select gains **"+ New module…"**. Choosing it shows a name input pre-filled `Module N: ` (N = number of non-archive modules in the track + 1). On Save the module is created first, then the lesson is saved into it.
- Manage → Lessons: the "Modules in this track" panel moves above the lesson list.

### Cross-app publish
- A checkbox **"Also publish to Ask Bubbles"** (Sunny) / **"Also publish to Ask Sunny"** (Bubbles) next to: lesson Save, lesson Publish/Unpublish, module add/rename, page Save. Starts unticked; remembers the editor's last choice in the browser (per-viewer convenience only).
- Sending app: after its own save succeeds, it POSTs the saved rows to `<AI_TRAINING_SYNC_URL>/api/ai-training/sync` with header `Authorization: Bearer <AI_TRAINING_SYNC_KEY>`. A lesson is sent with its track and module so parents exist on the other side. Payload: `{ actorEmail, tracks[], modules[], lessons[], pages[] }` in the shape of the importer's rows.
- Receiving route: constant-time compares the key (missing key = feature off, 404), checks `actorEmail` is on **its own** `AI_TRAINING_EDITOR_EMAILS`, validates rows with the existing import row rules, upserts parents before children (by id; pages by key) through `importRows`.
- The local save never fails because of the other app. The result says "Saved here, but not published to Ask Bubbles: <reason>" when the push fails.
- Config, per Vercel project: `AI_TRAINING_SYNC_URL` (the other app's base URL), `AI_TRAINING_SYNC_KEY` (same random value in both). Unset = the box is hidden.

## Left to the builder
- Exact placement and wording of the checkbox per screen; timeouts (short, ~10 s).
- Error text for a slug clash on the other side (another lesson already uses that web address in that track).

## Testing
- Unit: "+ New module…" flow; route refuses missing/wrong key and non-editors; parents-before-children order; local save succeeds when the push fails.
- Live: one draft test lesson published Sunny → Bubbles, checked, then deleted in each app.
