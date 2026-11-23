import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { foldName } from "./fold-name";

/**
 * ============================================================================
 * FORMS ON FILE BY TOPIC (FORM_TOPIC_SEARCH_ENABLED; Pau, 21 Nov 2026)
 * ============================================================================
 *
 * "Any forms about cash handling at my salons this month?", "who's been written up for dress code?": the agent loop's
 * find_past_forms could only pick among one person's 2–8 forms by their words ("about"). This reads the SAVED TEXT of
 * every form the manager may already see in Form Monitoring (the caller passes only rows that passed the same visibility
 * filter, never more) and keeps the forms whose saved text holds every word of the topic.
 *
 * What is searched: the account (Observation of Offense, Observation, Details of Coaching, Other, Original Expectation,
 * Follow-Up Observation, Specific Evidence), the Policy Violated line, and the ticked offense, coaching type and topics,
 * and review types (by their keys read as words: dress_code → "dress code"). Never the quoted manual text (Direct policy)
 * or the Action Plan: those read like every other form's, and would match a topic the form is not about.
 */

/** The saved fields a form's topic is read from (text), and the ticked groups read as words. */
const TOPIC_TEXT_KEYS = ["observation", "coaching_details", "other_topic", "original_expectation", "follow_up_observation", "specific_evidence", "policy_violated"] as const;
const TOPIC_TICK_KEYS = ["offense_type", "coaching_type", "coaching_topics", "review_types"] as const;
/** The level, for the result (never matched). */
const LEVEL_KEY = "warning_type";
const READ_KEYS = [...TOPIC_TEXT_KEYS, ...TOPIC_TICK_KEYS, LEVEL_KEY];

/** Ids per `.in()` filter, so a request URL stays short. */
const ID_CHUNK = 100;
/** PostgREST answers at most this many rows per request, whatever the limit: every read is paged. */
const PAGE_ROWS = 1000;

/** What one form says about its topic, read from its saved values. */
export interface FormTopicText {
  /** Every searchable word of the form, folded (accents off, lower case). */
  text: string;
  /** The Policy Violated line, as saved; null when empty. */
  policy: string | null;
  /** The ticked offense types, read as words ("Dress code"). */
  offense: string[];
  /** The ticked level ("written"), or null. */
  level: string | null;
}

const LEVEL_WORDS: Readonly<Record<string, string>> = { verbal: "Verbal Warning", written: "Written Warning", termination: "Termination", demotion: "Demotion" };

/** A ticked option's key read as words: "dress_code" → "dress code". */
const keyWords = (key: string) => key.replace(/_/g, " ").trim();
const capitalized = (text: string) => (text ? text[0]!.toUpperCase() + text.slice(1) : text);

/** The topic text of each form, by id, read from its saved values. Throws on a read error. */
export async function readFormTopicText(instanceIds: readonly string[]): Promise<Map<string, FormTopicText>> {
  const supabase = getSupabaseAdmin();
  const rows: Record<string, unknown>[] = [];
  for (let at = 0; at < instanceIds.length; at += ID_CHUNK) {
    const chunk = instanceIds.slice(at, at + ID_CHUNK);
    for (let from = 0; ; from += PAGE_ROWS) {
      const { data, error } = await supabase
        .from("form_instance_values")
        .select("instance_id, field_key, value, checked")
        .in("instance_id", chunk)
        .in("field_key", READ_KEYS)
        .order("instance_id", { ascending: true })
        .order("field_key", { ascending: true })
        .range(from, from + PAGE_ROWS - 1);
      if (error) throw new Error("The forms' saved text could not be read.");
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if ((data ?? []).length < PAGE_ROWS) break;
    }
  }
  const byId = new Map<string, { parts: string[]; policy: string | null; offense: string[]; level: string | null }>();
  for (const row of rows) {
    const id = String(row.instance_id);
    const entry = byId.get(id) ?? { parts: [], policy: null, offense: [], level: null };
    byId.set(id, entry);
    const key = String(row.field_key);
    const value = typeof row.value === "string" ? row.value.trim() : "";
    const checked = Array.isArray(row.checked) ? (row.checked as unknown[]).filter((item): item is string => typeof item === "string") : [];
    if (key === LEVEL_KEY) {
      entry.level = checked.length > 0 ? checked.map((item) => LEVEL_WORDS[item] ?? capitalized(keyWords(item))).join(", ") : null;
      continue;
    }
    if ((TOPIC_TEXT_KEYS as readonly string[]).includes(key) && value) entry.parts.push(value);
    if (key === "policy_violated" && value) entry.policy = value;
    if ((TOPIC_TICK_KEYS as readonly string[]).includes(key)) {
      const words = checked.map(keyWords);
      entry.parts.push(...words);
      if (key === "offense_type") entry.offense.push(...words.map(capitalized));
    }
  }
  return new Map(
    [...byId.entries()].map(([id, entry]) => [id, { text: foldName(entry.parts.join(" ")).toLowerCase(), policy: entry.policy, offense: entry.offense, level: entry.level }]),
  );
}

/** Words that never narrow a topic ("any forms about the dress code at my salons"). */
const NOT_TOPIC = new Set(
  ("a an the and or of for to in on at about any all every some my our his her their its this that these those with was were is are been be has have had " +
    "form forms write writeup writeups written wrote up ca cas corrective action actions coaching coachings coached warning warnings " +
    "who whos anyone anybody someone somebody people employee employees staff team member members salon salons store stores " +
    "month week year today yesterday last past recent recently this ever before since show list find me give get").split(" "),
);

/** The topic's words, folded, without the words that only say "a form" or "who". Empty: no topic. */
export function topicWords(topic: string): string[] {
  const words = foldName(topic)
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NOT_TOPIC.has(word));
  return [...new Set(words)];
}

/** A topic word's stem: "handling" and "handled" both read "handl"; short words are whole. */
function stem(word: string): string {
  return word.length <= 5 ? word : word.slice(0, Math.max(5, word.length - 3));
}

/** Whether the form's folded text holds every topic word (a word, or a word starting with its stem). */
export function matchesTopic(text: string, topic: readonly string[]): boolean {
  if (topic.length === 0) return false;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return topic.every((want) => {
    const root = stem(want);
    return words.some((word) => word === want || (root.length >= 4 && word.startsWith(root)));
  });
}

/** The employee's first name, as filed ("Remy" of "Remy Calder"). */
export function firstNameOf(employeeName: string): string {
  return employeeName.trim().split(/\s+/)[0] ?? "";
}
