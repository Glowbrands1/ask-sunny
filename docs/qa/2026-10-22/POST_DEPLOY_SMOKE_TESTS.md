# Ask Sunny — post-deployment smoke tests (full release, pull request #129)

**Setup**
- Run these on production right after the deploy.
- Use **synthetic test accounts only**: a Salon Director assigned to two salons, an Assistant Salon Director, an Employee, a District Manager and an admin.
- Use a synthetic employee who does **not** exist in the directory (e.g. "pat rivera").

**Data handling**
- Create **drafts only**. Never finalize a form.
- Delete each test draft afterwards, or leave it for HR to discard.
- Do not open, edit or correct any real employee's form.

**Rollback:** if any check marked ✱ fails, redeploy the previous production deployment from Vercel (`ask-sunny`, the deployment of `main` `49e5be9`, PR #127). No migration is involved, so rollback is a redeploy only.

| # | As | Type / do | Expected |
|---|---|---|---|
| 1 ✱ | Salon Director | "create coaching form for pat rivera, late 3 times this week", then "i already told you", then "today" | One Coaching card for **pat rivera** (spelling as typed) stays open across all three turns; no form picker |
| 2 ✱ | Salon Director | Reload the page | The same conversation (`?c=` in the address) and the open card come back |
| 3 ✱ | Salon Director | A form for pat rivera, then reply with a salon this account is **not** assigned to | Salon left blank and asked; employee unchanged |
| 4 ✱ | Salon Director | Card location choice | Only the account's own salons are offered |
| 5 ✱ | admin | "coaching form for pat rivera at salon 307" | No salon filled in; the card asks between **NE Grand Island** and **KS Shawnee Mission Pkwy**; answering "0307" fills NE Grand Island |
| 6 ✱ | Salon Director | "create a verbal ca for pat rivera, late today. we will not payroll deduct $25" | Card: payroll **No** |
| 7 ✱ | Salon Director | "… payroll deduct $25" → Create draft → "we cancelled the $25 payroll deduction" | The draft's payroll answer becomes **No**; the Action Plan has no deduction sentence |
| 8 ✱ | Salon Director | "… maybe payroll deduct $25" | Payroll **not** answered; the card asks Yes or No |
| 9 ✱ | Assistant Salon Director, then Employee | Open chat | No "Create a form" control; a form request gets no form card |
| 10 ✱ | District Manager | Ask for a coaching form | No salon filled in, and the form cannot be created (fail-closed, unchanged) |
| 11 | Salon Director | "write a coaching form for pat rivera, dated 10/20" | Employee **pat rivera** (not "pat rivera dated"); form date 10/20 |
| 12 | any | Delete a conversation; finalize nothing | Delete asks for confirmation first |

Record for each check: the time, the account (role only), pass or fail, and a screenshot of the card. The browser versions of checks 1–8 ran 12/12 on a disposable local stack before release (`evidence/`).
