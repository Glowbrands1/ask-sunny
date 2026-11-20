/**
 * QA's code audit on d7960a5f (item 13, 20 Nov 2026): one way to fold a name's letters, used wherever names are compared.
 * Accents come off ("Ramírez" → "Ramirez", never "Rami rez": NFKD splits the accent into its own mark, which is dropped,
 * not turned into a space) and every apostrophe is the straight one ("D’Angelo", an iPhone's curly ’, → "D'Angelo").
 * Case and spacing are left to the caller.
 */
export function foldName(text: string): string {
  return (text ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[‘’ʼ`´]/g, "'");
}
