# Proposed change to the protected name reader (for Pau's approval)

Status: **proposal only.** `src/lib/forms/proposal.ts` is protected; nothing
here is applied. Found while pinning NAME_CASE_INSENSITIVE_ENABLED (#270 /
Ask Bubbles #202). Both gaps read the same on main in mixed case, so they
are the reader's, not the flag's. Ask Bubbles' `proposal.ts` has the same
`readTypedName`; the change would be ported as the mechanism.

## Gap 1 — "for Test Employee" → Employee "Test"

Turns (QA testers, 26 Oct 2026): "ca for test employee at wornall, tanning
consultant, left the register unattended …", "create a coaching form for
Test Employee".

`readTypedName` (`proposal.ts` around lines 170–178) keeps a form word
("Employee") as the surname only when the sentence ends on it or a comma
follows a capitalised one:

```ts
const formWordAsSurname =
  parts.length > 0 &&
  isFormVocabulary(lower) &&
  (groundedEntitiesEnabled() || intentExtractionEnabled() || typedNameProceedsEnabled()) &&
  (/[.!?]/.test(raw) || (/^[A-Z]/.test(word) && raw.includes(",")));
```

Proposed, behind a new default-off flag `TYPED_PLACEHOLDER_NAME_ENABLED`:

```ts
const placeholderSurname = typedPlaceholderNameEnabled() && parts.length === 1 && /^test$/i.test(parts[0]!) && /^employee$/i.test(lower);
const formWordAsSurname =
  parts.length > 0 &&
  isFormVocabulary(lower) &&
  (groundedEntitiesEnabled() || intentExtractionEnabled() || typedNameProceedsEnabled()) &&
  (placeholderSurname || /[.!?]/.test(raw) || (/^[A-Z]/.test(word) && raw.includes(",")));
```

Only the two-word placeholder "test employee" (any case) is affected; no
real name contains "employee". Alternative with no code change: testers use
an invented real-looking name instead of the placeholder.

## Gap 2 — "rowan testcase opend late" → Employee "Rowan Testcase opend"

`readTypedName` (`proposal.ts` line 161) takes a third part wherever a name
position was read (`parts.length === (whole ? 2 : 3)`), so a lowercase verb
typo after the name ("opend") becomes a surname.

Proposed, behind the same new flag: a third part only when it is typed with
a capital, or when the word after it closes the name (a place, a title, a
comma, or the end of the sentence) — the rule NAME_CASE_INSENSITIVE_ENABLED
already uses in `ai/name-case.ts` (`humanCase`):

```ts
if (parts.length === 2 && typedPlaceholderNameEnabled() && !/^[A-Z]/.test(raw) && !closesName(words[index + 1])) break;
```

`closesName` would be new in `proposal.ts`: true for a missing next word,
sentence punctuation on `raw`, a comma, or a next word read as a salon or a
job title. "mary anne cruz" (end of turn) and "Mary Anne Cruz" keep three
parts; "rowan testcase opend late" keeps two.

## Pins to add with the change

- "ca for test employee at wornall, tanning consultant, left the register
  unattended, use the standards of conduct policy" → Test Employee (lc, SC,
  CAPS with NAME_CASE)
- "create a ca for rowan testcase opend late" → Rowan Testcase
- unchanged: "Transfer for mary anne cruz to salon 24" → three parts,
  "Exit for john michael doe effective october 2" → three parts
