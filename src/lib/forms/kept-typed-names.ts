import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { installKeptTypedNames, normalizeTypedName } from "./employee-match";

/**
 * Names the manager already said to keep, for this request only.
 *
 * The matcher itself stays free of `node:async_hooks`: the chat screen
 * imports it through the form path, and the browser bundle cannot load
 * that module. The reader is installed here, and only a server caller
 * wraps work in `withKeptTypedNames`.
 */
const keptTypedNames = new AsyncLocalStorage<ReadonlySet<string>>();

installKeptTypedNames(() => keptTypedNames.getStore());

export function withKeptTypedNames<T>(names: readonly string[], run: () => T): T {
  const set = new Set(names.map((name) => normalizeTypedName(name)).filter((name) => name.length > 0));
  return keptTypedNames.run(set, run);
}
