# Marquee Direction — design freeze

**Status: frozen.** The approved direction is implemented and signed off. Nothing
in the "Frozen" sections below changes without an explicit decision to change
it. This document exists so a later contributor can tell the difference between
a decision and an accident.

The colour extraction itself lives in
[`marquee-v2-color-system.md`](./marquee-v2-color-system.md). This document is
about what the implementation settled, and what it deliberately did not build.

---

## What "frozen" means mechanically

Intention does not hold a design in place. These assertions do, in
`src/app/theme-semantics.test.ts`:

| Assertion | What it stops |
| --- | --- |
| The four approved colours hold their exact hex values | A "tidy-up" shifting the hue |
| No component names an `--approved-*` token or a literal hex | Colour drifting out of `globals.css` |
| Every `var(--token)` in `src/` resolves in `globals.css` | A dead token silently rendering black — see the note below |
| Neither removed green appears anywhere | An "up" delta coming back green and asserting that up is good |
| `.display`, `.display-figure`, `.wordmark`, `.eyebrow`, `.pill-action`, `.stat-cell`, `.stat-grid` all exist | A rename silently unstyling every consumer |
| The settled token meanings still point where they were signed off | `--primary`, `--accent`, `--ring`, both flag tokens, the series ramp |
| No button variant fills with the coral | Pressing starting to look like alarming |
| The follow-up colour appears only on follow-up surfaces | Pink meaning nothing after a month |

**The dead-token check was written after finding a live fault.**
`ranked-bar-chart.tsx` painted its At Market bars with `var(--stc-warm-tan-deep)`
and drew its benchmark line with `var(--stc-slate-deep)`. Both tokens were
deleted when the approved palette replaced the old brand ramp. Types, lint and
every other test passed — but an unresolvable `var()` in an SVG presentation
attribute is an *invalid value*, not a fallback, so every At Market bar on Bed
Usage, Spa Engagement and Spa Wellness rendered **black**, and the benchmark line
**did not draw at all**. Those three reports need Supabase to render, so nobody
was going to catch it by eye.

---

## Frozen: the vocabulary

**Type.** Passion One (display) at 400, uppercase, positive tracking, leading at
or under 1. Lato for body. Jost for the wordmark only. Applied as classes
(`.display`, `.display-figure`, `.eyebrow`, `.wordmark`) rather than as element
rules, so the display face never lands on a table caption at 11px where it stops
being readable.

**Colour, by role.**

| Role | Token | Rule |
| --- | --- | --- |
| Primary action | `--primary` → `#1c1f29` on `#ffffff` | The only primary fill |
| Brand accent, focus ring | `--accent`, `--ring` → `#ffcc00` | Capped at two filled yellow blocks a screen |
| Generic selected UI | `--selected` → `#1c1f29` | A UI state, not a category |
| Measure behind plan | `--measure-flagged` `#ef6079` fill, `--measure-flagged-foreground` `#c2405c` ink | The only colour a measure may take |
| Chart series | `--measure-series`, `--measure-series-recessive` | No hue at all; varies in lightness |
| Follow-up / overdue | `--followup-attention` | Follow-up surfaces only, enforced by test |
| A change vs a named comparison | `--delta-up` `#1f7a4d` up, `--measure-flagged-foreground` `#c2405c` down | The **only** green in the system — see below |

**The one rule the rest follows from:** direction and target are different
questions. A measure can be up nine percent and still sit under plan, so
colouring by direction says which way the arrow points while colouring by target
says where to spend the shift. The flag is driven by target. Up and flat read
neutral. **Nothing flagged is a valid state** — a row where something is always
coloured teaches managers to ignore the colour.

**Coral is never a primary action.** It is a flag and an alarm. The action
*inside* an alarm bar is near-black: pressing and alarming must not look alike.

**Green is out — with one stated exception.** `#5c6559` and `#4f7a4c` are gone
and stay gone. "Ready", "good", every chart series and every band classification
resolve to the neutral ink.

**The exception, added by explicit request after the freeze:** a change against a
*named comparison* — "+5.11% vs 2025" on the Salon Performance KPI row, the
per-salon row and the comparison table — reads **green when it is good and red
when it is behind**. It is a deliberate reversal of the original rule for that
one control, and it is narrow in three ways that the tests enforce:

1. It applies only where the change already names both sides of its comparison.
2. It is reached only through `sentimentFor`, so a measure whose
   `higher_is_better` is **null** stays neutral in both directions — a green
   arrow on a cost measure would be the app inventing a judgement the business
   has not made. The screen reader is told the direction is undefined.
3. The arrow glyph and the word ("increase" / "decrease") both remain. Green and
   red is the worst pair for the commonest colour blindness, so the meaning
   never rests on the hue.

The green is `#1f7a4d`, neither of the removed ones: chosen at L\* 45.3 against
the flag ink's 46.9 so a rise and a fall carry equal weight, and measured at
5.32:1 on white and 4.99:1 on the canvas. `--approved-delta-down` `#d4405f` is
*not* used for the down direction — it measures 4.47:1 on white, under the floor
for text this size, and one red meaning "behind" is better than two.

---

## Frozen: the stat treatment

One panel divided by hairlines, never a card each — a figure only reads as the
largest thing on the page when nothing is drawn around it, and four bordered
boxes make four objects that run together.

Two implementations, and the difference is not cosmetic:

- **`.stat-cell`** — the Overview's four figures. Its divider rules pick out
  "the first cell" and "the second of a pair" by position, which is exact for
  one row of up to four and wrong for anything that wraps.
- **`.stat-grid`** — the general case, for a row that wraps. Each cell draws its
  own two dividers *outside* itself as offset box-shadows and the panel clips
  them, so the cells beginning a row lose their left divider and the top row
  loses its top one. Correct for any number of rows and columns, with no
  arithmetic to get wrong.

Hierarchy inside a panel is carried by **figure size**, never by a different
background. Emphasis is a bigger number.

---

## Frozen: where the flag appears

The flagged-measure treatment now reaches every report surface that carries a
real comparison. It is driven by the report's own approved classification, never
by a component's guess:

| Surface | What drives the flag |
| --- | --- |
| Overview stat panel, and the collapsed strip under an inline answer | The measure being short of plan |
| Salon Performance KPI row, comparison table | `sentimentFor(change, higherIsBetter)` — green good, red behind, neutral where the direction is not stated |
| Salon Performance movers chart | Same, and every bar stays neutral when `higher_is_better` is null |
| Bed Usage / Spa Engagement / Spa Wellness KPI rows | `trendFor(delta)` against the chain or installed-peer benchmark |
| `v Chain` / `vs Peers` table cells | `isBehindBenchmark(band)` — the band's own tone |
| Ranked bar charts | `BAND_FILL`, from the same band |
| The benchmark line on a ranked chart | Coral **only** where the chart is classifying against it |

Three refusals inside that, all deliberate:

1. **The FAST exemption.** FAST beds are being removed on purpose, so a FAST
   level 28% under the chain is the intended consequence of a decision already
   taken. It is shown as a figure and never raised as a finding — badge and
   coral both honour `reportableFinding`. Putting the most alarming mark on the
   page against the one row nobody should act on is the specific failure this
   avoids.
2. **A descriptive average is not a red line.** Bed Usage's per-bed chart bands
   every salon against the estate figure, so under that line *is* the finding
   and it draws coral. Spa Engagement draws the same kind of estate rate with no
   bands at all, and there a coral rule would invent a target the report never
   set. Derived from whether the rows carry bands, so the two cannot disagree.
3. **Four bands, three colours.** The obvious fourth — the deeper coral ink for
   Significantly Underperforming — scores ΔE 13.7 against the coral fill, under
   the floor of 15 this report family's own palette validator uses. A distinction
   a full-colour reader cannot resolve is not a distinction. The fill says
   *behind*; the badge beside it says how far behind, in words.

**Never colour alone.** Every flag is accompanied by a sign in the text, a word,
or a named band, so the meaning survives greyscale, colour blindness and print.

---

## Not frozen — deliberately not built

Flagged rather than fabricated. Each of these needs data or a product decision
that does not exist yet:

- **Plan and goal bars, and sparklines.** No target or trend data exists. The
  direction's own notes say so.
- **A "new videos" count on the rail.** No honest source.
- **The manager-ready next step in live mode.** The live system prompt never
  asks for it, and changing what the assistant outputs is a product decision,
  not a styling one.
- **Google Reviews figures.** Google Business Profile is not connected. The block
  is shown with a disclosure naming the missing integration rather than hidden —
  an absent block cannot mislead, but neither can it be checked for honesty.

## Not frozen — how "live" works

Every report page and the Overview are `export const dynamic = "force-dynamic"`:
each request re-reads the current facts server-side, and that is the whole of the
live mechanism.

The collapsed strip that stays on screen while an inline answer is open shows the
**same snapshot as the Performance panel**, not a separate set of figures. Both
are server-rendered nodes passed into the client screen, and both read through
one `cache`d `loadReportingOverview` call — so they cannot state different
revenue on the same screen, and the strip is not a second data path for numbers
the product has deliberately given one. **No Supabase Realtime subscription exists anywhere in this
app**, by an existing recorded decision — a socket on the app's landing page is a
new failure mode, and these reports change when a workbook is ingested rather
than continuously. Adding one is a change to that decision, not a styling task.
