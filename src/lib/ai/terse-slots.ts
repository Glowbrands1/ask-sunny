import { terseCommandOnlyEnabled, terseSlotReadEnabled } from "@/lib/config/chat-quality-flags";
import { extractJobTitle } from "@/lib/forms/proposal";
import { readSalonMentions } from "@/lib/forms/salon-mention";

import type { AskRequest } from "./types";

/**
 * TERSE_SLOT_READ_ENABLED: a terse "ca …" line is read like the long form.
 *
 * Ask Sunny conv_mvoffldz24z2t0u, 25 Oct 2026: "ca <name> opened late 15 min
 * 9-20 verbal 25 deduct" showed a card with no warning level, no payroll
 * answer or amount and no Date. Ask Bubbles conv_mvofim8a2lqx6jn: "ca <name>
 * kearney dress code 10/11 verbal" read "<name> Kearney" as the name and gave
 * no card at all.
 *
 * QA persona batches, 25 Oct 2026: "ca for <name> not opening salon on time
 * and no call no show" was read as OPEN a form on file; "coach <name> woven
 * acks 10-16" and "exit <name> tc ks manhattan nc/ns last day 9/20 …" opened
 * no form.
 *
 * The long form already reads every one of those slots, so a terse request —
 * a short form word (`SHORT_FORM_WORDS`) and then a name — is written out as
 * the long form before anything reads it: "Create a corrective action form
 * for <name> at <place>, <title>. On <date> <name> <what happened>. This is a
 * verbal warning. Payroll deduct applies and $25 will be deducted." An exit's
 * facts stay as typed after the request. Only manager turns that are such a
 * line are written out; every word of the account stays as typed, and any
 * case is read ("CA", "ca"). A question, a topic ("exit process", "coaching
 * tips") or a sentence is left alone. Off, the request is passed on as it is.
 *
 * The same file in Ask Bubbles; only `READERS` differs.
 */

/** This app's readers of a place and a job title. */
const READERS = {
  // A bare salon word ("manhattan") is read as a place only after "at", as the manager would say it.
  place: (text: string): boolean => readSalonMentions(text).length > 0 || readSalonMentions(`at ${text}`).length > 0,
  title: (text: string): string | null => extractJobTitle(text),
};

/**
 * THE SHORT FORM WORDS, in one table: the word a manager starts with, and the
 * form it asks for. Changing what "ca" means is a one-line edit here.
 */
export const SHORT_FORM_WORDS: Readonly<Record<string, { readonly request: string; readonly incident: boolean }>> = {
  ca: { request: "Create a corrective action form", incident: true },
  "c/a": { request: "Create a corrective action form", incident: true },
  dpoa: { request: "Create a corrective action form", incident: true },
  coach: { request: "Create a coaching form", incident: true },
  coaching: { request: "Create a coaching form", incident: true },
  exit: { request: "Create an exit form", incident: false },
};

/** "<form word> [form] [for] <rest>", with an optional level first ("verbal ca …"). */
const TERSE_LEAD = /^\s*(?:(verbal|written)\s+)?(ca|c\/a|dpoa|coach|coaching|exit)(?:\s+form)?\s+(?:for\s+)?(.+)$/i;
/** Words after the form word that make it a question or a topic, never a person. */
const NOT_A_PERSON =
  /^(?:process|procedure|interview|interviews|policy|policies|tips|info|information|help|question|questions|form|forms|survey|checklist|paperwork|steps|rules|template|templates|the|a|an|my|our|this|that|it|is|are|was|how|what|when|why|me|you|someone|somebody|employee|employees|team|staff|everyone)$/i;
const DATE = /^\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?$/;
const LEVEL = /^(?:verbal|written)$/i;
const MONEY = /^\$?\d+(?:\.\d{1,2})?$/;
const DEDUCT = /^(?:deduct|deduction|payroll|pd)$/i;
const NO_DEDUCT = /\bno\s+(?:payroll(?:\s+deduct(?:ion)?)?|deduct(?:ion)?|pd)\b/i;
const STATE = /^(?:ne|ks|mo|ia|sd|nd|mn|wi|il|tx)$/i;
const NAME_WORD = /^[A-Za-z][A-Za-z'’-]*$/;
/** Words that start an account, never a name: "opened late", "dress code". */
const NOT_A_NAME_WORD =
  /^(?:opened|open|opening|late|tardy|no|called|call|left|was|is|did|didnt|didn't|dress|cash|register|drawer|phone|cell|attendance|ncns|absent|missed|rude|failed|not|for|on|at|verbal|written)$/i;

export function withTerseSlots(request: AskRequest): AskRequest {
  if (!terseSlotReadEnabled()) return request;
  const question = expandTerseRequest(request.question, request.context.todayIso);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = expandTerseRequest(turn.content, request.context.todayIso);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/**
 * TERSE_COMMAND_ONLY_ENABLED (QA, 26 Oct 2026): with TERSE_SLOT_READ on, full
 * sentences were rewritten — "Exit for john michael doe effective october 2"
 * lost the surname, "coaching form for Test Employee at NE Kearney, she was
 * late on 10-5 and 10-15, I coached her on 10-16 …" was dated 10-5, and "CA
 * for Test Employee at Kearney, out of dress code 10/11" lost "out of". A
 * request with "for" after the form word is already read as a request, and a
 * line that talks in sentences (she, I, was, about, effective …) is an
 * account: both are left as typed. Only "<form word> <name> …" is written out.
 */
const FOR_LEAD = /^\s*(?:(?:verbal|written)\s+)?(?:ca|c\/a|dpoa|coach|coaching|exit)(?:\s+form)?\s+for\b/i;
const SENTENCE_WORDS = /\b(?:she|he|they|i|her|his|their|was|were|is|are|has|had|have|about|because|effective|who|when|while)\b/i;

function commandLine(text: string): boolean {
  return !FOR_LEAD.test(text) && !SENTENCE_WORDS.test(text);
}

/**
 * TERSE_COMMAND_ONLY_ENABLED (QA live run, 26 Oct 2026): "ca <first> <middle>
 * <last> <place> late today verbal" lost the surname. A third name word is
 * taken only when a place, a title, a state or the start of the account
 * ("late", "opened", never "on" or "was") follows it, and never when it is a
 * level, a form word or a topic (`NOT_A_THIRD_NAME`), a place, a title or a
 * repeat of the name. The end of the line or a date never makes a name:
 * "ca <name> final 10-14", "coach <name> woven", "coaching <name> tanned on
 * clock" stay two words (QA-4, 26 Oct 2026).
 */
/** Levels, form words and topics: never the third word of a name. */
const NOT_A_THIRD_NAME =
  /^(?:final|verbal|written|first|second|third|last|warning|ca|c\/a|dpoa|coach|coaching|exit|form|write|woven|acks?|training|orientation|uniform|personal|closing|opening|sales|schedule|break|breaks|refund|deposit|theft|safety|attendance|dress|cash|phone|cell|ncns|register|drawer|cleaning|sanitize|sanitizing|customer|customers|guest|guests|policy|tardy|tardiness|conduct|standards|insubordination|performance|inventory|product|products|recipe|measuring|timecard|clock|counter|music|food|smoking|vaping|language|rude|rudeness|today|yesterday|tomorrow)$/i;

function thirdNameWord(tokens: readonly string[], name: readonly string[]): boolean {
  const [word, next, after] = tokens;
  if (!word || !next || !NAME_WORD.test(word) || NOT_A_NAME_WORD.test(word) || NOT_A_PERSON.test(word) || NOT_A_THIRD_NAME.test(word)) return false;
  if (READERS.place(word) || READERS.title(word) || STATE.test(word) || READERS.place(`${word} ${next}`)) return false;
  if (name.some((part) => part.toLowerCase() === word.toLowerCase())) return false;
  return (
    READERS.place(next) ||
    (after !== undefined && READERS.place(`${next} ${after}`)) ||
    READERS.title(next) !== null ||
    STATE.test(next) ||
    (NOT_A_NAME_WORD.test(next) && !/^(?:on|at|for|was|is|did)$/i.test(next))
  );
}

/** The long form of a terse "<form word> <name> …" line, or the text as it is. */
export function expandTerseRequest(text: string, today: string): string {
  if (/[.!?\n]/.test(text.replace(/\d\.\d/g, "")) || text.trim().split(/\s+/).length > 40) return text;
  const lead = TERSE_LEAD.exec(text);
  if (!lead) return text;
  // TERSE_COMMAND_ONLY_ENABLED: only a command line is written out, never a sentence the readers already read.
  if (terseCommandOnlyEnabled() && !commandLine(text)) return text;
  const form = SHORT_FORM_WORDS[lead[2]!.toLowerCase()]!;
  const tokens = lead[3]!
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/,+$/, ""))
    .filter(Boolean);
  if (tokens.length === 0 || NOT_A_PERSON.test(tokens[0]!)) return text;

  const name: string[] = [];
  while (name.length < 2 && tokens.length > 0) {
    const word = tokens[0]!;
    if (!NAME_WORD.test(word) || NOT_A_NAME_WORD.test(word) || READERS.place(word) || READERS.title(word)) break;
    name.push(tokens.shift()!);
  }
  if (name.length === 2 && terseCommandOnlyEnabled() && thirdNameWord(tokens, name)) name.push(tokens.shift()!);
  if (name.length === 0) return text;

  let place: string | null = null;
  let title: string | null = null;
  let date: string | null = null;
  let level: string | null = lead[1] ? lead[1].toLowerCase() : null;
  let amount: string | null = null;
  const account: string[] = [];
  const rest = tokens.join(" ");
  const noDeduct = form.incident && NO_DEDUCT.test(rest);
  const words = noDeduct ? rest.replace(NO_DEDUCT, " ").trim().split(/\s+/).filter(Boolean) : tokens;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = words[index + 1] ?? "";
    if (form.incident && !date && DATE.test(word)) {
      date = withYear(word, today);
      continue;
    }
    if (form.incident && !level && LEVEL.test(word)) {
      level = word.toLowerCase();
      continue;
    }
    if (form.incident && !amount && MONEY.test(word) && DEDUCT.test(next)) {
      amount = word.replace(/^\$/, "");
      index += 1;
      continue;
    }
    if (form.incident && !amount && DEDUCT.test(word) && MONEY.test(next)) {
      amount = next.replace(/^\$/, "");
      index += 1;
      continue;
    }
    if (!place && account.length === 0) {
      const two = `${word} ${next}`.trim();
      if (next && READERS.place(two) && !READERS.place(word)) {
        place = two;
        index += 1;
        continue;
      }
      if (READERS.place(word)) {
        // "dodge, ne" / "dodge ne": the state after a place is part of it.
        if (STATE.test(next)) {
          place = `${word}, ${next}`;
          index += 1;
        } else place = word;
        continue;
      }
    }
    if (!title && account.length === 0 && READERS.title(word)) {
      title = READERS.title(word);
      continue;
    }
    account.push(word);
  }

  // "… 9-28-26 tc ks manhattan": a title and a place may also close the line.
  for (let peeled = true; peeled && account.length > 0; ) {
    peeled = false;
    const last = account[account.length - 1]!;
    const two = account.length > 1 ? `${account[account.length - 2]} ${last}` : "";
    if (!place && account.length > 1 && STATE.test(last) && READERS.place(account[account.length - 2]!)) {
      place = `${account[account.length - 2]}, ${last}`;
      account.splice(-2, 2);
      peeled = true;
    } else if (!place && two && READERS.place(two) && !READERS.place(account[account.length - 2]!)) {
      place = two;
      account.splice(-2, 2);
      peeled = true;
    } else if (!place && READERS.place(last)) {
      place = last;
      account.pop();
      peeled = true;
    } else if (!title && READERS.title(last)) {
      title = READERS.title(last);
      account.pop();
      peeled = true;
    }
  }

  const who = name.join(" ");
  const parts = [`${form.request} for ${who}${place ? ` at ${place}` : ""}${title ? `, ${title}` : ""}.`];
  if (!form.incident) {
    // An exit's facts are dates and steps of their own ("last day 9/20 called 9/27"); they stay as typed.
    const facts = account.join(" ").trim();
    return facts ? `${parts[0]} ${facts}.` : parts[0]!;
  }
  if (account.length > 0) parts.push(`${date ? `On ${date} ` : ""}${who} ${account.join(" ")}.`);
  else if (date) parts.push(`It happened on ${date}.`);
  if (level) parts.push(`This is a ${level} warning.`);
  if (amount) parts.push(`Payroll deduct applies and $${amount} will be deducted.`);
  else if (noDeduct) parts.push("Payroll deduct is not applicable.");
  return parts.join(" ");
}

/** "9-20" is the latest 9-20 that is not after today: "9-20-26". A typed year stays. */
function withYear(date: string, today: string): string {
  const parts = date.split(/[-/]/);
  if (parts.length === 3) return date;
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const typedMonth = Number(parts[0]);
  const typedDay = Number(parts[1]);
  const after = typedMonth > month || (typedMonth === month && typedDay > day);
  const separator = date.includes("/") ? "/" : "-";
  return `${parts[0]}${separator}${parts[1]}${separator}${String((after ? year - 1 : year) % 100).padStart(2, "0")}`;
}
