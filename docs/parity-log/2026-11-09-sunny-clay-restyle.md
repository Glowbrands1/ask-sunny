## 9 Nov 2026: clay restyle, cloud background and 5-star confetti — Sunny-only

Ask Sunny takes the approved "clay web" look: puffy shadows and rounder
corners on the shared components, the Sunny mascot, a floating rail and top
bar, rounded top-lit navy bands, clay tabs and goal bars on the dashboards,
Plus Jakarta Sans, a seamless sign-in gradient with turning sun rays, and a
repeating clay-cloud background. Visual only: no data, permission, citation,
forms or Woven behaviour changes. Not ported to Ask Bubbles: the owner's
call (9 Nov 2026) is "for now it's for Sunny, we can do Bubbles later when I
see it's successful in Sunny". The sun, clouds and Sunny are Sun Tan City's
look in any case; a Bubbles version would port the clay mechanism only. The cloud
background reuses Bubbles' canvas-pattern mechanism with Sunny's own artwork,
so nothing flows back.

Confetti on a 5-star chat rating (`lib/ui/confetti.ts`, one call in
`conversation-rating.tsx` after a successful save) is a small, brand-neutral
celebration that reads its colours from the theme tokens. Not ported yet,
for the same reason; Bubbles can take it as-is later.
