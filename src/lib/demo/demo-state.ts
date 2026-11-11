import "server-only";

/**
 * STATE A DEMO KEEPS BETWEEN REQUESTS, held on `globalThis`.
 *
 * A route handler and the page it refreshes are compiled into separate module
 * graphs, so a `Map` declared at module scope in a fixture file would exist
 * twice: the route would write to one copy and the page read the other, and a
 * demo button would appear to do nothing. One process-wide registry, keyed by
 * name, is shared by both. Nothing here is persisted; a restart clears it.
 */
const REGISTRY = Symbol.for("ask-sunny.demo-state");

type Registry = Map<string, Map<string, unknown>>;

export function demoStateMap<V>(name: string): Map<string, V> {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>;
  const registry = (holder[REGISTRY] ??= new Map());
  let map = registry.get(name);
  if (!map) {
    map = new Map();
    registry.set(name, map);
  }
  return map as Map<string, V>;
}
