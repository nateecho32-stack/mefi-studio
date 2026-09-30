// Pictures attached to a message, the pure half (scripts/image-attach.cjs): the
// bytes decide what a file is, the limits, the ids, the shape each provider wants
// and which models the catalog says can look. The store is image_store.test.mjs,
// the host wiring image_attach_host.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { png, jpeg, gif, webpX, webpL, webpLossy, notPictures } from "./fixtures/image-bytes.mjs";

const require = createRequire(import.meta.url);
const attach = require("../scripts/image-attach.cjs");
const profiles = require("../scripts/agent-profiles.cjs");
const catalog = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
const MB = 1024 * 1024;

test("the bytes say what a picture is, and only PNG, JPEG, WebP and GIF count", () => {
  assert.equal(attach.sniff(png()), "image/png");
  assert.equal(attach.sniff(jpeg()), "image/jpeg");
  assert.equal(attach.sniff(gif()), "image/gif");
  assert.equal(attach.sniff(Buffer.concat([Buffer.from("GIF87a"), Buffer.alloc(20)])), "image/gif", "the older GIF too");
  for (const make of [webpX, webpL, webpLossy]) assert.equal(attach.sniff(make()), "image/webp");
  for (const [name, bytes] of Object.entries(notPictures)) assert.equal(attach.sniff(bytes), null, `${name} is not a picture`);
  assert.equal(attach.sniff(Buffer.alloc(0)), null);
  assert.equal(attach.sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47])), null, "too short to be one");
  // RIFF that is not WebP (a WAV) is not a picture.
  assert.equal(attach.sniff(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(16)])), null);
});

test("dimensions come from each format's own header", () => {
  assert.deepEqual(attach.dimensions(png(640, 480), "image/png"), { width: 640, height: 480 });
  assert.deepEqual(attach.dimensions(jpeg(1920, 1080), "image/jpeg"), { width: 1920, height: 1080 });
  assert.deepEqual(attach.dimensions(gif(300, 200), "image/gif"), { width: 300, height: 200 });
  assert.deepEqual(attach.dimensions(webpX(4000, 3000), "image/webp"), { width: 4000, height: 3000 });
  assert.deepEqual(attach.dimensions(webpL(800, 600), "image/webp"), { width: 800, height: 600 });
  assert.deepEqual(attach.dimensions(webpLossy(1024, 768), "image/webp"), { width: 1024, height: 768 });
  assert.equal(attach.dimensions(Buffer.concat([png().subarray(0, 12), Buffer.alloc(40)]), "image/png"), null, "a PNG with no IHDR has none");
  assert.equal(attach.dimensions(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xd9]), Buffer.alloc(40)]), "image/jpeg"), null, "a JPEG with no frame header has none");
});

test("a picture is checked by its bytes: type, size, dimensions, and the name is only a label", () => {
  const ok = attach.inspect({ name: "shot.png", mime: "image/png", bytes: png(1568, 980, 2000) });
  assert.deepEqual(ok, { ok: true, mime: "image/png", ext: "png", width: 1568, height: 980, bytes: 2033, name: "shot.png" });
  // The bytes win over a wrong declared type and a wrong name.
  const renamed = attach.inspect({ name: "holiday.png", mime: "image/png", bytes: jpeg(100, 50) });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.mime, "image/jpeg");
  assert.equal(renamed.ext, "jpg");
  // A file dressed as a picture is refused whatever it is called.
  for (const [name, bytes] of Object.entries(notPictures)) {
    const refused = attach.inspect({ name: `${name}.png`, mime: "image/png", bytes });
    assert.equal(refused.ok, false, `${name} renamed .png`);
    assert.match(refused.error, /not a PNG, JPEG, WebP or GIF picture/);
  }
  // A declared type outside the four is refused even with picture bytes.
  for (const declared of ["image/svg+xml", "image/bmp", "application/pdf", "text/html", "image/tiff"]) {
    assert.match(attach.inspect({ name: "x.png", mime: declared, bytes: png() }).error, /PNG, JPEG, WebP or GIF/, declared);
  }
  assert.equal(attach.inspect({ name: "x", mime: "", bytes: png() }).ok, true, "no declared type is fine: the bytes decide");
  assert.equal(attach.inspect({ name: "x", mime: "IMAGE/PNG", bytes: png() }).ok, true, "a type is read without regard to case");
  assert.match(attach.inspect({ name: "x", mime: "image/png", bytes: Buffer.alloc(0) }).error, /empty/);
  assert.match(attach.inspect({ name: "x", mime: "image/png", bytes: png().subarray(0, 12) }).error, /complete picture/);
});

test("a picture is at most 5 MB and 25 megapixels", () => {
  assert.equal(attach.MAX_BYTES, 5 * MB);
  assert.equal(attach.inspect({ name: "a", mime: "image/png", bytes: png(10, 10, 5 * MB - 33) }).ok, true, "exactly 5 MB is accepted");
  const big = attach.inspect({ name: "a", mime: "image/png", bytes: png(10, 10, 5 * MB - 32) });
  assert.equal(big.ok, false);
  assert.equal(big.error, "That picture is 5.0 MB; the limit is 5 MB.");
  assert.equal(attach.inspect({ name: "a", mime: "image/png", bytes: png(5000, 5000) }).ok, true, "25 megapixels is the largest");
  const huge = attach.inspect({ name: "a", mime: "image/png", bytes: png(6000, 5000) });
  assert.equal(huge.ok, false);
  assert.match(huge.error, /6000 by 5000 pixels; pictures up to 25 megapixels/);
  // A tiny file that decodes into gigabytes is the one this protects the machine from.
  assert.equal(attach.inspect({ name: "a", mime: "image/png", bytes: png(60000, 60000, 500) }).ok, false);
  assert.equal(attach.inspect({ name: "a", mime: "image/gif", bytes: gif(20000, 20000) }).ok, false);
  assert.equal(attach.inspect({ name: "a", mime: "image/webp", bytes: webpX(16000, 16000) }).ok, false);
  assert.equal(attach.inspect({ name: "a", mime: "image/png", bytes: png(0, 0) }).ok, false, "a picture with no size is not one");
});

test("a name is only a label: no folders, no control characters, bounded, never empty", () => {
  assert.equal(attach.cleanName("C:\\Users\\me\\Desktop\\shot.png"), "shot.png");
  assert.equal(attach.cleanName("../../etc/passwd"), "passwd");
  assert.equal(attach.cleanName("  a\u0000b\nc\u007f.png "), "a b c .png");
  assert.equal(attach.cleanName("x".repeat(300)).length, 80);
  assert.equal(attach.cleanName(""), "picture.png");
  assert.equal(attach.cleanName(undefined, "jpg"), "picture.jpg");
  assert.equal(attach.cleanName(".."), "picture.png");
  assert.equal(attach.cleanName("/"), "picture.png");
});

test("what a renderer sends is decoded only after its size is known, in every form it may come in", () => {
  const bytes = png(2, 2, 30);
  const base64 = bytes.toString("base64");
  for (const [label, data] of [["base64", base64], ["a data URL", `data:image/png;base64,${base64}`], ["a Uint8Array", new Uint8Array(bytes)], ["an ArrayBuffer", new Uint8Array(bytes).buffer], ["a Buffer", bytes], ["wrapped base64", base64.replace(/(.{20})/g, "$1\n")]]) {
    const decoded = attach.decode(data);
    assert.equal(decoded.ok, true, label);
    assert.deepEqual([...decoded.bytes], [...bytes], label);
  }
  // Too big is refused before any buffer is made.
  const started = process.hrtime.bigint();
  const refused = attach.decode("A".repeat(20 * MB));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /over the limit of 5 MB/);
  assert.ok(Number(process.hrtime.bigint() - started) < 50_000_000, "nothing was decoded");
  assert.equal(attach.decode(new Uint8Array(5 * MB + 1)).ok, false);
  for (const bad of ["not base64 !!!", "data:image/png;base64,@@@@", 42, null, undefined, {}, [1, 2, 3]]) assert.equal(attach.decode(bad).ok, false, JSON.stringify(bad));
});

test("a message names at most four pictures, by ids Studio made, never by path", () => {
  const id = (n) => `img_${String(n).padStart(24, "0")}`;
  assert.deepEqual(attach.checkIds(undefined), { ok: true, ids: [] });
  assert.deepEqual(attach.checkIds(null), { ok: true, ids: [] });
  assert.deepEqual(attach.checkIds([]), { ok: true, ids: [] });
  assert.deepEqual(attach.checkIds([id(1), { id: id(2) }, id(1)]), { ok: true, ids: [id(1), id(2)] }, "objects with an id work, repeats collapse");
  assert.equal(attach.checkIds([1, 2, 3, 4].map(id)).ok, true);
  assert.match(attach.checkIds([1, 2, 3, 4, 5].map(id)).error, /up to 4 pictures/);
  for (const bad of ["../../x.png", "C:\\x.png", "/etc/passwd", "img_", `img_${"a".repeat(23)}`, `img_${"a".repeat(25)}`, `img_${"A".repeat(24)}`, `IMG_${"a".repeat(24)}`, `img_${"g".repeat(24)}`, `${id(1)}.png`, `${id(1)}/../x`, `${id(1)}\n`, 42, null, {}]) {
    assert.equal(attach.checkIds([bad]).ok, false, JSON.stringify(bad));
  }
  assert.equal(attach.checkIds("img_a").ok, false, "not a list");
  assert.equal(attach.isId(id(7)), true);
  assert.equal(attach.isId(`${id(7)}.json`), false);
});

const shots = [{ mime: "image/png", base64: "QUJD", name: "a.png" }, { mime: "image/jpeg", base64: "REVG", name: "b.jpg" }];
const body = () => ({ model: "m", max_tokens: 100, messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "first" }, { role: "assistant", content: "ok" }, { role: "user", content: "What is wrong here?" }] });

test("an OpenAI-compatible request gets image_url parts with data URLs in its last user message, and nothing else changes", () => {
  const original = body();
  const sent = attach.attachBody(original, shots, "openai");
  assert.deepEqual(sent.messages.at(-1).content, [
    { type: "text", text: "What is wrong here?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,REVG" } },
  ]);
  assert.deepEqual(sent.messages.slice(0, 3), original.messages.slice(0, 3), "system, earlier turns and the assistant reply are as they were");
  assert.equal(sent.model, "m");
  assert.equal(sent.max_tokens, 100);
  assert.deepEqual(original, body(), "the request it was given is not changed");
  assert.equal(typeof original.messages.at(-1).content, "string");
});

test("an Anthropic request gets image blocks with a base64 source, pictures first", () => {
  const sent = attach.attachBody(body(), shots, "anthropic");
  assert.deepEqual(sent.messages.at(-1).content, [
    { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "REVG" } },
    { type: "text", text: "What is wrong here?" },
  ]);
  assert.equal(attach.formatFor("https://api.anthropic.com/v1/messages"), "anthropic");
  assert.equal(attach.formatFor("https://opencode.ai/zen/go/v1/chat/completions"), "openai");
  assert.equal(attach.formatFor("https://opencode.ai/zen/v1/responses"), "openai", "the Responses wire is reached through responsesParts");
  assert.equal(attach.formatFor(undefined), "openai");
});

test("the Responses API takes input_text and input_image parts", () => {
  const sent = attach.attachBody(body(), shots, "openai");
  assert.deepEqual(attach.responsesParts(sent.messages.at(-1).content), [
    { type: "input_text", text: "What is wrong here?" },
    { type: "input_image", image_url: "data:image/png;base64,QUJD" },
    { type: "input_image", image_url: "data:image/jpeg;base64,REVG" },
  ]);
  assert.equal(attach.responsesParts("plain text"), "plain text", "a text message is left alone");
});

test("no pictures, or a request with no user message, is the request itself", () => {
  const plain = body();
  assert.equal(attach.attachBody(plain, [], "openai"), plain);
  assert.equal(attach.attachBody(plain, undefined, "openai"), plain);
  const noUser = { messages: [{ role: "system", content: "s" }] };
  assert.equal(attach.attachBody(noUser, shots, "openai"), noUser);
  assert.equal(attach.attachBody({}, shots, "openai").messages, undefined);
});

test("a CLI is given one plain line naming the file and where it is, and a reply says once that a model cannot see", () => {
  assert.equal(attach.attachedLine({ name: "shot.png", path: "C:\\data\\attachments\\img_x.png" }), "The owner attached shot.png at C:\\data\\attachments\\img_x.png");
  assert.equal(attach.attachedLines([{ name: "a.png", path: "/a" }, { name: "b.png", path: "/b" }]), "The owner attached a.png at /a\nThe owner attached b.png at /b");
  assert.equal(attach.unseenNote({ model: "glm-5.3", count: 1 }), "glm-5.3 can't see images, so I answered without looking at the picture you attached. It is saved with your message.");
  assert.equal(attach.unseenNote({ count: 3 }), "This model can't see images, so I answered without looking at the 3 pictures you attached. They are saved with your message.");
  assert.match(attach.unseenNote({ noModel: true, count: 1 }), /^No AI that can look at pictures answered, so I read your message without the picture\./);
});

test("the catalog decides which models can see, and a model it does not list can not", () => {
  const index = attach.visionIndex({
    models: [{ id: "kimi-k3", capabilities: { modalities: { input: ["text", "image"] } } }, { id: "glm-5.3", capabilities: { modalities: { input: ["text"] } } }, { id: "no-modalities", capabilities: { modalities: null } }],
    providerModels: { zen: [{ id: "gpt-6-luna", capabilities: { modalities: { input: ["text", "image", "pdf"] } } }], zai: [{ id: "glm-5.3-flash", capabilities: { modalities: { input: ["text", "image"] } } }, { id: "glm-5.3", capabilities: { modalities: { input: ["text"] } } }], claude: [{ id: "claude-opus-5", capabilities: { modalities: { input: ["text", "image"] } } }] },
  });
  for (const [provider, model, sees] of [
    ["opencode", "kimi-k3", true], ["opencode", "opencode-go/kimi-k3", true], ["opencode", "glm-5.3", false], ["opencode", "no-modalities", false], ["opencode", "never-heard-of-it", false],
    ["zen", "gpt-6-luna", true], ["zen", "GPT-6-LUNA", true], ["zen", "kimi-k3", false, "a table is per provider"],
    ["zai", "glm-5.3-flash", true], ["zai", "glm-5.3", false], ["claude", "claude-opus-5", true],
    ["openrouter", "openai/gpt-6-luna", true], ["openrouter", "moonshotai/kimi-k3", true], ["openrouter", "some/other-model", false],
    ["custom", "kimi-k3", true], ["lmstudio", "my-local-vision-model", false], ["lmstudio", "", false],
    ["grok", "grok-4.6", false], ["codex", "gpt-6-sol", false], ["antigravity", "gemini", false], ["claude-cli", "claude-opus-5", false], [undefined, "kimi-k3", true],
  ]) assert.equal(attach.sees(index, provider, model), sees, `${provider} ${model}`);
  assert.equal(attach.sees(null, "zen", "gpt-6-luna"), false, "no catalog, no sight");
  assert.equal(attach.sees(attach.visionIndex(null), "zen", "gpt-6-luna"), false);
  assert.equal(attach.sees(attach.visionIndex({ models: "nope", providerModels: 7 }), "opencode", "kimi-k3"), false, "a broken catalog reads as unknown");
});

test("against the real catalog, vision is true exactly where it says a model takes image input", () => {
  const index = attach.visionIndex(catalog);
  let checked = 0;
  for (const entry of catalog.models) {
    assert.equal(attach.sees(index, "opencode", entry.id), Boolean(entry.capabilities?.modalities?.input?.includes("image")), `opencode ${entry.id}`);
    checked += 1;
  }
  for (const [provider, list] of Object.entries(catalog.providerModels)) {
    for (const entry of list) {
      assert.equal(attach.sees(index, provider, entry.id), Boolean(entry.capabilities?.modalities?.input?.includes("image")), `${provider} ${entry.id}`);
      checked += 1;
    }
  }
  assert.ok(checked > 60, "the whole catalog was compared");
  // The models the app routes to by default.
  assert.equal(attach.sees(index, "zen", "gpt-6-sol"), true);
  assert.equal(attach.sees(index, "opencode", "deepseek-v4.1-flash"), true);
  assert.equal(attach.sees(index, "zai", "glm-5.3-flash"), true);
  assert.equal(attach.sees(index, "zai", "glm-5.3"), false);
  assert.equal(attach.sees(index, "opencode", "glm-5.3"), false);
});

test("agentProfiles.capabilities reports vision, false until the host hands it the catalog and for anything the catalog does not list", () => {
  try {
    profiles.useCatalog(null);
    assert.equal(profiles.capabilities("zen", "gpt-6-sol").vision, false, "unknown is false");
    assert.equal(profiles.capabilities("zen", "gpt-6-sol").fast, true, "the other capabilities are as they were");
    profiles.useCatalog(catalog);
    assert.equal(profiles.capabilities("zen", "gpt-6-sol").vision, true);
    assert.equal(profiles.capabilities("zai", "glm-5.3").vision, false);
    assert.equal(profiles.capabilities("zai", "glm-5.3-flash").vision, true);
    assert.equal(profiles.capabilities("openrouter", "openai/gpt-5.4-mini").vision, true, "the same model through another route");
    assert.equal(profiles.capabilities("grok", "grok-4.6").vision, false, "a coding CLI is never sent a picture");
    assert.equal(profiles.capabilities("custom", "").vision, false);
    assert.equal(profiles.capabilities().vision, false);
    assert.deepEqual(Object.keys(profiles.capabilities("zen", "gpt-6-sol")).sort(), ["efforts", "fast", "note", "vision"]);
    // Effort validation still reads the same table.
    assert.equal(profiles.validate({ agentEfforts: { heavy: "xhigh" }, aiProvider: "zen", aiModels: { heavy: "gpt-6-sol" } }), null);
  } finally { profiles.useCatalog(null); }
});
