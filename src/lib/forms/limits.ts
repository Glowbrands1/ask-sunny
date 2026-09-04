/**
 * FIELD LIMITS THAT BOTH SIDES OF THE SERVER BOUNDARY HAVE TO AGREE ON.
 *
 * A PLAIN MODULE, DELIBERATELY. No `"use client"`, no `import "server-only"`.
 *
 * That is the whole reason this file exists. The employee-name cap started life
 * as an export from `create-form-flow.tsx`, which carries `"use client"` — and
 * a client module's NON-COMPONENT exports become client *references* when a
 * server component imports them. The value is not the number on that side, so
 *
 *     params.employee?.slice(0, EMPLOYEE_NAME_MAX)
 *
 * ran as `slice(0, 0)` inside the server-rendered page and handed the screen an
 * empty string. The chat handoff carried the name correctly in the URL, the
 * template arrived, the "carried over from your conversation" notice appeared —
 * and the Employee field was blank. Typecheck was clean and the component's own
 * tests passed, because nothing in them crossed the boundary.
 *
 * So: anything read on BOTH sides lives here, where it is really a number.
 */

/**
 * How long an employee name may be.
 *
 * The `form_instances.employee_name` column is plain `text` with no limit, so
 * this is a product decision rather than a constraint being mirrored. It has to
 * be one number because three places apply it — the input's `maxLength`, the
 * chat handoff writing the name into a URL, and the page reading it back out —
 * and three independent 120s would drift.
 *
 * 120 is generous for "Firstname Lastname (test)" and short enough that the
 * name still fits on the rule it prints on.
 */
export const EMPLOYEE_NAME_MAX = 120;
