# Proposal: the app's own reminder lines are not a new request

Status: **waiting for Pau's approval. Nothing here is applied.** `src/lib/ai/form-proposal.ts` is a protected file; this page only describes the change.

Approve? **STORED_SLOTS_NOT_A_REQUEST: yes / no**

## The problem, in three sentences

When a manager answers a follow-up question on a Corrective Action ("no payroll deduct"), the app quietly puts a few reminder lines in front of that answer: "The form is the Corrective Action Form. The employee is … Policy reference: Standards of Conduct, JBA Policy Manual p.12." The part of `form-proposal.ts` that decides which messages belong to this form reads those reminder lines as if the manager had typed a brand-new request for the same employee, so it starts the form over from that short answer. The card then loses what the manager said earlier: the prior coaching disappears (tester's chat, 26 Oct 2026), and a draft created from that card would hold only "no payroll deduct" instead of the incident.

## What changes

Only when the new flag `STORED_SLOTS_NOT_A_REQUEST_ENABLED` is on (it ships off):

- When the app decides "is this message a new request for this form?", it looks at **what the manager typed**, without the app's own reminder lines. The app already has a helper that does exactly this (`managerWords`, used for edit requests today).
- The messages themselves are not changed or removed; only the "is this a new request?" check reads the manager's words.

The proposed edit is in one function, `turnsAboutThisForm` (around line 1645):

```diff
@@ src/lib/ai/form-proposal.ts
-import { payrollAmountFieldEnabled, typedNameProceedsEnabled } from "@/lib/config/chat-quality-flags";
+import {
+  payrollAmountFieldEnabled,
+  storedSlotsNotARequestEnabled,
+  typedNameProceedsEnabled,
+} from "@/lib/config/chat-quality-flags";
+import { managerWords } from "./edit-date-rules";
@@ function turnsAboutThisForm(
-  context.messages.forEach((message, index) => {
-    const intent = detectTemplateIntent(message.content);
+  context.messages.forEach((message, index) => {
+    // STORED_SLOTS_NOT_A_REQUEST_ENABLED: the app's reminder lines are not the manager's request.
+    const said = storedSlotsNotARequestEnabled() ? managerWords(message.content) : message.content;
+    const intent = detectTemplateIntent(said);
@@
-        statesHistoryOnly(message.content, businessToday()));
+        statesHistoryOnly(said, businessToday()));
@@
-    const names = options.answers?.has(message.content.trim()) ? [] : extractEmployeeNames(message.content);
+    const names = options.answers?.has(message.content.trim()) ? [] : extractEmployeeNames(said);
@@
-    if (forThisEmployee && requestAt < 0 && afterAnotherPerson && start < index && !correctsTheEmployee(message.content)) {
+    if (forThisEmployee && requestAt < 0 && afterAnotherPerson && start < index && !correctsTheEmployee(said)) {
@@
-      (describesIncident(message.content) ||
-        describesMoreThanTheRequest(message.content, { ignore: [employeeName ?? ""] }))
+      (describesIncident(said) ||
+        describesMoreThanTheRequest(said, { ignore: [employeeName ?? ""] }))
```

Plus the flag itself: one small function at the end of `src/lib/config/chat-quality-flags.ts` and its entry in `src/lib/ai/flags-off-parity.test.ts`, the same as every other new flag. The same change, with the same flag name, would be ported to Ask Bubbles only if Bubbles has the same problem (to be checked; its main form path is different).

## What stays the same

- **With the flag off (as it ships): nothing changes at all.** `said` is exactly the message as today.
- With the flag on, a message the manager actually typed is read exactly as before. The only difference is for messages that carry the app's reminder lines.
- A real second request still starts a new form: "create a ca for Test Employee for a register shortage" after an earlier CA for Test Employee still starts over (District Manager rule, 21 Oct 2026).
- A request for a different employee still starts that employee's own form, and keeps the first employee's answers out of it.
- No other file in the protected list is touched.

## How it would be tested

A new test file, every turn through the real chat route (`POST /api/chat`), with invented names, each case in lowercase and Sentence case:

1. **The reported chat:** request, then "prior coaching JBA Policy Manual 7-29-26", then "no payroll deduct". With the flag on, the card keeps the prior coaching and the incident; the draft notes keep the incident. With the flag off, the card is exactly as today (the bug is pinned, so we can see the flag is what fixes it).
2. **NEVER-BREAK, a real new request:** a second "create a ca for <same employee> for a register shortage" still starts a new form, flag on and off.
3. **NEVER-BREAK, another employee:** a request for a different person still starts that person's form and carries nothing over, flag on and off.
4. **NEVER-BREAK, same employee, new incident:** "create another corrective action for <same employee> for being late on 10-20" starts a new form.
5. **Flag off == today:** every existing test in the chat and forms suites passes unchanged with the flag off; the flags-off parity check covers the new flag.

The change would merge on its own (it touches a live path when switched on), with a green test pack after it, and the flag stays off until a live test round with it on.
