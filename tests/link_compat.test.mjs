import test from "node:test";
import assert from "node:assert/strict";
import compat from "../scripts/link-compat.cjs";
import hub from "../scripts/hub-client.cjs";
import transport from "../scripts/paired-transport.cjs";
import { OLDEST_PROTOCOL, PROTOCOL_VERSION, checkVersion } from "../relay/src/protocol.mjs";

// scripts/link-compat.cjs: which Studio versions still connect. A side
// accepts every protocol from its oldest to its newest; only a side whose
// newest is below the other's oldest is really behind and has to update.

test("overlapping windows connect and speak the highest number both know", () => {
  assert.deepEqual(compat.negotiate({ protocol: 1, oldest: 1 }, { protocol: 1, oldest: 1 }), { ok: true, speak: 1, behind: null });
  assert.deepEqual(compat.negotiate({ protocol: 3, oldest: 1 }, { protocol: 2, oldest: 2 }), { ok: true, speak: 2, behind: null }, "a release apart still works");
  assert.deepEqual(compat.negotiate({ protocol: 2, oldest: 1 }, {}), { ok: true, speak: 1, behind: null }, "a peer from before versions were sent speaks 1");
});

test("only the side that is really behind is asked to update", () => {
  assert.deepEqual(compat.negotiate({ protocol: 1, oldest: 1 }, { protocol: 4, oldest: 3 }), { ok: false, speak: null, behind: "me" });
  assert.deepEqual(compat.negotiate({ protocol: 4, oldest: 3 }, { protocol: 2, oldest: 1 }), { ok: false, speak: null, behind: "them" });
  assert.deepEqual(compat.negotiate({ protocol: 2, oldest: 1 }, { protocol: 3 }), { ok: false, speak: null, behind: "me" }, "a peer without `oldest` accepts only its own number");
});

test("malformed windows are clamped, never trusted", () => {
  assert.deepEqual(compat.windowOf({ protocol: 2, oldest: 9 }), { protocol: 2, oldest: 2 });
  assert.deepEqual(compat.windowOf({ protocol: "2", oldest: -1 }), { protocol: 1, oldest: 1 });
  assert.deepEqual(compat.windowOf(null), { protocol: 1, oldest: 1 });
  assert.equal(compat.appVersion("0.5.0"), "0.5.0");
  assert.equal(compat.appVersion("0.5.0-beta.1"), "0.5.0-beta.1");
  assert.equal(compat.appVersion("<script>"), null);
  assert.equal(compat.appVersion(5), null);
});

test("Studio versions compare as numbers, pre-releases first", () => {
  assert.equal(compat.compareVersions("0.4.10", "0.4.9"), 1);
  assert.equal(compat.compareVersions("0.4.6", "0.5.0"), -1);
  assert.equal(compat.compareVersions("0.5.0-beta.1", "0.5.0"), -1);
  assert.equal(compat.compareVersions("0.5.0", "0.5.0"), 0);
  assert.equal(compat.compareVersions("unknown", "0.5.0"), 0, "a missing version never reads as behind");
});

test("the words say who has to update, and nothing when nobody does", () => {
  assert.equal(compat.describe({ verdict: { ok: false, behind: "me" }, peer: "Laptop", mine: "0.3.3" }), "This Studio (0.3.3) is too far behind Laptop to connect. Update Studio and it reconnects by itself.");
  assert.equal(compat.describe({ verdict: { ok: false, behind: "them" }, peer: "Laptop", theirs: "0.3.3" }), "Laptop (Studio 0.3.3) is too far behind to connect. Update Studio there and it reconnects by itself.");
  assert.equal(compat.describe({ verdict: { ok: true }, peer: "Laptop", mine: "0.5.0", theirs: "0.4.6" }), "Laptop runs an older Studio (0.5.0 here, 0.4.6 on Laptop). They still connect; update when it suits you.");
  assert.equal(compat.describe({ verdict: { ok: true }, peer: "Laptop", mine: "0.5.0", theirs: "0.5.0" }), "");
});

test("Studio, its hub client and the relay agree on the Friends window; paired PCs use theirs", () => {
  assert.equal(hub.PROTOCOL_VERSION, compat.LINKS.friends.protocol);
  assert.equal(hub.OLDEST_PROTOCOL, compat.LINKS.friends.oldest);
  assert.equal(PROTOCOL_VERSION, compat.LINKS.friends.protocol, "relay/src/protocol.mjs PROTOCOL_VERSION");
  assert.equal(OLDEST_PROTOCOL, compat.LINKS.friends.oldest, "relay/src/protocol.mjs OLDEST_PROTOCOL");
  assert.deepEqual(transport.SPOKEN, { protocol: compat.LINKS.pcs.protocol, oldest: compat.LINKS.pcs.oldest });
  assert.ok(compat.LINKS.friends.oldest <= compat.LINKS.friends.protocol && compat.LINKS.pcs.oldest <= compat.LINKS.pcs.protocol);
});

test("the relay's hello check: today's Studio connects, a newer one that still speaks 1 connects, only the really old or really new are refused", () => {
  assert.deepEqual(checkVersion(1), { ok: true, speak: 1 }, "today's Studio sends protocol 1 and no oldest");
  assert.deepEqual(checkVersion(1, 1), { ok: true, speak: 1 });
  assert.deepEqual(checkVersion(2, 1), { ok: true, speak: 1 }, "a newer Studio that still speaks 1");
  assert.deepEqual(checkVersion(2), { ok: false, behind: "relay" }, "a newer Studio that speaks only 2: the relay is behind");
  assert.deepEqual(checkVersion(0), { ok: false, behind: "client" });
});
