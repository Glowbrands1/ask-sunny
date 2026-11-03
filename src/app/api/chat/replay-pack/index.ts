import type { ReplayCase } from "./cases";
import { NOV2_CASES } from "./nov2-cases";
import { OCT30_CASES } from "./oct30-cases";

/** Every case in the pack, in report order. */
export const CASES: readonly ReplayCase[] = [...OCT30_CASES, ...NOV2_CASES];
