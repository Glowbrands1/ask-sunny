## 11 Nov 2026: the app's own lines are no account on the full remap — Ask Sunny only (REMAP_APP_LINES_NOT_ACCOUNT_ENABLED, default off)

QA's S1, from the open-cases audit: `nov5-coding3-ca-offer-yes-no-account-remap`. On the full remap with REMAP_INCIDENT_FIX off, `statedIncident` read the manager's turn with the app's line appended to it ("The employee is <name>. Job title: …. It happened at <salon>."). With the name and salon taken out, the no-account Corrective Action card's What happened was "The employee is . Job title: Tanning Consultant. It happened". With the flag on, the app's lines are left out before the account is read (`ai/form-full-remap.ts`). The full remap (FORM_FULL_REMAP) is off in production.

Not needed in Ask Bubbles. Its `statedIncident` under MANAGER_WORDS_ONLY (on in production there) skips every clause that names the employee or a store (`namesOrPlacesThem`), so the app's line is never read as the account. The same case is "fixed" there.
