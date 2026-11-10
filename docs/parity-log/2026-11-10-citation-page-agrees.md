## 10 Nov 2026: CITATION_PAGE_AGREES_ENABLED stays Ask Sunny only

QA's ruling (b), 10 Nov 2026: a cash-drawer / register-shortage Corrective Action card
cites the Standards of Conduct on p.13 everywhere. In this app, with production's flags
and the slot model reading the heading "Standards of Conduct" (as live), the card read
"**Standards of Conduct** (page 13)" on its Policy line and "Standards of Conduct Policy,
JBA Policy Manual p.12" under it. The flag makes the citation line take the Policy line's
page on a CA card for a shortage only; Sales / MSB cards keep p.12.

Ask Bubbles was checked on `main` 37dc1b8 through the real chat route (temporary replay
cases, production's flags, the same invented person and wording: "create a corrective
action for Corwin Ashgrove, his cash drawer was short $20 on 11/3", with and without the
slot model's heading). Its CA card says "**Policy:** this reads as **Standards of
Conduct** — cash handling" with no page and prints no "… JBA Policy Manual p.N" citation
line, so there is no second page to disagree with. Not ported; the mechanism
(`shortagePolicyPage` in `ai/form-card-slots.ts`) ports as is if Bubbles' card ever
gains a paged citation line.
