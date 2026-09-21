/**
 * ============================================================================
 * THE IDS OF THE SEEDED RECORDS — AND NOTHING ELSE ABOUT THEM
 * ============================================================================
 *
 * The purge has to run on a LIVE deployment: its whole job is removing seeded
 * records that earlier builds wrote into real browsers. So it needs to know
 * which ids those are, in live mode, which means the ids have to ship.
 *
 * THAT IS A GENUINE TENSION AND THIS FILE IS THE NARROWEST RESOLUTION OF IT.
 * The purge cannot delete an id it does not know. What it does not need is
 * the RECORDS: not a name, not a figure, not a title, not a timestamp, not a
 * URL. So the ids travel and the content does not.
 *
 * WHAT SHIPS HERE IS OPAQUE. `conv-seed-1` is a primary key. It states nothing
 * about a salon, a person or a number, and reading the whole file tells you
 * only that some records once existed. The fabricated content those ids point
 * at — Jane Kowalski's coaching record, the invented Daily Stats answer —
 * stays in `data/demo/`, which a live bundle no longer imports.
 *
 * IT CANNOT DRIFT FROM THE SEEDS. `demo-record-ids.test.ts` imports both this
 * file and the demo modules and asserts they hold exactly the same ids, so a
 * seed added, renamed or removed fails the build rather than quietly escaping
 * the cleanup. That test is the only place the two are allowed to meet.
 *
 * THE ALTERNATIVE WAS WORSE. Matching a pattern like `/^conv-seed-\d+$/`
 * would remove the list, and with it the guarantee: a pattern deletes ids
 * nobody has ever shipped, which is how a cleanup starts taking real records.
 * Exact ids are the only rule that cannot over-reach.
 */

/** Seeded chat conversations. `data/demo/chat.ts`. */
export const DEMO_CONVERSATION_IDS: readonly string[] = [
  "conv-seed-1",
  "conv-seed-2",
  "conv-seed-3",
  "conv-seed-4",
  "conv-seed-5",
  "conv-seed-6",
];

/** Seeded generated forms. `data/demo/forms.ts`. */
export const DEMO_GENERATED_FORM_IDS: readonly string[] = [
  "form-2041",
  "form-2038",
  "form-2044",
  "form-2046",
  "form-2047",
  "form-2032",
  "form-2029",
  "form-2050",
  "form-2051",
  "form-2043",
  "form-2036",
  "form-2049",
  "form-2035",
  "form-2052",
];

/** Seeded form templates. `data/demo/templates.ts`. */
export const DEMO_FORM_TEMPLATE_IDS: readonly string[] = [
  "tpl-coaching",
  "tpl-dpoa",
  "tpl-sdit-epp",
  "tpl-tsd-epp",
  "tpl-dmit-tsd",
  "tpl-dmit-dmit",
  "tpl-asd-sdit",
  "tpl-fttc",
  "tpl-policy-review",
];
