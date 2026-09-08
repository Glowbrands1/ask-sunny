import "server-only";

import { detectBedSpaReport } from "../bed-spa-intake";
import { detectAllReports } from "../ingest";
import { looksLikeHtmlReport, readHtmlReport } from "../html-report";
import { detectSalesTotals } from "../sales-totals/parser";
import {
  extractEmailAddress,
  isApprovedSender,
  approvedSendersConfigured,
  subjectNamesCompReport,
} from "./delivery-gate";
import {
  isSalesTotalsCandidate,
  isWorkbookCandidate,
  type ResendAttachment,
} from "./resend-client";

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
 * An OVERRIDE now, not a requirement. The observed subject is "Sales Totals for
 * Bowen", so the fragment below is the default — the same reasoning the Comp
 * Report's constant carries: which report an endpoint ingests is a property of
 * the parser behind it, not a deployment setting. The variable stays so a
 * deployment can narrow it without a release.
 */
export const SALES_TOTALS_SUBJECT_ENV = "SALES_TOTALS_SUBJECT_FRAGMENT";

/** Observed in the real forwarding rule. Overridable by the variable above. */
export const SALES_TOTALS_SUBJECT_DEFAULT = "sales totals";

function salesTotalsSubjectFragment(): string {
  const configured = (process.env[SALES_TOTALS_SUBJECT_ENV] ?? "").trim().toLowerCase();
  return configured.length > 0 ? configured : SALES_TOTALS_SUBJECT_DEFAULT;
}

/**
 * The three new families read their own allowlists and their own subject
 * fragments, for the reason stated at the top of this file: "anyone approved
 * for one report may file any report" is exactly the widening this avoids.
 *
 * UNLIKE Sales Totals, these DO have a known subject fragment — each report's
 * own name appears in its subject — so only the sender address is unknown, and
 * a family with no sender configured admits nobody.
 */
export const BED_USAGE_SENDERS_ENV = "BED_USAGE_APPROVED_SENDERS";
export const BED_USAGE_SUBJECT_ENV = "BED_USAGE_SUBJECT_FRAGMENT";
export const SPA_WELLNESS_SENDERS_ENV = "SPA_WELLNESS_APPROVED_SENDERS";
export const SPA_WELLNESS_SUBJECT_ENV = "SPA_WELLNESS_SUBJECT_FRAGMENT";
export const SPA_ENGAGEMENT_SENDERS_ENV = "SPA_ENGAGEMENT_APPROVED_SENDERS";
export const SPA_ENGAGEMENT_SUBJECT_ENV = "SPA_ENGAGEMENT_SUBJECT_FRAGMENT";

export type ReportFamilyKey =
  | "comp_report"
  | "sales_totals"
  | "bed_usage"
  | "spa_wellness"
  | "spa_engagement";

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
  /**
   * Whether an attachment's METADATA makes it a plausible candidate.
   *
   * Per-family because the two formats are genuinely different: the Comp Report
   * is a real `.xlsx` and refuses `.xls`; Sales Totals IS an `.xls` name over
   * HTML. A shared rule would have to admit both, which would let a legacy file
   * reach the Comp Report parsers.
   */
  admitsAttachment(attachment: ResendAttachment): boolean;
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
  admitsAttachment: (attachment) => isWorkbookCandidate(attachment),
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
 * SALES TOTALS — now a complete email path, gated on one variable.
 *
 * THE SUBJECT IS KNOWN ("Sales Totals for Bowen") and has a default. THE SENDER
 * ADDRESS IS STILL CONFIGURATION, and deliberately: an allowlist of exact
 * addresses is the one thing that must be changeable without a release — a test
 * address has to come out again, and a hard-coded default would ship a
 * permanent entry into every deployment including any future one nobody has
 * thought about yet. So `SALES_TOTALS_APPROVED_SENDERS` remains the single
 * activation gate, and unset admits nobody.
 *
 * What is no longer missing is the PATH. `intakeReceivedSalesTotals` selects
 * the HTML-under-.xls attachment, `intakeSalesTotalsReport` parses and writes
 * it through `ingest_sales_totals`, and `begin_report_ingestion` gives it the
 * same replay protection the Comp Report has. `activationGaps` therefore
 * reports configuration only, because configuration is all that is left.
 */
const salesTotals: ReportFamily = {
  key: "sales_totals",
  label: "Sales Totals",

  isActivated: () => parseSenders(process.env[SALES_TOTALS_SENDERS_ENV]).length > 0,

  activationGaps: () =>
    parseSenders(process.env[SALES_TOTALS_SENDERS_ENV]).length > 0
      ? []
      : [`${SALES_TOTALS_SENDERS_ENV} is not set to a valid address`],

  admitsSender: (from) => {
    const allowed = parseSenders(process.env[SALES_TOTALS_SENDERS_ENV]);
    if (allowed.length === 0) return false; // Unset admits nobody.
    const address = extractEmailAddress(from);
    // EXACT match, like the Comp Report's. No domain wildcards: a rule as loose
    // as "anything from the reporting system" would let any colleague on that
    // domain file financial figures.
    return address !== null && allowed.includes(address);
  },

  admitsSubject: (subject) =>
    (subject ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      .includes(salesTotalsSubjectFragment()),

  admitsAttachment: (attachment) => isSalesTotalsCandidate(attachment),

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

/**
 * ============================================================================
 * BED USAGE, SPA WELLNESS AND SPA ENGAGEMENT
 * ============================================================================
 *
 * Built from one factory, because the three differ in exactly three things:
 * their label, their environment variables and their default subject fragment.
 * Everything that makes the gate safe — exact-match addresses, no domain
 * wildcards, unset admits nobody, content confirmed from the BYTES — is shared,
 * so there is one implementation of it rather than three to drift apart.
 *
 * EACH HAS A DEFAULT SUBJECT FRAGMENT, unlike Sales Totals. Every one of the
 * three reports names itself in its subject line, so the fragment is a known
 * quantity and only the sender address has to be configured. The variable still
 * exists and still overrides, because a subject line is somebody else's to
 * change.
 *
 * THE SENDER ADDRESS IS NEVER GUESSED. Unset means the family is not activated
 * and every delivery is refused, which is the correct state: all three can be
 * ingested today through the credentialled HTTP route, and email automation
 * switches on with one environment variable and no code change.
 *
 * A NOTE ON WHY THESE ARE ACTIVATABLE AND SALES TOTALS IS NOT. Sales Totals has
 * no email persistence path yet — the inbound route says so explicitly. These
 * three do: `intakeBedSpaWorkbook` writes them, and the inbound route reaches
 * it through the same `dispatchReportIntake` the credentialled route uses. So
 * activating one of these is a configuration decision, not a deployment.
 */
function bedSpaFamily(input: {
  key: ReportFamilyKey;
  label: string;
  sendersEnv: string;
  subjectEnv: string;
  /** Used when the environment variable is unset. */
  defaultSubjectFragment: string;
}): ReportFamily {
  const subjectFragment = () => {
    const configured = (process.env[input.subjectEnv] ?? "").trim();
    return (configured.length > 0 ? configured : input.defaultSubjectFragment).toLowerCase();
  };

  return {
    key: input.key,
    label: input.label,

    // The subject fragment has a default, so activation turns entirely on
    // whether somebody has been approved to send this report.
    isActivated: () => parseSenders(process.env[input.sendersEnv]).length > 0,

    activationGaps: () =>
      parseSenders(process.env[input.sendersEnv]).length > 0
        ? []
        : [`${input.sendersEnv} is not set to a valid address`],

    admitsSender: (from) => {
      const allowed = parseSenders(process.env[input.sendersEnv]);
      if (allowed.length === 0) return false; // Unset admits nobody.
      const address = extractEmailAddress(from);
      /*
       * EXACT match. No domain wildcards and no suffix matching: a domain rule
       * would let any colleague file figures by replying to the thread, and a
       * suffix match on `@example.com` also matches `evil@notexample.com`.
       */
      return address !== null && allowed.includes(address);
    },

    admitsSubject: (subject) =>
      (subject ?? "").replace(/\s+/g, " ").trim().toLowerCase().includes(subjectFragment()),

    /*
     * All three arrive as real `.xlsx` workbooks, so they take the Comp
     * Report's candidate rule rather than Sales Totals'. That distinction is
     * the whole reason this is per-family: Sales Totals is HTML wearing an
     * `.xls` name, and a shared rule permissive enough for it would let a
     * legacy file reach these parsers.
     *
     * METADATA ONLY — it decides which attachments are worth downloading.
     * `recognizes` below is what decides what a file actually is, from its
     * bytes, and a candidate admitted here still has to pass that.
     */
    admitsAttachment: (attachment) => isWorkbookCandidate(attachment),

    recognizes: async (bytes) => {
      // A real workbook whose STRUCTURE is this family's. HTML is not any of
      // these, and the extension is never consulted.
      if (looksLikeHtmlReport(bytes)) return false;
      try {
        const detections = await detectBedSpaReport(bytes);
        return detections.some(
          (detection) => detection.supported && detection.familyKey === input.key,
        );
      } catch {
        return false;
      }
    },
  };
}

const bedUsage = bedSpaFamily({
  key: "bed_usage",
  label: "Bed Usage Report",
  sendersEnv: BED_USAGE_SENDERS_ENV,
  subjectEnv: BED_USAGE_SUBJECT_ENV,
  defaultSubjectFragment: "bed usage",
});

const spaWellness = bedSpaFamily({
  key: "spa_wellness",
  label: "STC SPA Wellness Tracking",
  sendersEnv: SPA_WELLNESS_SENDERS_ENV,
  subjectEnv: SPA_WELLNESS_SUBJECT_ENV,
  defaultSubjectFragment: "spa wellness",
});

const spaEngagement = bedSpaFamily({
  key: "spa_engagement",
  label: "Spa Sessions per Unique Tanner per Spa Bed",
  sendersEnv: SPA_ENGAGEMENT_SENDERS_ENV,
  subjectEnv: SPA_ENGAGEMENT_SUBJECT_ENV,
  defaultSubjectFragment: "spa sessions per unique tanner",
});

export const REPORT_FAMILIES: readonly ReportFamily[] = [
  compReport,
  salesTotals,
  bedUsage,
  spaWellness,
  spaEngagement,
];

/*
 * THERE IS NO `EMAIL_INGESTIBLE_FAMILIES` LIST ANY MORE, and the absence is
 * deliberate.
 *
 * One existed while Sales Totals had no email write path: the inbound route
 * consulted it and acknowledged a Sales Totals delivery as "recognised but not
 * ingestible". Sales Totals now has that path, so the list would refuse the
 * only delivery it was ever meant to describe — and every remaining family
 * reaches a persistence path, which leaves nothing for a list to exclude.
 *
 * A second copy of "which families can be filed" is also the wrong shape for
 * this question: whether a family can be persisted is a property of the code
 * behind it, and the inbound route already answers it structurally by handing
 * the bytes to `dispatchReportIntake`. A constant restating it can only drift.
 */

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
