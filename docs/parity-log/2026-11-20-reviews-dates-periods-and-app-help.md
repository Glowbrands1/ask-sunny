# Google reviews in chat: the page's dates, any named month or period, and app_help says what it reads (20 Nov 2026)

**Sibling app: to check.** Ask Bubbles has its own Google reviews in chat (ported both ways on 18 Nov). Its read of the
latest reviews and its months pattern should be checked for the same two gaps; the agent loop's app_help is Sunny-only
(no loop there yet).

QA's code audit on 9e1d1f67:
- read_reviews ordered and dated the latest reviews by `googleAbsoluteDate ?? firstSeenAt`'s UTC day, so a review Google
  dates "3 months ago" but first scraped yesterday read as the newest, and an 8 PM Central review showed tomorrow's date.
  It now uses the Google Reviews page's own `reviewDateOf` (Google's date, else its estimate, else first seen, as a
  Central calendar date).
- "last month", "in October" and "last 2 months" matched nothing in MONTHS_PERIOD, so only this month to date was given.
  Any month or period the manager names now reads the month-by-month figures, in the chat block and read_reviews alike.
- app_help's "what Sunny does" said "It does not hold sales, review or scheduling data"; it now says what it reads (the
  Google Reviews and report figures, by the manager's role) and that it holds no scheduling data (CLAUDE.md §5).
