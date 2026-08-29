import type { AnswerMode, ChatConversation } from "@/types";
import { isoHoursFromAnchor } from "@/lib/utils/date";

/**
 * Seeded chat content — DEMO CONTENT.
 *
 * Every answer below is written for this prototype. None of it is real company
 * policy language; where an answer describes "what the policy says" it is
 * paraphrasing the seeded demo documents, and the UI labels it accordingly.
 *
 * FUTURE: MockAIProvider is replaced by ClaudeProvider, which sends the
 * retrieved chunks plus the manager's question to Claude and streams the
 * response. The shape of what comes back — prose, citations, recommended
 * videos, an optional form handoff — does not change.
 */

export const ANSWER_MODE_HELPER: Record<AnswerMode, string> = {
  quick: "Quick — the short answer, nothing else.",
  standard: "Standard — the answer with the why and the manager-ready next step.",
  detailed:
    "Detailed — the full picture, including what to document and where to verify it.",
};

export const ANSWER_MODE_LABEL: Record<AnswerMode, string> = {
  quick: "Quick",
  standard: "Standard",
  detailed: "Detailed",
};

export const SUGGESTED_PROMPTS = [
  "What should I focus on in today's Daily Stats?",
  "Help me prepare for a coaching conversation.",
  "What does our policy say about attendance?",
  "Create a coaching form for a performance concern.",
  "How should I handle a client objection?",
  "Show me training related to this issue.",
];

/** The standing note beneath the composer. */
export const MANAGER_NOTE =
  "Sunny supports your decision-making — it does not replace it. Verify official policy, HR, loss prevention, payroll, safety, and maintenance-risk actions through the right leadership channel before you act.";

export interface DemoAnswer {
  id: string;
  /** Lowercase keywords matched against the manager's question. */
  matchers: string[];
  quick: string;
  standard: string;
  detailed: string;
  citationChunkIds: string[];
  videoIds: string[];
  followUps?: string[];
}

export const DEMO_ANSWERS: DemoAnswer[] = [
  {
    id: "ans-daily-stats",
    matchers: [
      "daily stats",
      "daily stat",
      "focus on today",
      "numbers today",
      "report today",
      "conversion",
      "traffic",
      "average ticket",
    ],
    quick:
      "Start with conversion. It is down 1.4 points week over week while traffic is up 6.2%, so the gap is on the floor, not in the door.",
    standard: `Start with **conversion**.

Traffic was up 6.2% against the same weekday last week, but membership conversion fell 1.4 points to 24.6%. More guests came in and fewer of them left with a membership — that points at the conversation on the floor rather than at marketing.

**Read the report in this order:** traffic against the same weekday last week → conversion → average ticket → membership mix. Pick the single largest gap and coach one behaviour against it, not four.

**Your manager-ready next step:** in today's huddle, name conversion as the one focus. Ask each consultant to present membership options to every eligible guest, including during the evening rush, and check back at close.`,
    detailed: `Start with **conversion** — it is the only measure moving the wrong way.

**What the numbers say**
- Guests served: 486 yesterday, up 6.2% against the same weekday last week.
- Membership conversion: 24.6%, down 1.4 points week over week.
- Average ticket: $41.80, up $1.35.
- Upgrades: 63, up 9 against the same weekday.

Traffic and ticket are both healthy. That isolates the problem: more people are walking in, and a smaller share of them are converting. A strong conversion rate on low traffic is a marketing problem; high traffic with weak conversion is a coaching problem on the floor.

**How to read it**
Work the report in a fixed order — traffic against the same weekday last week, then conversion, then average ticket, then membership mix. Comparing to the same weekday matters: a Tuesday never looks like a Saturday.

**What to do today**
1. Name conversion as the single focus in the huddle. One behaviour, not four.
2. Ask for the membership conversation with every eligible guest, specifically during the evening rush — that is where it usually gets skipped.
3. Spend twenty minutes on the floor during peak and observe rather than assist.
4. At close, review what you saw with whoever is on shift: one thing that went well, one thing to adjust.

**What to document**
If you observe the membership conversation being skipped by a specific consultant, that is a coaching conversation, and it should be documented the same day. Sunny can draft the coaching form for you.

**Where to verify**
Figures above are demo data in this prototype. In production these come from the Daily Stats report — confirm against the source report before you coach against a number.`,
    citationChunkIds: ["chunk-007", "chunk-008", "chunk-012"],
    videoIds: ["vid-07", "vid-01"],
    followUps: [
      "Draft a coaching form about membership conversion",
      "Show me training on membership presentation",
    ],
  },
  {
    id: "ans-coaching-prep",
    matchers: [
      "coaching conversation",
      "prepare for a coaching",
      "prep for a coaching",
      "how do i coach",
      "coach someone",
      "difficult conversation",
      "performance conversation",
    ],
    quick:
      "Know the specific behaviour and the dates before you start. Name the gap, ask an open question, agree one expected behaviour, set a follow-up date, document it the same day.",
    standard: `**Prepare before you open your mouth.** You need three things written down: the specific behaviour, the dates it happened, and the standard it falls short of. Vague coaching reads as personal; specific coaching reads as fair.

**The shape of the conversation**
1. Name the gap plainly — behaviour and dates, no build-up.
2. Ask an open question so they can explain. Listen to the whole answer.
3. Agree **one** expected behaviour going forward.
4. Set a follow-up date and say what you will be looking for.

**Your manager-ready next step:** decide your one expected behaviour before you walk in. If you cannot say it in a single sentence, you are not ready to have the conversation yet.

Document it the same day — the record protects the team member as much as it protects the business.`,
    detailed: `**Before the conversation**

Write down three things:
- The specific behaviour — what was observed, not what you concluded.
- The dates it occurred. Two or three concrete instances beats "lately".
- The standard it falls short of, and where that standard is written.

If you cannot fill in all three, the conversation is not ready. Vague coaching lands as personal criticism; specific coaching lands as fair.

**During the conversation**

1. **Name the gap plainly.** "On the 12th, 15th and 19th you were between ten and twenty minutes late to a scheduled shift." No preamble, no sandwich.
2. **Ask an open question.** "Help me understand what is happening." Then stop talking. You may learn something that changes the conversation entirely.
3. **Agree one expected behaviour.** One. A person can change one thing reliably; four things change nothing.
4. **Offer support where it is real** — a schedule adjustment, a shadowing shift, extra product training.
5. **Set the follow-up date** and say out loud what you will be looking for on that date.

**After the conversation**

Document it the same day, while it is accurate. Record what was observed and what was agreed — not speculation about why. Set the follow-up in Form Monitoring so it does not quietly lapse.

**On the follow-up date**

The follow-up is a real conversation, not a box to tick. You either confirm the change has held, or you escalate to the next step. If circumstances genuinely changed, move the date rather than let it expire.

**Where to verify**
This reflects the seeded demo Coaching Conversation Guide and Salon Director Manual. Before a formal step, read the exact wording in the official manual and confirm the sequence with your District Manager.`,
    citationChunkIds: ["chunk-004", "chunk-005", "chunk-006"],
    videoIds: ["vid-04", "vid-05"],
    followUps: [
      "Create a coaching form for a performance concern",
      "What should I document afterwards?",
    ],
  },
  {
    id: "ans-attendance",
    matchers: [
      "attendance",
      "tardy",
      "tardiness",
      "late",
      "call out",
      "call-out",
      "punctuality",
      "no show",
    ],
    quick:
      "Ready to work at shift start; late arrivals are recorded as occurrences. Call-outs go to the Salon Director by phone, as early as possible — text alone is not sufficient notice.",
    standard: `**What the seeded policy says**

Team members are expected to be ready to work at the start of their scheduled shift — not arriving at it. A late start is recorded as an occurrence, and repeated occurrences in a rolling period move through the standard coaching sequence, beginning with a documented conversation before any formal step.

Call-outs go to the Salon Director **directly, by phone**, as far ahead of the shift as possible. A text on its own is not treated as sufficient notice. Record the call-out the same day so a pattern is visible before it becomes a performance issue.

**Your manager-ready next step:** if you are seeing a pattern, pull the specific dates first, then hold a documented coaching conversation. Sunny can draft the form once you have the dates.`,
    detailed: `**What the seeded policy says**

*Punctuality.* Team members are expected to be ready to work at the start of their scheduled shift. Arriving at the start time and then getting ready does not meet the standard. A late start is recorded as an occurrence.

*Occurrences.* Repeated occurrences within a rolling period are addressed through the standard coaching sequence. A documented conversation comes first — a formal step is not the opening move.

*Call-outs.* Notice goes to the Salon Director directly, by phone, as far ahead of the shift as possible. Text-only notice is not considered sufficient. The Salon Director records the call-out the same day.

**How to handle a pattern**

1. Pull the specific dates and times. Three concrete instances is a conversation; "always late" is not.
2. Hold a documented coaching conversation naming those dates.
3. Agree one expected behaviour — ready to work at scheduled start, every shift.
4. Set a follow-up date and put it in Form Monitoring.
5. Escalate only if the follow-up shows no change, and confirm the correct step with your District Manager first.

**A caution worth repeating**

Attendance conversations sit close to payroll and HR. This answer paraphrases seeded demo content. Read the exact language in the official policy manual before a formal step, and confirm the sequence through your leadership channel.`,
    citationChunkIds: ["chunk-001", "chunk-002", "chunk-003"],
    videoIds: ["vid-04"],
    followUps: [
      "Create a coaching form for repeated tardiness",
      "What is the difference between coaching and a DPOA?",
    ],
  },
  {
    id: "ans-objection",
    matchers: [
      "objection",
      "client objection",
      "guest objection",
      "too expensive",
      "price",
      "push back",
      "pushback",
      "says no",
    ],
    quick:
      "Listen to the whole objection, name which of the four it is — price, commitment, time, or a past experience — and answer that one. Reframe price around cost per visit.",
    standard: `**Answer the objection you actually heard.**

Almost every objection is one of four things: price, commitment length, time, or a bad past experience. Listen to the whole thing before you respond — answering the wrong one reads as not listening, and that costs you more than the objection did.

**On price specifically:** acknowledge it directly rather than defending the number, then reframe around cost per visit at the frequency the guest just described. If the real objection is commitment length, stop defending the price and move the conversation to the shorter tier.

**Your manager-ready next step:** match the tier to how the guest says they will actually use the salon. A tier they can sustain retains better than an upgrade that lapses in month two.`,
    detailed: `**Step one: hear all of it**

Let the guest finish. Most objections are one of four things:
- **Price** — the number feels high.
- **Commitment** — the length of the agreement, not the cost.
- **Time** — they do not think they will come often enough.
- **Past experience** — something went wrong before, here or elsewhere.

Name to yourself which one you are hearing, then answer that one. Answering the wrong objection is the most common floor mistake, and it reads as not listening.

**Price**
Acknowledge it plainly — "it is a real number" — then reframe around cost per visit at the frequency they just told you. Do not defend the price; put it next to the usage.

**Commitment**
Stop selling the tier you were on. Move to the shorter option. A guest who says yes to a smaller commitment is a member; a guest who says no to a large one is not.

**Time**
This is usually honest. Match the tier to actual expected usage rather than to the highest price point — the guide is explicit that a sustainable tier retains better than an upgrade that lapses.

**Past experience**
Ask what happened. Fix what you can fix today, in front of them. Do not negotiate until it is addressed.

**After the conversation**
Log the outcome either way. Objection patterns across a week are coachable; single conversations are not.

**Where to verify**
Paraphrased from the seeded demo Membership Sales Guide and Objection Handling Reference.`,
    citationChunkIds: ["chunk-010", "chunk-016", "chunk-009"],
    videoIds: ["vid-02", "vid-01", "vid-03"],
    followUps: [
      "Show me training on membership presentation",
      "How do I coach a consultant on conversion?",
    ],
  },
  {
    id: "ans-training",
    matchers: [
      "show me training",
      "training related",
      "video",
      "videos",
      "tutorial",
      "watch",
      "training on",
    ],
    quick:
      "Here are the training videos that match what you are working on. Each one is under five minutes.",
    standard: `Here is the training that matches what you are working on.

Sunny matches videos on the equipment, keywords, category, and tags attached to each one — so describing the problem in plain language is enough. You do not have to know the video's title.

**Your manager-ready next step:** assign one video, not five. Watch it with the team member if the gap is a skill rather than an effort issue.`,
    detailed: `Here is the training that matches what you are working on.

**How the matching works**

Every video in the library carries four things Sunny matches against: the equipment it covers, its keywords, its category, and its tags. Describe the problem the way you would say it out loud — "the spray booth will not start", "my new consultant keeps skipping the membership conversation" — and Sunny surfaces the videos attached to that language.

**How to use it well**

- Assign **one** video. A list of five gets none of them watched.
- If the gap is a skill, watch it together and then have them do it once in front of you.
- If the gap is effort rather than skill, a video will not fix it — that is a coaching conversation.
- Log completion in the training tracker so certification stays current.

**Coming later**

Videos will be transcribed, which means Sunny will be able to answer from what is said inside a video, not only from its metadata. Transcription is not part of this phase.`,
    citationChunkIds: ["chunk-006"],
    videoIds: ["vid-04", "vid-07", "vid-10", "vid-14"],
    followUps: ["Show me equipment troubleshooting videos", "What training is new this month?"],
  },
  {
    id: "ans-safety",
    matchers: [
      "safety",
      "injury",
      "injured",
      "incident",
      "emergency",
      "unsafe",
      "hurt",
      "accident",
    ],
    quick:
      "Make the area safe, provide or summon care, document what was observed, and notify your District Manager the same day. Unsafe equipment comes out of service immediately.",
    standard: `**Immediate order of operations**

1. Make the area safe.
2. Provide or summon appropriate care.
3. Document what happened while it is fresh — what was **observed**, not what you concluded about the cause.
4. Notify your District Manager the same day.

**On equipment:** anything suspected of being unsafe comes out of service immediately and is tagged, before any further guest use. Equipment risk is escalated the same day — it is never held for the next scheduled maintenance visit.

**Your manager-ready next step:** if this is live right now, stop reading and make the area safe. Then call your District Manager. Safety actions go through your leadership channel, not through Sunny.`,
    detailed: `**If something is happening now, act first and read this after.**

**Order of operations**

1. **Make the area safe.** Move people away from the hazard before anything else.
2. **Care.** Provide or summon appropriate care immediately.
3. **Document.** Write down what was observed — time, location, who was present, what was seen. Do not speculate about cause in the written record. Speculation in a safety document creates problems later for everyone.
4. **Notify.** Your District Manager, the same day. Not the next shift.

**Equipment specifically**

Any equipment suspected of being unsafe is taken out of service immediately and tagged before any further guest use. It is escalated the same day through the service request path. It is never left running until the next scheduled maintenance visit, and it is never quietly kept in rotation because the salon is busy.

**Guest reports of discomfort**

Respond calmly, record what the guest describes in their own words, and follow the incident reporting procedure. Do not offer a medical opinion.

**This is a verify-first topic**

Safety and injury handling run through your leadership channel. This answer paraphrases seeded demo content for the prototype. Follow the official procedure and your District Manager's direction — not a chat answer.`,
    citationChunkIds: ["chunk-013", "chunk-014"],
    videoIds: ["vid-15"],
    followUps: ["What goes in an incident report?", "Show me equipment troubleshooting videos"],
  },
  {
    id: "ans-dress-code",
    matchers: ["dress code", "uniform", "name badge", "badge", "footwear", "grooming"],
    quick:
      "Approved tops, name badge in place, closed-toe footwear, grooming standards met. Someone sent home to correct it is coached in private and documented the same day.",
    standard: `**What the seeded policy covers**

Dress code expectations cover approved tops, name badge placement, closed-toe footwear, and grooming standards.

If a team member has to be sent home to correct a dress code issue, the conversation happens in private — never on the floor, never in front of guests — and it is documented the same day.

**Your manager-ready next step:** if this is a first occurrence, a private verbal coaching is usually the right weight. Document it so a pattern is visible if it repeats.`,
    detailed: `**What the seeded policy covers**

- Approved tops for the role.
- Name badge, worn and visible in the correct position.
- Closed-toe footwear.
- Grooming standards.

**Handling it well**

1. **In private, every time.** A dress code correction delivered on the floor costs you more in credibility than the dress code violation cost you.
2. **First occurrence** is normally a private verbal coaching. Document it — not to punish, but so a pattern is visible if it repeats.
3. **If they must be sent home** to correct it, that is a documented conversation the same day.
4. **A repeat pattern** moves into the standard coaching sequence. Pull the specific dates before you escalate.

**A note on consistency**

Dress code is the standard most often applied unevenly across a team, and unevenness is what makes it feel personal. If you are coaching one person, be confident you would coach anyone else on the same thing.

**Where to verify**
Paraphrased from the seeded demo Attendance & Dress Code Policy. Confirm the exact wording in the official manual before any formal step.`,
    citationChunkIds: ["chunk-003", "chunk-001"],
    videoIds: ["vid-04"],
    followUps: ["Create a coaching form about dress code", "What does our policy say about attendance?"],
  },
  {
    id: "ans-membership",
    matchers: [
      "membership",
      "sell",
      "sales",
      "upgrade",
      "conversion rate",
      "tier",
      "convert",
    ],
    quick:
      "Match the tier to how the guest says they will actually use the salon, not to the highest price point. Sustainable tiers retain; oversold ones lapse.",
    standard: `**Match the tier to actual usage.**

The strongest membership conversation is not the one that lands the highest tier — it is the one that lands the tier the guest can sustain. A tier that fits retention beats an upgrade that lapses in month two.

**On the floor:** present the options, describe them in terms of how the guest just said they plan to visit, and let them choose. Pressure converts today and churns next quarter.

**Your manager-ready next step:** if conversion is soft, watch the evening rush. The membership conversation is almost always the first thing dropped when the salon gets busy.`,
    detailed: `**The principle**

Match the membership tier to how the guest actually plans to use the salon rather than to the highest price point. A tier the guest can sustain produces better retention than an upgrade that lapses in month two — which shows up in your numbers as a conversion win and a retention loss.

**The conversation**

1. Ask how often they expect to come in. Listen to the answer.
2. Present the options in terms of that frequency — cost per visit, not monthly price.
3. Recommend one. "Based on twice a week, this is the one that makes sense for you."
4. Let them choose. Silence after a recommendation is not a problem to fill.

**When conversion is soft**

- Check whether the conversation is happening at all during peak. It is the first thing dropped when the salon is busy.
- Check whether it is happening with *every eligible guest* or only the easy ones.
- Check the objection pattern for the week. If everyone hears "too expensive", the framing is wrong, not the price.

**Upgrades**

Introduce an upgrade when the guest's usage pattern already supports it — a member coming four times a week on a tier built for two is a service conversation, not a sales one.

**Where to verify**
Paraphrased from the seeded demo Membership Sales Guide and Upgrade & Add-On Conversation Guide.`,
    citationChunkIds: ["chunk-009", "chunk-010"],
    videoIds: ["vid-01", "vid-03", "vid-02"],
    followUps: ["How should I handle a client objection?", "What should I focus on in today's Daily Stats?"],
  },
  {
    id: "ans-reviews",
    matchers: ["google review", "reviews", "rating", "review count", "reputation", "stars"],
    quick:
      "Reviews gained this week is on the Google Reviews screen — 148 across all salons, two fewer than last week. Willow Park and Hillcrest Station are furthest below goal.",
    standard: `**Where to look:** the Google Reviews screen carries the number someone currently counts by hand each week.

This week: **148 reviews gained** across all salons, against a combined goal of 185 — two fewer than last week. Average rating is 4.61. Two salons are meaningfully below goal: Willow Park (3 of 15) and Hillcrest Station (4 of 15).

**Asking well:** ask a guest who has just had a good visit, in the moment, while they are still standing there. A request sent later converts far less often.

**Your manager-ready next step:** for the two salons below goal, make the ask part of the close of every positive interaction this week, and check the count on Friday rather than at month end.`,
    detailed: `**The number you are looking for**

"Reviews gained this week" is the figure someone currently produces by opening every location's Google listing, writing down the total, and subtracting last week's total. On the Google Reviews screen it is calculated instead: **148 this week**, against a combined weekly goal of 185, at an average rating of 4.61 — two fewer than last week.

**Who needs attention**

- Willow Park — 3 gained, goal 15, rating 4.2.
- Hillcrest Station — 4 gained, goal 15, rating 4.4.
- Northgate Square — 7 gained, goal 15, rating 4.5.

Rating and volume are moving together at those three, which usually means an experience problem rather than an asking problem. Look at wait times and room readiness before you coach the ask.

**How to ask well**

- Ask in the moment, at the end of a visit that clearly went well.
- Ask the specific guest, not the room.
- Make it part of the close of a good interaction, not a separate campaign.
- Respond to reviews — especially the critical ones. A responded-to two-star review reads very differently to the next guest than an ignored one.

**What is coming**

Connecting the Google Business Profile API removes the manual count entirely and updates these figures automatically. It is listed on the Integrations screen and is not connected in this prototype.`,
    citationChunkIds: ["chunk-015"],
    videoIds: [],
    followUps: ["Which salons need attention this week?", "Show me client experience training"],
  },
  {
    id: "ans-opening",
    matchers: ["opening", "closing", "checklist", "open the salon", "close the salon", "huddle"],
    quick:
      "Opening: equipment checks, cleanliness walk, product levels, two-minute huddle on the day's focus. The Salon Director confirms it is complete before the first guest.",
    standard: `**Opening**

Equipment checks, cleanliness walk, product levels, then a two-minute huddle on the day's single focus. The Salon Director confirms the checklist is complete before the first guest is served — confirming is part of the standard, not a formality.

**Closing**

Review results against the day's focus with whoever is on shift. Name one thing that went well and one thing to adjust tomorrow. Keep it under five minutes.

**Your manager-ready next step:** if checklists are being marked complete without being done, that is a documented coaching conversation — and it is worth doing early, because it is the standard everything else rests on.`,
    detailed: `**Opening — the first thirty minutes**

1. Equipment checks across every bed and booth.
2. Cleanliness walk, front of house through to the rooms.
3. Product levels against par.
4. Two-minute team huddle on the day's single focus.
5. Salon Director confirms the checklist is complete before the first guest is served.

The confirmation step is the one most often skipped, and it is the one that makes the rest real.

**Through the day**

Mid-day reset on cleanliness and product. Room turnover to standard between every guest — turnover time is the first thing that slips during an evening rush, and it is visible to every guest waiting at the desk.

**Closing**

Complete the closing checklist in order, prepare the deposit per the cash handling procedure, then close the day with whoever is on shift: one thing that went well, one thing to adjust tomorrow. Five minutes, not fifteen.

**If checklists are being signed without being done**

Address it early and directly. It is a documented coaching conversation, and it matters more than it looks — every other operational standard depends on the checklist being honest.

**Where to verify**
Paraphrased from the seeded demo Salon Operations Guide and Opening & Closing Checklist.`,
    citationChunkIds: ["chunk-011", "chunk-012"],
    videoIds: ["vid-08", "vid-09"],
    followUps: ["What should I focus on in today's Daily Stats?", "Show me operations training"],
  },
  {
    id: "ans-epp",
    matchers: ["epp", "performance plan", "employee performance plan", "dpoa", "corrective action", "write up", "written warning"],
    quick:
      "Coaching documents a conversation. A DPOA is the formal corrective step after coaching has not held. An EPP is a development plan with measurable objectives over a set period.",
    standard: `**The three are different tools.**

- **Coaching Form** — documents a conversation about a specific gap, with one expected behaviour and a follow-up date. This is the everyday tool.
- **Disciplinary Plan of Action (DPOA)** — the formal corrective step, used after coaching on the same topic has not held. It records prior conversations, the plan, and the consequence.
- **EPP (Employee Performance Plan)** — a development plan over a set period (commonly 30/60/90 days) with measurable objectives and a review date. Used for role development as much as for performance concern.

**Your manager-ready next step:** if there is no documented coaching on this topic yet, start there. A DPOA without a documented conversation in front of it is difficult to support.

Confirm the correct step with your District Manager before you open a DPOA.`,
    detailed: `**Coaching Form**

The everyday tool. Documents that a conversation happened about a specific gap, names one expected behaviour, and sets a follow-up date. Most people issues should be resolved here and never go further.

**Disciplinary Plan of Action (DPOA)**

The formal corrective step, used when documented coaching on the same topic has not produced a change. It records:
- prior conversations on this topic, with dates and outcomes
- the step level (documented verbal, written, final written)
- the plan of action
- the consequence if expectations are not met

A DPOA with no documented coaching in front of it is hard to support. Build the record first.

**EPP — Employee Performance Plan**

A development plan over a defined period, commonly 30, 60, or 90 days, with measurable objectives and a scheduled review. The template set covers several tracks: SDIT EPP, TSD EPP, DMIT EPP (TSD Review and DMIT Review stages), ASD-SDIT Performance EPP, and FTTC Performance EPP.

An EPP is used for development as often as for concern — the ASD-SDIT plan is a promotion track, not a correction.

**Policy Review**

Separate from all three. Records that a specific policy was reviewed with a team member and acknowledged. Used at onboarding, after a policy update, or following an incident.

**Before you open a formal step**

Confirm the correct step with your District Manager, and read the exact policy language in the official manual. Sunny drafts from the knowledge base — it does not decide the disciplinary step for you.`,
    citationChunkIds: ["chunk-004", "chunk-006"],
    videoIds: ["vid-05", "vid-04"],
    followUps: ["Create a coaching form for a performance concern", "Help me prepare for a coaching conversation."],
  },
  {
    id: "ans-equipment",
    matchers: ["spray booth", "bed", "lamp", "equipment", "error code", "broken", "not working", "maintenance"],
    quick:
      "Run the first checks before logging a service request. If the equipment is suspected unsafe, take it out of service and tag it immediately — do not wait for the next visit.",
    standard: `**Run the first checks, then escalate properly.**

There is a short set of checks to run before logging a service request — most spray booth and bed faults resolve there, and a service visit for something that was on the checklist costs the salon a day of that equipment.

**The exception:** if the equipment is suspected of being unsafe, it comes out of service immediately and is tagged, before any further guest use. That escalates the same day. It is never held for the next scheduled maintenance visit.

**Your manager-ready next step:** watch the two-minute troubleshooting video for the equipment in question, run the checks, then log the request with what you already tried.`,
    detailed: `**Order of operations**

1. **Is it a safety issue?** If the equipment is suspected of being unsafe, stop here — take it out of service, tag it, and escalate the same day through the service request path. Do not run diagnostics on equipment you suspect is unsafe with guests in the building.
2. **Run the first checks.** Each equipment class has a short pre-service checklist. Most faults resolve there.
3. **Log the request with detail.** Include the error code, what you already tried, and when it started. A request that says "not working" gets a slower and less useful visit.
4. **Record it.** The maintenance log is what makes a recurring fault visible as recurring.

**Common ones**

- **Spray booth will not start** — four checks before logging. Covered in a three-minute video.
- **Bed reporting an error code** — read the code first; it tells you whether the bed can stay in service.
- **Lamp replacement** — follow the documented interval and log the change. Skipped logging is why lamp intervals drift.

**Escalation**

Equipment risk goes same-day. Everything else follows the standard service request path. When in doubt about whether something is a risk, treat it as one and call your District Manager.

**Where to verify**
Paraphrased from the seeded demo Service Request & Escalation Guide, Spray Booth Troubleshooting Reference, and Safety Procedures.`,
    citationChunkIds: ["chunk-014"],
    videoIds: ["vid-14", "vid-15", "vid-12"],
    followUps: ["Show me equipment troubleshooting videos", "What are our safety procedures?"],
  },
];

/** Returned when nothing in the answer bank matches. */
export const FALLBACK_ANSWER = {
  quick:
    "This prototype answers from a seeded demo knowledge base, so this question does not have a canned response yet.",
  standard: `This prototype runs on **MockAIProvider** — a seeded set of demo answers over demo documents — so it does not have a response prepared for this question.

Try one of the suggested questions, or ask about Daily Stats, coaching conversations, attendance, dress code, membership sales, objections, safety, equipment, opening and closing, or Google reviews.

Once Claude is connected, this question is answered live from whatever is actually in the knowledge base — with the same source cards you see on the seeded answers.`,
  detailed: `This prototype runs on **MockAIProvider**, a seeded set of demo answers over a demo knowledge base, so it does not have a prepared response for this question.

**What works today**

Ask about any of these and you will get a grounded answer with source cards:
- Daily Stats and what to act on first
- Preparing for and documenting a coaching conversation
- Attendance, punctuality, call-outs, dress code
- Membership sales, upgrades, and objection handling
- Safety, incidents, and equipment risk
- Equipment troubleshooting and maintenance
- Opening and closing standards
- Google reviews and reviews gained
- Coaching vs DPOA vs EPP

You can also say "create a coaching form for [name] regarding [issue]" to run the chat-to-form flow.

**What changes when Claude is connected**

Every question is answered live against the real knowledge base. Retrieval returns the actual chunks from your uploaded documents, Claude answers from those chunks, and the same source cards show which document and page the answer came from. Nothing about the interface changes — only what is behind it.`,
};

/** Seeded conversation history for the sidebar. */
export const DEMO_CONVERSATIONS: ChatConversation[] = [
  {
    id: "conv-seed-1",
    title: "Daily Stats — conversion focus",
    createdAt: isoHoursFromAnchor(-3),
    updatedAt: isoHoursFromAnchor(-3),
    attachedDocumentIds: [],
    messages: [
      {
        id: "msg-s1-1",
        role: "user",
        content: "What should I focus on in today's Daily Stats?",
        createdAt: isoHoursFromAnchor(-3),
      },
      {
        id: "msg-s1-2",
        role: "assistant",
        content: DEMO_ANSWERS[0].standard,
        createdAt: isoHoursFromAnchor(-3),
        mode: "standard",
        citations: [],
      },
    ],
  },
  {
    id: "conv-seed-2",
    title: "Coaching a consultant on tardiness",
    createdAt: isoHoursFromAnchor(-27),
    updatedAt: isoHoursFromAnchor(-27),
    attachedDocumentIds: [],
    messages: [],
  },
  {
    id: "conv-seed-3",
    title: "Attendance policy — call-out notice",
    createdAt: isoHoursFromAnchor(-52),
    updatedAt: isoHoursFromAnchor(-52),
    attachedDocumentIds: [],
    messages: [],
  },
  {
    id: "conv-seed-4",
    title: "Spray booth will not start",
    createdAt: isoHoursFromAnchor(-96),
    updatedAt: isoHoursFromAnchor(-96),
    attachedDocumentIds: [],
    messages: [],
  },
  {
    id: "conv-seed-5",
    title: "Membership objection — price",
    createdAt: isoHoursFromAnchor(-168),
    updatedAt: isoHoursFromAnchor(-168),
    attachedDocumentIds: [],
    messages: [],
  },
  {
    id: "conv-seed-6",
    title: "Preparing for an ASD development plan",
    createdAt: isoHoursFromAnchor(-312),
    updatedAt: isoHoursFromAnchor(-312),
    attachedDocumentIds: [],
    messages: [],
  },
];
