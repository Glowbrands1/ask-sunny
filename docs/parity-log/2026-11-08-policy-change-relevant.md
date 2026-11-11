# Not needed here: POLICY_CHANGE_RELEVANT_ENABLED (code in both apps; on in the sibling app's production)

QA's round-6 flag audit (8 Nov 2026): on in the sibling app's production, never set here. There, a revision ("in the
previously recieved coaching include that <name> signed the jba policy manual on 10-15-26") cited the manual's 401k
sheet headed "Warning" (QA, 5 Nov 2026, severe).

Not needed in this app: checked on main 0ae7b2e, both of its replay cases hold with production's flags and the flag
off (`nov5-policy-benefits-warning-revision`: no "Warning" cited, the turn is not taken as a policy change;
`nov6-policy-change-relevant-remove-attendance`). This app's manual has no "warning" section (NOT_A_SECTION in
`forms/policy-change.ts`). Those cases stay in the pack as the guard.
