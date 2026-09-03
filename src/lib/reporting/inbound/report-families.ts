import "server-only";

import { detectAllReports } from "../ingest";
import { looksLikeHtmlReport, readHtmlReport } from "../html-report";
import { detectSalesTotals } from "../sales-totals/parser";
import {
  extractEmailAddress,
  isApprovedSender,
  approvedSendersConfigured,
  subjectNamesCompReport,
} from "./delivery-gate";

/**
 * ============================================================================
 * WHICH REPORT IS THIS, AND MAY THIS SENDER FILE IT?
 * ============================================================================
 *
 * One inbound endpoint, one signature check, several report families. The
 * webhook signature is verified ONCE before any of this runs — see the route —
 * and only then does a delivery get identified and routed.
 *
 * WHY A ROUTER RATHER THAN A SECOND ENDPOINT. A second endpoint would mean a
 * second Resend webhook, a second signing secret to rotate, a second signature
 * implementation to keep correct, and a second copy of the ordering rules that
 * make this safe (verify, then gate, then fetch). The families differ only in
 * who may send them, what their subject says, and which parser reads them —
 * so those three things are data here, and everything else is shared.
 *
 * SENDER AND SUBJECT ARE PER-FAMILY, DELIBERATELY. The Comp Report's allowlist
 * must not admit a Sales Totals sender and vice versa: they are different
 * reports from different systems, and "anyone approved for one report may file
 * any report" is exactly the widening this avoids. Each family reads its own
 * environment variable.
 *
 * A FAMILY WITH NO CONFIGURATION IS DISABLED. Not "open", not "falls back to
 * the other family's allowlist" — refused. So a family can be built, tested and
 * shipped before anybody knows its sender address, and activating it later is a
 * configuration change rather than a deployment.
 */

/** Sales Totals reads its own allowlist. Never the Comp Report's. */
export const SALES_TOTALS_SENDERS_ENV = "SALES_TOTALS_APPROVED_SENDERS";

/**
 * The subject fragment a Sales Totals delivery must carry.
 *
 * A variable rather than a constant because, unlike "Comp Report", nobody has
 * yet seen this email's subject line. The sender was described only as
 * "STC Reports", which is a display name and not an address.
 */
export const SALES_TOTALS_SUBJECT_ENV = "SALES_TOTALS_SUBJECT_FRAGMENT";

export type ReportFamilyKey = "comp_report" | "sales_totals";

export interface ReportFamily {
  readonly key: ReportFamilyKey;
  readonly label: string;
  /** Whether live email ingestion is configured for this family. */
  isActivated(): boolean;
  /** What is missing before it can be activated. Empty when it is. */
  activationGaps(): string[];
  /** Whether this sender may file this family's report. */
  admitsSender(from: string | null | undefined): boolean;
  /** Whether this subject names this family's report. */
  admitsSubject(subject: string | null | undefined): boolean;
  /** Whether these bytes ARE this family's report. Content only. */
  recognizes(bytes: Uint8Array): Promise<boolean>;
}

/** Comma/semicolon/newline separated addresses, normalised. Exact matches. */
function parseSenders(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[,;\n]/)
        .map((entry) => extractEmailAddress(entry.trim()))
        .filter((entry): entry is string => entry !== null),
    ),
  ];
}

/**
 * THE COMP REPORT. Behaviour is unchanged from before the router existed.
 *
 * Same `REPORTING_APPROVED_SENDERS` variable, same exact-match rule, same
 * "comp report" subject fragment. The functions are the ones the existing
 * tests already cover, called rather than reimplemented, so there is no second
 * definition of the rule to drift.
 */
const compReport: ReportFamily = {
  key: "comp_report",
  label: "Comp Report",
  isActivated: () => approvedSendersConfigured(),
  activationGaps: () =>
    approvedSendersConfigured() ? [] : ["REPORTING_APPROVED_SENDERS is not set"],
  admitsSender: (from) => isApprovedSender(from),
  admitsSubject: (subject) => subjectNamesCompReport(subject),
  recognizes: async (bytes) => {
    // A workbook, and one our parsers recognise. HTML is not this family.
    if (looksLikeHtmlReport(bytes)) return false;
    try {
      // Takes bytes and reads the workbook itself; returns one entry per
      // registered parser, so "any supported" is the question.
      const detections = await detectAllReports(bytes);
      return detections.some((detection) => detection.supported);
    } catch {
      return false;
    }
  },
};

/**
 * SALES TOTALS. Structurally ready, and NOT ACTIVATED.
 *
 * Two things are unknown and neither may be guessed:
 *
 *   * THE SENDER ADDRESS. Described as "STC Reports", which is a display name.
 *     A display name is not an address and is trivially forged, so it cannot
 *     become an allowlist entry. `SALES_TOTALS_APPROVED_SENDERS` stays unset
 *     until the real address is read off a delivered message's headers.
 *   * THE SUBJECT LINE. Unlike "Comp Report", nobody has seen it.
 *     `SALES_TOTALS_SUBJECT_FRAGMENT` stays unset.
 *
 * Both unset means every Sales Totals delivery is refused, which is the correct
 * state: the report can be ingested by hand or by the credentialled HTTP route
 * today, and email automation switches on with two environment variables and no
 * code change.
 */
const salesTotals: ReportFamily = {
  key: "sales_totals",
  label: "Sales Totals",

  isActivated: () =>
    parseSenders(process.env[SALES_TOTALS_SENDERS_ENV]).length > 0 &&
    (process.env[SALES_TOTALS_SUBJECT_ENV] ?? "").trim().length > 0,

  activationGaps: () => {
    const gaps: string[] = [];
    if (parseSenders(process.env[SALES_TOTALS_SENDERS_ENV]).length === 0) {
      gaps.push(`${SALES_TOTALS_SENDERS_ENV} is not set to a valid address`);
    }
    if ((process.env[SALES_TOTALS_SUBJECT_ENV] ?? "").trim().length === 0) {
      gaps.push(`${SALES_TOTALS_SUBJECT_ENV} is not set`);
    }
    return gaps;
  },

  admitsSender: (from) => {
    const allowed = parseSenders(process.env[SALES_TOTALS_SENDERS_ENV]);
    if (allowed.length === 0) return false; // Unset admits nobody.
    const address = extractEmailAddress(from);
    // EXACT match, like the Comp Report's. No domain wildcards: a rule as loose
    // as "anything from the reporting system" would let any colleague on that
    // domain file financial figures.
    return address !== null && allowed.includes(address);
  },

  admitsSubject: (subject) => {
    const fragment = (process.env[SALES_TOTALS_SUBJECT_ENV] ?? "").trim().toLowerCase();
    if (fragment === "") return false; // Unset matches nothing.
    return (subject ?? "").replace(/\s+/g, " ").trim().toLowerCase().includes(fragment);
  },

  recognizes: async (bytes) => {
    // HTML wearing an .xls name, carrying the Sales Totals markers. The
    // extension is never consulted.
    if (!looksLikeHtmlReport(bytes)) return false;
    try {
      return detectSalesTotals(readHtmlReport(bytes)).supported;
    } catch {
      return false;
    }
  },
};

export const REPORT_FAMILIES: readonly ReportFamily[] = [compReport, salesTotals];

export function familyByKey(key: string): ReportFamily | null {
  return REPORT_FAMILIES.find((family) => family.key === key) ?? null;
}

export type FamilyRoutingOutcome =
  | { routed: true; family: ReportFamily }
  | {
      routed: false;
      /** Why, for an operator log. Never returned to the sender verbatim. */
      reason: string;
      code:
        | "no_family_matched_sender"
        | "subject_not_matched"
        | "family_not_activated"
        | "content_not_recognised"
        | "ambiguous_content";
      /** The family this looked like, where one could be identified. */
      family: ReportFamily | null;
    };

/**
 * Which family may accept this delivery, on sender and subject alone.
 *
 * Runs BEFORE any attachment is listed or downloaded, so an unapproved sender
 * costs one signature check and nothing else — no outbound call made on a
 * stranger's behalf.
 *
 * ACTIVATION IS CHECKED AFTER SENDER AND SUBJECT MATCH, on purpose. It means an
 * operator log can say "this looked like Sales Totals from an approved-looking
 * sender, but the family is not activated", which is the actionable message.
 * The sender is told nothing either way.
 */
export function routeDelivery(input: {
  from: string | null | undefined;
  subject: string | null | undefined;
}): FamilyRoutingOutcome {
  const senderMatches = REPORT_FAMILIES.filter((family) => family.admitsSender(input.from));

  if (senderMatches.length === 0) {
    return {
      routed: false,
      code: "no_family_matched_sender",
      reason: "The sender is not on any report family's allowlist.",
      family: null,
    };
  }

  const subjectMatches = senderMatches.filter((family) => family.admitsSubject(input.subject));
  if (subjectMatches.length === 0) {
    return {
      routed: false,
      code: "subject_not_matched",
      reason: "The sender is approved for a family, but the subject names no report.",
      family: senderMatches[0],
    };
  }

  /*
   * More than one family admitting the same sender AND subject would mean the
   * rules overlap, and guessing between them could file one report's figures
   * under the other. Refused rather than resolved by ordering.
   */
  if (subjectMatches.length > 1) {
    return {
      routed: false,
      code: "ambiguous_content",
      reason: `Sender and subject match more than one family: ${subjectMatches
        .map((family) => family.key)
        .join(", ")}.`,
      family: null,
    };
  }

  const family = subjectMatches[0];
  const gaps = family.activationGaps();
  if (gaps.length > 0) {
    return {
      routed: false,
      code: "family_not_activated",
      reason: `${family.label} email ingestion is not activated: ${gaps.join("; ")}.`,
      family,
    };
  }

  return { routed: true, family };
}

/**
 * Confirms the BYTES are the family the headers claimed.
 *
 * The last gate, and the one the headers cannot satisfy. A From address and a
 * subject are both trivially forged; the file's structure is not. A delivery
 * whose headers say Comp Report and whose attachment is a Sales Totals document
 * is refused rather than handed to whichever parser the subject suggested.
 */
export async function confirmFamilyContent(
  family: ReportFamily,
  bytes: Uint8Array,
): Promise<FamilyRoutingOutcome> {
  if (await family.recognizes(bytes)) {
    return { routed: true, family };
  }

  // Did it match a DIFFERENT family? That distinction is worth logging: a
  // mis-sent report is an operational mistake, an unrecognised file is a
  // template change or a stray attachment.
  for (const other of REPORT_FAMILIES) {
    if (other.key === family.key) continue;
    if (await other.recognizes(bytes)) {
      return {
        routed: false,
        code: "content_not_recognised",
        reason: `The attachment is a ${other.label} document, but the delivery was routed as ${family.label}.`,
        family: other,
      };
    }
  }

  return {
    routed: false,
    code: "content_not_recognised",
    reason: `The attachment does not carry ${family.label}'s structural markers.`,
    family,
  };
}

/** Readiness, for the endpoint's GET. Names and booleans only. */
export function familyReadiness(): {
  key: string;
  label: string;
  activated: boolean;
  gaps: string[];
}[] {
  return REPORT_FAMILIES.map((family) => ({
    key: family.key,
    label: family.label,
    activated: family.isActivated(),
    // Variable NAMES, never their values.
    gaps: family.activationGaps(),
  }));
}
