# Ask Sunny — Assistant Salon Director / Employee permissions, and salon numbers 306 / 307 / 314

**Nothing was changed for this document. No access was widened.** Evidence: `evidence/pre-release/roles-*.json` and `numbers-*.json` (probes run through the real create route and chat answer path on Sunny `main` `1feaa75` and the branch `9e84273`).

## 1. Where the rules live

- One permission matrix, in code: `src/lib/permissions/index.ts` → `DEFAULT_PERMISSION_MATRIX`.
- The **server** enforces it on every protected request: `src/lib/auth/server.ts` `authorizeRequest` → `hasPermission(DEFAULT_PERMISSION_MATRIX, identity.role, permission)` → 403 "Your role does not have permission to do that." Form creation goes through `authorizeForms(request, template.requiredPermission)` (`src/app/api/forms/instances/route.ts:158`).
- The admin "permissions matrix" screen displays this same matrix in real (authenticated) mode and offers no Save there; it is editable only in demo mode, where it changes nothing on the server (`src/features/admin/permissions-matrix.tsx:44-63`).
- **The branch does not change the matrix, `authorizeRequest`, or any route's permission.** Its only permission-related change is `af17a18` (port of Bubbles `987e4b7`): the chat screen hides the "Create a form" control from an account holding none of the form-creation permissions (`FORM_CREATION_PERMISSIONS`), because the server would refuse every template anyway. That is a **UI narrowing**, not an access change.

## 2. Current permissions (identical on `main` and the branch)

| Permission | Employee | Assistant Salon Director | Salon Director (for comparison) |
|---|---|---|---|
| Ask Sunny questions | ✓ | ✓ | ✓ |
| Read the knowledge base | ✓ | ✓ | ✓ |
| Training videos | ✓ | ✓ | ✓ |
| Prepare coaching conversations (`create_coaching`, chat guidance only — no form) | — | ✓ | ✓ |
| Overview, Daily Stats, Manager Resources | — | ✓ | ✓ |
| View form monitoring (read the list of filed forms) | — | ✓ | ✓ |
| Google reviews | — | ✓ | ✓ |
| Forms workspace | — | — | ✓ |
| **Create any form** (coaching, corrective action, policy review, hiring, exit, demotion/transfer) | **—** | **—** | ✓ (11 templates) |
| EPP forms | — | — | — (District Manager and above) |
| Reports | — | — | ✓ |
| Manage templates / form records / knowledge / users | — | — | — |

Employee is a **closed list** of three permissions; anything added later is denied by default.

## 3. Verified behaviour (route and chat probes)

| | `main` `1feaa75` | branch `9e84273` |
|---|---|---|
| Employee — create each of the 17 templates via `POST /api/forms/instances` | **403 × 17** | **403 × 17** |
| Assistant Salon Director — same | **403 × 17** | **403 × 17** |
| Salon Director (control) | 200 × 11, 403 × 6 (the EPP templates) | identical |
| Employee / ASD in chat: "create a coaching form for pat rivera…" | No card: "Your role cannot create a **Coaching Form**, so I will not propose one. Ask your district manager which forms your role should cover." | identical |
| "Create a form" control in the chat screen | shown (pressing it could only be refused) | **hidden** for Employee and ASD |

**Decision needed from you (F-14):** confirm that hiding "Create a form" from Assistant Salon Directors and Employees is wanted. If ASDs should be able to file some forms, that is a change to the matrix (granting e.g. `create_coaching_form` to `assistant_salon_director`) — **a widening of access that QA has not made and will not make without your instruction.**

## 4. Salon numbers 306, 307 and 314

Sun Tan City has two numbering systems that overlap **without agreeing** (`src/lib/reviews/store-codes.ts`):

| Typed number | As an Ask Sunny salon number | As a Google store code |
|---|---|---|
| 306 | salon **0306** — MO Kansas City Wornall (Google code 140) | **KS Manhattan** — salon 0462 |
| 307 | salon **0307** — NE Grand Island (Google code 141) | **KS Shawnee Mission Pkwy** — salon 0463 |
| 314 | salon **0314** — NE Omaha 144th and Center (Google code 148) | **KS Lawrence** — salon 0468 |

How a typed number is read (probe on the real reader):

| Manager types | `main` | branch |
|---|---|---|
| "at salon 306" / "at store 306" / "at #306" | **loc-0306 (Wornall)** — silently; if the manager meant Google store 306 this is Manhattan's form filed against Wornall | **no salon** — the card asks which salon |
| "at salon 0306" (with the zero) | loc-0306 | loc-0306 |
| 307 / 314 (any form) | loc-0307 / loc-0314 silently | no salon — asks |
| "at salon 462" | loc-0462 | loc-0462 |
| "at store 140" (Wornall's Google code) | not read | loc-0306 |
| "at store 373" (Overland Park's Google code; no salon 0373) | not read | loc-0476 |
| A bare reply "306" to "Which salon is this about?" | intake dropped (F-12) | neither picked: both **0306 and 0462** offered for the manager to choose (`qa-f12-salon-reply-e2e.test.ts:450`, manager assigned to both); the choice still passes `authorizeLocation` |

**Why they stay unresolved:** a three-digit number that is both a salon number and a different salon's Google code cannot be resolved from the number alone; guessing files an HR record against a salon nobody named. The branch fails safe: the salon stays blank and the manager chooses. **Access is unaffected either way:** whatever salon is chosen still passes `authorizeLocation`, so a manager can never file at a salon outside their assignment by typing a number.

**Decision needed from you:** keep "ask" (recommended), or adopt a business rule such as "**salon** N always means salon number 0N; **store** N always means the Google store code" — a product rule for HR/operations to confirm, not something QA should infer.
