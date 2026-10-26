import { stateCaGuardEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/**
 * STATE_CA_GUARD_ENABLED: "CA" after a place is California, not a
 * Corrective Action.
 *
 * Ask Sunny conv_mvokdp2c24wi9re, 26 Oct 2026: the turn "Sacramento, CA"
 * opened the Corrective Action intake (seven questions). The form reader
 * takes the word "CA" wherever it stands, in any case.
 *
 * Before any reader sees a manager turn, "CA" is written as "California"
 * where it is a state: before a ZIP code ("Los Angeles CA 90001"), or after a
 * California city, with or without a comma, in any case ("Sacramento, CA",
 * "sacramento, ca", "Los Angeles CA"). After a person, a salon or a topic
 * ("Rowan Pell, CA", "at Lawrence CA", "Coaching, CA") it stays the form. "ca" as a form ("ca", "ca for …",
 * "write up ca", "create a ca", "verbal ca …") is never changed. Off, every
 * turn is read as typed.
 *
 * The same file in Ask Bubbles.
 */

/** Words before "ca" that make it the form, never the state. */
const FORM_LEAD = /^(?:a|an|the|new|create|make|need|needs|write|draft|do|start|file|open|verbal|written|final|perf|another|this|that|my|up)$/i;
const AFTER_STATE = /^(?:\s*$|\s*[.,;!?)]|\s+\d{5}\b|\s+(?:last|this|next|in|on|at|and|area|since|until|before|after|location|store|salon)\b)/i;

export function withStateNames(request: AskRequest): AskRequest {
  if (!stateCaGuardEnabled()) return request;
  const question = statesSpelledOut(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = statesSpelledOut(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

/**
 * California's cities, the evidence that "CA" after a word is the state (QA-4
 * and QA-6, 26 Oct 2026: "Avery Stone CA", "Rowan Pell, CA", "avery, ca", "at
 * Lawrence CA", "Coaching, CA" are the form after a person, a salon or a
 * topic, and capitals or a comma cannot tell them from "Sacramento, CA").
 * Geography, the same in both apps.
 */
const CALIFORNIA_CITIES = new Set(
  (
    "los angeles|san diego|san jose|san francisco|fresno|sacramento|long beach|oakland|bakersfield|anaheim|santa ana|riverside|stockton|irvine|" +
    "chula vista|fremont|san bernardino|modesto|fontana|oxnard|moreno valley|huntington beach|glendale|santa clarita|garden grove|oceanside|" +
    "rancho cucamonga|santa rosa|ontario|elk grove|corona|lancaster|palmdale|salinas|pomona|hayward|escondido|torrance|sunnyvale|orange|" +
    "fullerton|pasadena|thousand oaks|visalia|simi valley|concord|roseville|vallejo|santa clara|victorville|berkeley|fairfield|carlsbad|" +
    "temecula|redding|chico|san mateo|santa barbara|santa monica|burbank|inglewood|downey|ventura|el monte|costa mesa|antioch|richmond|" +
    "daly city|west covina|norwalk|murrieta|el cajon|san luis obispo|palm springs|napa|davis|merced|monterey|santa cruz|eureka|malibu|" +
    "beverly hills|culver city|newport beach|laguna beach|redondo beach|mountain view|palo alto|walnut creek|san rafael|tracy|turlock|yuba city"
  ).split("|"),
);

/** The text with every state "CA" written as "California". */
export function statesSpelledOut(text: string): string {
  if (!text) return text;
  return text.replace(/\b([A-Za-z][A-Za-z.'’-]*)(,\s*|\s+)(ca)\b/gi, (whole, place: string, gap: string, _ca: string, offset: number, all: string) => {
    if (FORM_LEAD.test(place)) return whole;
    const after = all.slice(offset + whole.length);
    if (!AFTER_STATE.test(after)) return whole;
    const zip = /^\s+\d{5}\b/.test(after);
    if (!zip && !californiaCity(all.slice(0, offset), place)) return whole;
    return `${place}${gap}California`;
  });
}

/** The word before "CA", with up to two words before it, names a California city. */
function californiaCity(before: string, place: string): boolean {
  const words = `${before} ${place}`.toLowerCase().split(/[^a-z.'’-]+/).filter(Boolean);
  for (let size = 1; size <= 3 && size <= words.length; size += 1) {
    if (CALIFORNIA_CITIES.has(words.slice(-size).join(" "))) return true;
  }
  return false;
}
