# Marquee Direction — design freeze

**Status: frozen.** The approved direction is implemented and signed off. Nothing
in the "Frozen" sections below changes without an explicit decision to change
it. This document exists so a later contributor can tell the difference between
a decision and an accident.

The colour extraction itself lives in
[`marquee-v2-color-system.md`](./marquee-v2-color-system.md). This document is
about what the implementation settled, and what it deliberately did not build.

---

## SUPERSEDED, 2026-09-10 — the three pinned Marquee artifacts

Three artifacts were approved as the current visual authority and directly
reverse four decisions recorded further down this document:

- **Marquee Reports Tab**
- **Marquee Google Reviews**
- **Marquee Chat Tab**

Each reversal below is listed with the artifact's own argument, because none of
them is a matter of taste — three carry a colour-vision validator's results and
the fourth fixes a promise the product was breaking. The rest of the freeze is
unchanged, and the two removed greens (`#5c6559`, `#4f7a4c`) stay removed.

### 1. Coral is the chart data fill. The no-hue series ramp is out.

**Was:** chart series carried no hue at all — a lightness ramp, with the
near-black for the reading that mattered — on the argument that coral was
committed to "behind plan" and no hue was free for series identity.

**Now:** every bar in a ranking is `#ef6079`, on a `#fdeef0` track, and rank or
band never changes it. The Reports artifact ran the palette through a contrast
and colour-vision validator and recorded a refusal of the value the old ramp
used: the near-black *"failed both the lightness and chroma checks —
technically legible, but reading as grey rather than as a colour"*, while the
coral passes all six checks.

The rule that keeps coral from doing two jobs travels with it, and is why the
data fill is its own token (`--measure-data`) rather than `--followup-attention`
even though the two hold the same value today:

> In a chart, coral is the data. In the interface, coral is attention. A bar and
> a status pill are different objects.

The ordinal ramp survives for the two jobs that are genuinely ordinal — a
recessive baseline, and a neutral two-period series — and `--status-ready` /
`--status-processing` stay grey, because a document that finished indexing is
not outperforming anything.

### 2. Green marks the good direction, and it now has a ladder.

**Was:** green permitted on exactly one control — a delta against a named
comparison — and explicitly forbidden on any status, series or classification
colour.

**Now:** one green, `#2f6b4f`, wherever the business has stated which direction
is better: the delta arrow, the diverging bar, and the "outperforming / at goal"
rung of the four-state status ladder. The value replaces the locally derived
`#1f7a4d` and measures *better* — 6.29:1 on white against 5.32:1 — so adopting
the artifact's literal cost nothing. The artifact rejected the obvious
`#4f7a4c` at protan ΔE 6.7 against the coral.

Still narrow: green is never a section or a category colour, and a measure whose
`higher_is_better` the catalogue does not state is still neutral —
`theme-semantics.test.ts` enforces that every painting site asks `sentimentFor`.

### 3. The four-state status ladder, shared by Reports and Google Reviews.

Bed Usage's status vocabulary was plain text in a table column; Google Reviews
had no status column at all. Both now draw the same chip, with a glyph and the
state in words as well as a fill:

| Rung | Fill | Glyph | Reports | Google Reviews |
| --- | --- | --- | --- | --- |
| outperforming | `#2f6b4f` | ▲ | Outperforming peers | At goal |
| at market | white, `#c9bdb4` edge | ● | At market | On track |
| below market | `#9a6d10` | ▬ | Below market | Behind |
| significantly under | `#c2405c` | ▼ | Significantly under | Needs attention |
| tracked for capacity | `#e6cfc2` | ◇ | FAST capacity only | — |

The Reviews artifact's reason for the reuse: *"the same four fills and glyphs as
the report tabs, so a chip means the same thing wherever a DM sees it."*

**Two of the artifact's literals are deepened**, and this is the same move — and
the same justification — as the two muted inks: these carry 8.5px caps in white,
which is small text and needs 4.5:1.

| Rung | Artifact | Shipped | White on it |
| --- | --- | --- | --- |
| below market | `#b07d12` | `#9a6d10` | 3.63:1 → 4.60:1 |
| significantly under | `#ef6079` | `#c2405c` | 3.17:1 → 5.02:1 |

Each is scaled toward black along its own channel ratios so the hue survives.
The second lands on the deeper coral the system already carried, so no new
colour was invented — and it keeps the ladder separable from the chart fill,
which is the artifact's own rule that a bar and a pill are different objects.

### 4. Sources come back under an answer, as a rule and numbered rows.

**Was:** the source block under a chat answer was removed outright, and
`chat-sources.dom.test.tsx` asserted that nothing appeared in its place — no
card, no count, no "view sources" affordance.

**Now:** a SOURCES label over a 3px rule, then one line per citation — a yellow
numeral, the document, the page. The complaint that produced the removal was
real and the artifact quotes it back: *"Today they are three white cards
competing with the answer they support."* The cards are still gone; what
returned is roughly a tenth of their height, with no excerpt, no category and
no card.

It also fixes a promise the product was breaking. The band's trust line says
answers are generated from indexed company documents; with the block removed,
that was uncheckable on every answer in the app.

### Not reversed

The **chart-colour prohibition on yellow** stands and the artifact restates it:
at 1.47:1 on a light ground *"yellow cannot be a chart bar... it never encodes a
value."* It stays in the chrome, the section rules, the active tab underline and
labels. The one filled-yellow exception in the daylight half remains a *label* —
a source numeral, a mode tag, the rail pill.

---

## What "frozen" means mechanically

Intention does not hold a design in place. These assertions do, in
`src/app/theme-semantics.test.ts`:

| Assertion | What it stops |
| --- | --- |
| The four approved colours hold their exact hex values | A "tidy-up" shifting the hue |
| No component names an `--approved-*` token or a literal hex | Colour drifting out of `globals.css` |
| Every `var(--token)` in `src/` resolves in `globals.css` | A dead token silently rendering black — see the note below |
| Neither removed green appears anywhere | A green the direction rejected coming back |
| One green, shared by the delta, the diverging bar and the outperforming chip | The ladder and the arrow drifting onto two greens a manager has to learn twice |
| `--status-ready`, `--status-processing` and the series ramp never resolve to a green | A document that finished indexing reading as "outperforming" |
| Every file painting a delta green reaches it through `sentimentFor` | A rise in a cost measure painted as good news |
| The status ladder's five tokens exist, and `StatusChip` carries all five glyphs | Colour becoming the only cue for a state |
| The data fill is `--measure-data`, the benchmark is the near-black | The chart quietly going back to a grey ramp |
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
per-salon row, the comparison table and the Overview's own performance panel —
reads **green when it is good and red when it is behind**. It is a deliberate reversal of the original rule for that
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
| Overview change line | The report's own change, through `sentimentFor`; absent entirely on a family with no baseline |
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
**same snapshot as the Performance panel**, not a separate set of figures. It
carries the figures only — the change line and the period stay on the panel,
because at strip width four extra percentages double its length. Both
are server-rendered nodes passed into the client screen, and both read through
one `cache`d `loadReportingOverview` call — so they cannot state different
revenue on the same screen, and the strip is not a second data path for numbers
the product has deliberately given one. **No Supabase Realtime subscription exists anywhere in this
app**, by an existing recorded decision — a socket on the app's landing page is a
new failure mode, and these reports change when a workbook is ingested rather
than continuously. Adding one is a change to that decision, not a styling task.
