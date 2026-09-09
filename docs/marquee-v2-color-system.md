# Marquee v2 — extracted colour system

Source: Artifact **"Marquee Direction"** (`Marquee Direction (Copy)`,
`artifact/18a1930f-3564-4c05-85ea-f9a2e6e7fb58`), read 2026-09-09. Values below are
transcribed verbatim from that artifact's CSS and its "How the colour is used" table.
Nothing here is approximated or interpolated.

The artifact contains **three** distinct colour sets. Only the first is the direction.

1. **Marquee v2** (`.mk--next`) — the proposal. This document.
2. **As deployed** (`.mk--now`) — a reference plate of the *current* build, included so the
   comparison is against the real thing. Not a target. See "Current build" below.
3. **The spec document's own chrome** — the dark board the artifact itself is presented on.
   Not application colour at all. See "Never ship" below.

The artifact's own summary of the direction: *"Four colours, one job each. Near-black is not
just chrome any more — it is a surface with real area, which is what lets yellow and coral run
at full strength instead of floating on peach."*

---

## The four committed colours

These are the only rows in the artifact's palette table that are prescriptive, and each carries
an explicit prohibition.

| COLOUR ROLE | HEX | WHERE IT IS USED | NEVER |
| --- | --- | --- | --- |
| Band / near-black surface | `#1c1f29` | The Ask Sunny band and the top bar. One surface, roughly the top third of the page. | Not the left rail — that stays `#b2aeaa` at the medium weight. |
| Brand yellow | `#ffcc00` | Sun mark, send button, the ask bar's underline, the band's closing rule, section rules, the reviews bar, the "due this week" counter, card tags, active rail item. | Not more than two filled blocks per screen. |
| Attention coral | `#ef6079` | Attention only. The follow-up bar, overdue pills, the overdue counter, and any measure short of plan. | **Not a button. Pressing and alarming must not look alike.** |
| Red-light red | `#d62c3a` | The band's corner glow, at 40% over near-black. **That is its only appearance.** | Not errors, not text, not a fill. |

---

## Full palette

### Surfaces

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Main page background (canvas / "daylight") | `#fff6f0` | `--m-bg`; `.work`, `.stwrap`, `.collapsed`, `.crop`, `.railcrop`. The peach field below the band. |
| Band surface | `#1c1f29` | `.band`. Also the `.s-head .full` button, the `.vid .pl` play dot, the answer avatar fill. |
| Top bar / chrome (one step deeper than the band) | `#12141c` | `--m-top`; `.tools` toolbar, `.alarm .pin`, `.alarm .go` button, `--shade` on the top-bar sun mark. |
| Cards / paper | `#ffffff` | `.ask`, `.stats`, `.card`, `.sheet`, `.chips span`, `.jump span`, `.fups span`. |
| Secondary surface (warm peach tint) | `#f6ece4` | `.ct.c` "open" counter, `.vid` video row, `.jump` bottom strip. |
| Yellow-tinted callout | `#fffaea` | `.next` — the "next step" block inside the answer sheet. |
| Left rail | `#b2aeaa` | `.mk-rail`. Stated twice as fixed: *"The left rail stays at `#b2aeaa`."* |
| Clear-button surface | `#f1efec` | `.ask .clear`. |

### Borders and dividers

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Card border | `#f0ddd2` | `.stats`, `.card`, `.chips span`; `.sheet` bottom border. |
| Stat column hairline | `#f5e6dc` | `.st` left dividers inside the single stats panel. |
| Row divider | `#f8ece5` | `.row`, `.src` top borders. |
| Rule / chip border (stronger) | `#e6cfc2` | `.bare` 3px top rule, `.fups span`, `.jump` top border and chips, `.collapsed .show`. |
| Rail border | `#a09c98` | `.mk-rail` right border, `.railcrop .user` top border. |
| Band divider / chip border | `#33353f` | `.shorts` top rule, `.tools span`, the `.mk-top .div` hairline. |
| Band pill border | `#43454f` | `.b-head .loc`, `.prompts span`. |
| Chrome border | `#24262f` | `.tools` bottom border. |

### Text

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Primary text | `#141821` | `--m-ink`; `.st strong` (38px figures), `.card h5`, `.wlab b`, `.row .who`, `.bare div`, `.chips span`, `.s-body h6`, `.next p`. |
| Secondary text | `#3d3e44` | `.s-body p` — answer-sheet body copy. |
| Muted text | `#7c7a80` | `.st u` labels, `.row .what`, `.wlab u`, `.bare u`, `.collapsed u`, `.src span`, `.st.quiet em`, `.vid span`. |
| Muted text, lightest (provenance) | `#a09a94` | `.st .per`, `.st .tgt`, `.prov` — the through-date/last-updated line. |
| Placeholder | `#8b8896` | `.ask .ph` — the ask bar's placeholder copy. |
| Rail item text | `#2b2926` | `.mk-nav`. Called out as clearing 4.5:1 on `#b2aeaa`. |
| Rail section label | `#454240` | `.mk-rail h6`. Also clears 4.5:1. *"Anything lighter on this rail does not."* |
| Rail icon | `#cac6c2` | `.mk-nav i`. Same grey whether or not the section is active. |
| Muted text on the band | `#9d9aa8` | `.b-head p` (date line), `.thinking`. |
| Chip text on the band | `#cfcdd6` | `.shorts div`, `.tools span`. |
| Dimmest band label | `#5f606c` | `.tools u` — the "Jump to" eyebrow. |
| Band prompt-chip text | `#e6e4ea` | `.prompts span`. |
| Top-bar chip text | `#f0eef2` | `.mk-chip`. |
| Parent-brand wordmark | `#b6b4c0` | `.stc` "Sun Tan City", with `TAN` in `#ffcc00`. A type stand-in — *"swap in the official SVG before this ships."* |

### Yellow system

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Primary accent | `#ffcc00` | Sun mark; `.ask .send`; the `.ask` 4px underline; `.band` 4px bottom rule; `.wlab i` section rules; `.revbar` / `.rev`; `.ct.b`; `.card h5 .tg` tags; `.mk-nav.on` active rail pill; `.bare div i`; `.src i`; `.next` left border; `.s-head .av` and `.tag`; `.thinking i`; `.modes span.on`; `.stlab .n`. |
| Ink on yellow | `#332a00` | `.ask .send svg` stroke; `--m-on-ink`; `.ct.b strong`; `.p-soon`; `.revbar .lead strong`; `.revbar .meter i` fill; `.revbar .open` background; `.s-head .tag`. |
| Label on yellow | `#6b5200` | `.revbar` and `.rev` eyebrows and `em`; `.ct.b u`; `.next u`. |
| Meter track on yellow | `rgba(51,42,0,.22)` | `.revbar .meter`, `.rev .meter` — `#332a00` at 22%. |

### Coral / attention system

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Attention (fill) | `#ef6079` | `.alarm` follow-up bar; `.p-over` overdue pill; `.ct.a` overdue counter; `.wlab .pin`; `.mk-nav .bdg` rail count; `.collapsed .alert`; `.st.flag .goal i`; `.ask .typed i` caret; `.fups span.new` border. |
| Soft text on coral | `#ffe3e8` | `.alarm span`, `.ct.a u`. |
| Attention as text (deep) | `#c2405c` | `.st.flag u`, `.st.flag em`, `.st.down u`, `.bare u span`, `.fups span.new` text. Coral where it has to read as type rather than fill. |
| Down-delta text | `#d4405f` | `.st em.dn`. |
| Corner glow | `#d62c3a` | `.band` radial gradient only, at 40%. Its single appearance. |

### Positive / neutral measures

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Positive / "up" delta | `#4f7a4c` | `.st em`. The one sanctioned green — but see the conflict noted below. |
| Goal track | `#f0e4da` | `.st .goal` progress track. |
| Goal fill (neutral) | `#c9bdb4` | `.st .goal i`. Also the grey *"all four sparklines take"* once trend data exists. |
| Quiet rail badge | `#a09c98` | `.mk-nav .bdg.q` — a count with no implication that anything is wrong. |

### Buttons

The artifact renders five button treatments and **defines no hover, active, or focus-visible
state for any of them** — there are zero `:hover` rules in the file. Hover states are a genuine
gap in this direction, not something to be read out of it.

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Primary button (daylight) | `#1c1f29` on `#ffffff` text | `.s-head .full` "Open full answer". |
| Primary button (on the band) | `#12141c` on `#ffffff` text | `.alarm .go` "Open form monitoring". |
| Button on yellow | `#332a00` on `#ffcc00` text | `.revbar .open`. |
| Send button | `#ffcc00` with `#332a00` icon | `.ask .send`. |
| Secondary / outline button | `#ffffff`, border `#e6cfc2`, text `#141821` | `.collapsed .show` "Show overview". |

**Open decision, stated in the artifact footer:** *"Two items need a decision: the primary
button colour in the daylight half (near-black, since coral is committed to attention)."*
Near-black is the recommendation, not a settled token.

### Pills and chips

| COLOUR ROLE | HEX | WHERE IT IS USED |
| --- | --- | --- |
| Overdue pill | `#ef6079` / `#ffffff` | `.p-over`. |
| Due-soon pill | `#ffcc00` / `#332a00` | `.p-soon`. |
| Card tag | `#ffcc00` / `#332a00` | `.card h5 .tg`. |
| Chip on paper | `#ffffff`, border `#f0ddd2`, text `#141821` | `.chips span` (Manager resources). |
| Chip inside the ask card | `#fff6f0`, border `#e6cfc2`, text `#141821` | `.inchips span` — suggestions are content, so they sit on canvas inside the white card. |
| Chip on the band | `rgba(255,255,255,.04)`, border `#43454f`, text `#e6e4ea` | `.prompts span`. |
| Chip in the chrome | border `#33353f`, text `#cfcdd6`, icon `#3a3c47` | `.tools span` — the six "Jump to" shortcuts. |
| Jump-strip chip | `#ffffff`, border `#e6cfc2`, icon `#e6cfc2` | `.jump span`. |
| Follow-up chip (new) | border `#ef6079`, text `#c2405c` | `.fups span.new`. |
| Top-bar chip | `rgba(255,255,255,.13)` / `#f0eef2` | `.mk-chip`. |
| Band shortcut tile | `#2c2f3a`, border `#3c3f4b` | `.shorts i`; highlighted variant `rgba(255,204,0,.16)` on `rgba(255,204,0,.45)`. |

### Charts and measures

The artifact draws no chart. It specifies measure treatment only, and the rule is explicit:

- Deltas are **neutral**; coral appears **once**, on the measure short of plan.
- Progress is a `#f0e4da` track with a `#c9bdb4` fill; the flagged one turns `#ef6079`.
- *"When trend data arrives, all four sparklines take the same warm grey and only the flagged
  one turns coral. A neutral delta over a green line is the same inconsistency in a different
  place."*
- *"Nothing flagged is a valid state… A dashboard where something is always coloured teaches
  managers to ignore the colour."*

### Gradients

Exactly two, both radial. There are no linear gradients in the direction.

| COLOUR ROLE | VALUE | WHERE IT IS USED |
| --- | --- | --- |
| Band corner glow | `radial-gradient(110% 150% at 100% 0%, rgba(214,44,58,.4) 0%, rgba(28,31,41,0) 56%)` | `.band` — `#d62c3a` at 40% falling to transparent `#1c1f29`. |
| Brand glow behind the lockup | `radial-gradient(circle, rgba(255,204,0,.22) 0%, rgba(255,204,0,0) 68%)` | `.mk-brand::before` — a 64px soft glow behind the sun mark and wordmark. |

### Shadows and glows

| COLOUR ROLE | VALUE | WHERE IT IS USED |
| --- | --- | --- |
| Ask bar lift (hard yellow underline) | `0 4px 0 #ffcc00` | `.ask`. |
| Ask bar focus glow | `0 4px 0 #ffcc00, 0 0 0 4px rgba(255,204,0,.22)` | `.ask.live` — the typing state. The nearest thing to a focus ring in the artifact. |
| Card shadow | `0 1px 2px rgba(120,80,70,.05), 0 14px 30px -18px rgba(120,80,70,.5)` | `.stats`, `.card` — warm-brown, not neutral black. |
| Coral alarm shadow | `0 1px 2px rgba(120,80,70,.05), 0 14px 30px -18px rgba(180,60,90,.55)` | `.alarm.sect`. |
| Rail active pill shadow | `0 1px 3px rgba(60,58,54,.28)` | `.mk-nav.on`. |
| Alarm dot halo | `0 0 0 4px rgba(255,255,255,.3)` | `.alarm .d`. |

---

## REMOVE / DO NOT USE

### Marked "Remove" in the artifact

| COLOUR | HEX | THE ARTIFACT'S WORDING |
| --- | --- | --- |
| Sage green | `#5c6559` | *"**Remove.** Sage green isn't in this direction and it's what makes buttons and chips read olive today."* |

`#5c6559` is live in this repo right now as `--stc-sage`, and `--accent: var(--stc-sage)` — which
is precisely the olive cast the artifact is describing.

### Prohibitions on colours that stay

| COLOUR | HEX | PROHIBITION |
| --- | --- | --- |
| Attention coral | `#ef6079` | Never a button. *"Pressing and alarming must not look alike."* |
| Red-light red | `#d62c3a` | Never errors, never text, never a fill. Corner glow only. |
| Near-black | `#1c1f29` | Never the left rail. |
| Brand yellow | `#ffcc00` | Never more than two filled blocks per screen. |
| Per-section rail hues | — | Named as *"a specific trap"*: section colour and status colour would then mean different things within the same twelve pixels. |

### Unresolved conflict about green — flagging, not resolving

The artifact says two different things about `#4f7a4c`, and both are load-bearing:

- The palette table keeps it: *"Keep green only for 'up' deltas — `#4f7a4c`."*
- The stats-row section removes it: *"So the deltas are neutral and coral appears once, on the
  metric that is short of goal… **Green is out of the system entirely.**"* Repeated verbatim in
  that section's second caption.

The stats row is the more specific and more recent statement, and the `.st` CSS backs it: the
recommended treatment uses `.st.quiet em { color: #7c7a80 }`, with `#4f7a4c` only on the
unstyled `.st em` default. Read together, `#4f7a4c` is a fallback that the recommended
treatment never reaches. **This needs a decision before either is coded.**

### Never ship — the spec document's own chrome

These are the dark board the artifact is *presented* on, not application colour. A naive
extraction sweeps them up; none belong in Ask Sunny.

`#131319` `#1b1b23` `#2e2e3a` `#3d3d4b` `#f4f2f0` `#bfbcc6` `#8b8896` `#0c0c11` `#6d6a78`
`#5c5966` `#2a2a34` `#4d4d5a` `#8d8a9a` `#1e1e26` `#23232d` `#ff8fa4` `#faf9f5` `#141413` `#000`

(`#8b8896` is the one overlap — it is legitimately the ask-bar placeholder in the mockup *and*
the document's muted text.)

### Current build — the "before", not a target

The `.mk--now` reference plate documents what is deployed today, so the comparison is honest.
The artifact's verdict on it: *"all of it is the same white box on the same peach field, and the
headline and the largest number land within two pixels of each other."*

`#333436` (ink) `#6e7074` (muted) `#8b8b8e` (subtle) `#e7e1db` (border) `#eeeae5` (divider)
`#97663a` (warm-tan active icon) `#f8efdd` / `#9c7429` (gold tag) `#f7eeed` / `#8a6362` (blush
pill) `#a2564e` (brick down-delta) `#5c6559` (sage up-delta — the colour marked Remove)

---

## Deltas against `src/app/globals.css` as it stands

The repo has already adopted the four committed colours as raw tokens — `--approved-topbar`,
`--approved-rail`, `--approved-brand-yellow`, `--approved-followup`, `--approved-redlight`,
`--approved-canvas` all match the artifact exactly. Three things do not:

1. **`--accent: var(--stc-sage)` (`#5c6559`)** is the colour the artifact marks Remove.
   It has no replacement named in the artifact; the direction simply has no accent in that slot.
2. **`--primary: var(--stc-warm-tan-deep)` (`#97663a`)** is a current-build colour. The artifact
   leaves the daylight primary button open, recommending near-black (`#1c1f29`).
3. **Chart series** are on `--stc-warm-tan-deep` / `--stc-warm-tan` / `--stc-slate-deep`. The
   artifact's measure rule is neutral-with-one-coral-flag, which those do not express.

Applying any of these is a separate change with a real component blast radius, and items 1 and 2
depend on decisions the artifact explicitly leaves open. Nothing in this document has been
applied to the token layer.
