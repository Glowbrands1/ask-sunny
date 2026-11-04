# CA_SALES_POLICY_ENABLED — flag classification to follow (Ask Sunny)

Ask Bubbles classified this flag in #426 (39 changed, all INTENDED, 0
UNCLASSIFIED, 3 runs each mode). That table names Ask Bubbles' tests and is not
carried here: it does not describe Ask Sunny's suites. The Ask Sunny
classification is still to be run before any flip;
`CA_SALES_POLICY_ENABLED.classes.json` stays `{}` until then.

The one finding from Ask Bubbles' run that is a mechanism, not a test list, is
ported: "on the sales floor" read as a sales shortfall through the looser
`TARGET` words. The flag's reading now uses the stated-shortfall reader
(`forms/metric-shortfall.ts`), and `ca-sales-policy.test.ts` pins it.
