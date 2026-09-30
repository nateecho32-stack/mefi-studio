// Reading a saved picture back for Build's thread (assistant:image-read, renderer/sessions.js): a message and a
// task's brief name pictures by opaque id, and the thread shows them. The store (scripts/image-store.cjs) is the only
// thing that turns an id into a file: read() answers one picture as a data URL, only for an id it saved, only when its
// record and its bytes still agree, and never a path. The host block (main.cjs "Picture attachments") adds the
// project gate and MEFI_STUDIO_NO_IMAGE_ATTACH=1, which refuses it like every other use of a picture.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { png, jpeg, gif, notPictures } from "./fixtures/image-bytes.mjs";

const require = createRequire(import.meta.url);
const { createImageStore } = require("../scripts/image-store.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));
const send = (bytes, name = "shot.png", mime = "image/png") => ({ name, mime, data: bytes.toString("base64") });

async function studio() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-image-read-"));
  const folder = path.join(root, "data", "projects", "project_a", "attachments");
  let counter = 0;
  const store = createImageStore({ dir: () => folder, randomId: () => (counter += 1).toString(16).padStart(24, "0") });
  return { root, folder, store, done: async () => { assert.ok(path.basename(root).startsWith("mefi-image-read-")); await rm(root, { recursive: true, force: true }); } };
}

test("read answers a saved picture as a data URL with its name, type, size and dimensions, and never a path", async () => {
  const s = await studio();
  try {
    const bytes = png(640, 480, 300);
    const saved = await s.store.save(send(bytes, "empty state.png"));
    const read = plain(await s.store.read(saved.id));
    assert.equal(read.ok, true);
    assert.deepEqual([read.id, read.name, read.mime, read.bytes, read.width, read.height], [saved.id, "empty state.png", "image/png", bytes.length, 640, 480]);
    assert.equal(read.dataUrl, `data:image/png;base64,${bytes.toString("base64")}`, "the bytes that were sent come back");
    assert.equal(JSON.stringify(read).includes(s.root), false, "no path of this PC is in the answer");
    const jpg = await s.store.save(send(jpeg(30, 20, 40), "holiday.jpg", "image/jpeg"));
    assert.match((await s.store.read(jpg.id)).dataUrl, /^data:image\/jpeg;base64,/);
    const moving = await s.store.save(send(gif(8, 8, 10), "spin.gif", "image/gif"));
    assert.match((await s.store.read(moving.id)).dataUrl, /^data:image\/gif;base64,/);
  } finally { await s.done(); }
});

test("read refuses an id the store did not save: not an id, another kind of file, a path, a picture that is gone", async () => {
  const s = await studio();
  try {
    await s.store.save(send(png(10, 10)));
    for (const bad of ["", "img_short", "../../etc/passwd", "img_" + "g".repeat(24), "IMG_" + "a".repeat(24), " img_" + "a".repeat(24), null, undefined, 12, {}, ["img_" + "a".repeat(24)], "img_" + "a".repeat(24) + ".png"]) {
      const answer = plain(await s.store.read(bad));
      assert.equal(answer.ok, false, `${JSON.stringify(bad)} is refused`);
      assert.equal(answer.dataUrl, undefined);
    }
    const gone = plain(await s.store.read("img_" + "a".repeat(24)));
    assert.equal(gone.ok, false);
    assert.match(gone.error, /no longer saved|not a picture/i, "a picture that was never saved, or has been cleared, says so in words");
  } finally { await s.done(); }
});

test("read refuses a record that lies and bytes that no longer say what the record says", async () => {
  const s = await studio();
  try {
    const saved = await s.store.save(send(png(10, 10, 50)));
    const file = path.join(s.folder, `${saved.id}.png`);
    // The bytes were swapped for something that is not a picture: refused, and never sent.
    await writeFile(file, Buffer.concat([notPictures.text, Buffer.alloc(Math.max(0, saved.bytes - notPictures.text.length), 0)]).subarray(0, saved.bytes));
    const swapped = plain(await s.store.read(saved.id));
    assert.equal(swapped.ok, false);
    assert.equal(swapped.dataUrl, undefined, "nothing of the file leaves");
    // A record that names a different kind of file than the bytes are.
    const other = await s.store.save(send(jpeg(10, 10, 50), "a.jpg", "image/jpeg"));
    const record = path.join(s.folder, `${other.id}.json`);
    await writeFile(record, JSON.stringify({ id: other.id, name: "a.jpg", mime: "image/png", ext: "png", bytes: other.bytes, width: 10, height: 10, at: 1 }));
    assert.equal((await s.store.read(other.id)).ok, false, "a record whose type does not match its file");
    // A link in place of the file is not followed out of the folder.
    if (process.platform !== "win32") {
      const linked = await s.store.save(send(png(12, 12, 50), "b.png"));
      const target = path.join(s.root, "secret.png");
      await writeFile(target, png(12, 12, 50));
      await rm(path.join(s.folder, `${linked.id}.png`));
      await symlink(target, path.join(s.folder, `${linked.id}.png`));
      assert.equal((await s.store.read(linked.id)).ok, false, "a link to a file elsewhere is refused");
    }
  } finally { await s.done(); }
});

// ---- the host block ---------------------------------------------------------------------------------------------------

const source = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));

async function host({ env = {}, open = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-image-read-host-"));
  const context = vm.createContext({
    require: mainRequire, path, process: { env: { ...env }, pid: process.pid }, Buffer, console, Promise, Date,
    nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, TASKS_PATH: "eyes-tasks.json",
    projectDataPath: () => path.join(root, "projects", "p1", "eyes-tasks.json"),
    projects: { open: () => open, current: () => ({ id: "p1" }) }, assistantState: { messages: [] }, getEyes: async () => ({ readJson: async () => [] }),
  });
  vm.runInContext(section("// ---- Picture attachments", "// ---- end of picture attachments"), context);
  return { context, root, done: async () => { assert.ok(path.basename(root).startsWith("mefi-image-read-host-")); await rm(root, { recursive: true, force: true }); } };
}

test("the host reads a picture the project holds, and only while a project is open", async () => {
  const h = await host();
  try {
    const bytes = png(40, 30, 100);
    const saved = plain(await h.context.saveMessagePicture(send(bytes, "screen.png")));
    const read = plain(await h.context.readMessagePicture({ id: saved.id }));
    assert.equal(read.ok, true);
    assert.equal(read.dataUrl, `data:image/png;base64,${bytes.toString("base64")}`);
    assert.equal((await h.context.readMessagePicture({ id: "../x" })).ok, false);
    assert.equal((await h.context.readMessagePicture({})).ok, false);
    assert.equal((await h.context.readMessagePicture(undefined)).ok, false, "a call with no payload is refused, not thrown");
    h.context.projects.open = () => false;
    const closed = plain(await h.context.readMessagePicture({ id: saved.id }));
    assert.deepEqual([closed.ok, /Open a project folder first/.test(closed.error)], [false, true]);
  } finally { await h.done(); }
});

test("MEFI_STUDIO_NO_IMAGE_ATTACH=1 refuses the read like every other use of a picture", async () => {
  const h = await host();
  try {
    const saved = plain(await h.context.saveMessagePicture(send(png(8, 8), "a.png")));
    assert.equal((await h.context.readMessagePicture({ id: saved.id })).ok, true, "on by default");
    h.context.process.env.MEFI_STUDIO_NO_IMAGE_ATTACH = "1";
    const off = plain(await h.context.readMessagePicture({ id: saved.id }));
    assert.deepEqual(off, { ok: false, off: true, error: "Picture attachments are switched off on this PC." });
    h.context.process.env.MEFI_STUDIO_NO_IMAGE_ATTACH = "0";
    assert.equal((await h.context.readMessagePicture({ id: saved.id })).ok, true, "only 1 turns it off");
  } finally { await h.done(); }
});

test("the channel is wired: main handles assistant:image-read, the bridge names it, and it is held to the open project", async () => {
  assert.match(source, /ipcMain\.handle\("assistant:image-read", \(_event, payload\) => readMessagePicture\(payload \?\? \{\}\)\);/);
  const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /assistantImageRead: \(payload\) => ipcRenderer\.invoke\("assistant:image-read", \{ id: typeof payload\?\.id === "string" \? payload\.id\.slice\(0, 80\) : "" \}\),/);
  // Not one of the channels that answer before a project is open: they are the ones listed in APP_WIDE_PREFIXES/CHANNELS.
  const wide = source.slice(source.indexOf("const APP_WIDE_PREFIXES"), source.indexOf("ipcMain.handle = handleProjectIpc;"));
  assert.doesNotMatch(wide, /assistant:/, "so the project gate applies to it");
});
