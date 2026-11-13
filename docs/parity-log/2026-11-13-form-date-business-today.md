## 13 Nov 2026: an evening form is dated today, not tomorrow — FORM_DATE_BUSINESS_TODAY_ENABLED (default off), both apps

Live bug (QA; Pau's audit: 27 of 29 evening Sunny forms in 30 days carried the next day's date, 6 finalized).
Sunny seeded a new form's date, and the template preview's, with the UTC date (`toISOString().slice(0, 10)`),
already tomorrow from about 6–7 PM Central; Woven's termination and new-hire dates were read against the UTC date
too. With the flag on, each is `recordToday()` (`lib/business-today.ts`, `businessToday()` in BUSINESS_TIMEZONE).
Sunny: #925.

Ask Bubbles: its form date and preview already used `businessToday()` (default America/Chicago). Its three Woven
reads (`employees/woven/sync.ts`, `employees/woven/validate.ts`, `admin/new-hire-invites.ts`) still used the UTC
date and are ported behind the same flag in a Bubbles pull request.

Time zone: every Sunny salon is in KS, MO or NE (Central), but Sunny production stays on the code default
(America/New_York) for now. With the flag on, an evening form is dated today until 11 PM Central (it was tomorrow
from about 6 PM). Setting NEXT_PUBLIC_BUSINESS_TIMEZONE=America/Chicago also moves analytics, reporting freshness,
follow-up due dates and the reviews code's zone assumption (14 tests assume Eastern; Gate-Sunny-2), so it is a
separate gated change.
