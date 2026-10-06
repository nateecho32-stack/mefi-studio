import assert from "node:assert/strict";
import test from "node:test";
import hub from "../scripts/hub-client.cjs";

// scripts/hub-client.cjs's Shop calls against a scripted relay: nothing is
// asked of a relay that does not list "shop", ids and fields are checked
// before anything leaves, a pack's data goes whole (so the relay's check can
// refuse a key instead of it being dropped here), results keep only the
// fields Studio knows (a pack's data only the schema's keys), and refusals
// keep what Studio needs to say why.

const USER = { id: "123456789012345678", name: "Mefi" };
const PACK_ID = "pack_AbCdEfGhIjKlMnOp";
const PACK = { v: 1, palette: { accent: "#4f8cff", background: "#0b0f17", surface: "#151b26", text: "#e8eef7" } };
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((done) => setImmediate(done)); };

function harness({ features = ["shop"], answer = () => ({ status: 200, body: { ok: true } }) } = {}) {
  const calls = [];
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  const fetch = async (href, init) => {
    const url = new URL(href);
    const respond = (reply) => ({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body });
    if (init.method === "POST" && url.pathname === "/v1/session") return respond({ status: 200, body: { ok: true, session: "hub-session", expiresAt: Date.now() + 15 * 60_000, user: USER } });
    const call = { method: init.method, path: `${url.pathname}${url.search}`, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call);
    return respond(await answer(call));
  };
  const client = hub.createHubClient({
    url: "https://hub.example.test", fetch, WebSocket: FakeSocket, getAccessToken: async () => ({ ok: true, token: "discord-access" }),
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  });
  async function ready() {
    await client.connect();
    const socket = sockets.at(-1);
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "ready", user: USER, protocol: 1, features }) });
    await settle();
  }
  return { client, calls, ready };
}

test("a relay that does not list the Shop is never asked", async () => {
  const h = harness({ features: ["credits", "projects"] });
  await h.ready();
  assert.equal(h.client.status().shop, false);
  const answers = await Promise.all([
    h.client.shop("studio"), h.client.shopOwned(), h.client.shopBuy("studio:fx-embers", 90), h.client.shopPublish({ name: "Neon", price: 0, data: PACK }),
    h.client.shopUpdate(PACK_ID, { name: "Neon" }), h.client.shopUnlist(PACK_ID), h.client.shopReport(PACK_ID, { reason: "spam" }), h.client.modShopRemove(PACK_ID),
  ]);
  assert.ok(answers.every((answer) => answer.ok === false && answer.error === "unsupported"));
  assert.equal(h.calls.length, 0);
});

test("ids, views and fields are checked before anything leaves", async () => {
  const h = harness();
  await h.ready();
  assert.equal(h.client.status().shop, true);
  const refused = [
    h.client.shop("studio", "not a cursor!"),
    h.client.shopBuy("nope", 10), h.client.shopBuy("studio:Skin", 10), h.client.shopBuy("studio:fx-embers", -1), h.client.shopBuy("studio:fx-embers", 1.5), h.client.shopBuy("pack_short", 0),
    h.client.shopUpdate("studio:skin-frost", { name: "Neon" }), h.client.shopUpdate(PACK_ID, { price: 5 }), h.client.shopUpdate(PACK_ID, { listed: "yes" }), h.client.shopUpdate(PACK_ID, { name: "A" }),
    h.client.shopUnlist("../admin"),
    h.client.shopPublish({ name: "Neon", price: 0 }), h.client.shopPublish({ name: "Neon", price: 0, data: [] }), h.client.shopPublish({ name: "Neon", price: 251, data: PACK }),
    h.client.shopPublish({ name: "x".repeat(41), price: 0, data: PACK }), h.client.shopPublish({ name: "Two\nlines", price: 0, data: PACK }), h.client.shopPublish({ name: "Neon", price: 0, data: PACK, blurb: "a\nb" }),
    h.client.shopPublish({ name: "Neon", price: 0, data: { ...PACK, note: "x".repeat(16 * 1024) } }),
    h.client.shopReport(PACK_ID, { reason: "  " }), h.client.shopReport(PACK_ID, { reason: "x".repeat(501) }), h.client.shopReport(PACK_ID, { reason: "spam", text: "x".repeat(301) }),
    h.client.modShopRemove("pack_x"), h.client.modShopRemove(PACK_ID, { reason: "a\nb" }),
  ];
  for (const [index, answer] of (await Promise.all(refused)).entries()) assert.deepEqual(answer, { ok: false, error: "bad-request" }, `call ${index}`);
  assert.equal(h.calls.length, 0, "nothing reached the relay");
});

test("each call goes where the relay expects it, with only the fields it takes", async () => {
  const h = harness();
  await h.ready();
  await h.client.shop("top", "30");
  await h.client.shop("everything");
  await h.client.shopOwned();
  await h.client.shopBuy("studio:fx-embers", 90);
  await h.client.shopBuy(PACK_ID, 0);
  await h.client.shopPublish({ name: "Neon night", blurb: " ", price: 0, data: { ...PACK, css: "x" }, listed: true, extra: 1 });
  await h.client.shopUpdate(PACK_ID, { blurb: "", listed: false, sales: 99 });
  await h.client.shopUnlist(PACK_ID);
  await h.client.shopReport(PACK_ID, { reason: " spam ", text: "  more words " });
  await h.client.modShopRemove(PACK_ID);
  await h.client.modShopRemove(PACK_ID, { reason: "a copy" });
  assert.deepEqual(h.calls, [
    { method: "GET", path: "/v1/shop?view=top&cursor=30", body: undefined },
    { method: "GET", path: "/v1/shop?view=studio", body: undefined },
    { method: "GET", path: "/v1/shop/owned", body: undefined },
    { method: "POST", path: "/v1/shop/studio:fx-embers/buy", body: { price: 90 } },
    { method: "POST", path: `/v1/shop/${PACK_ID}/buy`, body: { price: 0 } },
    { method: "POST", path: "/v1/shop/packs", body: { name: "Neon night", price: 0, data: { ...PACK, css: "x" } } },
    { method: "PUT", path: `/v1/shop/packs/${PACK_ID}`, body: { blurb: "", listed: false } },
    { method: "DELETE", path: `/v1/shop/packs/${PACK_ID}`, body: undefined },
    { method: "POST", path: `/v1/shop/packs/${PACK_ID}/report`, body: { reason: "spam", text: "more words" } },
    { method: "POST", path: `/v1/admin/shop/${PACK_ID}/remove`, body: {} },
    { method: "POST", path: `/v1/admin/shop/${PACK_ID}/remove`, body: { reason: "a copy" } },
  ]);
});

test("results keep an item's known fields only: a pack's data has the schema's keys, numbers and strings are capped", async () => {
  const studio = { id: "studio:skin-frost", kind: "skin", name: "Frost scales", blurb: "Ember in icy blue.", price: 40, requires: null, maker: null, data: { v: 1 }, sales: 3, owned: true, status: "listed", createdAt: 1, updatedAt: 2, html: "<b>x</b>" };
  const pack = {
    id: PACK_ID, kind: "pack", name: "Neon night", blurb: "x".repeat(161), price: -5, requires: "javascript:alert(1)", maker: { id: "200000000000000001", name: "Alice", email: "a@example.com" },
    data: { v: 1, palette: { ...PACK.palette, accent: "#4F8CFF", glow: "#ffffff" }, nodeStyle: "halo", material: "nope", font: "mono", css: "body{}" },
    sales: 1e12, owned: "yes", status: "sold", createdAt: "today", updatedAt: 5,
  };
  const h = harness({
    answer: () => ({ status: 200, body: { ok: true, items: [studio, pack, { ...pack, id: "pack_BbCdEfGhIjKlMnOp", data: { v: 1, palette: { accent: "#ffffff" } } }, { ...studio, id: "studio:../x" }, { ...studio, name: "x".repeat(41) }], next: "not a cursor!", balance: 40, canEarn: true, hold: { reason: "nope", until: 1 } } }),
  });
  await h.ready();
  const page = await h.client.shop("new");
  assert.deepEqual(page, {
    ok: true, view: "new",
    items: [
      { id: "studio:skin-frost", kind: "skin", name: "Frost scales", blurb: "Ember in icy blue.", price: 40, requires: null, maker: null, data: null, sales: 3, owned: true, status: "listed", createdAt: 1, updatedAt: 2 },
      {
        id: PACK_ID, kind: "pack", name: "Neon night", blurb: "", price: 0, requires: null, maker: { id: "200000000000000001", name: "Alice" },
        data: { v: 1, palette: PACK.palette, nodeStyle: "halo", font: "mono" }, sales: 0, owned: false, status: "listed", createdAt: null, updatedAt: 5,
      },
    ],
    next: null, balance: 40, canEarn: true, hold: null,
  }, "a pack without a whole palette, an odd id and an over-long name are left out");
  assert.deepEqual(hub.packData({ v: 1, palette: { ...PACK.palette, accent2: null } }), PACK, "accent2 may be missing");
  assert.equal(hub.packData({ v: 2, palette: PACK.palette }), null);
  assert.equal(hub.itemCard({ ...studio, kind: "hat" }), null);
});

test("shopOwned keeps id, kind, name, data and when it changed, and a pack only with a pack's data", async () => {
  const h = harness({
    answer: () => ({ status: 200, body: { ok: true, items: [
      { id: "studio:fx-dissolve", kind: "effect", name: "Dissolve", data: { v: 1 }, updatedAt: 7, price: 60 },
      { id: PACK_ID, kind: "pack", name: "Neon night", data: { ...PACK, url: "https://example.com" }, updatedAt: 8 },
      { id: "pack_BbCdEfGhIjKlMnOp", kind: "pack", name: "Broken", data: null, updatedAt: 9 },
    ] } }),
  });
  await h.ready();
  assert.deepEqual(await h.client.shopOwned(), { ok: true, items: [
    { id: "studio:fx-dissolve", kind: "effect", name: "Dissolve", data: null, updatedAt: 7 },
    { id: PACK_ID, kind: "pack", name: "Neon night", data: PACK, updatedAt: 8 },
  ] });
});

test("refusals keep needs, price, balance, hold and until, and nothing else", async () => {
  let reply = null;
  const h = harness({ answer: () => reply });
  await h.ready();
  reply = { status: 409, body: { ok: false, error: "short", reason: "credits", balance: 10, price: 60, needs: "javascript:alert(1)", hold: "nope", extra: "x" } };
  assert.deepEqual(await h.client.shopBuy("studio:fx-dissolve", 60), { ok: false, error: "short", reason: "credits", balance: 10, price: 60 });
  reply = { status: 409, body: { ok: false, error: "needs", needs: "studio:fx-embers" } };
  assert.deepEqual(await h.client.shopBuy("studio:hat-party", 20), { ok: false, error: "needs", needs: "studio:fx-embers" }, "no item needs another today, but the refusal keeps its shape");
  reply = { status: 403, body: { ok: false, error: "hold", hold: "new-member", until: 123 } };
  assert.deepEqual(await h.client.shopPublish({ name: "Neon", price: 20, data: PACK }), { ok: false, error: "hold", hold: "new-member", until: 123 });
  reply = { status: 429, body: { ok: false, error: "rate-limited", retryAfter: 5000 } };
  assert.deepEqual(await h.client.shopPublish({ name: "Neon", price: 0, data: PACK }), { ok: false, error: "rate-limited", retryAfter: 5000 });
  reply = { status: 200, body: { ok: true, pack: { id: "not-a-pack" } } };
  assert.deepEqual(await h.client.shopUnlist(PACK_ID), { ok: false, error: "failed" }, "an answer that is not a pack is a failure");
});

test("a moderator's report list keeps a Shop report's pack", async () => {
  const h = harness({
    answer: () => ({ status: 200, body: { ok: true, reports: [
      { id: "rep_a", kind: "shop", roomId: null, messageId: null, projectId: null, packId: PACK_ID, author: { id: "200000000000000001", name: "Alice" }, reporter: { id: "200000000000000003", name: "Cara" }, reason: "copy", text: "Neon · from a game", verified: true, createdAt: 1 },
      { id: "rep_b", kind: "project", roomId: null, messageId: null, projectId: "proj_a", packId: "javascript:x", author: null, reporter: { id: "200000000000000003", name: "Cara" }, reason: "spam", text: null, verified: true, createdAt: 2 },
    ] } }),
  });
  await h.ready();
  const { reports } = await h.client.modReports();
  assert.deepEqual(reports.map((item) => [item.id, item.kind, item.packId, item.projectId]), [["rep_a", "shop", PACK_ID, null], ["rep_b", "project", null, "proj_a"]]);
});
