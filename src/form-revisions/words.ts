import { NAV_SECTIONS } from "@/components/shell/navigation";
import { ACTIVE_BRAND } from "@/lib/brand";

/**
 * THE ONE FILE IN `src/form-revisions/` THAT DIFFERS BETWEEN THE TWO APPS.
 *
 * Every component here is the same code in both apps. The words a person
 * reads that belong to one company come from that app's own configuration:
 * the register's name from the navigation entry for its route, and the word
 * for one location from the brand's vocabulary.
 */
export const REGISTER_HREF = "/forms/monitoring";

export const REGISTER_NAME: string =
  NAV_SECTIONS.flatMap((section) => section.items).find((item) => item.href === REGISTER_HREF)?.label ?? "Forms";

export const LOCATION_NOUN: string = ACTIVE_BRAND.vocabulary.salonNoun;
