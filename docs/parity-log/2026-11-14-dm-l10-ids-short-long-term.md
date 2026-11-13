# DM L10: IDS split into Short term, Long-term and Recently solved

**Change.** The DM L10 tab's IDS section (copied from the Leadership Hub) now has three tabs, as in Bloom Growth:
Short term, Long-term and Recently solved. An issue carries an optional `term` (`"long"`; missing means short-term)
and, once solved, `resolvedAt`. Only short-term issues are ranked. The same change is made in the Leadership Hub's
meeting page (`Glowbrands1/leadership-hub`, branch `claude/bloom-dm-l10-import`), so both apps show the one
meeting record the same way.

**Ask Bubbles: not needed.** Ask Bubbles has no L10 tab yet (the BCS DM and BCS GM L10 tabs are planned; see
`src/features/l10/README.md`). When they are copied, they get this version of `src/features/l10`.
