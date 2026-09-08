import "server-only";

import {
  BedSpaIntakeRejected,
  detectBedSpaReport,
  intakeBedSpaWorkbook,
  type BedSpaIntakeDependencies,
  type BedSpaIntakeResult,
} from "./bed-spa-intake";
import { ReportParseError } from "./errors";
import {
  intakeReportWorkbook,
  ReportIntakeRejected,
  type IntakeDependencies,
  type ReportIntakeInput,
  type ReportIntakeResult,
} from "./intake";

/**
 * ============================================================================
 * ONE DELIVERY, FIVE REPORT FAMILIES, ONE ENTRY POINT
 * ============================================================================
 *
 * The credentialled intake endpoint takes a workbook and no instructions about
 * what it is. There are now two intake stacks behind it:
 *
 *   the COMP REPORT stack, which runs several parsers over ONE workbook because
 *   that file legitimately contains three sheets of the same family;
 *
 *   the BED USAGE / SPA stack, where three different files arrive from three
 *   different senders and exactly one family recognises any given delivery.
 *
 * They stay separate because they answer different questions, and this module
 * is the ONE place that decides which one a delivery belongs to. A branch inside
 * either stack would mean each of them carrying the other's rules.
 *
 * THE ORDER OF THE ASK IS NOT A PREFERENCE. The Bed Usage and Spa detectors
 * look for three specific headings (`Bed Usage Report`, `SPA Wellness`,
 * `Spa Sessions per Unique Tanner per Spa Bed`); the Comp Report's look for
 * theirs. No workbook satisfies both, so the order cannot change an outcome —
 * it is asked first only because its detectors are the cheaper probe.
 *
 * A DELIVERY THAT NOTHING RECOGNISES IS REFUSED WITH BOTH STACKS' REASONS, so
 * "the workbook changed" says which family and which marker. Guessing is never
 * an option here: filing one report's figures under another's name is the
 * failure that would be hardest to notice afterwards.
 */

export type DispatchedIntake =
  | { family: "comp_sales"; result: ReportIntakeResult }
  | { family: "bed_spa"; result: BedSpaIntakeResult };

export interface DispatchDependencies {
  compSales?: IntakeDependencies;
  bedSpa?: BedSpaIntakeDependencies;
}

/**
 * Runs one delivery through whichever stack recognises it.
 *
 * Rethrows the recognising stack's own rejection, so the route keeps reporting
 * `template_drift` versus `unsupported_workbook` with that family's reasons.
 * When NEITHER recognises it, the Comp Report stack's rejection is rethrown —
 * it is the family a stray spreadsheet is most likely to have been meant for,
 * and its message already lists every parser's verdict.
 */
export async function dispatchReportIntake(
  input: ReportIntakeInput,
  dependencies: DispatchDependencies = {},
): Promise<DispatchedIntake> {
  /*
   * The cheap probe first. A file this cannot read is not refused here: the
   * Comp Report stack reads the same bytes and produces the refusal, so there
   * is one place that decides what "unreadable" means.
   */
  let bedSpaRecognises = false;
  try {
    const detections = await detectBedSpaReport(input.bytes);
    bedSpaRecognises = detections.some((entry) => entry.supported);
  } catch (error) {
    if (!(error instanceof ReportParseError)) throw error;
    bedSpaRecognises = false;
  }

  if (bedSpaRecognises) {
    return {
      family: "bed_spa",
      result: await intakeBedSpaWorkbook(
        {
          bytes: input.bytes,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          externalMessageId: input.externalMessageId,
          senderEmail: input.senderEmail,
          receivedAt: input.receivedAt,
          externalArchiveUrl: input.externalArchiveUrl,
          inboundEmailId: input.inboundEmailId,
        },
        dependencies.bedSpa ?? {},
      ),
    };
  }

  return {
    family: "comp_sales",
    result: await intakeReportWorkbook(input, dependencies.compSales ?? {}),
  };
}

/** True when this rejection came from the Bed Usage / Spa stack. */
export function isBedSpaRejection(error: unknown): error is BedSpaIntakeRejected {
  return error instanceof BedSpaIntakeRejected;
}

/** True when this rejection came from the Comp Report stack. */
export function isCompSalesRejection(error: unknown): error is ReportIntakeRejected {
  return error instanceof ReportIntakeRejected;
}
