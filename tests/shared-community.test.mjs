import assert from "node:assert/strict";
import test from "node:test";
import { Community, communityMetadata, communityPage } from "../build/shared/core/community.mjs";

const enc = value => new TextEncoder().encode(JSON.stringify(value));
const query = { limit: 24, offset: 0, sort: "recent", query: "", appearance: "all" };
const good = { id: "ver_abcdefgh", themeId: "t", name: "N", version: "1", authorDisplayName: "A", license: "MIT", packageSha256: "x", packageBytes: 3, applyCompatible: true };

test("list keeps usable entries and tolerates odd descriptive fields", () => {
  const page = communityPage(enc({ items: [good, { id: "bad" }, good, { id: "ver_zzzzzzzz", applyCompatible: false, displayMeta: { platforms: ["linux"] } }], total: 1, limit: 99, offset: 5 }), query);
  assert.deepEqual(page.items.map(item => item.id), ["ver_abcdefgh", "ver_zzzzzzzz"]);
  assert.equal(page.items[1].name, "ver_zzzzzzzz");
  assert.equal(page.items[1].applyCompatible, false);
  assert.deepEqual(page.items[1].platforms, []);
  assert.equal(page.total, 2); assert.equal(page.limit, 24);
});

test("metadata only requires a matching id", () => {
  const meta = communityMetadata(enc({ id: "ver_abcdefgh", applyCompatible: false }), "ver_abcdefgh");
  assert.equal(meta.name, "ver_abcdefgh"); assert.equal(meta.applyCompatible, false);
  assert.throws(() => communityMetadata(enc({ id: "ver_other123" }), "ver_abcdefgh"), { code: "THEME_INVALID" });
});

test("download has no size/hash gate, runs without a concurrency cap, and a failure can be retried", async () => {
  let reads = 0, fail = true; const registered = [];
  const http = { list: async () => enc({ items: [] }), image: async () => ({ bytes: new Uint8Array(1), extension: ".png" }), close() {},
    read: async (version, download, maximum) => { if (!download) return enc({ ...good, packageBytes: 1, packageSha256: "stale" });
      reads++; if (fail) { fail = false; throw new Error("net"); } assert.ok(maximum >= 1024 * 1024); return new Uint8Array([1, 2, 3, 4]); } };
  const packages = { registerCommunity: async (bytes, meta) => { registered.push(bytes.byteLength); return { source: meta.id }; } };
  const community = new Community(http, packages);
  const tickets = [];
  for (let i = 0; i < 12; i++) tickets.push(await community.inspect("dreamskin://apply?version=ver_abcdefgh"));
  const [a, b] = await Promise.all([community.inspect("dreamskin://apply?version=ver_abcdefgh"), community.inspect("dreamskin://apply?version=ver_abcdefgh")]);
  assert.notEqual(a.handle, b.handle);
  await assert.rejects(community.download(tickets[0].handle), /net/);
  assert.deepEqual(await community.download(tickets[0].handle), { source: "ver_abcdefgh" });
  assert.deepEqual(registered, [4]); assert.equal(reads, 2);
  await community.close();
});
