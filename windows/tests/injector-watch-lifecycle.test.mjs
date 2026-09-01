import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nextIdentityReconnectDelay } from "../scripts/injector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const injectorSource = await fs.readFile(path.join(here, "../scripts/injector.mjs"), "utf8");

test("identity reconnect keeps the original browser identity and backs off", () => {
  assert.equal(nextIdentityReconnectDelay(1), 500);
  assert.equal(nextIdentityReconnectDelay(2), 1000);
  assert.equal(nextIdentityReconnectDelay(5), 8000);
  assert.equal(nextIdentityReconnectDelay(6), 10000);
  assert.equal(nextIdentityReconnectDelay(0), 500);
});

test("watcher revalidates identity on every target discovery and does not stop on transient closure", () => {
  assert.match(
    injectorSource,
    /targets = await listAppTargets\(options\.port, options\.browserId\)/,
  );
  assert.match(injectorSource, /const reconnectIdentityAnchor = async \(\) =>/);
  assert.match(injectorSource, /connectBrowserIdentityAnchor\(options\.port, options\.browserId\)/);
  assert.doesNotMatch(
    injectorSource,
    /original CDP browser identity closed; watcher is stopping instead of reconnecting/,
  );
  assert.match(
    injectorSource,
    /CDP browser identity changed during handoff; watcher is stopping/,
  );
});
