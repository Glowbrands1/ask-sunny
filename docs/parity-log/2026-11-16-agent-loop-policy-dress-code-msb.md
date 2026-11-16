# 2026-11-16 — agent loop: dress code cited as Dress Code; Must See Behaviors only when said

**Stays Sunny-only for now.** Ask Bubbles has no agent loop yet. Rules this adds (`policy-fit.ts`, propose_form in
tools.ts): when the manager's words describe a dress-code offense (dress code named, or clothing worn on shift), a
Corrective Action citing a heading other than the manual's own Dress Code headings, or Other alone, is refused
(`dress_code_heading`) with those headings as the fit, unless the manager named another policy; "Other — Must See
Behaviors" with no MSB / must see behaviors in the request is refused (`msb_not_said`). Port with the loop; Bubbles' manual
headings are read the same way (never copy Sunny's clothing or policy wording).
