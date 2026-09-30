import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createDom, Element } from "./fixtures/renderer-dom.mjs";

// The picture half of Home's message box (renderer/composer-pictures.js), loaded into a
// bare context with the shared fake DOM: the Attach button, paste, drop, the thumbnails,
// the limits the host also holds, the note about what a model will do with them, and the
// switch the host can throw. Real geometry, focus and the real file dialog are Electron's;
// tests/composer_render.test.mjs looks at the box in a real window.
const source = readFileSync(new URL("../renderer/composer-pictures.js", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise(setImmediate); };
const file = (name = "shot.png", type = "image/png", size = 2048) => ({ name, type, size, bytes: Buffer.from(`bytes of ${name}`) });
const MB = 1024 * 1024;

function box({ bridge = {}, scope = () => "project-a", blocked = () => false, mode = () => "chat", noProbe = false } = {}) {
  const dom = createDom();
  const input = new Element("textarea");
  dom.body.append(input);
  const calls = { image: [], remove: [], more: [], made: [], revoked: [], focus: 0 };
  input.focus = () => { calls.focus += 1; };
  class Reader { readAsDataURL(f) { setImmediate(() => { this.result = `data:${f.type};base64,${Buffer.from(f.bytes ?? "x").toString("base64")}`; this.onload?.(); }); } }
  let serial = 0;
  const window = {
    mefiStudio: {
      assistantImage: async (payload) => {
        if (payload.probe) return noProbe ? { ok: false } : { ok: true, probe: true };
        calls.image.push(payload);
        serial += 1;
        return { ok: true, id: `img_${String(serial).padStart(24, "0")}`, name: payload.name, mime: payload.mime, bytes: 100, thumb: "data:image/png;base64,iVBOR", vision: { sees: false, model: "glm-5.3" } };
      },
      assistantImageRemove: async (payload) => { calls.remove.push(payload); return { ok: true }; },
      ...bridge,
    },
    MefiFileInputs: { addFiles: (target, files) => calls.more.push([target, files.map((f) => f.name)]) },
  };
  const URL = { createObjectURL: (f) => { calls.made.push(f.name); return `blob:${f.name}`; }, revokeObjectURL: (url) => calls.revoked.push(url) };
  vm.runInNewContext(source, { window, document: dom.document, FileReader: Reader, URL, Array, JSON, Promise, String, Number, Math, Set, Map, WeakMap, Error });
  const pictures = window.MefiComposerPictures.bind(input, { scope, blocked, mode });
  const $ = (selector) => dom.body.querySelector(selector);
  const $$ = (selector) => dom.body.querySelectorAll(selector);
  const events = () => {
    const seen = { prevented: 0, stopped: 0, immediate: 0 };
    return { seen, event: (extra = {}) => ({ preventDefault() { seen.prevented += 1; }, stopPropagation() { seen.stopped += 1; }, stopImmediatePropagation() { seen.immediate += 1; }, ...extra }) };
  };
  const choose = async (...files) => { const chooser = $(".composer-attach input"); chooser.files = files; await chooser.trigger("change"); await settle(); };
  return { dom, input, window, pictures, calls, $, $$, events, choose, note: () => $(".composer-attach-note").textContent, names: () => $$(".composer-thumb-name").map((node) => node.textContent) };
}

test("the Attach picture button hands a chosen picture to the host and shows a thumbnail with its name and size, and take() names it for the message", async () => {
  const b = box();
  await settle();
  assert.equal(b.$(".composer-attach-button").textContent, "Attach picture");
  assert.match(b.$(".composer-attach-button").title, /PNG, JPEG, WebP or GIF, up to 5 MB, up to 4/);
  assert.equal(b.$(".composer-attach input").getAttribute("accept"), "image/png,image/jpeg,image/webp,image/gif");
  await b.choose(file("crash screen.png", "image/png", 3 * 1024));
  assert.equal(b.calls.image.length, 1);
  assert.equal(b.calls.image[0].name, "crash screen.png");
  assert.equal(b.calls.image[0].mime, "image/png");
  assert.equal(Buffer.from(b.calls.image[0].data, "base64").toString(), "bytes of crash screen.png", "the host is sent base64, not a data URL");
  assert.deepEqual(plain(b.names()), ["crash screen.png · 1 KB"], "the size shown is the one the host kept, rounded up to a whole KB");
  assert.equal(b.$(".composer-thumb img").getAttribute("src"), "data:image/png;base64,iVBOR", "the host's bounded preview is the thumbnail");
  assert.deepEqual(plain(b.pictures.take()), ["img_000000000000000000000001"]);
  assert.equal(b.pictures.count(), 1);
  assert.equal(b.$(".composer-attach-button").disabled, false);
});

test("what the note says follows what the chat model can do: sees, cannot see, and a task's brief", async () => {
  let vision = { sees: true, model: "kimi-k3" };
  const b = box({ bridge: { assistantImage: async (payload) => (payload.probe ? { ok: true } : { ok: true, id: "img_" + "a".repeat(24), name: payload.name, mime: payload.mime, bytes: 10, thumb: null, vision }) } });
  await b.choose(file());
  assert.match(b.note(), /^Sent to kimi-k3, which can read images\./);
  assert.match(b.note(), /not redacted the way text is/, "the picture is not scrubbed, and the box says so");
  b.pictures.clear();
  assert.equal(b.note(), "", "nothing attached, nothing said");
  vision = { sees: false, model: "glm-5.3" };
  await b.choose(file());
  assert.match(b.note(), /^glm-5\.3 can't see images\. The picture is saved with your message, and the reply will say so\./);
  b.pictures.clear();
  vision = { sees: null, model: null };
  await b.choose(file());
  assert.equal(b.note(), "", "an unknown route is not guessed at");
  b.pictures.clear();
  vision = { sees: false, model: "glm-5.3" };
  const task = box({ mode: () => "task", bridge: { assistantImage: async (payload) => (payload.probe ? { ok: true } : { ok: true, id: "img_" + "b".repeat(24), name: payload.name, mime: payload.mime, bytes: 10, thumb: null, vision }) } });
  await task.choose(file());
  assert.match(task.note(), /^Saved with the project\. The task's brief names the file so a builder can open it\./, "a task does not ask the chat model anything");
});

test("a picture pasted with no text in the clipboard is attached; text pasted with a picture, and plain text, are left to the box", async () => {
  const b = box();
  const shot = file("Screenshot.png");
  const first = b.events();
  await b.input.trigger("paste", first.event({ clipboardData: { files: [shot], getData: () => "" } }));
  await settle();
  assert.equal(first.seen.prevented, 1, "a screenshot on the clipboard is taken");
  assert.equal(b.calls.image.length, 1);
  const withText = b.events();
  await b.input.trigger("paste", withText.event({ clipboardData: { files: [file("cell-range.png")], getData: (kind) => (kind === "text/plain" ? "A1\tB1" : "") } }));
  await settle();
  assert.equal(withText.seen.prevented, 0, "a spreadsheet range or web page pastes as the text it is");
  assert.equal(b.calls.image.length, 1);
  const words = b.events();
  await b.input.trigger("paste", words.event({ clipboardData: { files: [], getData: () => "hello" } }));
  const doc = b.events();
  await b.input.trigger("paste", doc.event({ clipboardData: { files: [file("notes.pdf", "application/pdf")], getData: () => "" } }));
  await settle();
  assert.equal(words.seen.prevented + doc.seen.prevented, 0);
  assert.equal(b.calls.image.length, 1, "only pictures are the box's to take");
});

test("a drop takes the pictures, hands the text files to the file reader, and leaves a drop with no picture alone", async () => {
  const b = box();
  const both = b.events();
  await b.input.trigger("drop", both.event({ dataTransfer: { files: [file("a.png"), file("plan.md", "text/markdown"), file("b.jpg", "image/jpeg")] } }));
  await settle();
  assert.equal(both.seen.prevented, 1);
  assert.equal(both.seen.immediate, 1, "the picture drop is this box's before the text-file reader sees it");
  assert.deepEqual(plain(b.calls.image.map((call) => call.name)), ["a.png", "b.jpg"]);
  assert.equal(b.calls.more.length, 1);
  assert.equal(b.calls.more[0][0], b.input);
  assert.deepEqual(plain(b.calls.more[0][1]), ["plan.md"], "the text file goes to the existing reader, not away");
  const text = b.events();
  await b.input.trigger("drop", text.event({ dataTransfer: { files: [file("plan.md", "text/markdown")] } }));
  await settle();
  assert.equal(text.seen.prevented + text.seen.immediate, 0, "a drop of text files is the file reader's, untouched");
  assert.equal(b.calls.image.length, 2);
  const over = b.events();
  await b.input.trigger("dragover", over.event({ dataTransfer: { items: [{ kind: "file", type: "image/png" }], files: [] } }));
  assert.equal(over.seen.prevented, 1, "while dragging a browser shows kinds, not files; a picture is welcome");
  const notOver = b.events();
  await b.input.trigger("dragover", notOver.event({ dataTransfer: { items: [{ kind: "file", type: "text/plain" }], files: [] } }));
  assert.equal(notOver.seen.prevented, 0);
});

test("the limits are said before the host is asked: four to a message, 5 MB each, four types", async () => {
  const b = box();
  await b.choose(file("1.png"), file("2.png"), file("3.png"), file("4.png"), file("5.png"));
  assert.equal(b.calls.image.length, 4);
  assert.match(b.note(), /A message can carry up to 4 pictures\./);
  assert.equal(b.$(".composer-attach-button").disabled, true, "the button rests at four");
  b.pictures.clear();
  await b.choose(file("huge.png", "image/png", 5 * MB + 1));
  assert.equal(b.calls.image.length, 4, "an oversize picture never crosses to the host");
  assert.match(b.note(), /huge\.png is 5\.0 MB; the limit is 5 MB\./);
  await b.choose(file("clip.svg", "image/svg+xml"));
  assert.match(b.note(), /Pictures can be PNG, JPEG, WebP or GIF\./);
  await b.choose(file("doc.pdf", "application/pdf"));
  assert.equal(b.calls.image.length, 4);
  await b.choose(file("exactly.png", "image/png", 5 * MB));
  assert.equal(b.calls.image.length, 5, "5 MB itself is fine");
});

test("the host's refusal is shown and adds nothing; a failure to read is shown too", async () => {
  const refused = box({ bridge: { assistantImage: async (payload) => (payload.probe ? { ok: true } : { ok: false, error: "That file is not a PNG, JPEG, WebP or GIF picture." }) } });
  await refused.choose(file("fake.png"));
  assert.equal(refused.pictures.count(), 0);
  assert.equal(refused.note(), "That file is not a PNG, JPEG, WebP or GIF picture.");
  const broken = box({ bridge: { assistantImage: async (payload) => { if (payload.probe) return { ok: true }; throw new Error("The bridge went away."); } } });
  await broken.choose(file());
  assert.equal(broken.pictures.count(), 0);
  assert.equal(broken.note(), "The bridge went away.");
  assert.equal(broken.pictures.isBusy(), false, "a failure does not leave the box busy");
});

test("removing a picture tells the host, takes the thumbnail away and gives the box its focus back", async () => {
  const b = box();
  await b.choose(file("a.png"), file("b.png"));
  const [first] = b.$$(".composer-thumb-remove");
  assert.equal(first.getAttribute("aria-label"), "Remove a.png");
  await first.trigger("click");
  await settle();
  assert.deepEqual(plain(b.calls.remove), [{ id: "img_000000000000000000000001" }]);
  assert.deepEqual(plain(b.names()), ["b.png · 1 KB"]);
  assert.deepEqual(plain(b.pictures.take()), ["img_000000000000000000000002"]);
  assert.equal(b.calls.focus, 1);
});

test("while a message is on its way the pictures stay: the box cannot add or remove", async () => {
  let busy = false;
  const b = box({ blocked: () => busy });
  await b.choose(file("a.png"));
  busy = true;
  b.pictures.refresh();
  assert.equal(b.$(".composer-thumb-remove").disabled, true);
  assert.equal(b.$(".composer-attach-button").disabled, true);
  await b.$(".composer-thumb-remove").trigger("click");
  await b.choose(file("late.png"));
  assert.equal(b.calls.remove.length, 0, "the host is reading it");
  assert.equal(b.calls.image.length, 1, "nothing new is taken");
  assert.equal(b.pictures.count(), 1);
  busy = false;
  b.pictures.refresh();
  assert.equal(b.$(".composer-thumb-remove").disabled, false);
});

test("clear() forgets what went with a message without telling the host to delete it; a project change drops the pictures too", async () => {
  let project = "project-a";
  const b = box({ scope: () => project });
  await b.choose(file("a.png"));
  b.pictures.clear();
  assert.equal(b.pictures.count(), 0);
  assert.equal(b.calls.remove.length, 0, "a sent picture is the message's now");
  await b.choose(file("b.png"));
  project = "project-b";
  b.pictures.refresh();
  assert.equal(b.pictures.count(), 0, "a picture belongs to its project's box");
  assert.equal(b.$$(".composer-thumb").length, 0);
  assert.equal(b.calls.remove.length, 0);
});

test("a picture that finishes uploading after the project changed is not added to the new project's box", async () => {
  let project = "project-a", release;
  const b = box({ scope: () => project, bridge: { assistantImage: (payload) => (payload.probe ? Promise.resolve({ ok: true }) : new Promise((resolve) => { release = () => resolve({ ok: true, id: "img_" + "c".repeat(24), name: "late.png", mime: "image/png", bytes: 5, thumb: null, vision: null }); })) } });
  const pending = b.pictures.addFiles([file("late.png")]);
  await settle();
  assert.equal(b.pictures.isBusy(), true);
  assert.equal(b.$$(".composer-thumb-busy").length, 1);
  project = "project-b";
  release();
  await pending; await settle();
  assert.equal(b.pictures.count(), 0);
  assert.equal(b.pictures.isBusy(), false);
});

test("without a preview from the host the page makes one from the file, and lets it go when the picture is removed or sent", async () => {
  const b = box({ bridge: { assistantImage: async (payload) => (payload.probe ? { ok: true } : { ok: true, id: "img_" + (payload.name === "a.webp" ? "d" : "e").repeat(24), name: payload.name, mime: payload.mime, bytes: 9, thumb: null, vision: null }) } });
  await b.choose(file("a.webp", "image/webp"), file("b.gif", "image/gif"));
  assert.deepEqual(plain(b.calls.made), ["a.webp", "b.gif"]);
  assert.equal(b.$(".composer-thumb img").getAttribute("src"), "blob:a.webp");
  await b.$(".composer-thumb-remove").trigger("click");
  assert.deepEqual(plain(b.calls.revoked), ["blob:a.webp"]);
  b.pictures.clear();
  assert.deepEqual(plain(b.calls.revoked), ["blob:a.webp", "blob:b.gif"], "a preview is not kept past its picture");
});

test("when the host has pictures switched off the row is not shown and a drop is left alone", async () => {
  const off = box({ bridge: { assistantImage: async () => ({ ok: false, off: true, error: "Picture attachments are switched off on this PC." }) } });
  await settle();
  assert.equal(off.$(".composer-attach").hidden, true, "asked once at the start, so the button never shows");
  const drop = off.events();
  await off.input.trigger("drop", drop.event({ dataTransfer: { files: [file("a.png")] } }));
  await off.input.trigger("paste", drop.event({ clipboardData: { files: [file("a.png")], getData: () => "" } }));
  assert.equal(drop.seen.prevented, 0, "a switched-off box takes nothing over");
  const late = box();
  await settle();
  assert.equal(late.$(".composer-attach").hidden, false);
  late.window.mefiStudio.assistantImage = async () => ({ ok: false, off: true, error: "Picture attachments are switched off on this PC." });
  await late.choose(file("a.png"));
  assert.equal(late.$(".composer-attach").hidden, true, "and a host that says so mid-way hides it then");
});

test("drawing again with nothing changed leaves the thumbnails as they were, and the box binds once", async () => {
  const b = box();
  await b.choose(file("a.png"));
  const before = b.$(".composer-thumb");
  b.pictures.refresh(); b.pictures.refresh();
  assert.equal(b.$(".composer-thumb"), before, "a redraw with the same pictures keeps the same nodes, so an image never flickers");
  assert.equal(b.window.MefiComposerPictures.bind(b.input, {}), b.pictures, "binding twice hands back the first");
  assert.equal(b.$$(".composer-attach").length, 1);
  assert.equal(b.window.MefiComposerPictures.get(b.input), b.pictures);
  assert.equal(b.window.MefiComposerPictures.LIMITS.count, 4);
  assert.equal(b.window.MefiComposerPictures.LIMITS.bytes, 5 * MB);
});

test("a blocked or read-only box takes no pictures, and a bridge without the channel is quiet", async () => {
  const b = box({ blocked: () => true });
  await b.choose(file("a.png"));
  assert.equal(b.calls.image.length, 0);
  const bare = box({ bridge: { assistantImage: undefined } });
  await bare.choose(file("a.png"));
  assert.equal(bare.pictures.count(), 0, "an old bridge has no channel; the button does nothing and nothing throws");
  const closed = box();
  closed.input.readOnly = true;
  await closed.choose(file("a.png"));
  assert.equal(closed.calls.image.length, 0);
});
