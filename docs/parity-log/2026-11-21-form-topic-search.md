# 2026-11-21 — forms on file by topic (FORM_TOPIC_SEARCH_ENABLED; Pau)

**Sibling app: Bubbles: lands with the loop port (Pau's decision 3, 21 Nov).** Ask Bubbles has no agent loop, and Pau's rule
for now is that no part of it is copied there; this search is a find_past_forms branch, so it moves with the loop.

Pau wants a manager to ask "any forms about cash handling at my salons this month?" or "who's been written up for dress
code?" and get the matching forms. find_past_forms with a topic (`about`) and no employee:

- reads exactly the forms Form Monitoring shows this manager (`chatFormsActor`, `instanceListFilterFor`,
  `visibleInstances`, the same read as a period list; an assistant salon director's own-forms rule holds), narrowed by
  the period and kind of form when given;
- reads those forms' saved text only (`forms/form-topic-search.ts`): the account fields, Policy Violated, and the ticked
  offense, coaching type and topics and review types, never the quoted manual or the Action Plan;
- keeps a form when its saved text holds every word of the topic, and returns form, date, first name, policy and level,
  25 at most, with counts by code (total, people, by_form) and "showing N of M";
- runs only when the manager's own words ask about forms on file (`forms_on_file_evidence`).

Default off (production-flags.json "off"); with it off, a topic-only call is refused plainly (`topic_search_off`).
