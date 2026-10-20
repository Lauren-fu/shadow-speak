import test from "node:test";
import assert from "node:assert/strict";
import { createKeyStore } from "../key-store.mjs";

test("key survives new panel instances; local storage is restricted before saving", async () => {
  const saved = {}; let restricted = false;
  const storage = {
    async setAccessLevel(options) { assert.equal(options.accessLevel, "TRUSTED_CONTEXTS"); restricted = true; },
    async get(name) { return { [name]: saved[name] }; },
    async set(data) { assert.ok(restricted); Object.assign(saved, data); },
    async remove(name) { delete saved[name]; }
  };
  const first = createKeyStore(storage);
  await first.save(" test-key-not-a-real-secret ");
  const reopened = createKeyStore(storage);
  assert.equal(await reopened.read(), "test-key-not-a-real-secret");
  await reopened.clear();
  assert.equal(await first.read(), "");
});
test("a failure to restrict key storage prevents saving secrets", async () => {
  const store = createKeyStore({
    async setAccessLevel() { throw new Error("storage unavailable"); },
    async set() { assert.fail("must not save"); }
  });
  await assert.rejects(store.save("test-only"), /unavailable/);
});
