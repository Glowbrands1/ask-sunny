# Ask Sunny — rules for every session

Ask Sunny (JB & Associates / Sun Tan City) has a sibling app, **Ask Bubbles**
(`Glowbrands1/Ask-bubbles`, Buff City Soap). Bubbles is a port of this app:
the chat, the forms intake, the Corrective Action engine, policy citation,
access and Woven sync are the same code with different company data. A bug
found in one app is almost always in the other.

## 1. Every fix is checked against Ask Bubbles

Before finishing any change to chat, forms, Corrective Action, policy
citation, access/auth, knowledge sync or Woven:

1. Check whether Ask Bubbles has the same bug. Ask for `Glowbrands1/Ask-bubbles`
   to be added to the session if it is not attached.
2. Either port the fix there in the same session (one commit per fix,
   `Port from Ask Sunny (<sha>): …`), or add a line to
   `docs/parity-log.md` saying why it stays Sunny-only.
3. The pull request description says which: **Sibling app: ported in <PR> /
   not needed because …**.

Name mapping when porting: Sunny ↔ Bubbles, salon ↔ store, Form Monitoring ↔
Forms Register. Both apps cite the **JBA Policy Manual** (Bubbles reads it as
Buff City Soap) — never rename manual titles, retrieval depends on them.
Never copy one company's content (policies, job titles, salon/store names,
nicknames, Sun Tan City / Buff City Soap wording) into the other — port the
mechanism.

## 2. Every bug report becomes a test

When a manager, HR or QA reports a chat or form problem, add a regression test
that uses **their exact wording** (see `src/app/api/forms/hr-feedback-oct21-e2e.test.ts`
and `src/lib/ai/form-intake-qa-*.test.ts`). Prove it fails before the fix and
passes after.

## 3. Before pushing

```bash
npm run lint
npx tsc --noEmit -p .
npx vitest run <the test files you touched>
npm test            # full suite; CI runs it on every pull request
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck and the tests on every
pull request. Don't merge a red pull request; don't skip or weaken a test to
get green — a test whose expectation changes on purpose says why in a comment.

## 4. Don't leave work on unmerged branches

Finish each session with its work merged or its pull request open. Fixes that
sat on unmerged branches (e.g. `claude/awesome-mayer-i0b5dj`,
`claude/jolly-keller-j1o4ad`) reached Ask Bubbles but not Ask Sunny's `main`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
