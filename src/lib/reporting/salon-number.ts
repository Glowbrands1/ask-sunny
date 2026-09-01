/**
 * THE SALON BUSINESS KEY, AS A PATTERN.
 *
 * Kept in its own module for the same reason as the metric vocabulary: the
 * dashboard's URL parser validates salon numbers arriving from a query string,
 * and the parser module that used to own this constant reaches ExcelJS through
 * its cell coercions. A regex does not need a spreadsheet library.
 *
 * Mirrors `salons_salon_number_format` in the schema exactly. TEXT, so '0468'
 * survives: numeric coercion would drop the leading zero and split a salon's
 * history across two rows.
 */
export const SALON_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
