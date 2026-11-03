## 3 Nov 2026: "primary salon is X" is not a salon edit — Sunny only (PRIMARY_SALON_NOT_EDIT_ENABLED, default off)

Replay set s21: "Put together a written CA for <name>, primary salon is Omaha
Center. But on Monday 10/05/2026 <name> was working a shift at Omaha Pacific
…". With production's flags, the card took Omaha Center: `salonSetInTurn`
(`ai/edit-date-rules.ts`, FORM_EDIT_DATE_RULES_ENABLED) read "salon is Omaha
Center" as an edit of the form's salon. On, "primary salon is …" is not read
as an edit (the same reading `keptSalon` already makes), so the salon where it
happened stands. Ask Bubbles: not needed. Its `edit-date-rules.ts` has no
store-edit reading; checked through its chat route with production's flags
and the same words in its stores ("primary store is Bellevue … working a shift
at Dodge"), the card names neither store and asks which, which is a different
behaviour, looked at with Bubbles b2.
