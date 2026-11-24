/**
 * NAMING A MODULE CREATED FROM THE LESSON EDITOR.
 *
 * The editor pre-fills "Module N: " so the editor only types the topic. The
 * admin-only archive module is not counted: it is not a numbered module.
 */
export function nextModuleName(modules: readonly { adminOnly: boolean }[]): string {
  return `Module ${modules.filter((m) => !m.adminOnly).length + 1}: `;
}

/** The new module's name, trimmed; refuses a blank one or one that is only its number. */
export function cleanNewModuleTitle(raw: string): string {
  const title = typeof raw === "string" ? raw.trim() : "";
  if (!title || /^module\s*\d*\s*:?$/i.test(title)) throw new Error("Give the new module a name.");
  if (title.length > 300) throw new Error("Module name is too long.");
  return title;
}
