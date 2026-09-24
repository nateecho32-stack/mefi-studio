// The spawn loop checks each ranked candidate against one store snapshot.
// The session haystacks are built once per snapshot; every answer must match
// a check against fresh copies of the same sessions and todos.
import test from "node:test";
import assert from "node:assert/strict";
import { collaborate } from "../scripts/assistant.mjs";

const sessions = [
  { id: "s1", title: "Orbit trails renderer", edits: 3, active: true },
  { id: "s2", title: "Unrelated inventory", todos: [{ content: "wire the orbit camera" }] },
  { id: "s3", title: "Child session", parentId: "s1" },
  { id: "s1", title: "Orbit trails renderer (duplicate row)" },
  { sessionId: "s4", title: "Palette work" },
];
const todos = [{ sessionId: "s4", content: "Orbit palette swatches" }, { sessionId: "s2", content: "shaders" }, { content: "orphan orbit" }];
const works = [
  { title: "Improve orbit trails", prompt: "smoother trails" },
  { title: "Palette swatches", prompt: "add swatches" },
  { title: "Shaders", prompt: "compile shaders faster" },
  { title: "Nothing matches here", prompt: "zzzzz" },
];
const copy = (value) => JSON.parse(JSON.stringify(value));

test("feature peers read from the shared snapshot match a check on fresh copies", () => {
  for (const work of works) {
    const shared = collaborate({ work, sessions, todos });
    const fresh = collaborate({ work, sessions: copy(sessions), todos: copy(todos) });
    assert.deepEqual(shared.featurePeers, fresh.featurePeers, work.title);
    assert.deepEqual(shared, fresh);
  }
  assert.deepEqual(collaborate({ work: works[0], sessions, todos }).featurePeers.map((row) => row.sessionId), ["s1", "s2", "s4"]);
  // Another todos snapshot with the same sessions array is read afresh.
  assert.deepEqual(collaborate({ work: works[2], sessions, todos: [] }).featurePeers.map((row) => row.sessionId), []);
  assert.deepEqual(collaborate({ work: works[2], sessions, todos }).featurePeers.map((row) => row.sessionId), ["s2"]);
  assert.deepEqual(collaborate({ work: works[1], sessions, todos: [{ sessionId: "s2", content: "palette swatches" }] }).featurePeers.map((row) => row.sessionId), ["s2", "s4"]);
});
