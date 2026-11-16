# 2026-11-16 — agent loop: "Other" only where it belongs

**Stays Sunny-only for now.** The agent loop is not in Ask Bubbles yet (behind AGENT_LOOP_ENABLED here). This fixes a
rule from Sunny's PR 6 (#1059, merged through the launch train #1066).
- Only a Corrective Action, the form with policy fields, always carries a policy.
- A Coaching card cites one only when the manager names one or a manual section fits; it never makes "Other — <topic>"
  out of the coaching topic.
- A Corrective Action that cites "Other" alone, for an incident the topic reader fits to a manual section, gets
  fits_headings.

When the loop is ported, take the rule with it; the mechanism is the same, with the Bubbles forms' own policy fields.
