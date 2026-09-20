import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../renderer/idle.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ selection = "auto", loaded = true, playing = false, saved = false } = {}) {
  const requests = [], events = [], nodes = [], writes = new Map();
  const player = { source: "local", queueLength: loaded ? 1 : 0, title: "Test track", playing };
  const element = { src: loaded ? "blob:fixture" : "", paused: !playing, ended: false };
  const makeNode = (kind) => {
    const node = { kind, connected: new Set(), connect(target) { this.connected.add(target); }, disconnect(target) { if (target) this.connected.delete(target); else this.connected.clear(); } };
    nodes.push(node); return node;
  };
  const context = {
    destination: { kind: "speakers" }, state: "running", resume: () => Promise.resolve(),
    createMediaElementSource: () => makeNode("local"), createMediaStreamSource: () => makeNode("capture"), createAnalyser: () => makeNode("analyser"),
  };
  const capture = (kind) => new Promise((resolve, reject) => requests.push({ kind, resolve, reject }));
  const state = {
    active: true, reactive: saved, captureArmed: false, audioSource: selection, audio: context, audioResponse: 1.4,
    inputGeneration: 0, inputPending: null, inputStream: null, inputError: null, localAudio: null,
    mediaElements: new WeakMap(), bands: {}, bus: makeNode("bus"), nodes: [], music: null,
  };
  const status = { textContent: "" };
  const window = { dispatchEvent: (event) => events.push(event), MefiMusic: { status: () => player, getAudioElement: () => element } };
  const env = vm.createContext({ Date, Math, Promise, String, Boolean, JSON, window, state, el: { musicStatus: status },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    noMotion: () => false, writeStore: (key, value) => writes.set(key, value), ensureAudio() {}, refreshGraph() {},
    navigator: { mediaDevices: { getDisplayMedia: () => capture("desktop"), getUserMedia: () => capture("mic") } },
  });
  vm.runInContext(section("function useReactiveInput()", "function bell("), env);
  vm.runInContext(section("function musicNodeDetails()", "// Open/active tasks"), env);
  const stream = () => {
    const ended = [];
    const audio = { stops: 0, stop() { this.stops++; }, addEventListener(name, callback) { if (name === "ended") ended.push(callback); } };
    const video = { stops: 0, stop() { this.stops++; } };
    return { audio, video, end: () => ended.forEach((callback) => callback()), getTracks: () => [audio, video], getAudioTracks: () => [audio], getVideoTracks: () => [video] };
  };
  return { env, state, player, element, requests, events, nodes, writes, status, stream };
}

test("legacy automatic source preference migrates without turning saved capture into a new permission gesture", () => {
  const expression = source.match(/audioSource: (.+),\r?\n/)[1];
  for (const [stored, expected] of [
    [{}, "auto"], [{ "mefiStudio.zenSource": "desktop" }, "auto"], [{ "mefiStudio.zenSource": "mic" }, "mic"],
    [{ "mefiStudio.audioSource.v2": "desktop" }, "desktop"], [{ "mefiStudio.audioSource.v2": "local" }, "local"],
    [{ "mefiStudio.audioSource.v2": "unsupported" }, "auto"],
  ]) assert.equal(vm.runInNewContext(expression, { readStore: (key) => stored[key] }), expected);
  const f = fixture({ saved: true, loaded: false });
  f.env.useReactiveInput();
  assert.equal(f.requests.length, 0);
  f.env.setMusicReactive(true);
  assert.equal(f.requests.length, 1);
});

test("automatic and Studio sources directly follow a loaded track, while explicit desktop ignores the queue", async () => {
  for (const selection of ["auto", "local"]) {
    const f = fixture({ selection }); f.env.setMusicReactive(true);
    assert.equal(f.env.audioStatus().source, "local");
    assert.equal(f.env.audioStatus().phase, "paused");
    assert.equal(f.requests.length, 0);
  }
  const f = fixture({ selection: "desktop" }); f.env.setMusicReactive(true);
  assert.equal(f.requests[0].kind, "desktop");
  const stream = f.stream(); f.requests[0].resolve(stream); await flush();
  f.env.syncMusicNode();
  assert.equal(f.env.audioStatus().source, "desktop");
  assert.equal(f.state.localAudio, null);
  assert.equal(stream.audio.stops, 0);
  assert.equal(stream.video.stops, 1);
  assert.equal(f.nodes.find((node) => node.kind === "capture").connected.has(f.state.audio.destination), false);
});

test("Studio-only mode waits for tracks and never falls back to desktop capture", () => {
  const f = fixture({ selection: "local", loaded: false }); f.env.setMusicReactive(true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.env.audioStatus().text, "Add a track to link");
  f.player.queueLength = 1; f.element.src = "blob:added"; f.env.syncMusicNode();
  assert.equal(f.env.audioStatus().source, "local");
  f.player.source = "spotify"; f.env.syncMusicNode(); f.env.useReactiveInput();
  assert.equal(f.env.audioStatus().listening, false);
  assert.equal(f.requests.length, 0);
});

test("switching source supersedes a pending capture and releases its late tracks", async () => {
  const f = fixture({ selection: "desktop" }); f.env.setMusicReactive(true);
  f.env.setAudioSource("local");
  assert.equal(f.env.audioStatus().source, "local");
  const old = f.stream(); f.requests[0].resolve(old); await flush();
  assert.equal(old.audio.stops, 1); assert.equal(old.video.stops, 1);
  assert.equal(f.env.audioStatus().source, "local");
  assert.equal(f.state.inputPending, null);
  assert.equal(f.writes.get("mefiStudio.audioSource.v2"), "local");
});

test("switching Auto from desktop to a newly loaded track never rearms capture when that track disappears", async () => {
  const f = fixture({ loaded: false }); f.env.setMusicReactive(true);
  const capture = f.stream(); f.requests[0].resolve(capture); await flush();
  f.player.queueLength = 1; f.element.src = "blob:added"; f.env.syncMusicNode();
  assert.equal(capture.audio.stops, 1);
  assert.equal(f.env.audioStatus().source, "local");
  f.player.source = "spotify"; f.env.syncMusicNode(); f.env.useReactiveInput();
  assert.equal(f.env.audioStatus().listening, false);
  assert.equal(f.requests.length, 1, "switching player tabs is not a desktop-capture gesture");
  f.env.setMusicReactive(true);
  assert.equal(f.requests.length, 2, "an explicit reconnect can capture desktop Spotify playback");
});

test("capture denial and ended streams expose one-click retry without automatic permission loops", async () => {
  const f = fixture({ selection: "mic" }); f.env.setMusicReactive(true);
  f.requests[0].reject({ name: "NotAllowedError" }); await flush();
  assert.equal(f.env.audioStatus().phase, "error");
  f.env.useReactiveInput(); assert.equal(f.requests.length, 1);
  f.env.setMusicReactive(true);
  const capture = f.stream(); f.requests[1].resolve(capture); await flush();
  capture.end();
  assert.equal(f.env.audioStatus().listening, false);
  assert.equal(f.env.audioStatus().phase, "error");
  f.env.useReactiveInput(); assert.equal(f.requests.length, 2);
  f.env.setMusicReactive(true); assert.equal(f.requests.length, 3);
});

test("player pause, resume and source changes publish useful status without disconnecting playback", () => {
  const f = fixture(); f.env.setMusicReactive(true);
  assert.equal(f.events.at(-1).detail.phase, "paused");
  assert.equal(f.events.at(-1).detail.response, 1.4);
  const count = f.events.length; f.env.renderMusicStatus(true); assert.equal(f.events.length, count);
  f.element.paused = false; f.player.playing = true; f.env.syncMusicNode();
  assert.equal(f.events.at(-1).type, "mefi-audio-change");
  assert.equal(f.events.at(-1).detail.phase, "listening");
  const sourceNode = f.nodes.find((node) => node.kind === "local");
  f.env.setMusicReactive(false);
  assert.equal(sourceNode.connected.size, 1);
  assert.ok(sourceNode.connected.has(f.state.audio.destination));
  assert.equal(f.element.paused, false);
  f.env.setMusicReactive(true);
  assert.equal(f.nodes.filter((node) => node.kind === "local").length, 1);
});

test("choosing a source while the link is off saves it without requesting audio", () => {
  const f = fixture(); f.env.setAudioSource("mic");
  assert.equal(f.requests.length, 0);
  assert.equal(f.env.audioStatus().selection, "mic");
  assert.equal(f.env.audioStatus().phase, "off");
  f.env.setMusicReactive(true); assert.equal(f.requests[0].kind, "mic");
});
