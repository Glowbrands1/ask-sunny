import { afterEach } from "vitest";

/**
 * A test that replaces `process.env` with a plain object leaks that object
 * into the next file in the same worker. Put the real object back, and copy
 * the keys the test meant to restore onto it.
 */
const realEnv = process.env;

afterEach(() => {
  if (process.env === realEnv) return;
  const replacement = process.env;
  process.env = realEnv;
  for (const key of Object.keys(realEnv)) {
    if (!(key in replacement)) delete realEnv[key];
  }
  for (const [key, value] of Object.entries(replacement)) {
    if (value === undefined) delete realEnv[key];
    else realEnv[key] = value;
  }
});
