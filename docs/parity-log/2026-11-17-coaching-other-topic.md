# The coaching "Other" topic is the topic (17 Nov 2026)

**Sibling app: not needed.** Ask Bubbles has no agent loop yet, and that is where the card's topic comes from. The
fallback in `other-write-in.ts` reads the form's own employee name, so it ports with OTHER_WRITE_IN_GUARD.

QA (the tester's coaching form): the saved Other topic read "Coaching for test testy on greeting guests at the door".
QA approved (a), with (b) as the fallback:

- **(a) The card's topic.** `propose_form` takes an optional coaching `topic` with `topic_evidence`. It is kept on the card
  (`coachingTopic`) only when all of these hold:
  - the evidence is a manager message of this request;
  - the quote holds every word of the topic;
  - the topic does not hold the person's name.

  Otherwise the fact `topic_not_kept` tells the model. Create sends it as `cardTopic`, and the saved form's Other topic is
  that topic.
- **(b) Fallback.** The topic is the text after the form's own employee name, when a topic lead follows the name
  ("<name> on greeting guests at the door" → "Greeting guests at the door"). "<name> at Kearney" is read as before.
