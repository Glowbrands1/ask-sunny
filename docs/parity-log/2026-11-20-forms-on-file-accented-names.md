# Accents never hide a form on file (QA's f072, 20 Nov 2026)

**Sibling app: Coding-G ports it** (from Coding-G's port of #1141 to Ask Bubbles, which found these two gaps here). The
same two parts apply there: the forms-register readers' name words, and its overview's folded name column (its own
migration, with its own view's columns).

- The forms-on-file readers split names on `[^a-z]`, so "Ramírez" was read as "ram rez": `candidateNameWords`, the row's
  `nameWords`, `looksLikeItNamesSomebody` (`chat-form-records.ts`) and the close-spelling reader's `wordsOf`
  (`reopen-close-spelling.ts`) now fold accents first with `foldName` (#1141).
- The database's ilike compares the letters as stored, so "lucia ramirez" never found a form stored as "Lucía Ramírez".
  Migration `20261120002000_forms_overview_unaccent.sql` (not applied by the pull request; QA applies it after
  merge) installs `unaccent` and adds `employee_name_folded = lower(unaccent(employee_name))` as the overview's last
  column; `listInstances` matches it beside `employee_name`. Until the migration is applied, a read that names the missing
  column is read again by the stored name only, as before.
