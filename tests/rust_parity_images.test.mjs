// A message's pictures, JavaScript (scripts/image-store.cjs with the checks of
// image-attach.cjs) against Rust (crates/mefi-core images, docs/rust-migration.md
// stage 2): the same verdicts on the same bytes, and the same steps on two
// attachment folders give the same answers and leave the same files. Needs
// npm run host:core; skips without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { coreBinary } from "../scripts/rust-host.mjs";

const require = createRequire(import.meta.url);
const images = require("../scripts/image-attach.cjs");
const { createImageStore } = require("../scripts/image-store.cjs");
const binary = coreBinary();
const skip = existsSync(binary) ? false : `mefi-core is not built (${binary}); run npm run host:core`;
const CONST = (value) => ({ $mefi: "const", value });
const BYTES = (buffer) => ({ $mefi: "bytes", b64: Buffer.from(buffer).toString("base64") });

function rust(calls) {
  const result = spawnSync(binary, ["repo-batch"], { input: JSON.stringify(calls), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map((answer) => answer.ok ? answer.value : { thrown: answer.error });
}

// Pictures by their headers: enough bytes to be read, nothing a decoder needs.
const pad = (bytes, length) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(Math.max(0, length - bytes.length))]);
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n) => [n & 255, (n >>> 8) & 255];
const le24 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const png = (width, height, length = 64) => pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(width), ...be32(height)], length);
const gif = (width, height, version = 0x39) => pad([0x47, 0x49, 0x46, 0x38, version, 0x61, ...le16(width), ...le16(height)], 32);
const riff = (kind, rest) => pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, ...Buffer.from(kind), ...rest], 40);
const vp8 = (width, height) => riff("VP8 ", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le16(width), ...le16(height)]);
const vp8l = (width, height) => { const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14); return riff("VP8L", [0, 0, 0, 0, 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255]); };
const vp8x = (width, height) => riff("VP8X", [0, 0, 0, 0, 0, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
const jpeg = (width, height, { app = true, sof = 0xc0 } = {}) => pad([0xff, 0xd8, 0xff, ...(app ? [0xe0, 0, 16, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0] : []), 0xff, sof, 0, 17, 8, ...le16(0).slice(0, 0), (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 3], 80);

const SAMPLES = {
  png: png(640, 480), pngWide: png(6000, 6000), pngZero: png(0, 10), pngShort: png(10, 10, 20), pngNoIhdr: Buffer.from(png(10, 10)).fill(0, 12, 16),
  gif89: gif(32, 16), gif87: gif(5, 6, 0x37), gifBad: gif(1, 1, 0x36),
  vp8: vp8(300, 200), vp8l: vp8l(17, 9), vp8x: vp8x(4000, 3000), vp8Other: riff("ALPH", []),
  jpeg: jpeg(1024, 768), jpegNoApp: jpeg(12, 34, { app: false }), jpegSof2: jpeg(50, 60, { sof: 0xc2 }), jpegDht: jpeg(50, 60, { sof: 0xc4 }),
  empty: Buffer.alloc(0), short: Buffer.from([0x89, 0x50]), text: Buffer.from("not a picture at all, just words"),
};

test("picture checks: the same verdicts on the same bytes", { skip }, () => {
  const calls = [], expected = [];
  for (const [label, bytes] of Object.entries(SAMPLES)) {
    calls.push({ function: "images.attach.sniff", args: [BYTES(bytes)] });
    expected.push([`sniff ${label}`, images.sniff(bytes)]);
    for (const mime of ["image/png", "image/gif", "image/webp", "image/jpeg", "image/bmp"]) {
      calls.push({ function: "images.attach.dimensions", args: [BYTES(bytes), mime] });
      expected.push([`dimensions ${label} ${mime}`, images.dimensions(bytes, mime)]);
    }
    for (const [name, mime] of [["shot.png", "image/png"], ["C:\\Users\\me\\Pictures\\holiday photo.JPG", "IMAGE/JPEG "], [null, ""], ["../..", undefined], ["a/b/../x.gif", "image/svg+xml"], ["\u0007bell\ttab name " + "x".repeat(100), "image/webp"]]) {
      calls.push({ function: "images.attach.inspect", args: [{ name, mime: mime ?? null, bytes: BYTES(bytes) }] });
      expected.push([`inspect ${label} ${name}`, images.inspect({ name, mime: mime ?? null, bytes })]);
    }
  }
  const big = Buffer.alloc(5 * 1024 * 1024 + 1);
  png(10, 10).copy(big);
  calls.push({ function: "images.attach.inspect", args: [{ name: "big.png", mime: "image/png", bytes: BYTES(big) }] });
  expected.push(["inspect big", images.inspect({ name: "big.png", mime: "image/png", bytes: big })]);
  for (const name of ["", "   ", ".", "..", "a\\b\\c.png", "日本語の写真.png", "\u0000x", 42]) {
    calls.push({ function: "images.attach.cleanName", args: [name, "jpg"] });
    expected.push([`cleanName ${name}`, images.cleanName(name, "jpg")]);
  }
  const b64 = SAMPLES.png.toString("base64");
  for (const data of [b64, `data:image/png;base64,${b64}`, "data:no-comma", ` ${b64.slice(0, 20)}\n${b64.slice(20)} `, b64.replace(/=+$/, ""), "QUJD", "QUJDRA", "QUJDRA=", "QUJDR", "Q", "", "!!notbase64!!", "QU JD", "QUJD====", "x".repeat(7 * 1024 * 1024 + 100), 42, null, BYTES(SAMPLES.gif89)]) {
    calls.push({ function: "images.attach.decode", args: [data] });
    const decoded = images.decode(typeof data === "object" && data?.$mefi ? Buffer.from(data.b64, "base64") : data);
    expected.push([`decode ${String(typeof data === "string" ? data : JSON.stringify(data)).slice(0, 30)}`, decoded.ok ? { ok: true, base64: decoded.bytes.toString("base64") } : decoded]);
  }
  const id = (n) => `img_${String(n).repeat(24).slice(0, 24)}`;
  for (const value of [undefined, null, [], [id(1)], [id(1), id(1)], [{ id: id(2) }, id(3)], [id(1), id(2), id(3), id(4), id(5)], "img_x", [id(1), "../x"], [7]]) {
    calls.push({ function: "images.attach.checkIds", args: [value ?? null] });
    expected.push([`checkIds ${JSON.stringify(value)}`, images.checkIds(value ?? null)]);
  }
  const answers = rust(calls);
  expected.forEach(([label, value], index) => assert.deepEqual(answers[index], JSON.parse(JSON.stringify(value)), label));
});

test("the attachments folder: the same answers and the same files from both languages", { skip }, async (t) => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "mefi-parity-images-")));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const jsDir = path.join(root, "js", "attachments"), rsDir = path.join(root, "rs", "attachments");
  const thumbnail = "data:image/png;base64,iVBORw0KGgo=";
  const store = createImageStore({ dir: () => jsDir, thumbnail: async () => thumbnail });
  const collaborators = { dir: CONST(rsDir), thumbnail: CONST(thumbnail) };
  const plainOnes = { dir: CONST(rsDir) };
  // Ids differ between the two sides: each side's ids become <id0>, <id1>... in the order they appear.
  const masks = { js: new Map(), rs: new Map() };
  const mask = (value, side, base) => JSON.parse(JSON.stringify(value).replace(/img_[a-f0-9]{24}/g, (id) => {
    if (!masks[side].has(id)) masks[side].set(id, `<id${masks[side].size}>`);
    return masks[side].get(id);
  }).split(JSON.stringify(base).slice(1, -1)).join("<dir>"));
  const both = async (label, jsWork, rsCall) => {
    const jsAnswer = await jsWork();
    const [rsAnswer] = rust([rsCall]);
    assert.deepEqual(mask(rsAnswer, "rs", rsDir), mask(jsAnswer, "js", jsDir), label);
    return { js: jsAnswer, rs: rsAnswer };
  };
  const saved = [];
  for (const [label, request] of [
    ["png", { name: "screen shot.png", mime: "image/png", data: SAMPLES.png.toString("base64") }],
    ["jpeg as data URL", { name: "C:\\pics\\photo.jpg", mime: "image/jpeg", data: `data:image/jpeg;base64,${SAMPLES.jpeg.toString("base64")}` }],
    ["gif", { name: "", mime: "", data: SAMPLES.gif89.toString("base64") }],
    ["webp", { name: "w.webp", mime: "image/webp", data: SAMPLES.vp8x.toString("base64") }],
    ["refused: text", { name: "a.png", mime: "image/png", data: SAMPLES.text.toString("base64") }],
    ["refused: svg", { name: "a.svg", mime: "image/svg+xml", data: SAMPLES.png.toString("base64") }],
    ["refused: wide", { name: "huge.png", mime: "image/png", data: SAMPLES.pngWide.toString("base64") }],
  ]) {
    const answer = await both(`save ${label}`, () => store.save(request), { function: "images.save", args: [collaborators, request] });
    if (answer.js.ok) saved.push({ js: answer.js.id, rs: answer.rs.id, name: answer.js.name });
  }
  // A big picture with no preview maker gets no preview; a small one is its own.
  const large = png(100, 100, 20000);
  await both("save large without a preview maker", () => createImageStore({ dir: () => jsDir }).save({ name: "large.png", data: large.toString("base64") }), { function: "images.save", args: [plainOnes, { name: "large.png", data: large.toString("base64") }] });
  const ids = (side) => saved.map((entry) => entry[side]);
  await both("resolve all", () => store.resolve(ids("js").slice(0, 4)), { function: "images.resolve", args: [collaborators, ids("rs").slice(0, 4)] });
  await both("resolve too many", () => store.resolve([...ids("js"), "img_000000000000000000000000"]), { function: "images.resolve", args: [collaborators, [...ids("rs"), "img_000000000000000000000000"]] });
  await both("resolve unknown", () => store.resolve(["img_aaaaaaaaaaaaaaaaaaaaaaaa"]), { function: "images.resolve", args: [collaborators, ["img_aaaaaaaaaaaaaaaaaaaaaaaa"]] });
  await both("resolve nothing", () => store.resolve(undefined), { function: "images.resolve", args: [collaborators, null] });
  await both("read png", () => store.read(saved[0].js), { function: "images.read", args: [collaborators, saved[0].rs] });
  // A picture whose bytes no longer say what its record says, and one whose record says another size.
  const swap = (dir, id, ext) => writeFileSync(path.join(dir, `${id}.${ext}`), SAMPLES.gif89.subarray(0, readFileSync(path.join(dir, `${id}.${ext}`)).length));
  swap(jsDir, saved[1].js, "jpg"); swap(rsDir, saved[1].rs, "jpg");
  await both("read swapped bytes", () => store.read(saved[1].js), { function: "images.read", args: [collaborators, saved[1].rs] });
  writeFileSync(path.join(jsDir, `${saved[2].js}.gif`), "short"); writeFileSync(path.join(rsDir, `${saved[2].rs}.gif`), "short");
  await both("resolve resized", () => store.resolve([saved[2].js]), { function: "images.resolve", args: [collaborators, [saved[2].rs]] });
  await both("remove webp", () => store.remove(saved[3].js), { function: "images.remove", args: [collaborators, saved[3].rs] });
  await both("remove again", () => store.remove(saved[3].js), { function: "images.remove", args: [collaborators, saved[3].rs] });
  await both("remove not an id", () => store.remove("../x"), { function: "images.remove", args: [collaborators, "../x"] });
  // Prune: a day-old picture nobody names goes, a named one stays, leftovers and temporary files over a day old go.
  const age = (dir, id, ext) => {
    const meta = path.join(dir, `${id}.json`);
    const record = JSON.parse(readFileSync(meta, "utf8"));
    writeFileSync(meta, JSON.stringify({ ...record, at: Date.now() - 2 * 24 * 3600000 }));
  };
  age(jsDir, saved[0].js); age(rsDir, saved[0].rs);
  age(jsDir, saved[1].js); age(rsDir, saved[1].rs);
  const old = new Date(Date.now() - 3 * 24 * 3600000);
  for (const dir of [jsDir, rsDir]) {
    for (const name of ["img_bbbbbbbbbbbbbbbbbbbbbbbb.png", "x.png.tmp-1-abcd", "img_cccccccccccccccccccccccc.png"]) writeFileSync(path.join(dir, name), "left over");
    utimesSync(path.join(dir, "img_bbbbbbbbbbbbbbbbbbbbbbbb.png"), old, old);
    utimesSync(path.join(dir, "x.png.tmp-1-abcd"), old, old);
    writeFileSync(path.join(dir, "img_dddddddddddddddddddddddd.json"), "{broken");
    utimesSync(path.join(dir, "img_dddddddddddddddddddddddd.json"), old, old);
  }
  await both("prune keeping the first", () => store.prune({ keep: new Set([saved[0].js]) }), { function: "images.prune", args: [collaborators, { keep: [saved[0].rs] }] });
  const listing = (dir, side) => readdirSync(dir).map((name) => mask(name, side, dir)).sort();
  assert.deepEqual(listing(rsDir, "rs"), listing(jsDir, "js"), "the same files are left");
});
