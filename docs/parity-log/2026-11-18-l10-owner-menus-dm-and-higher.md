# 18 Nov 2026: STC DM L10 owner menus list every DM-or-higher person from Woven — Sunny-only

Field Support and QA asked (17 Nov 2026): "Can we add myself, and any other DM or higher role as a drop down option to
add to-do's and issues?" The to-do and issue owner menus listed only the meeting's own people (the Leadership Hub's
roster). They now add, after them, every active Woven employee whose Ask Sunny role is District Manager or higher, by
Woven's role (`employee_access_preview.effective_role`) or by their active account (`app_user_role`), with Woven full
names, read at page load (`src/features/l10/owners.server.ts`, `lib/ownerMenu.ts`). No names are in the repository.

**Sibling app: not ported.** Requested for Ask Sunny's meeting only. Ask Bubbles has the same owner menus (the Hub's
roster for the BCS DM L10) and the same Woven tables; port the two files and the page wiring if its team asks.
