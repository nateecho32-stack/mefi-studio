// Where a message's pictures live (scripts/image-store.cjs), against real
// temporary folders: what is written and where, atomically and nowhere else;
// what a message may name; a record that lies, a link that leads elsewhere; and
// the cleanup that keeps what a message still names and no more.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { png, jpeg, gif, webpL, notPictures } from "./fixtures/image-bytes.mjs";

const require = createRequire(import.meta.url);
const { createImageStore, THUMB_MAX_CHARS, MAX_STORED, ORPHAN_MS } = require("../scripts/image-store.cjs");
const DAY = 86400000;

async function studio(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-image-store-"));
  const folder = path.join(root, "data", "projects", "project_a", "attachments");
  let clock = 1_800_000_000_000;
  let counter = 0;
  let where = folder;
  const store = createImageStore({ dir: () => where, now: () => clock, randomId: () => (counter += 1).toString(16).padStart(24, "0"), ...options });
  return {
    root, folder, store, advance: (ms) => { clock += ms; }, now: () => clock, move: (next) => { where = next; },
    files: async () => (await readdir(folder).catch(() => [])).sort(),
    everything: async () => { const found = []; const walk = async (dir) => { for (const entry of await readdir(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) await walk(full); else found.push(path.relative(root, full).split(path.sep).join("/")); } }; await walk(root); return found.sort(); },
    done: async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("mefi-image-store-")); await rm(root, { recursive: true, force: true }); },
  };
}
const send = (bytes, name = "shot.png", mime = "image/png") => ({ name, mime, data: bytes.toString("base64") });

test("a saved picture is two files in the project's attachments folder, written whole, and nothing is written anywhere else", async () => {
  const s = await studio();
  try {
    const saved = await s.store.save(send(png(640, 480, 300)));
    assert.equal(saved.ok, true);
    assert.equal(saved.id, `img_${"1".padStart(24, "0")}`);
    assert.deepEqual([saved.name, saved.mime, saved.bytes, saved.width, saved.height], ["shot.png", "image/png", 333, 640, 480]);
    assert.deepEqual(await s.files(), [`${saved.id}.json`, `${saved.id}.png`]);
    assert.deepEqual(await s.everything(), [`data/projects/project_a/attachments/${saved.id}.json`, `data/projects/project_a/attachments/${saved.id}.png`], "under the project's data folder and nowhere else");
    assert.deepEqual([...await readFile(path.join(s.folder, `${saved.id}.png`))], [...png(640, 480, 300)], "the bytes are the bytes sent");
    const record = JSON.parse(await readFile(path.join(s.folder, `${saved.id}.json`), "utf8"));
    assert.deepEqual(record, { id: saved.id, name: "shot.png", mime: "image/png", ext: "png", bytes: 333, width: 640, height: 480, at: s.now() });
    assert.equal((await readdir(s.folder)).some((name) => name.includes(".tmp-")), false, "no temporary file is left");
    if (process.platform !== "win32") assert.equal((await stat(path.join(s.folder, `${saved.id}.png`))).mode & 0o077, 0, "readable by the owner only");
    // The type comes from the bytes: a JPEG sent as "shot.png" is stored as a JPEG.
    const second = await s.store.save(send(jpeg(30, 20), "holiday.png", "image/png"));
    assert.equal(second.mime, "image/jpeg");
    assert.ok((await s.files()).includes(`${second.id}.jpg`));
  } finally { await s.done(); }
});

test("a refused picture writes nothing at all", async () => {
  const s = await studio();
  try {
    const refusals = [
      send(notPictures.text), send(notPictures.svg, "logo.svg", "image/svg+xml"), send(notPictures.pdf, "doc.png"), send(notPictures.exe, "run.png", "image/png"),
      { name: "big.png", mime: "image/png", data: png(10, 10, 5 * 1024 * 1024).toString("base64") },
      send(png(9000, 9000)), send(Buffer.alloc(0)), { name: "x", mime: "image/png", data: 12345 }, { name: "x", mime: "image/png", data: "%%%not base64%%%" }, {},
    ];
    for (const attempt of refusals) {
      const result = await s.store.save(attempt);
      assert.equal(result.ok, false, JSON.stringify(attempt).slice(0, 60));
      assert.equal(typeof result.error, "string");
    }
    assert.deepEqual(await s.everything(), [], "not even the folder");
    assert.equal((await s.store.save(undefined)).ok, false);
  } finally { await s.done(); }
});

test("the preview is bounded: the host's when it fits, a tiny original when it does not, and none for a large picture", async () => {
  const good = `data:image/png;base64,${"A".repeat(200)}`;
  const previews = [good, `data:image/png;base64,${"A".repeat(THUMB_MAX_CHARS)}`, "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", 42, null];
  for (const [index, made] of previews.entries()) {
    const s = await studio({ thumbnail: async () => made });
    try {
      const small = await s.store.save(send(png(4, 4)));
      const large = await s.store.save(send(png(400, 400, 60000)));
      if (index === 0) { assert.equal(small.thumb, good); assert.equal(large.thumb, good); continue; }
      assert.equal(small.thumb, `data:image/png;base64,${png(4, 4).toString("base64")}`, `a tiny original is its own preview (${index})`);
      assert.equal(large.thumb, null, `an unusable preview never becomes one (${index})`);
    } finally { await s.done(); }
  }
  const failing = await studio({ thumbnail: async () => { throw new Error("no decoder for this"); } });
  try {
    const result = await failing.store.save(send(png(400, 400, 60000)));
    assert.equal(result.ok, true, "a preview that throws never fails the save");
    assert.equal(result.thumb, null);
    assert.ok(JSON.stringify(result).length < 1000);
  } finally { await failing.done(); }
  const bare = await studio();
  try { assert.equal((await bare.store.save(send(gif(4, 4)))).thumb.startsWith("data:image/gif;base64,"), true, "no thumbnail collaborator at all"); } finally { await bare.done(); }
});

test("a message can name only pictures that are really saved, and gets their names and where they are", async () => {
  const s = await studio();
  try {
    const a = await s.store.save(send(png(8, 8), "one.png"));
    const b = await s.store.save(send(webpL(8, 8), "two.webp", "image/webp"));
    const found = await s.store.resolve([a.id, { id: b.id }]);
    assert.equal(found.ok, true);
    assert.deepEqual(found.images.map(({ id, name, mime, bytes }) => [id, name, mime, bytes]), [[a.id, "one.png", "image/png", png(8, 8).length], [b.id, "two.webp", "image/webp", webpL(8, 8).length]]);
    assert.equal(found.images[0].path, path.join(s.folder, `${a.id}.png`));
    assert.deepEqual((await s.store.resolve(undefined)), { ok: true, images: [] });
    assert.deepEqual((await s.store.resolve([])), { ok: true, images: [] });
    // Never a path, never an id Studio did not make, never more than four.
    for (const bad of [["../../etc/passwd"], [path.join(s.folder, `${a.id}.png`)], ["img_" + "f".repeat(24)], [a.id, "nope"], [1, 2, 3, 4, 5].map((n) => `img_${String(n).padStart(24, "0")}`)]) {
      const result = await s.store.resolve(bad);
      assert.equal(result.ok, false, JSON.stringify(bad));
      assert.equal(typeof result.error, "string");
    }
    assert.match((await s.store.resolve(["img_" + "f".repeat(24)])).error, /no longer saved/);
  } finally { await s.done(); }
});

test("a record that lies, bytes swapped after the fact and a link that leads elsewhere are all refused", async () => {
  const s = await studio();
  try {
    const one = await s.store.save(send(png(8, 8), "real.png"));
    // Bytes replaced by something else of another size.
    await writeFile(path.join(s.folder, `${one.id}.png`), notPictures.text);
    assert.match((await s.store.resolve([one.id])).error, /"real.png" is no longer saved/);
    // The same size but no longer a picture: resolve passes the size, load refuses the bytes.
    const two = await s.store.save(send(png(8, 8), "two.png"));
    await writeFile(path.join(s.folder, `${two.id}.png`), Buffer.alloc(png(8, 8).length, 0x41));
    const entry = (await s.store.resolve([two.id])).images[0];
    await assert.rejects(() => s.store.load(entry), /is not the picture that was saved/);
    // A record for another id, or for a type it does not name, is not a record.
    const three = await s.store.save(send(png(8, 8), "three.png"));
    const record = JSON.parse(await readFile(path.join(s.folder, `${three.id}.json`), "utf8"));
    for (const forged of [{ ...record, id: `img_${"e".repeat(24)}` }, { ...record, ext: "gif" }, { ...record, mime: "image/svg+xml", ext: "svg" }, "not json {"]) {
      await writeFile(path.join(s.folder, `${three.id}.json`), typeof forged === "string" ? forged : JSON.stringify(forged));
      assert.equal((await s.store.resolve([three.id])).ok, false);
    }
    if (process.platform !== "win32") {
      const four = await s.store.save(send(png(8, 8), "four.png"));
      const secret = path.join(s.root, "secret.png");
      await writeFile(secret, png(8, 8));
      await rm(path.join(s.folder, `${four.id}.png`));
      await symlink(secret, path.join(s.folder, `${four.id}.png`));
      assert.equal((await s.store.resolve([four.id])).ok, false, "a link to a file elsewhere is not the picture");
    }
  } finally { await s.done(); }
});

test("load gives a request the picture's contents, and a picture is taken away with its record", async () => {
  const s = await studio();
  try {
    const saved = await s.store.save(send(gif(6, 6, 100), "anim.gif", "image/gif"));
    const entry = (await s.store.resolve([saved.id])).images[0];
    const loaded = await s.store.load(entry);
    assert.equal(loaded.base64, gif(6, 6, 100).toString("base64"));
    assert.equal(loaded.mime, "image/gif");
    assert.deepEqual(await s.store.remove(saved.id), { ok: true });
    assert.deepEqual(await s.files(), []);
    assert.deepEqual(await s.store.remove(saved.id), { ok: true }, "taking away what is gone is fine");
    assert.equal((await s.store.remove("../../etc/passwd")).ok, false);
    assert.equal((await s.store.resolve([saved.id])).ok, false);
    // A record nobody can read does not hide its bytes.
    const other = await s.store.save(send(jpeg(6, 6), "b.jpg", "image/jpeg"));
    await writeFile(path.join(s.folder, `${other.id}.json`), "garbage");
    assert.deepEqual(await s.store.remove(other.id), { ok: true });
    assert.deepEqual(await s.files(), []);
  } finally { await s.done(); }
});

test("each project has its own folder, and a picture from another project is not found", async () => {
  const s = await studio();
  try {
    const here = await s.store.save(send(png(8, 8)));
    s.move(path.join(s.root, "data", "projects", "project_b", "attachments"));
    assert.equal((await s.store.resolve([here.id])).ok, false, "not in project b");
    const there = await s.store.save(send(png(9, 9)));
    assert.equal((await s.store.resolve([there.id])).ok, true);
    assert.deepEqual((await s.everything()).map((file) => file.split("/")[2]).sort(), ["project_a", "project_a", "project_b", "project_b"]);
  } finally { await s.done(); }
});

const aged = async (s, name, ageMs) => { const when = new Date(s.now() - ageMs); await utimes(path.join(s.folder, name), when, when); };

test("cleanup removes a picture nobody sent after a day, keeps every picture a message or task still names, and clears leftovers", async () => {
  const s = await studio();
  try {
    const sent = await s.store.save(send(png(8, 8), "sent.png"));
    const orphan = await s.store.save(send(png(9, 9), "orphan.png"));
    s.advance(2 * DAY);
    const fresh = await s.store.save(send(png(10, 10), "fresh.png"));
    // Leftovers of saves that never finished: bytes with no record, a temporary file, an unreadable record.
    await writeFile(path.join(s.folder, `img_${"a".repeat(24)}.png`), png(3, 3));
    await writeFile(path.join(s.folder, `img_${"b".repeat(24)}.png.tmp-1-abc`), "half");
    await writeFile(path.join(s.folder, `img_${"c".repeat(24)}.json`), "not json");
    await writeFile(path.join(s.folder, "notes.txt"), "not ours");
    for (const name of [`img_${"a".repeat(24)}.png`, `img_${"b".repeat(24)}.png.tmp-1-abc`, `img_${"c".repeat(24)}.json`]) await aged(s, name, 2 * DAY);
    const result = await s.store.prune({ keep: new Set([sent.id]) });
    assert.equal(result.ok, true);
    const left = await s.files();
    assert.ok(left.includes(`${sent.id}.png`) && left.includes(`${sent.id}.json`), "a picture a message still names stays, however old");
    assert.ok(left.includes(`${fresh.id}.png`), "a picture from the last day stays, sent or not");
    assert.ok(!left.includes(`${orphan.id}.png`) && !left.includes(`${orphan.id}.json`), "a day-old picture nobody named is gone with its record");
    assert.deepEqual(left.filter((name) => name.startsWith(`img_${"a".repeat(24)}`) || name.includes("tmp") || name.startsWith(`img_${"c".repeat(24)}`)), [], "leftovers are gone");
    assert.ok(left.includes("notes.txt"), "a file that is not ours is never touched");
    assert.equal(result.kept, 2);
    // Just under a day is still a chance to send it.
    const almost = await studio();
    try {
      const saved = await almost.store.save(send(png(8, 8)));
      almost.advance(ORPHAN_MS - 1000);
      await almost.store.prune({ keep: new Set() });
      assert.equal((await almost.store.resolve([saved.id])).ok, true);
      almost.advance(2000);
      await almost.store.prune({ keep: new Set() });
      assert.equal((await almost.store.resolve([saved.id])).ok, false);
    } finally { await almost.done(); }
  } finally { await s.done(); }
});

test("the folder is held to a bounded count, oldest first, and never at the cost of a picture a message names", async () => {
  const s = await studio();
  try {
    await mkdir(s.folder, { recursive: true });
    const ids = [];
    for (let n = 0; n < MAX_STORED + 5; n += 1) {
      const id = `img_${n.toString(16).padStart(24, "0")}`;
      ids.push(id);
      const meta = { id, name: `p${n}.png`, mime: "image/png", ext: "png", bytes: png(2, 2).length, width: 2, height: 2, at: s.now() - (MAX_STORED + 5 - n) * 1000 };
      await writeFile(path.join(s.folder, `${id}.png`), png(2, 2));
      await writeFile(path.join(s.folder, `${id}.json`), JSON.stringify(meta));
    }
    const result = await s.store.prune({ keep: new Set([ids[0], ids[1]]) });
    assert.equal(result.removed, 5);
    const left = new Set((await s.files()).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)));
    assert.equal(left.size, MAX_STORED);
    assert.ok(left.has(ids[0]) && left.has(ids[1]), "the two named pictures survive though they are the oldest");
    assert.ok(!left.has(ids[2]) && !left.has(ids[6]) && left.has(ids[7]), "the oldest unnamed ones went first");
    // A full folder refuses a new picture and says why.
    for (let n = 0; n < 10; n += 1) { const id = `img_${(1000 + n).toString(16).padStart(24, "0")}`; await writeFile(path.join(s.folder, `${id}.json`), "{}"); }
    const full = await s.store.save(send(png(8, 8)));
    assert.equal(full.ok, false);
    assert.match(full.error, /Too many pictures are saved/);
  } finally { await s.done(); }
});

test("saving tidies the folder at most once an hour, and only when the host can say what is still named", async () => {
  let asked = 0;
  const s = await studio({ keep: async () => { asked += 1; return new Set(); } });
  try {
    const first = await s.store.save(send(png(8, 8)));
    assert.equal(asked, 1, "the first save tidies");
    s.advance(3 * DAY);
    await s.store.save(send(png(9, 9)));
    assert.equal(asked, 2, "an hour later it does again");
    assert.equal((await s.store.resolve([first.id])).ok, false, "and the day-old picture nobody named went");
    await s.store.save(send(png(10, 10)));
    assert.equal(asked, 2, "not on every save");
    const blind = await studio();
    try {
      const old = await blind.store.save(send(png(8, 8)));
      blind.advance(3 * DAY);
      await blind.store.save(send(png(9, 9)));
      assert.equal((await blind.store.resolve([old.id])).ok, true, "with no way to know what a message names, nothing is removed by saving");
    } finally { await blind.done(); }
  } finally { await s.done(); }
});
