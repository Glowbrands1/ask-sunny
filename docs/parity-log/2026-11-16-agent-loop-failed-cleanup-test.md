# Agent loop PR 4 (owner's additions), the open-draft protection is tested: Ask Sunny only

**Change in Ask Sunny** (Coding-7, 16 Nov 2026; tests only): the replay pack can make a delete fail
(`t.failDeletesOf`), and a new case checks that when the revision draft a refused edit opened cannot be deleted, the
refusal says `revision_cleanup: "failed"`, the failure is logged with the form id only, and the finalized original is
unchanged. The already-open draft (`...-never-deletes-an-already-open-draft`) and the cleaned-up case were on main
already. No app code changed: the test passes on main's `tools.ts`, and fails when the cleanup is reported wrong.

**Ask Bubbles: not needed yet.** Ask Bubbles has no agent loop on its main. Port with the loop.
