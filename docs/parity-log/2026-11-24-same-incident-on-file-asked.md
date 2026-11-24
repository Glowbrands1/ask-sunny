# A card for an incident already on file is asked about, and waits (port of Ask Bubbles #1123, 24 Nov 2026)

**Report (Pau's review, 23 Nov 2026, via QA):** an employee had two finalized Corrective Actions for one incident date (a
no-show on 11/18) and a third draft; the AI never said one already existed. Ask Bubbles fixed it in #1123 (5b6d9a7) and
left a parity entry saying Sunny's port was pending. The owner asked for it on 24 Nov 2026.

**Ported (Ask Sunny, agent loop), with Bubbles' names:**
- `src/lib/forms/same-incident.ts`: `formsOnFileSameDay`, `sameDayOnFileQuestion`.
- `propose_form` (`src/lib/ai/agent-loop/tools.ts`): `sameDayFormsOnFile`. A Corrective Action or Coaching card whose
  person (roster id) already has that form on file for the card's incident date makes no card (`reason_code:
  same_incident_on_file`). The reply ends with "<P> already has a Corrective Action for 11/18 (finalized 11/19). Do you
  want to open that one, or is this a separate incident?". `separate_incident_evidence` (the manager's words) builds the
  card.
- The record `slots.agent_loop.same_incident` (`SameIncidentSlot` / `SameIncidentRecord`, `sameIncidentRecords`, a
  request start in `requestStarts`), `sameIncidentChecked` on the card record, and the rules-book line.
- Create's last gate (`src/app/api/forms/instances/route.ts`, 409 `same_incident_on_file`) through
  `settled-names.ts` (`sameIncidentKinds`, `sameIncidentChecked`).

**Not ported:** Bubbles' dateless-copy branch (a card with no date checked against the form `read_form` read). Sunny's
`read_form` keeps no `formsRead` record (Bubbles' U16 copy feature). Create's last gate still checks the date the form is
saved with.

**Added in Sunny, and in Ask Bubbles in the same session (owner, 24 Nov 2026):** a draft waiting for HR approval is
named "waiting for HR approval" in the question, not "a draft" (`withHr` in `same-incident.ts`). It is never called
filed or finalized. That form is only seen by its creator and HR, so another manager is never told it exists.

**Cases:** `src/app/api/chat/replay-pack/nov24-agent-loop-same-incident-on-file-cases.ts`. The finalized, draft,
with-HR and Create-gate cases fail before the port. The separate-incident answer, other-date and Create-after-separate
controls pass both before and after.
