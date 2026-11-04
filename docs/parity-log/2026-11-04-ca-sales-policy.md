# 4 Nov 2026: sales and MSB corrective actions cite the Standards of Conduct — ported from Ask Bubbles (6c825944, #422) (CA_SALES_POLICY_ENABLED, default off)

Pau's client request B1, 4 Nov 2026. On: a Corrective Action whose account
reads as the Under Performance offense type (`TARGET`, or Under Performance
named) or uses a term of the approved chat glossary (MSB, read through
`foldsToGlossaryTerm` in `src/lib/ai/chat-glossary.ts`) is read as the
Standards of Conduct; the card says so, the draft ticks that box and Direct
policy cites the manual's section by heading and page; the drafting model's
Under Performance tick becomes the Standards of Conduct box; one added prompt
line. Same mechanism and flag as Ask Bubbles; no word list. As in Ask Bubbles,
`foldsToGlossaryTerm` ignores CHAT_GLOSSARY_ENABLED, so the MSB reading needs
only CA_SALES_POLICY_ENABLED.

Replay cases in `nov4-ca-sales-policy-cases.ts`, as in Ask Bubbles: the MSB
case and the wrong-items draft hold with the flag on; low sales (metric only,
answered with the progression) and the wrong-items card stay OPEN for Pau;
both negative controls (attendance cites Attendance, cleaning does not cite the
Standards of Conduct) hold. The case wording uses salons and invented names.
