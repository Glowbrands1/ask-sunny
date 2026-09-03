import "server-only";

/**
 * WHICH INBOUND EMAILS MAY BECOME REPORTING DATA.
 *
 * Two independent gates, both on data the SENDER controls, which is why
 * neither is a security boundary and both are stated as filters:
 *
 *   THE APPROVED SENDER LIST decides whose mail is even looked at. A `From`
 *   address is trivially forged, so this is not authentication — the webhook
 *   SIGNATURE is what proves the delivery came from Resend, and the signature
 *   is checked first. This list is the narrower question of whose report we
 *   agreed to ingest, and it exists so that a forwarding rule pointed at the
 *   wrong mailbox, or a colleague replying to the thread, cannot file figures.
 *
 *   THE SUBJECT FILTER decides which of an approved sender's mails is the Comp
 *   Report. A substring match on `Comp Report`, because the date moves every
 *   month and an exact-subject rule would silently stop working on the first of
 *   the next one.
 *
 * A REJECTED DELIVERY IS ACKNOWLEDGED, NOT REFUSED. The route answers 200 with
 * an `ignored` outcome, and the reason it returns never names the allowlist or
 * says which gate closed. Two reasons: a webhook that answers non-2xx is
 * retried, and a wrong sender will never become right, so a refusal would buy
 * an endless retry loop for nothing; and a prober learning "that sender is not
 * approved" learns which addresses are.
 */

/** Server-side, comma-separated. Never NEXT_PUBLIC_. */
export const APPROVED_SENDERS_ENV = "REPORTING_APPROVED_SENDERS";

/**
 * The subject must contain this, case-insensitively.
 *
 * A constant rather than an environment variable: which report this endpoint
 * ingests is a property of the parsers behind it, not a deployment setting.
 */
export const REQUIRED_SUBJECT_FRAGMENT = "comp report";

/**
 * Extracts the bare address from a `From` header.
 *
 * Resend hands over the header as written, which may be
 * `Samuel Brockie <samuel.brockie@glowbrands.com>` or the bare address. Angle
 * brackets win when present, because a display NAME can contain anything —
 * including a second address put there to be mistaken for the real one.
 */
export function extractEmailAddress(from: string | null | undefined): string | null {
  if (!from) return null;
  const angled = /<([^<>]+)>\s*$/.exec(from.trim());
  const candidate = (angled ? angled[1] : from).trim().toLowerCase();
  // One `@`, something either side, no whitespace. Not full RFC 5322 — this is
  // a comparison key, and anything it rejects was never going to match the
  // allowlist anyway.
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : null;
}

/**
 * The configured allowlist, normalized.
 *
 * Case is folded and whitespace trimmed, so an entry pasted from a mail client
 * with a trailing space or a capitalised domain still matches. Empty entries
 * are dropped, which makes a trailing comma harmless.
 */
export function approvedSenders(raw: string | undefined = process.env[APPROVED_SENDERS_ENV]): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(/[,;\s]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0 && entry.includes("@")),
    ),
  ];
}

export function approvedSendersConfigured(): boolean {
  return approvedSenders().length > 0;
}

/**
 * EXACT ADDRESS MATCH ONLY.
 *
 * No domain wildcards and no suffix matching, deliberately. A rule like
 * "anything at glowbrands.com" would let any of hundreds of colleagues file
 * reporting figures by replying to the thread, and a suffix match on
 * `@glowbrands.com` also matches `evil@notglowbrands.com`. Adding or removing
 * one address is an environment-variable edit, which is the point: the test
 * address comes out later without a code change.
 */
export function isApprovedSender(
  from: string | null | undefined,
  allowlist: string[] = approvedSenders(),
): boolean {
  const address = extractEmailAddress(from);
  if (!address) return false;
  return allowlist.includes(address);
}

/**
 * Whether a subject names the Comp Report.
 *
 * Substring, case-insensitive, whitespace-collapsed. Accepts
 * `Comp Report 2026 08 30 - Bowen, Curt`, next month's, and `Comp Report TEST`;
 * rejects an unrelated thread. Collapsing whitespace is what makes a subject
 * that a mail client wrapped as `Comp  Report` still match.
 */
export function subjectNamesCompReport(subject: string | null | undefined): boolean {
  if (!subject) return false;
  return subject.toLowerCase().replace(/\s+/g, " ").includes(REQUIRED_SUBJECT_FRAGMENT);
}

export type DeliveryGateOutcome =
  | { admit: true }
  /**
   * Not admitted. `code` is safe to return; `operatorReason` is not.
   *
   * The distinction is the whole point of this type: the caller gets a coarse
   * code that says nothing about the allowlist, and an operator reading a
   * response can still tell a misconfiguration from a wrong sender.
   */
  | { admit: false; code: IgnoredReason; operatorReason: string };

export type IgnoredReason =
  /** No approved sender list configured. Nobody is admitted. */
  | "not_configured"
  /** The sender is not on the list, or the From header was unusable. */
  | "sender_not_approved"
  /** The subject does not name the Comp Report. */
  | "subject_not_matched";

/**
 * Both gates, in the order that fails closed cheapest.
 *
 * Configuration first: a deployment with no allowlist admits NOBODY, rather
 * than defaulting to everybody, which is the failure that would matter.
 */
export function admitDelivery(input: {
  from: string | null | undefined;
  subject: string | null | undefined;
  allowlist?: string[];
}): DeliveryGateOutcome {
  const allowlist = input.allowlist ?? approvedSenders();

  if (allowlist.length === 0) {
    return {
      admit: false,
      code: "not_configured",
      operatorReason: `${APPROVED_SENDERS_ENV} is not configured, so no inbound email can be ingested.`,
    };
  }

  if (!isApprovedSender(input.from, allowlist)) {
    return {
      admit: false,
      code: "sender_not_approved",
      // Names neither the sender nor the list. An operator can look at the
      // variable; this string goes into a response.
      operatorReason: "The sending address is not on the approved sender list.",
    };
  }

  if (!subjectNamesCompReport(input.subject)) {
    return {
      admit: false,
      code: "subject_not_matched",
      operatorReason: `The subject does not contain "${REQUIRED_SUBJECT_FRAGMENT}".`,
    };
  }

  return { admit: true };
}
