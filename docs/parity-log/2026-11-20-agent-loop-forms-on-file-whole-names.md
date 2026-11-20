# 2026-11-20 — agent loop: forms on file are only ever the named person's (whole name words)

**Stays Sunny-only for now, but check the sibling's own forms-on-file reader.** Ask Bubbles has no agent loop yet. Rule
this adds (find_past_forms, tools.ts): a form is the named person's only when the typed name is whole words of its
employee's name (`wholeNameWords`: full, first or last name), the same person by `samePerson`, or one roster holder's
other name; never a substring ("Ann" never lists Hannah's or Joann's forms). When the matches belong to more than one
person and none is the full name typed, no form is listed and the reply asks which person. Port with the loop; check
whether any Ask Bubbles reader of forms on file keeps a row by substring.
