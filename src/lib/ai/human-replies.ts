import { humanRepliesEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

/**
 * HUMAN_REPLIES_ENABLED: replies that sound like a person talking to a manager.
 *
 * The owner's rule, 26 Oct 2026: "humanize it". Two parts, both applied to the
 * assembled reply on its way out, so no protected file is edited (owner via
 * QA, 26 Oct: "4.ok", the phrase-table option):
 *
 *   PHRASES rewrites the form flow's robotic sentences ("I'll draft a … from
 *   what you've described, and check the applicable company policy before
 *   anything policy-related goes on it." → "Here's the … for …. I'll check the
 *   policy manual before citing anything."). A question keeps the words its
 *   readers match ("Who is this **…** for?", "Is payroll deduct applicable?",
 *   "Which salon is this about?", the numbered intake list); only the
 *   sentences around it change. "**Nothing has been created" and "You haven't
 *   told me what happened yet" keep their opening words.
 *
 *   On a later card turn for the same form and employee, the opener becomes
 *   one line on what this turn changed, read from the card's own fields
 *   ("Got it — the date's 10/14."); a paragraph, "**Label:**" line or "·"
 *   read-back already shown in this chat is left out; the save notice is
 *   SHORT_SAVE_NOTICE. Questions are never left out.
 *
 * The save notice is on every card. The card (`formProposal`) is returned
 * exactly as built. Off, the answer is returned unchanged.
 */

export const SHORT_SAVE_NOTICE = "Nothing's saved until you tap **Create draft**.";

/** A grounded answer that only says the knowledge base has nothing on the question. */
export const NOT_HERE =
  "That's not something I can help with here — I can help with forms and the policy manual.";

/**
 * The rewrites, longest first. Each is a sentence the form flow builds today
 * (`docs/human-replies-inventory.md` lists where), and what a coordinator
 * would say instead. Nothing here adds a fact or drops a required notice.
 */
const PHRASES: readonly (readonly [RegExp, string])[] = [
  /* Openers. */
  [
    /I'll draft a \*\*([^*\n]+)\*\* for \*\*([^*\n]+)\*\* from what you've described, and check the applicable JB & Associates policy before anything policy-related goes on it\./g,
    "Here's the **$1** for **$2**. I'll check JB & Associates policy before citing anything.",
  ],
  [
    /I'll draft a \*\*([^*\n]+)\*\* for \*\*([^*\n]+)\*\* from what you've described, and check the applicable company policy before anything policy-related goes on it\./g,
    "Here's the **$1** for **$2**. I'll check the policy manual before citing anything.",
  ],
  [/^Here is what I would put on a \*\*([^*\n]+)\*\*\.$/gm, "Here's the **$1**."],
  [/^Here is the ([^*.\n]+)\.$/gm, "Here's the $1."],
  [/Everything I need is here, drawn from your messages? above\./g, "I have everything I need from what you wrote."],

  /* The save notice, in every variant. */
  [
    /I have the employee\. Your account covers every salon, so this form won't name one\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g,
    `Got the employee. It won't name a salon, since you cover them all. ${SHORT_SAVE_NOTICE}`,
  ],
  [
    /This one is for the whole team\. Your account covers every salon, so this form won't name one\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g,
    `It's for the whole team. It won't name a salon, since you cover them all. ${SHORT_SAVE_NOTICE}`,
  ],
  [
    /I have the employee and the salon\. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do\./g,
    `Got the employee and salon. ${SHORT_SAVE_NOTICE}`,
  ],
  [
    /This one is for the whole team, and I have the salon\. Create the draft here when you're ready, and edit it below — nothing is saved to anyone's file until you do\./g,
    `It's for the whole team, and I have the salon. ${SHORT_SAVE_NOTICE}`,
  ],
  [
    /Your account covers every salon, so the form won't name one unless you did\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g,
    `It won't name a salon unless you did, since you cover them all. ${SHORT_SAVE_NOTICE}`,
  ],
  [
    /Your account covers every salon, so this form won't name one\. Create the draft here when you're ready and edit it below — nothing is saved to anyone's file until you do\./g,
    `It won't name a salon, since you cover them all. ${SHORT_SAVE_NOTICE}`,
  ],
  [/Create the draft here when you're ready,? and edit it below — nothing is saved to anyone's file until you do\./g, SHORT_SAVE_NOTICE],
  [
    /Your account covers every salon rather than one, so Ask Sunny will not put a salon on this form\./g,
    "This form won't name a salon, since you cover them all.",
  ],

  /* "Nothing has been created" keeps its opening words. */
  [
    /\*\*Nothing has been created\.\*\* This is a proposal, not a form — I can't create this one in chat yet\./g,
    "**Nothing has been created.** I can't make this form in chat yet.",
  ],
  [
    /\*\*Nothing has been created\.\*\* This is a proposal, not a form\. To file one today, use Create a Form\./g,
    "**Nothing has been created.** To file it today, use Create a Form.",
  ],
  [
    /\*\*Nothing has been created yet\.\*\* Choose the salon below, or tell me which one, and you can create the draft here\./g,
    "**Nothing has been created yet.** Pick the salon below, or tell me, and you can create the draft.",
  ],
  [
    /\*\*Nothing has been created yet\.\*\* Tell me which salon, and you can create the draft here\./g,
    "**Nothing has been created yet.** Tell me the salon and you can create the draft.",
  ],

  /* Read-backs. "Like you said" only where the line already said the manager said it. */
  [
    /(\*\*Type of Warning:\*\* (?:Verbal|Written) Warning), as you said — I'll tick it on the form\. Tell me if that should change\./g,
    "$1, like you said. I'll tick it on the form.",
  ],
  [
    /(\*\*Prior actions:\*\* [^\n]+?), as you said\. I'll list (it|them) on the form — tell me if that should change\./g,
    "$1, like you said. I'll list $2 on the form.",
  ],
  [
    /\*\*On file in Form Monitoring for ([^*\n]+):\*\* ([^\n]+?)\. I'll list (it|them) under prior coaching and corrective action on the form — remove any that shouldn't count\./g,
    "**Already on file for $1:** $2. I'll add $3 as prior actions — remove any that shouldn't count.",
  ],
  [
    /You'll set ([^\n]+?) on the form — I won't guess at (?:it|them), and they don't hold the plan up\./g,
    "You can set $1 on the form; they don't hold the plan up.",
  ],
  [/You'll set ([^\n]+?) on the form — I won't guess at (?:it|them)\./g, "You can set $1 on the form."],
  [/^Is payroll deduct applicable\? \*\*(Yes|No)\*\* — tell me if that should change\.$/gm, "Payroll deduct: **$1**."],
  [/^\*\*Payroll deduction amount\*\* (\*\*[^*\n]+\*\*) — tell me if that should change\.$/gm, "**Payroll deduction amount:** $1."],

  /* A "·" read-back: "…, as you said — tell me if that should change". */
  [/, as you said — tell me if that should change(?= · |$)/gm, ", like you said"],
  [/ — tell me if that should change(?= · |$)/gm, ""],

  /* Questions: the question stays, the explanation around it goes. */
  [
    /One more question: \*\*Is payroll deduct applicable\?\*\* Yes or No\? Tell me here, or tick it on the form — I won't answer it for you\./g,
    "**Is payroll deduct applicable?** Yes or no — here or on the form.",
  ],
  [
    /(Who is this \*\*[^*\n]+\*\* for\?) Give me their name and I'll (?:draft it from what you've told me(?: — you can set the warning level and anything else on the form itself)?|fill in what you've already described)\./g,
    "$1",
  ],
  [
    /(Which of them is this \*\*[^*\n]+\*\* for — [^\n?]+\?) Tell me and I'll (?:draft it from|fill in) what you've already described\./g,
    "$1",
  ],
  [/Who is this form for\? Tell me the employee's full name\./g, "Who is this form for? Full name, please."],
  [/To draft a form, I'll need a few details first:/g, "To draft it, I need:"],
  [/\n\nCould you please provide these\?/g, "\n\nCan you send those?"],
  [/I won't choose which salon this belongs to\. (Which salon is this about\?)/g, "$1"],
  [
    /(\*\*[^*\n]+\*\*) isn't a salon on your assignment, so I can't file a form against it\. (Which of your salons is this about\?)/g,
    "$1 isn't one of your salons. $2",
  ],
  [
    /I can't confirm which salon this would be filed against, so the proposal has none\. A form can only name a salon Ask Sunny can verify you're assigned to\./g,
    "I can't confirm a salon you're assigned to, so I left it off.",
  ],

  /* Intake. The numbered list stays as built: payroll answers are read against its numbers. */
  [
    /Great, I can help you create a (\*\*[^*\n]+\*\*)\. To get started, please provide me with these details:/g,
    "Sure — for the $1 I need:",
  ],
  [
    /Once I have that I'll prepare the [^\n]+? and check the applicable company policy before anything policy-related goes on it\./g,
    "Then I'll draft it and check the policy manual.",
  ],
  [/^I have most of it\. Still missing:$/gm, "Almost there. Still need:"],
  [
    /Let's fill out the (\*\*[^*\n]+\*\*)\. Send me what you have in one message and I'll put each detail in the right place:/g,
    "Let's do the $1. Send what you have in one message:",
  ],
  [
    /To finish it I still need ([^\n]+?)\. Send them here in one message, or fill them in on the form — I won't guess at any of them\./g,
    "Still need $1. Send them here or fill them in on the form.",
  ],
  [/That covers every detail the form asks for\./g, "That's everything the form asks for."],
  [
    /I took (\*\*[^*\n]+\*\*) from earlier in this conversation — if this form is for somebody else, tell me who\./g,
    "I used $1 from earlier. If it's someone else, tell me who.",
  ],
  [/Your role cannot create a (\*\*[^*\n]+\*\*), so I will not propose one\./g, "Your role can't create a $1."],
  [
    /That form is not published in Ask Sunny yet, so I will not stand in for it with a different one\./g,
    "That form isn't published in Ask Sunny yet.",
  ],

  /* The policy line's second sentence. Whether it says "as you said" is not decided here. */
  [
    /I'll quote that section from the current policy manual on the draft; tell me if a different policy applies\./g,
    "I'll quote it on the draft; tell me if it's another policy.",
  ],
  [/I'll quote that section from the current policy manual on the draft\./g, "I'll quote the manual's section on the draft."],
  [
    /The policy manual has no single section to quote for it, so Direct policy is left for you to complete\./g,
    "The manual has no one section for it, so fill in Direct policy yourself.",
  ],
  [
    /\*\*You haven't told me what happened yet\*\*, so I can't cite the policy manual — the draft will come back without the policy section and page\. You can create it now and fill it in yourself, or tell me here what happened and I'll draft it \(or redraft the form you created\) with the manual's section and page cited\./g,
    "**You haven't told me what happened yet.** Tell me and I'll cite the manual's section and page, or create it now and fill it in yourself.",
  ],

  /* Prior coaching. Each keeps the words the note is found by. */
  [
    /Prior coaching is optional\. No finalized record is in this app and no note was given, so the line stays blank\. The draft can still be created\./g,
    "Prior coaching is optional — none on file and none given, so it stays blank.",
  ],
  [
    /Prior coaching already listed from Form Monitoring stays on the form\. Drafts are not used\. The draft can still be created\./g,
    "Prior coaching on file stays on the form (drafts don't count).",
  ],
  [
    /Prior coaching on file \(finalized only\): ([^\n]+?)\. Drafts are not used\. The draft can still be created\./g,
    "Prior coaching on file: $1 (finalized only; drafts don't count).",
  ],
  [/(Prior coaching note: [^\n]+?)\. No finalized record was required\. The draft can still be created\./g, "$1."],

  /* A redraft. */
  [
    /Redrafted the (\*\*[^*\n]+\*\* for \*\*[^*\n]+\*\*) from what you described\.\n\n\*\*Direct policy from official manual\*\* now quotes the manual and cites its section and page\./g,
    "Updated the draft of the $1 — the policy now quotes the manual, with its section and page.",
  ],
  [/Redrafted the (\*\*[^*\n]+\*\* for \*\*[^*\n]+\*\*) from what you described\./g, "Updated the draft of the $1."],
  [/Give it a read below before you finalize\./g, "Have a look below before you finalize."],
];

/** The knowledge base described instead of the question answered. */
const KNOWLEDGE_BASE_ONLY =
  /^(?:The|This) knowledge base\b[^\n]{0,300}?\b(?:nothing (?:in it |in there )?(?:about|on)|doesn't (?:cover|mention|say anything about)|does not (?:cover|mention)|has no(?:thing)? (?:about|on|information))/i;

interface Turn {
  readonly role: string;
  readonly content: string;
  readonly error?: unknown;
}

interface Opener {
  readonly form: string;
  readonly employee: string | null;
}

/** The first line of a card turn, as PHRASES leaves it: the form, then the employee where it names one. */
const OPENERS: readonly RegExp[] = [
  /^Here's the \*\*([^*]+)\*\* for \*\*([^*]+)\*\*\. I'll check .+ before citing anything\.$/,
  /^Here's the \*\*([^*]+)\*\*\.$/,
  /^Here's the ([^*.]+)\.$/,
];

/** Said under the coaching opener. Leaves with it. */
const AFTER_OPENER = /^I have everything I need from what you wrote\.$/;

/** A line that ends with the save notice (or, unrewritten, the long one). */
const SAVE_NOTICE = /(?:nothing is saved to anyone's file until you do\.|Nothing's saved until you tap \*\*Create draft\*\*\.)$/;

/** Never left out, even when the manager has read it before. */
const ALWAYS_KEEP: readonly RegExp[] = [/^\*\*Nothing has been created/, /You haven't told me what happened yet/];

const PAYROLL_READBACK = /^Payroll deduct: \*\*(?:Yes|No)\*\*\.$/;

const LIST_ITEM = /^(?:\d+\.|[-*])\s/;

/** Read-backs set side by side on one line. */
const SEGMENT = " · ";

const DATE_WORDS =
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:today|yesterday|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
const WARNING_WORDS = /\b(?:verbal|written)\b/i;
const PAYROLL_WORDS = /\b(?:deduct\w*|payroll)\b/i;
const BARE_ANSWER = /^\s*(?:yes|yep|yeah|no|nope|n\/a|not applicable)\b[\s.!]*$/i;
const MONEY = /\$\s?\d|\b\d+(?:\.\d{2})?\s*(?:dollars|bucks)\b/i;

/** One fact on the card: how the acknowledgement says it, the read-back lines it stands for, and whether this turn named it. */
interface Fact {
  readonly says: string;
  readonly replaces: readonly RegExp[];
  readonly named: boolean;
}

export function humanizeFormReply(
  answer: AskResponse,
  input: { readonly history: readonly Turn[]; readonly question: string; readonly today: string },
): AskResponse {
  if (!humanRepliesEnabled()) return answer;
  const content = humanPhrases(answer.content);
  if (!answer.formProposal && !answer.formSelection && KNOWLEDGE_BASE_ONLY.test(content.trim())) {
    return { ...answer, content: NOT_HERE, citations: [] };
  }
  const rewritten = content === answer.content ? answer : { ...answer, content };
  const history = input.history.map((turn) =>
    turn.role === "assistant" && typeof turn.content === "string" ? { ...turn, content: humanPhrases(turn.content) } : turn,
  );
  return withoutRepeats(rewritten, { ...input, history });
}

/** PHRASES applied to one reply. */
export function humanPhrases(content: string): string {
  return PHRASES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), content);
}

function withoutRepeats(
  answer: AskResponse,
  input: { readonly history: readonly Turn[]; readonly question: string; readonly today: string },
): AskResponse {
  const proposal = answer.formProposal;
  if (!proposal || proposal.status === "needs_employee") return answer;
  if (!proposal.employeeName && proposal.subject !== "team") return answer;

  const lines = answer.content.split("\n");
  const opener = openerOf(lines[0] ?? "");
  if (!opener || !sameForm(opener.form, proposal.templateName)) return answer;

  const earlier = earlierCardTurns(input.history, proposal);
  if (earlier.length === 0) return answer;

  const seen = new Set(
    earlier
      .flatMap((turn) => turn.content.split("\n"))
      .flatMap((line) => [line, ...line.split(SEGMENT)])
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const lastAssistant = earlier[earlier.length - 1]!.content;
  const facts = factsOf(proposal, input.question, lastAssistant, input.today);
  const changes = facts.filter((fact) => fact.named);
  // A fact said this turn, or already said the same way by an earlier "Got it", is not read back again.
  const earlierText = earlier.map((turn) => turn.content).join("\n");
  const replaced = facts
    .filter((fact) => fact.named || earlierText.includes(fact.says))
    .flatMap((fact) => fact.replaces);

  const paragraphs = answer.content.split(/\n{2,}/);
  const kept: string[] = [];
  let noticed = false;
  paragraphs.forEach((paragraph, index) => {
    const out: string[] = [];
    paragraph.split("\n").forEach((raw, lineIndex) => {
      const line = raw.trim();
      if (!line) return;
      if (index === 0 && lineIndex === 0) return; // the opener
      if (AFTER_OPENER.test(line)) return;
      if (SAVE_NOTICE.test(line)) {
        if (!noticed) out.push(SHORT_SAVE_NOTICE);
        noticed = true;
        return;
      }
      if (ALWAYS_KEEP.some((pattern) => pattern.test(line))) {
        out.push(raw);
        return;
      }
      if (replaced.some((pattern) => pattern.test(line))) return;
      if (line.includes("?") || LIST_ITEM.test(line)) {
        out.push(raw);
        return;
      }
      if (seen.has(line)) return;
      // "**Issue:** … · **Type of warning:** … · …": only the parts not said before.
      const parts = line.split(SEGMENT);
      if (parts.length > 1) {
        const fresh = parts.filter(
          (part) => !seen.has(part.trim()) && !replaced.some((pattern) => pattern.test(part.trim())),
        );
        if (fresh.length > 0) out.push(fresh.join(" · "));
        return;
      }
      out.push(raw);
    });
    if (out.length > 0) kept.push(out.join("\n"));
  });

  return { ...answer, content: [acknowledgement(changes), ...kept].join("\n\n") };
}

function openerOf(line: string): Opener | null {
  for (const pattern of OPENERS) {
    const match = pattern.exec(line.trim());
    if (match?.[1]) return { form: match[1], employee: match[2] ?? null };
  }
  return null;
}

function sameForm(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The assistant turns of this card so far, oldest first: from the most recent
 * opener on, when that opener is this form for this employee. A card for
 * another form or another person starts again with the full explanation.
 */
function earlierCardTurns(history: readonly Turn[], proposal: ChatFormProposal): Turn[] {
  const replies = history.filter((turn) => turn.role === "assistant" && !turn.error && typeof turn.content === "string");
  for (let index = replies.length - 1; index >= 0; index -= 1) {
    const opener = openerOf(replies[index]!.content.split("\n")[0] ?? "");
    if (!opener) continue;
    if (!sameForm(opener.form, proposal.templateName)) return [];
    if (opener.employee && proposal.employeeName && !sameForm(opener.employee, proposal.employeeName)) return [];
    return replies.slice(index);
  }
  return [];
}

/** The card's own fields, each marked with whether the manager's turn names its topic. */
function factsOf(proposal: ChatFormProposal, question: string, lastAssistant: string, today: string): Fact[] {
  const said = question.toLowerCase();
  const facts: Fact[] = [];
  if (proposal.employeeName) {
    facts.push({
      says: `it's for **${proposal.employeeName}**`,
      replaces: [/^\*\*Employee:\*\*/],
      named: said.includes(proposal.employeeName.toLowerCase()),
    });
  }
  const date = proposal.formDate ? shortDate(proposal.formDate, today) : null;
  if (date) facts.push({ says: `the date's ${date}`, replaces: [/^\*\*Date:\*\*/], named: DATE_WORDS.test(question) });
  if (proposal.warningLevel) {
    facts.push({
      says: `it's a ${proposal.warningLevel} warning`,
      replaces: [/^\*\*Type of warning:\*\*/i],
      named: WARNING_WORDS.test(question),
    });
  }
  if (proposal.payrollDeduct === "yes" || proposal.payrollDeduct === "no") {
    const payrollAsked = /payroll deduct applicable\?/i.test(lastAssistant);
    facts.push({
      says: proposal.payrollDeduct === "yes" ? "payroll deduct is a yes" : "no payroll deduct",
      replaces: [PAYROLL_READBACK, /^\*\*Payroll deduct:\*\*/],
      named: PAYROLL_WORDS.test(question) || (payrollAsked && BARE_ANSWER.test(question)),
    });
  }
  if (proposal.payrollDeductAmount) {
    facts.push({
      says: `the deduction's ${proposal.payrollDeductAmount}`,
      replaces: [/^\*\*Payroll deduction amount:?\*\*/],
      named: MONEY.test(question),
    });
  }
  if (proposal.locationName && proposal.locationResolution === "resolved") {
    facts.push({
      says: `it's at **${proposal.locationName}**`,
      replaces: [/^\*\*Salon:\*\*/],
      named: namesPlace(said, proposal.locationName),
    });
  }
  return facts;
}

function acknowledgement(changes: readonly Fact[]): string {
  if (changes.length === 0) return "Got it — here's the card.";
  const parts = changes.map((change) => change.says);
  const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Got it — ${joined}.`;
}

/** "2026-10-14" → "10/14" this year, "10/14/2025" another. */
function shortDate(iso: string, today: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const short = `${Number(month)}/${Number(day)}`;
  return today.startsWith(`${year}-`) ? short : `${short}/${year}`;
}

/** A word of the location's name (four letters or more) in the manager's turn. */
function namesPlace(said: string, name: string): boolean {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
    .some((word) => new RegExp(`\\b${word}\\b`).test(said));
}
