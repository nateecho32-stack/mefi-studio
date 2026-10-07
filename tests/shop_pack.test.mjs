import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FONTS, MATERIALS, NODE_STYLES, PACK_LIMITS, PALETTE_KEYS, PALETTE_OPTIONAL, checkPack, contrastRatio } from "../relay/src/shop-pack.mjs";
import { CATALOG } from "../relay/src/shop.mjs";

// What a Shop style pack may hold (relay/src/shop-pack.mjs): data only, every
// key from the schema, colours as #rrggbb, readable text and accents. The
// cases live in tests/fixtures/shop-pack-cases.json so Studio's own mirror of
// the check (the pack editor) can be held to the same answers.

const cases = JSON.parse(await readFile(new URL("./fixtures/shop-pack-cases.json", import.meta.url), "utf8"));

test("every shared case gets the answer the fixture names", () => {
  assert.ok(cases.length >= 40, "the fixture covers the schema, the size and readability");
  for (const { name, data, ok, error } of cases) {
    const result = checkPack(data);
    assert.equal(result.ok, ok, name);
    if (ok) assert.ok(result.pack, name);
    else assert.equal(result.error, error, name);
  }
  assert.deepEqual([...new Set(cases.filter((item) => !item.ok).map((item) => item.error))].sort(), ["bad-pack", "low-contrast", "too-big"], "each refusal is covered");
});

test("a pack comes back as a copy: colours lower-case, keys in the schema's order, nothing else", () => {
  const data = { font: "mono", palette: { text: "#E8EEF7", accent2: "#A46BFF", surface: "#151B26", background: "#0B0F17", accent: "#4F8CFF" }, v: 1, nodeStyle: "sigil" };
  const { ok, pack } = checkPack(data);
  assert.equal(ok, true);
  assert.deepEqual(pack, { v: 1, palette: { accent: "#4f8cff", background: "#0b0f17", surface: "#151b26", text: "#e8eef7", accent2: "#a46bff" }, nodeStyle: "sigil", font: "mono" });
  assert.deepEqual(Object.keys(pack), ["v", "palette", "nodeStyle", "font"]);
  assert.deepEqual(Object.keys(pack.palette), ["accent", "background", "surface", "text", "accent2"]);
  pack.palette.text = "#000000";
  assert.equal(data.palette.text, "#E8EEF7", "the caller's object is never the one kept");
  // Only plain JSON counts: a key JSON would drop is not there, and anything JSON cannot hold is refused.
  assert.equal(checkPack({ v: 1, palette: { ...pack.palette, text: "#e8eef7" }, material: undefined }).ok, true);
  const loop = { v: 1, palette: {} };
  loop.palette.self = loop;
  assert.equal(checkPack(loop).error, "bad-pack");
  assert.equal(checkPack({ v: 1n }).error, "bad-pack");
});

test("WCAG contrast: black on white is 21, a colour on itself 1, and the limits are the spec's", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#ffffff", "#000000"), 21, "order does not matter");
  assert.equal(contrastRatio("#3a7bff", "#3a7bff"), 1);
  assert.equal(Math.round(contrastRatio("#767676", "#ffffff") * 100) / 100, 4.54);
  assert.deepEqual({ ...PACK_LIMITS }, { bytes: 2048, textContrast: 4.5, accentContrast: 4.5, nameMin: 2, nameMax: 40, blurbMax: 160 }, "the accent is read as text too, so it needs what text needs");
  assert.deepEqual([...PALETTE_KEYS, ...PALETTE_OPTIONAL], ["accent", "background", "surface", "text", "accent2"]);
  assert.deepEqual([...NODE_STYLES], ["orbs", "glass", "minimal", "halo", "crystal", "singularity", "prism", "sigil"]);
  assert.deepEqual([...MATERIALS], ["focus", "studio", "atmosphere"]);
  assert.deepEqual([...FONTS], ["studio", "display", "serif", "mono"]);
});

// The packs for October's drop ("2026-10", Haunted Hollow) and the classic shelf, kept as catalog entries until they
// join relay/src/shop.mjs CATALOG at merge: each passes the check exactly as kept, its accent reads at 4.5:1 on its
// panels as well as its page (a light pack's accent is text on both), and its words are plain.
test("the October drop's and the classic style packs pass the check exactly as kept, with plain words and fair prices", async () => {
  const themes = JSON.parse(await readFile(new URL("./fixtures/shop-themes-2026-10.json", import.meta.url), "utf8"));
  assert.deepEqual(themes.map((item) => [item.name, item.drop]), [
    ["Pumpkin Spice", "2026-10"], ["Haunted", "2026-10"], ["Candlelight (light)", "2026-10"],
    ["Midnight Neon", null], ["Forest Glade", null], ["Ocean Breeze (light)", null], ["Rose Gold (light)", null], ["Frost", null],
  ]);
  assert.equal(new Set(themes.map((item) => item.id)).size, themes.length, "every id once");
  const studioIds = new Set(CATALOG.map((item) => item.id)), studioNames = new Set(CATALOG.map((item) => item.name));
  for (const item of themes) {
    assert.deepEqual(Object.keys(item), ["id", "kind", "name", "price", "blurb", "drop", "data"], item.id);
    assert.match(item.id, /^studio:pack-[a-z0-9-]{1,35}$/);
    assert.ok(!studioIds.has(item.id) && !studioNames.has(item.name), `${item.name} is new to the Shop`);
    assert.equal(item.kind, "pack");
    assert.ok(Number.isInteger(item.price) && item.price >= 40 && item.price <= 50, `${item.name}: ${item.price} credits`);
    assert.ok(item.name.length >= PACK_LIMITS.nameMin && item.name.length <= PACK_LIMITS.nameMax && item.blurb.length <= PACK_LIMITS.blurbMax);
    assert.doesNotMatch(`${item.name} ${item.blurb}`, /perk|unlock|premium|entitlement/i);
    assert.deepEqual(checkPack(item.data), { ok: true, pack: JSON.parse(JSON.stringify(item.data)) }, item.name);
    const { accent, background, surface, text } = item.data.palette;
    assert.ok(contrastRatio(accent, surface) >= 4.5 && contrastRatio(text, surface) >= 4.5, `${item.name}: the accent and text read on the panels`);
    assert.ok(NODE_STYLES.includes(item.data.nodeStyle), `${item.name} wears a node style Studio comes with`);
    // A light look says so in its name and its words, as Sakura (light) does.
    const light = (item.name.endsWith("(light)"));
    assert.equal(light, contrastRatio(background, "#000000") > contrastRatio(background, "#ffffff"), `${item.name}: a light page is named a light look`);
    if (light) assert.match(item.blurb, /a light look\.$/);
  }
});

test("Studio's own packs pass the same check, exactly as they are kept", () => {
  const packs = CATALOG.filter((item) => item.kind === "pack");
  assert.equal(packs.length, 3);
  for (const item of packs) assert.deepEqual(checkPack(item.data), { ok: true, pack: JSON.parse(JSON.stringify(item.data)) }, item.id);
  assert.ok(CATALOG.filter((item) => item.kind !== "pack").every((item) => item.data === null), "pets, skins and effects carry no data");
});
