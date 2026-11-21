/**
 * THE MANAGER'S OWN CLAUSE FOR A SHORTENED ACCOUNT (QA's live L6 on prod 14fed8c, 22 Nov 2026).
 *
 * "exit form for Test Testy, terminated for job abandonment, not eligible for rehire": the model's account was "job
 * abandonment", so the exit card and the saved reason lost the manager's "terminated for". When the model's account is
 * one clause and is, as whole words, part of exactly one clause the manager typed in this request (clauses end at a comma,
 * semicolon, sentence end or line break), that whole clause is the account, as typed. The account's own words are never
 * read for meaning; anything else (no such clause, several, an account of several clauses) keeps the model's account.
 */

const CLAUSE_END = /[,;.!?\n]+/;
const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}'/]+/gu, " ").trim();

export function ownClauseHolding(account: string, managerWords: string): string | null {
  const own = account.trim().replace(/[.!?]+$/, "");
  if (own === "" || CLAUSE_END.test(own)) return null;
  const wanted = norm(own);
  if (wanted === "") return null;
  const holding = managerWords
    .split(CLAUSE_END)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== "" && ` ${norm(clause)} `.includes(` ${wanted} `) && norm(clause) !== wanted);
  const distinct = [...new Set(holding.map(norm))];
  if (distinct.length !== 1) return null;
  const clause = holding[0]!;
  return /[.!?]$/.test(account.trim()) ? `${clause}.` : clause;
}
