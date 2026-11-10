import { surnameParticlesEnabled } from "@/lib/config/chat-quality-flags";

import { NOT_A_NAME, TYPED_NAME_WORD } from "./name-words";
import { isFormVocabulary } from "./template-intent";

/**
 * ============================================================================
 * "MARISOL DE LA VEGA" IS ONE SURNAME AFTER A FIRST NAME
 * ============================================================================
 *
 * SURNAME_PARTICLES_ENABLED (QA's audit item 17b, 10 Nov 2026; default off). A typed name whose surname opens with
 * a particle was cut at the particle: "create a ca for marisol de la vega, she was late on 11/3" put "Marisol De" on
 * the card, and "marisol van der vega" put "Marisol Van". The lower-case name reader (`forms/proposal.ts`, protected)
 * reads at most a first name and a surname word, and the particles are not name words to it. Here, after a first name,
 * a run of particles ("de", "de la", "van der", "von", "del", "da", …) followed by a word that can end a name is read
 * as one surname, as typed ("de la vega"). Off, nothing is read here.
 */
const PARTICLES = new Set(["de", "del", "della", "di", "da", "das", "do", "dos", "du", "la", "le", "van", "von", "der", "den", "ter", "ten"]);
/** The particles a surname can open with ("la" and "der" only follow another one: "de la", "van der"). */
const OPENS = new Set(["de", "del", "della", "di", "da", "das", "do", "dos", "du", "le", "van", "von", "ter", "ten"]);
const WRAPPER_AFTER = /[)\]}"”’'»,.;:!?]+$/;
const MAX_PARTICLES = 3;

export interface ParticleSurname {
  /** The surname as typed, particles included: "de la vega". */
  readonly surname: string;
  /** How many words of `words` it takes, from `index`. */
  readonly used: number;
  /** Whether its last word carried the punctuation that ends a name ("vega,"). */
  readonly ends: boolean;
}

/** The particle surname that starts at `words[index]`, or null (always null with the flag off). */
export function particleSurname(words: readonly string[], index: number): ParticleSurname | null {
  if (!surnameParticlesEnabled()) return null;
  const first = words[index];
  if (!first || !OPENS.has(first.toLowerCase())) return null;
  const parts = [first];
  for (let at = index + 1; at < words.length && at <= index + MAX_PARTICLES; at += 1) {
    const raw = words[at]!;
    const bare = raw.replace(WRAPPER_AFTER, "");
    const lower = bare.toLowerCase();
    // A particle with punctuation after it ("de,") ends no name.
    if (PARTICLES.has(lower)) {
      if (bare !== raw) return null;
      parts.push(raw);
      continue;
    }
    if (bare.length < 2 || !TYPED_NAME_WORD.test(bare) || NOT_A_NAME.has(lower) || isFormVocabulary(lower)) return null;
    parts.push(bare);
    return { surname: parts.join(" "), used: parts.length, ends: bare !== raw };
  }
  return null;
}
