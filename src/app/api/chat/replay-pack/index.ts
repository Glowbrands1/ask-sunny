import type { ReplayCase } from "./cases";
import { NOV2_DATA_LOSS_CASES } from "./nov2-data-loss-cases";
import { NOV2_METRIC_LOOP_CASES, NOV2_PERSON_CASES } from "./nov2-person-cases";
import { NOV2_CLAIM_CASES, NOV2_POLICY_REST_CASES } from "./nov2-claim-cases";
import { NOV2_CASES } from "./nov2-cases";
import { OCT30_CASES } from "./oct30-cases";

/** Every case in the pack, in report order. */
export const CASES: readonly ReplayCase[] = [...OCT30_CASES, ...NOV2_CASES, ...NOV2_DATA_LOSS_CASES, ...NOV2_PERSON_CASES, ...NOV2_CLAIM_CASES, ...NOV2_POLICY_REST_CASES, ...NOV2_METRIC_LOOP_CASES];
