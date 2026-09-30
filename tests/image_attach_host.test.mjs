// Pictures on a message inside the host (main.cjs "Picture attachments"): the
// real block, request builders and reply path run against a real temporary
// folder and the real catalog, with only the providers and Electron replaced.
// assistant:image keeps a picture; a model the catalog says can see gets it in
// the provider's own format; one that cannot says so once in the reply; a coding
// CLI gets one plain line; a task's brief names the file; and the kill switch
// MEFI_STUDIO_NO_IMAGE_ATTACH=1 turns all of it off.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { png, jpeg } from "./fixtures/image-bytes.mjs";

const source = readFileSync(new URL("../main.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};
const mainRequire = createRequire(new URL("../main.cjs", import.meta.url));
const catalog = JSON.parse(readFileSync(new URL("../data/models.json", import.meta.url), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const send = (bytes, name = "shot.png", mime = "image/png") => ({ name, mime, data: bytes.toString("base64") });

async function host({ env = {}, tasks = [], routes = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-image-host-"));
  const state = { messages: [] };
  const calls = { wire: [], cli: [], logs: [], thumbs: 0 };
  const process_ = { env: { ...env }, pid: process.pid };
  const nativeImage = { createFromBuffer: (bytes) => ({ isEmpty: () => bytes[0] !== 0x89 && bytes[0] !== 0xff, getSize: () => ({ width: 400, height: 200 }),
    resize: ({ width, height }) => ({ toDataURL: () => { calls.thumbs += 1; return `data:image/png;base64,${Buffer.from(`${width}x${height}`).toString("base64")}`; }, toJPEG: () => Buffer.from("jpeg preview") }),
    toDataURL: () => "data:image/png;base64,AAAA", toJPEG: () => Buffer.from("jpeg preview") }) };
  const context = vm.createContext({
    require: mainRequire, path, process: process_, Buffer, console, Promise, Date, crypto: mainRequire("node:crypto"),
    nativeImage, TASKS_PATH: "eyes-tasks.json", projectDataPath: () => path.join(root, "projects", "p1", "eyes-tasks.json"),
    projects: { open: () => true, current: () => ({ id: "p1" }) },
    assistantState: state, getEyes: async () => ({ readJson: async () => tasks }),
    catalogDocument: { read: async () => catalog }, agentProfiles: mainRequire("./scripts/agent-profiles.cjs"),
    readAgentSettings: async () => ({}), readSettings: async () => ({}),
    seatChoice: () => ({ provider: routes.provider ?? "zen", model: routes.model ?? "gpt-6-sol" }), decryptKey: () => (routes.key ?? "key"), SEAT_DEFAULTS: { companion: { model: "gpt-6-luna" } },
    resolveAiRoute: async () => routes.resolve ?? { ok: true, provider: "opencode", model: "deepseek-v4.1-flash" }, DATA_ONLY_CLIS: new Set(["claude", "codex", "grok", "antigravity"]),
    logLine: (line) => calls.logs.push(line),
    // httpAssistantCall's collaborators.
    applyModelRouting: async (route) => route, providerBreaker: { enter: () => ({ allowed: true, settle() {} }) }, settleProvider() {}, providerSkipped: () => ({ ok: false }),
    assistantSessionId: async () => "session", ZAI_MODEL_HEAVY: "glm-5.3",
    chatCompletion: async (endpoint, apiKey, model, body) => { calls.wire.push({ endpoint, model, body: structuredClone(body) }); return { ok: true, text: "answer", model }; },
    // cliAssistantCall's collaborators.
    cliAccountTurn: (_provider, call) => call({}),
    claudeCompletion: async (system, user) => { calls.cli.push({ system, user }); return { ok: true, text: "cli answer", model: "claude" }; },
    recordModelCall: async () => {}, autoFallbackEnabled: () => false,
  });
  vm.runInContext(section("// ---- Picture attachments", "// ---- end of picture attachments")
    + section("async function httpAssistantCall(", "// Circuit breakers for the host's own model calls")
    + section("function responsesRequest(", "// A Responses reply in the chat-completions shape")
    + section("async function cliAssistantCall(", "// The HTTP half of assistantFetch"), context);
  return { context, root, state, calls, env: process_.env, folder: path.join(root, "projects", "p1", "attachments"), done: async () => { assert.ok(path.basename(root).startsWith("mefi-image-host-")); await rm(root, { recursive: true, force: true }); } };
}
const call = (h, route, user = "What is wrong here?") => h.context.httpAssistantCall({ ok: true, provider: "opencode", endpoint: "https://opencode.ai/zen/go/v1/chat/completions", apiKey: "k", model: "kimi-k3", ...route }, "system prompt", user, 500, { pinned: true, taskType: "conversation" });

test("assistant:image keeps a picture under the project's attachments folder and answers with an id, a bounded preview and what the chat model will do", async () => {
  const h = await host();
  try {
    const saved = plain(await h.context.saveMessagePicture(send(png(400, 200, 500))));
    assert.equal(saved.ok, true);
    assert.match(saved.id, /^img_[a-f0-9]{24}$/);
    assert.deepEqual([saved.name, saved.mime, saved.width, saved.height], ["shot.png", "image/png", 400, 200]);
    assert.match(saved.thumb, /^data:image\/png;base64,/);
    assert.ok(saved.thumb.length < 30000);
    assert.deepEqual(saved.vision, { sees: true, model: "gpt-6-sol" }, "the companion seat is on gpt-6-sol, which the catalog says takes images");
    assert.deepEqual((await readdir(h.folder)).sort(), [`${saved.id}.json`, `${saved.id}.png`]);
    // The same route with a model that cannot see.
    h.context.seatChoice = () => ({ provider: "zai", model: "glm-5.3" });
    h.context.decryptKey = () => null;
    h.context.resolveAiRoute = async () => ({ ok: true, provider: "zai", model: "glm-5.3" });
    assert.deepEqual(plain((await h.context.saveMessagePicture(send(jpeg(30, 30)))).vision), { sees: false, model: "glm-5.3" });
    h.context.resolveAiRoute = async () => ({ ok: false });
    assert.deepEqual(plain((await h.context.saveMessagePicture(send(png(9, 9)))).vision), { sees: null, model: null }, "no route: the box says nothing");
    // A refusal answers plainly and keeps nothing.
    const refused = await h.context.saveMessagePicture(send(Buffer.from("MZ not a picture")));
    assert.equal(refused.ok, false);
    assert.match(refused.error, /not a PNG, JPEG, WebP or GIF/);
    assert.equal((await readdir(h.folder)).length, 6, "three saved pictures, two files each");
    // Taking one away.
    assert.deepEqual(plain(await h.context.removeMessagePicture({ id: saved.id })), { ok: true });
    assert.equal((await readdir(h.folder)).some((name) => name.startsWith(saved.id)), false);
    assert.equal((await h.context.removeMessagePicture({ id: "../../x" })).ok, false);
  } finally { await h.done(); }
});

test("MEFI_STUDIO_NO_IMAGE_ATTACH=1 refuses a picture, a message that carries one, and the picture in a brief", async () => {
  const h = await host({ env: { MEFI_STUDIO_NO_IMAGE_ATTACH: "1" } });
  try {
    const off = plain(await h.context.saveMessagePicture(send(png())));
    assert.deepEqual(off, { ok: false, off: true, error: "Picture attachments are switched off on this PC." });
    assert.equal((await h.context.removeMessagePicture({ id: "img_" + "a".repeat(24) })).off, true);
    assert.deepEqual(plain(await h.context.saveMessagePicture({ probe: true })), { ok: false, off: true, error: "Picture attachments are switched off on this PC." }, "the box's own question is answered too, so it can hide the button");
    assert.equal((await h.context.attachedPictures(["img_" + "a".repeat(24)])).ok, false);
    assert.equal((await h.context.attachedPictures([])).ok, true, "a message with no pictures is untouched by the switch");
    assert.equal((await h.context.withPictureLines("brief", ["img_" + "a".repeat(24)])).ok, false);
    assert.equal(await h.context.messageExtras({ images: [{ id: "img_" + "a".repeat(24) }] }), null, "a reply builds nothing from a picture while it is off");
    await assert.rejects(() => readdir(h.folder), /ENOENT/, "nothing was written");
    h.env.MEFI_STUDIO_NO_IMAGE_ATTACH = "0";
    assert.deepEqual(plain(await h.context.saveMessagePicture({ probe: true })), { ok: true, probe: true }, "on: the probe saves nothing");
    await assert.rejects(() => readdir(h.folder), /ENOENT/, "a probe wrote nothing either");
    assert.equal((await h.context.saveMessagePicture(send(png()))).ok, true, "only 1 turns it off");
  } finally { await h.done(); }
});

test("a model the catalog says can see gets the picture in an OpenAI-compatible request as an image_url data URL", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(400, 200, 100)));
    const extras = await h.context.messageExtras({ id: "m1", text: "What is wrong here?", images: [{ id: saved.id }] });
    const result = await extras.run(() => call(h, { model: "kimi-k3" }));
    assert.equal(result.ok, true);
    const body = h.calls.wire[0].body;
    assert.deepEqual(plain(body.messages[0]), { role: "system", content: "system prompt" }, "the system prompt is untouched");
    assert.equal(body.messages[1].content[0].type, "text");
    assert.equal(body.messages[1].content[0].text, "What is wrong here?");
    assert.deepEqual(plain(body.messages[1].content[1]), { type: "image_url", image_url: { url: `data:image/png;base64,${png(400, 200, 100).toString("base64")}` } });
    assert.deepEqual(plain(extras.notes()), [], "it saw the picture: nothing to say");
  } finally { await h.done(); }
});

test("the Responses API wire gets input_text and input_image, and an Anthropic endpoint gets image source blocks", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(jpeg(20, 10, 50), "photo.jpg", "image/jpeg"));
    const extras = await h.context.messageExtras({ text: "look", images: [{ id: saved.id }] });
    const base64 = jpeg(20, 10, 50).toString("base64");
    await extras.run(() => call(h, { provider: "zen", model: "gpt-6-sol", endpoint: "https://opencode.ai/zen/v1/responses" }, "look"));
    // The request body is chat-shaped; chatCompletion turns it into the Responses shape with responsesRequest.
    const wire = plain(h.context.responsesRequest(h.calls.wire[0].body));
    assert.deepEqual(wire.input, [{ role: "user", content: [{ type: "input_text", text: "look" }, { type: "input_image", image_url: `data:image/jpeg;base64,${base64}` }] }]);
    assert.equal(wire.instructions, "system prompt");
    // A text-only message is still a plain string on that wire.
    assert.equal(h.context.responsesRequest({ model: "m", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }).input[0].content, "hi");
    h.calls.wire.length = 0;
    await extras.run(() => call(h, { provider: "claude", model: "claude-opus-5", endpoint: "https://api.anthropic.com/v1/messages" }, "look"));
    assert.deepEqual(plain(h.calls.wire[0].body.messages[1].content), [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } }, { type: "text", text: "look" }]);
  } finally { await h.done(); }
});

test("a model that cannot see is sent the request as it was, and the reply says so once, with the model's name", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(8, 8)));
    const extras = await h.context.messageExtras({ text: "look at this", images: [{ id: saved.id }] });
    const result = await extras.run(async () => { await call(h, { provider: "opencode", model: "glm-5.3" }, "look at this"); return call(h, { provider: "opencode", model: "glm-5.3" }, "and again"); });
    assert.equal(result.ok, true);
    for (const sent of h.calls.wire) assert.equal(typeof sent.body.messages.at(-1).content, "string", "no picture went to a model that cannot see");
    assert.deepEqual(plain(extras.notes()), ["glm-5.3 can't see images, so I answered without looking at the picture you attached. It is saved with your message."]);
    assert.deepEqual(plain(extras.notes()), plain(extras.notes()), "asking again does not multiply it");
    // A model the catalog does not know at all is a model that cannot see.
    h.calls.wire.length = 0;
    const other = await h.context.messageExtras({ text: "look", images: [{ id: saved.id }] });
    await other.run(() => call(h, { provider: "custom", model: "my-own-local-model" }, "look"));
    assert.equal(typeof h.calls.wire[0].body.messages.at(-1).content, "string");
    assert.match(other.notes()[0], /^my-own-local-model can't see images/);
  } finally { await h.done(); }
});

test("when a fallback model can see after the first could not, the picture goes to it and no note is made", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(8, 8)));
    const extras = await h.context.messageExtras({ text: "look", images: [{ id: saved.id }] });
    await extras.run(async () => { await call(h, { provider: "opencode", model: "glm-5.3" }, "look"); await call(h, { provider: "opencode", model: "kimi-k3" }, "look"); });
    assert.equal(typeof h.calls.wire[0].body.messages.at(-1).content, "string");
    assert.equal(Array.isArray(h.calls.wire[1].body.messages.at(-1).content), true);
    assert.deepEqual(plain(extras.notes()), []);
  } finally { await h.done(); }
});

test("no model answered at all: the reply says none that can look at pictures did, once", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(8, 8)));
    const extras = await h.context.messageExtras({ text: "look", images: [{ id: saved.id }, { id: (await h.context.saveMessagePicture(send(jpeg(9, 9)))).id }] });
    assert.deepEqual(plain(extras.notes()), ["No AI that can look at pictures answered, so I read your message without the 2 pictures. They are saved with your message."]);
  } finally { await h.done(); }
});

test("a coding CLI is never sent a picture, only one plain line naming the file and where it is", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(8, 8), "crash screen.png"));
    const extras = await h.context.messageExtras({ text: "why", images: [{ id: saved.id }] });
    const route = { ok: true, provider: "claude", model: "claude-opus-5", cli: true };
    await extras.run(() => h.context.cliAssistantCall(route, "system", "why does it crash?", 500, { role: "routine", taskType: "conversation" }));
    const line = `The owner attached crash screen.png at ${path.join(h.folder, `${saved.id}.png`)}`;
    assert.equal(h.calls.cli[0].user, `why does it crash?\n\n${line}`);
    assert.doesNotMatch(h.calls.cli[0].user, /base64|image_url/);
    assert.match(extras.notes()[0], /can't see images/, "the reply still says the model did not look at it");
    // No picture in scope, or a line already there: the text is as it was.
    assert.equal(h.context.imageCliText("plain"), "plain");
    await extras.run(async () => assert.equal(h.context.imageCliText(`why\n\n${line}`), `why\n\n${line}`, "the line is not added twice"));
  } finally { await h.done(); }
});

test("a task made from the box names its pictures in its brief, one plain line each, and is refused when one is gone", async () => {
  const h = await host();
  try {
    const one = await h.context.saveMessagePicture(send(png(8, 8), "a.png"));
    const two = await h.context.saveMessagePicture(send(jpeg(8, 8), "b.jpg", "image/jpeg"));
    const briefed = plain(await h.context.withPictureLines("Fix the header", [one.id, two.id]));
    assert.equal(briefed.ok, true);
    assert.equal(briefed.text, `Fix the header\n\nThe owner attached a.png at ${path.join(h.folder, `${one.id}.png`)}\nThe owner attached b.jpg at ${path.join(h.folder, `${two.id}.jpg`)}`);
    assert.equal((await h.context.withPictureLines("Fix", [])).text, "Fix");
    await h.context.removeMessagePicture({ id: two.id });
    const gone = await h.context.withPictureLines("Fix the header", [one.id, two.id]);
    assert.equal(gone.ok, false);
    assert.equal(gone.error, "A picture is no longer saved. Attach it again.", "its record went with it, so it has no name to give");
    const forged = await h.context.attachedPictures(["../../etc/passwd"]);
    assert.equal(forged.ok, false);
  } finally { await h.done(); }
});

test("a picture that vanishes between attaching and the reply is said, not hidden, and the message still gets its answer", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(8, 8), "gone.png"));
    await h.context.removeMessagePicture({ id: saved.id });
    const extras = await h.context.messageExtras({ text: "look", images: [{ id: saved.id, name: "gone.png" }] });
    assert.deepEqual(plain(extras.images), []);
    assert.deepEqual(plain(extras.notes()), ['"gone.png" is no longer saved, so I answered without it.'], "named from the message's own record");
    const result = await extras.run(() => call(h, { model: "kimi-k3" }, "look"));
    assert.equal(result.ok, true, "the call runs as an ordinary one");
    assert.equal(typeof h.calls.wire[0].body.messages.at(-1).content, "string");
  } finally { await h.done(); }
});

test("a message with no pictures costs the reply path nothing", async () => {
  const h = await host();
  try {
    assert.equal(await h.context.messageExtras({ text: "hello" }), null);
    assert.equal(await h.context.messageExtras({ text: "hello", images: [] }), null);
    const result = await call(h, { model: "kimi-k3" }, "hello");
    assert.equal(result.ok, true);
    assert.equal(h.calls.wire[0].body.messages.at(-1).content, "hello");
    assert.equal(h.context.imageCliText("hello"), "hello");
    await assert.rejects(() => readdir(h.folder), /ENOENT/, "no folder was made");
  } finally { await h.done(); }
});

test("cleanup never removes a picture the thread or a task still names", async () => {
  const h = await host();
  try {
    const sent = await h.context.saveMessagePicture(send(png(8, 8), "sent.png"));
    const inTask = await h.context.saveMessagePicture(send(png(9, 9), "task.png"));
    const orphan = await h.context.saveMessagePicture(send(png(10, 10), "orphan.png"));
    h.state.messages.push({ role: "user", text: "x", images: [{ id: sent.id }] }, { role: "assistant", text: "y" });
    h.context.getEyes = async () => ({ readJson: async () => [{ id: "t1", prompt: `Fix it\n\nThe owner attached task.png at ${path.join(h.folder, `${inTask.id}.png`)}` }, { id: "t2", prompt: "no pictures" }] });
    const named = await h.context.imageNamedIds();
    assert.deepEqual([...named].sort(), [sent.id, inTask.id].sort());
    assert.equal(named.has(orphan.id), false);
    // An unreadable board leaves the thread's pictures kept and does not throw.
    h.context.getEyes = async () => { throw new Error("board locked"); };
    assert.deepEqual([...await h.context.imageNamedIds()], [sent.id]);
  } finally { await h.done(); }
});

test("the previews are made by Electron for PNG and JPEG only, and a failure never fails the save", async () => {
  const h = await host();
  try {
    assert.match(await h.context.imageThumbnail(png(400, 200), "image/png"), /^data:image\/png;base64,/);
    assert.equal(h.calls.thumbs, 1);
    assert.match(await h.context.imageThumbnail(jpeg(400, 200), "image/jpeg"), /^data:image\/jpeg;base64,/);
    assert.equal(await h.context.imageThumbnail(Buffer.from("GIF89a...."), "image/gif"), null, "the page makes its own for the rest");
    assert.equal(await h.context.imageThumbnail(Buffer.from("RIFF....WEBP"), "image/webp"), null);
    h.context.nativeImage = { createFromBuffer: () => { throw new Error("no decoder"); } };
    assert.equal((await h.context.saveMessagePicture(send(png(400, 200, 30000)))).ok, true);
  } finally { await h.done(); }
});

test("assistantMessage keeps a picture's name and size on the message, refuses a message whose picture is gone, and never stores a path", async () => {
  const h = await host();
  try {
    const saved = await h.context.saveMessagePicture(send(png(8, 8), "screenshot.png"));
    const pushed = [];
    Object.assign(h.context, {
      ensureAssistant: async () => {}, agentBrain: undefined, assistantMessageId: () => "msg_1", assistantTrim() {}, assistantCaps: () => ({ messages: 100 }), assistantLog() {},
      assistantReplyWork: (user) => ({ id: `job_${user.id}` }), assistantAiUsable: () => false, ASSISTANT_PRIORITY: { responder: 3 },
      enqueue: async (_role, _run, options) => { pushed.push(options); return { role: "assistant", text: "ok" }; },
      assistantRespond: async () => ({}), saveAssistant: async () => {}, assistantAppendReply: () => ({}),
    });
    vm.runInContext(section("function assistantUiContext(", "// ---- Picture attachments") + "\n;", h.context);
    const result = plain(await h.context.assistantMessage("look at this", { images: [{ id: saved.id }] }));
    assert.equal(result.ok, true);
    assert.deepEqual(plain(h.state.messages[0].images), [{ id: saved.id, name: "screenshot.png", mime: "image/png", bytes: png(8, 8).length }]);
    assert.doesNotMatch(JSON.stringify(h.state.messages[0]), /attachments|projects|mefi-image-host|\\\\/, "no path on the message: ids and names only");
    h.state.messages.length = 0;
    await h.context.removeMessagePicture({ id: saved.id });
    const refused = plain(await h.context.assistantMessage("look at this", { images: [{ id: saved.id }] }));
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "A picture is no longer saved. Attach it again.");
    assert.equal(h.state.messages.length, 0, "the thread was not touched");
    const plainMessage = plain(await h.context.assistantMessage("no picture here", {}));
    assert.equal(plainMessage.ok, true);
    assert.equal("images" in h.state.messages[0], false);
    h.env.MEFI_STUDIO_NO_IMAGE_ATTACH = "1";
    assert.match((await h.context.assistantMessage("with a picture", { images: [{ id: saved.id }] })).error, /switched off/);
  } finally { await h.done(); }
});

test("the channels are project-gated, the bridge carries the pictures, and the reply path is hooked", async () => {
  assert.match(source, /ipcMain\.handle\("assistant:image", \(_event, payload\) => saveMessagePicture\(payload \?\? \{\}\)\);/);
  assert.match(source, /ipcMain\.handle\("assistant:image-remove", \(_event, payload\) => removeMessagePicture\(payload \?\? \{\}\)\);/);
  assert.match(source, /return assistantMessage\(text, \{ context, images \}\);/);
  assert.match(source, /const wire = typeof imageBodyFor === "function" \? await imageBodyFor\(candidate, requestBody\(candidate\)\) : requestBody\(candidate\);/);
  assert.match(source, /const said = typeof imageCliText === "function" \? imageCliText\(user\) : user;/);
  assert.match(source, /extras\.run\(ask\)/);
  assert.match(source, /extras\.notes\(\)/);
  const gate = source.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  assert.ok(!/assistant:/.test(gate), "the chat is the open project's, so a project switch waits");
  const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
  assert.match(preload, /assistantMessage: \(text, projectId, context, images\) => ipcRenderer\.invoke\("assistant:message", \{ text, projectId, context, images \}\)/);
  assert.match(preload, /assistantImage: \(payload\) => ipcRenderer\.invoke\("assistant:image"/);
  assert.match(preload, /assistantImageRemove: \(payload\) => ipcRenderer\.invoke\("assistant:image-remove"/);
  assert.match(preload, /tasksCreate: \(task\) => ipcRenderer\.invoke\("tasks:create", task\)/, "a task carries its pictures in the payload it already sends");
});
