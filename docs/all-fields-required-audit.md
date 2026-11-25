# Every field filled before approval — audit (25 Nov 2026)

Pau's request, in his words:

> Can you please update all forms so that they cannot submit for approval if all field are not filled out?
> for the box with previous coaching/ca, if none found add N/A QA and audit first pls before making everything
> required, of course signature is not required for approval, we do it by hand in person

The change ships **behind `ALL_FIELDS_REQUIRED_ENABLED`, off**, so QA can run through this audit first and then flip
it (Vercel production, then `src/config/production-flags.json` in the same pull request). Nothing changes for anyone
until then.

## What the audit found before changing anything

1. **The only "required" check today is off in production.** Revision 9 of the Corrective Action Form marks its two
   history boxes `required`, but the check runs only with `REQUIRED_FIELDS_AT_FINALIZE_ENABLED`, which is **off** in
   production. So today every form, the Corrective Action included, can be sent for approval with every line blank.
2. **"Required" was a mark on a published version.** Marking every field that way would need a new revision of every
   form, would be held back on any form an administrator has edited, and would not reach drafts already open on
   an older version. The new rule is the code's instead: it reaches every version and every open draft.
3. **Some lines cannot be filled in the app at all.** Lines marked FILLED BY HAND (the DMIT EPP's self-assessment)
   are refused when a person saves them. Requiring them would make those forms impossible to send. They are done on
   paper, in person, like the signatures.
4. **Some lines only apply after another answer** (the payroll amount only when payroll deduct is Yes; the Other
   topic only when Other is ticked; the exit form's notice dates only when notice was fulfilled).
5. **The EPPs' Re-Evaluation section is filled at the re-evaluation**, weeks after the plan is issued. Requiring it on
   the first send would block every EPP.

## The rule (with the flag on)

Finalize, and "Finalize and send for approval", are refused while anything the form's creator fills is blank, and the
refusal names what is blank (the first eight, then "and N more"). The form stays a draft the manager can fix.
On the form card it is a pop-up, not an error line (Pau, 25 Nov 2026): it says why (HR receives a complete record;
signatures are signed by hand, in person), lists the blank fields, and "Show me the blank fields" closes it onto the
first one. Each blank field is outlined in red and marked Required until it is filled.

| Part of a form | Counts as filled when |
| --- | --- |
| A line (text, long text, date) | it has any text |
| A tick list (Type of Warning, Yes / No, …) | at least one box is ticked |
| A numbered list ("top three strengths") | every numbered line has text |
| An expectation checklist | every row is marked one way or the other |
| A plan-of-action table (TSD EPP) | every row has a plan |

**Never asked for:** signatures (signed by hand, in person); lines FILLED BY HAND; lines the employee writes on their
own section; the Re-Evaluation section (asked for when the form is a re-evaluation); the EPP appendix's "Relevant JBA
Policy" (blank when no manual section applies); "New Location, if applicable"; tick lists where no tick is itself the
answer (interview "Qualities to observe", the walkthrough ✔ / X column, the exit form's "Submitted & Fulfilled Notice").

**Asked for only after another answer:** Payroll deduction amount (payroll deduct Yes); Coaching "Other" (Other
ticked); exit notice dates (notice submitted and fulfilled); exit resignation type (notice not fulfilled).

**The previous coaching / CA box** (Corrective Action, "List previous coaching and corrective actions …") never
blocks: when it is still blank at Finalize or send for approval — no step the manager stated and no form on file the
draft found — the app writes **N/A** into it (recorded as the app's, `no_prior_actions_found`). A history already in
the box is never touched. If a step is added later (for example after HR sends it back), the N/A line is dropped.

## Decisions (Pau, 25 Nov 2026)

- **Exit form "Additional Details"** is optional ("Should it be optional? - yes").
- **Interview "Update In Careerplug"** is required (one box, "Yes": the interviewer confirms it was done). Confirmed.
- **Expectation checklists** need every row marked; a row can no longer be left as "not evaluated yet". Confirmed.
- **EPP figures:** an EPP cannot be sent without the productivity figures. Where an EPP has its own figure lines
  (PPTA, LPSVA, UPTA, …), those lines are required and the "figures, as provided" box beside them is not; an EPP with
  only one productivity box requires that box. Confirmed.
- **Interview "Qualities to observe"** are not required (a candidate may show none).
- **Coaching forms** (Coaching, Follow-Up Coaching) finalize without HR; they are held to the same rule at Finalize.

## QA checklist (flag on, preview)

1. Corrective Action with nothing filled → "Finalize and send for approval" is refused and names the blank lines;
   the form stays a draft and HR is not notified.
2. Fill everything but leave the previous coaching / CA box empty → it is sent; the box reads **N/A**.
3. Payroll deduct **No** → no amount asked; **Yes** with no amount → refused, naming "Payroll deduction amount".
4. Coaching Form with Other ticked and the Other line blank → refused; untick Other → sent.
5. An EPP with the Re-Evaluation section blank → sent; "Re-evaluate" it and send with the section blank → refused.
6. Signatures are never named in a refusal, on any form.
7. Flag off → every form sends exactly as before.

## Form by form (generated from the code)

Each form lists what must be filled and what is not asked for, and why. Regenerate after any change to the forms.

### Coaching Form (`coaching`)

**Must be filled (7):** Name; Date; Job Title; Location; Type of Coaching; Topic of Coaching; Details of Coaching

**Not required:**
- Other — asked only when coaching_topics is other
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### Corrective Action Form (`dpoa`)

**Must be filled (13):** Employee Name; Date; Job Title; Location; Type of Warning; List date of JBA policy manual signed by employee; List previous coaching and corrective actions and include date signed by employee in past 90 days; Type of Offense; Observation of Offense; Policy Violated; Direct policy from official manual; Action Plan; Is payroll deduct applicable?

**Not required:**
- Payroll deduction amount — asked only when payroll_deduct is yes
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### Policy Review (`policy-review`)

**Must be filled (10):** Employee Name; Date; Job Title; Location; Type; Topic; Observation; Policy Violated; Direct policy from official manual; Plan of Action

**Not required:**
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### SDIT EPP (`sdit-epp`)

**Must be filled (19):** Employee Name; Date; Job Title; Location; SDIT expectations; In what areas is the SDIT currently succeeding?; In what areas does the SDIT currently need improvement?; Overall top three strengths; Overall two biggest areas of improvement; Salon's current productivity — PPTA; Salon's current productivity — LPSVA; Salon's current productivity — UPTA; SDIT's personal productivity — PPTA; SDIT's personal productivity — LPSVA; SDIT's personal productivity — UPTA; Self review; Salon Goals: current top three goals; Plan, objectives and goals; Training Salon Director and SDIT will meet and re-evaluate the week of

**Not required:**
- Salon figures, as provided — figures given on the form's own lines (asked only on a form without them)
- SDIT figures, as provided — figures given on the form's own lines (asked only on a form without them)
- Your expectations — written by the employee, in person
- What are your overall top strengths? — written by the employee, in person
- What are your overall biggest areas of improvement? — written by the employee, in person
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Which objectives were met? — Re-Evaluation section: asked on the re-evaluation
- Plan of Action — Re-Evaluation section: asked on the re-evaluation
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Relevant JBA Policy — the appendix's policy line is left blank when no section of the manual applies

### TSD EPP (`tsd-epp`)

**Must be filled (28):** Employee Name; Date; Job Title; Location; In what areas is the manager currently succeeding?; In what areas does the manager currently need improvement?; Management expectations; What are the manager's overall top three strengths?; What are the manager's overall two biggest areas of improvement?; Manager's current productivity — PPTA; Manager's current productivity — LPSVA; Manager's current productivity — UPTA; Manager's current productivity — Club Close; Manager's current productivity — Average Club Dollar; Salon's current productivity — PPTA; Salon's current productivity — LPSVA; Salon's current productivity — UPTA; Salon's current productivity — Club Close; Salon's current productivity — Average Club Dollar; Plan of Action — Bench; Plan of Action — Management Bench; Plan of Action — Personal Primary Productivity; Plan of Action — Salon Primary Productivity; Plan of Action — Salon Secondary Productivity; Plan of Action — Coaching and Development; Plan of Action — District Outreach; Plan of Action — Salon Standards of Cleanliness and Safety; Manager and Supervisor will meet and re-evaluate the week of

**Not required:**
- Manager figures, as provided — figures given on the form's own lines (asked only on a form without them)
- Salon figures, as provided — figures given on the form's own lines (asked only on a form without them)
- What do you feel is the most important skill for a Salon Director to possess? — written by the employee, in person
- In what areas do you feel you are currently succeeding, and where do you need improvement? — written by the employee, in person
- What are your overall top three strengths? — written by the employee, in person
- What are your overall two biggest areas of improvement? — written by the employee, in person
- Salon Goals: what are your salon's current top three goals? — written by the employee, in person
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Which objectives were met? — Re-Evaluation section: asked on the re-evaluation
- Objectives — Re-Evaluation section: asked on the re-evaluation
- Plan of Action — Re-Evaluation section: asked on the re-evaluation
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Relevant JBA Policy — the appendix's policy line is left blank when no section of the manual applies

### ASD-SDIT Performance EPP (`asd-sdit-epp`)

**Must be filled (14):** Employee Name; Date; Job Title; Location; In what areas is the ASD currently succeeding?; In what areas does the ASD currently need improvement?; Overall top three strengths; Overall two biggest areas of improvement; ASD's current productivity; Salon's current productivity; Self review; Salon Goals: current top three goals; Plan, objectives and goals; Training Salon Director and ASD will meet and re-evaluate the week of

**Not required:**
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### FTTC Performance EPP (`fttc-epp`)

**Must be filled (14):** Employee Name; Date; Job Title; Location; In what areas is the TC currently succeeding?; In what areas does the TC currently need improvement?; Overall top three strengths; Overall two biggest areas of improvement; TC's current productivity; Salon's current productivity; Self review; Salon Goals: current top three goals; Plan, objectives and goals; Salon Director and TC will meet and re-evaluate the week of

**Not required:**
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### DMIT EPP — TSD Review (`dmit-epp-tsd`)

**Must be filled (12):** Employee Name; Date; Job Title; Location; In what areas is the TSD currently succeeding?; In what areas does the TSD currently need improvement?; What are the TSD's overall top three strengths?; What are the TSD's overall two biggest areas of improvement?; District Manager's current productivity; Salon's current productivity; Plan, objectives and goals; District Manager and TSD will meet and re-evaluate the week of

**Not required:**
- What do you feel is the most important skill for a District Manager to possess? — filled by hand, in person
- In what areas do you feel you are currently succeeding? — filled by hand, in person
- In what areas do you feel you need improvement? — filled by hand, in person
- What are your overall top three strengths? — filled by hand, in person
- What are your overall two biggest areas of improvement? — filled by hand, in person
- Salon Goals: What are your salon's current top three goals? — filled by hand, in person
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Which objectives were met? — Re-Evaluation section: asked on the re-evaluation
- Plan of Action — Re-Evaluation section: asked on the re-evaluation
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### DMIT EPP — DMIT Review (`dmit-epp-dmit`)

**Must be filled (12):** Employee Name; Date; Job Title; Location; In what areas is the TSD currently succeeding?; In what areas does the TSD currently need improvement?; What are the TSD's overall top three strengths?; What are the TSD's overall two biggest areas of improvement?; District Manager's current productivity; Salon's current productivity; Plan, objectives and goals; District Manager and TSD will meet and re-evaluate the week of

**Not required:**
- What do you feel is the most important skill for a District Manager to possess? — filled by hand, in person
- In what areas do you feel you are currently succeeding? — filled by hand, in person
- In what areas do you feel you need improvement? — filled by hand, in person
- What are your overall top three strengths? — filled by hand, in person
- What are your overall two biggest areas of improvement? — filled by hand, in person
- Salon Goals: What are your salon's current top three goals? — filled by hand, in person
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Which objectives were met? — Re-Evaluation section: asked on the re-evaluation
- Plan of Action — Re-Evaluation section: asked on the re-evaluation
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person

### Follow-Up Coaching Form (`follow-up-coaching`)

**Must be filled (8):** Original Coaching Topic; Original Expectation; Follow-Up Observation; Progress Level; Specific Evidence; Additional Coaching Completed; Next Step; Next Follow-Up

**Not required:**


### Resignation/Exit Form (`stc-exit`)

**Must be filled (17):** Name; Date; Job Title; Location; Permanent Address; Last Day Worked; Resignation Details; All store items were returned; Salon key was returned; Is Payroll Deduction applicable? *; *Do they forfeit their bonus?; *Are they to be dropped to minimum wage?; Written notice attached?; Is this employee eligible for rehire?; Resignation Date; How Employee Resigned; Reason for Resignation

**Not required:**
- Additional Details — optional on the exit form (Pau, 25 Nov 2026)
- Resignation Details — no tick is an answer: resignation_type is asked for instead
- Date that notice was given — asked only when resignation_notice is submitted_fulfilled_notice
- Date that notice was fulfilled — asked only when resignation_notice is submitted_fulfilled_notice
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- District Manager/Witness Signature (when required) — signed by hand, in person

### Demotion Form (`demotion`)

**Must be filled (11):** Employee Name; Date; Employment Status; Job Title; Location; Rate of Pay; New Job Title; New Employment Status; New Rate of Pay; Type of Demotion; Please provide a brief summary/ reason for demotion

**Not required:**
- New Location, if applicable — the form says "if applicable"
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Witness Signature — signed by hand, in person

### Position Transfer Form (`position-transfer`)

**Must be filled (11):** Employee Name; Date; Employment Status; Job Title; Location; Rate of Pay; New Job Title; New Employment Status; New Pay Rate; Type of Transfer; Please provide a brief summary / reason for transfer

**Not required:**
- New Location, if applicable — the form says "if applicable"
- Employee Signature — signed by hand, in person
- Supervisor Signature — signed by hand, in person
- Witness Signature — signed by hand, in person

### Prescreen / Phone Interview Form (`prescreen-phone-interview`)

**Must be filled (8):** Applicant Name; Date; Position Applied For; Are you at least 18 years old?; Why are you interested in working for Sun Tan City?; Are you willing to use our services as part of your Sun Tan City uniform? (Must agree to UV, Sunless and Spa usage to proceed with employment); Previous Work Experience; Availability

**Not required:**
- Interviewer Signature — signed by hand, in person

### Tanning Consultant Interview Form (`tanning-consultant-interview`)

**Must be filled (19):** Applicant Name; Date; Interviewed By; Salon Name; Notes — 1. Tell me about yourself and why you’re interested in wo…; Notes — 2. Can you walk me through your resume and highlight your…; Notes — 3. Describe your availability and any scheduling restrict…; Notes — 4. Describe a time you delivered excellent customer servi…; Notes — 5. Think back to a busy day when you were helping several…; Notes — 6. This role includes recommending products and services…; Notes — 7. Give me an example of a time you were accountable for…; Notes — 8. Our company has five core values. Id like to hear abou…; Notes — 9. Give me an example of a time when you and a teammate d…; Notes — 10. Give me an example of when you faced a challenge with…; Notes — 11. What skills or experiences make you confident you’ll…; Notes — 12. This position requires key functions such as standing…; Closing; Final Recommendation; Update In Careerplug

**Not required:**
- Qualities to Observe Throughout Interview — no tick is an answer: none of these qualities were seen

### First Round Management Interview Form (`management-interview-round-1`)

**Must be filled (27):** Applicant Name; Date; Interviewed By; Salon Name; Notes — How did your professional journey lead you here, and wher…; Notes — Can you walk me through your resume and highlight your mo…; Notes — Can you share one or two accomplishments you’re most prou…; Notes — Confirm Pay/Salary expectations & schedule availability:; Notes — Describe a time you successfully built and motivated a te…; Notes — Tell me about a time when you had to have a difficult con…; Notes — Give me an example of when you took initiative on somethi…; Notes — Everyone responds differently to leadership styles. What…; Notes — How do you drive sales performance while maintaining exce…; Notes — What were your sales targets in your last position? How c…; Notes — Tell me about a time you turned an unhappy client into a…; Notes — What systems or processes have you used to manage staffin…; Notes — This role involves hands-on work like cleaning beds and d…; Notes — How do you ensure your team is consistently trained to me…; Notes — A client approaches the counter upset because the tanning…; Notes — Why should we select you for this position?; Cleanliness & organization; Equipment maintenance & safety; Client service interactions; Staff engagement & leadership presence; Sales focus & promotions; Final Recommendation; Update In Careerplug

**Not required:**
- Qualities to Observe Throughout Interview — no tick is an answer: none of these qualities were seen
- Qualities to Observe Throughout Interview & Walkthrough — no tick is an answer: none of these qualities were seen
- ✔ / X — the column is ✔ / X: an unticked line is the X

### Second Round Management Interview Form (`management-interview-round-2`)

**Must be filled (18):** Applicant Name; Date; Interviewed By; Salon Name; Notes — After going through the interview process so far, how wou…; Notes — Based on what you know now, what skills or qualities do y…; Notes — Confirm Salary Expectations and Availability:; Notes — Describe your approach to setting and communicating perfo…; Notes — How do you identify and develop future leaders within you…; Notes — How do you ensure all team members follow company policie…; Notes — If you were given direction as a Salon Director to reduce…; Notes — Tell me about a time you used performance results or key…; Notes — Scenario 1: Let’s pretend that during your walkthrough in…; Notes — Scenario 2: Customer visits have dropped 20% over the pas…; Notes — How would you create a 30–60–90 day training plan for a n…; Notes — How do you follow up to ensure training is being applied…; Final Recommendation; Update In Careerplug

**Not required:**

