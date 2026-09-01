import type { ReactNode } from "react";

/**
 * THE STAKEHOLDER-REVIEW GATE RENDERS OUTSIDE THE APPLICATION SHELL.
 *
 * This route group exists for exactly one page. Putting it under `(app)` would
 * wrap the password prompt in `AppShell`, which renders the prototype's own
 * demo login screen over anything it wraps until a demo session exists — so a
 * reviewer sent here by the middleware would be shown "Sign in to Ask Sunny"
 * and never see the review prompt at all.
 *
 * The two doors are unrelated and must not be nested: this one decides whether
 * the reporting deployment may be reached at all, the shell's decides which
 * demo role the prototype presents.
 *
 * TEMPORARY, with the rest of the gate; see `lib/reporting-review/gate.ts`.
 */
export default function ReviewGateLayout({ children }: { children: ReactNode }) {
  return <div id="main">{children}</div>;
}
