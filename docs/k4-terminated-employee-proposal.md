# K4 — exit forms for people Woven marks terminated (proposal, no code change)

**Status:** proposal for Pau. Nothing here is built. `src/lib/ai/form-proposal.ts`
is protected; QA asked for the exact diff before any edit.

## What happens today

- Woven sync **does** store people who have left: `employee_access_directory`
  holds 15 `terminated` rows in Ask Sunny and 4 in Ask Bubbles (26 Oct 2026).
- `scopeRoster` (`src/lib/forms/employee-roster.ts:79`) drops every
  `terminated` row, so the person an exit form is *for* is never on the
  roster the name check reads.
- On an exit form the name check therefore says: *"I didn't find **Name** in
  the employee list for your salons, so the form will use the name exactly as
  you typed it. Check the spelling before you file it."*, and the salon is
  not taken from Woven.

## Plain-language options

1. **Leave it** (today): the exit form is still offered with the typed name
   and a spelling note. The note is misleading: the person *is* in Woven, as
   terminated.
2. **Recommended:** on Resignation/Exit forms only, when the typed name is not
   on the active roster, look it up among the Woven people marked terminated
   (same salon scope). If found, use their Woven name and salon and show
   *"Marked terminated in Woven."* instead of the spelling note. If not found,
   keep today's note. Coaching, Corrective Action and every other form keep
   today's behaviour. Behind `EXIT_TERMINATED_EMPLOYEE_ENABLED`, default off.
3. Like 2, but also ask the manager to confirm the name once when nobody
   matches at all (a typo guard).

## The diff option 2 needs (`src/lib/ai/form-proposal.ts`, lines 1047–1052)

Before:
```ts
  if (result.kind === "none") {
    if (typedNameProceedsEnabled()) return {};
    return { note: `I didn't find **${…}** in the employee list for your salons, …` };
  }
```
After:
```ts
  if (result.kind === "none") {
    const left = exitTerminatedEmployeeEnabled() && EXIT_TEMPLATES.has(match.key)
      ? await findTerminatedEmployee(typed.employeeName, input.actor.scope) : null;
    if (left) return { resolution: { kind: "resolved", employeeName: left.name }, salonIds: left.salonIds, note: "Marked terminated in Woven." };
    if (typedNameProceedsEnabled()) return {};
    return { note: `I didn't find **${…}** in the employee list for your salons, …` };
  }
```
Plus, outside the protected file: `findTerminatedEmployee` in
`src/lib/forms/employee-roster.ts` (reads the same directory rows,
`employment_status = 'terminated'`, same scope rules as `scopeRoster`), and
the flag. Ask Bubbles gets the same change in its own `form-proposal.ts` (also
protected there).

## How it would be proven

A regression test with QA's wording ("Can you create an exit form for me?" /
a pasted block: name, Tanning Consultant, NE Kearney, "Gave notice -
fulfilled notice", "Gave notice 9/25/26 - date notice fulfilled 10/9/26",
"Resigning to pursue other career options", "Store items returned payroll
deduction does not apply eligible for rehire"), an invented name planted as
a terminated directory row, flag off (today's note) and on (the Woven name,
the salon, "Marked terminated in Woven."), and a Coaching Form for the same
person that keeps today's note.
