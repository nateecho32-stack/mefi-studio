import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const start = source.indexOf("function primaryBranchParents(");
const end = source.indexOf("// Each layout has a real, deterministic volume.", start);
assert.ok(start >= 0 && end > start, "branch topology helpers exist");

function fixture() {
  const state = {};
  const env = vm.createContext({ state, Map, Set, String, Number });
  vm.runInContext(source.slice(start, end), env);
  const oracle = env.primaryBranchParents;
  let builds = 0;
  env.primaryBranchParents = (...args) => { builds += 1; return oracle(...args); };
  const projected = [
    { node: { id: "root", kind: "root" } },
    { node: { id: "session:a", kind: "session" } },
    { node: { id: "session:b", kind: "session" } },
    { node: { id: "task", kind: "task", sessionId: "session:a" } },
    { node: { id: "todo", kind: "todo", groupParentId: "task" } },
  ];
  const edges = [{ a: 0, b: 1 }, { a: 0, b: 2 }, { a: 1, b: 3 }, { a: 2, b: 3 }, { a: 3, b: 4 }];
  const run = (nodes = projected, links = edges) => {
    const result = env.cachedBranchParents(nodes, links);
    assert.deepEqual([...result], [...oracle(nodes, links)], "cached parents match the uncached resolver exactly");
    return result;
  };
  return { env, state, projected, edges, run, builds: () => builds };
}

test("Command topology reuses its parent map across fresh projections, coordinates and status", () => {
  const { projected, edges, run, builds, state } = fixture();
  const first = run();
  for (let frame = 0; frame < 20; frame += 1) {
    const independent = projected.map(({ node }) => ({
      node: { ...node, x: frame, y: -frame, z: frame / 2, state: frame % 2 ? "active" : "done", dying: frame % 3 === 0 },
      p: { x: frame * 10, y: frame * 20, depth: frame },
    }));
    const links = edges.map((edge) => ({ ...edge, weight: frame, color: `color:${frame}` }));
    assert.equal(run(independent, links), first);
  }
  assert.equal(builds(), 1, "stable topology resolves parents only once");
  assert.equal(state.branchTopology.parents, first);
});

test("Command topology observes in-place node IDs, kinds and every effective-parent fallback", async (t) => {
  const cases = [
    ["node ID", (nodes) => { nodes[3].node.id = "renamed"; }],
    ["agent kind", (nodes) => { nodes[1].node.kind = "agent"; }],
    ["root kind", (nodes) => { nodes[3].node.kind = "root"; }],
    ["group parent", (nodes) => { nodes[3].node.groupParentId = "session:b"; }],
    ["session parent", (nodes) => { nodes[3].node.sessionId = "session:b"; }],
    ["anchor parent", (nodes) => { delete nodes[3].node.sessionId; nodes[3].node.anchorSessionId = "session:b"; }],
    ["empty preferred ID", (nodes) => { nodes[3].node.groupParentId = ""; }],
    ["numeric preferred ID", (nodes) => { nodes[3].node.groupParentId = 0; }],
    ["preferred deletion", (nodes) => { delete nodes[3].node.sessionId; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const { projected, run, builds } = fixture();
    const first = run();
    mutate(projected);
    const next = run();
    assert.notEqual(next, first, "in-place topology mutation invalidates the snapshot");
    assert.equal(run(), next);
    assert.equal(builds(), 2);
  });
});

test("Command topology compares effective preferred parents without invalidating shadowed metadata", () => {
  const { projected, run, builds } = fixture();
  const node = projected[3].node;
  node.groupParentId = "session:a";
  const first = run();
  node.sessionId = "session:b";
  node.anchorSessionId = "root";
  assert.equal(run(), first, "groupParentId overrides the other parent fields");
  node.groupParentId = null;
  const second = run();
  assert.notEqual(second, first);
  assert.equal(second.get("task"), "session:b");
  node.sessionId = null;
  const third = run();
  assert.notEqual(third, second, "null sessionId reveals anchorSessionId");
  assert.equal(builds(), 3);
});

test("Command topology detects in-place edges, input ordering and length changes", async (t) => {
  const cases = [
    ["parent endpoint", (_nodes, edges) => { edges[2].a = 0; }],
    ["child endpoint", (_nodes, edges) => { edges[2].b = 4; }],
    ["invalid endpoint", (_nodes, edges) => { edges[2].a = 900; }],
    ["node order", (nodes) => { [nodes[1], nodes[2]] = [nodes[2], nodes[1]]; }],
    ["edge order", (_nodes, edges) => { edges.reverse(); }],
    ["node addition", (nodes) => { nodes.push({ node: { id: "new", kind: "task" } }); }],
    ["node removal", (nodes) => { nodes.pop(); }],
    ["edge addition", (_nodes, edges) => { edges.push({ a: 0, b: 4 }); }],
    ["edge removal", (_nodes, edges) => { edges.pop(); }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const { projected, edges, run, builds } = fixture();
    const first = run();
    mutate(projected, edges);
    const next = run();
    assert.notEqual(next, first);
    assert.equal(run(), next);
    assert.equal(builds(), 2);
  });
});

test("Command topology preserves deterministic parent resolution with duplicate and cyclic edges", () => {
  const { projected, edges, run } = fixture();
  edges.push({ a: 1, b: 3 }, { a: 3, b: 1 }, { a: 4, b: 3 }, { a: 4, b: 0 }, { a: 3, b: 3 });
  const first = run();
  assert.equal(run(), first);
  const reversed = run(projected, [...edges].reverse());
  assert.deepEqual([...reversed], [...first]);
  for (const id of reversed.keys()) {
    const seen = new Set();
    let cursor = id;
    while (cursor) {
      assert.equal(seen.has(cursor), false, "chosen primary edges form no cycle");
      seen.add(cursor);
      cursor = reversed.get(cursor);
    }
  }
});

test("Command topology keeps only the latest bounded snapshot and parent map", () => {
  const { run, state, builds } = fixture();
  const first = run();
  const firstSnapshot = state.branchTopology;
  const firstEntries = [...first];
  for (let revision = 0; revision < 50; revision += 1) {
    const projected = Array.from({ length: revision % 7 + 2 }, (_, index) => ({
      node: { id: `${revision}|${index}`, kind: index ? "task" : "root" },
    }));
    const edges = projected.slice(1).map((_, index) => ({ a: index, b: index + 1 }));
    const current = run(projected, edges);
    assert.equal(state.branchTopology.nodes.length, projected.length * 3);
    assert.equal(state.branchTopology.edges.length, edges.length * 2);
    assert.equal(state.branchTopology.parents, current);
    assert.equal(current.size, projected.length - 1);
    assert.deepEqual(Object.keys(state.branchTopology).sort(), ["edges", "nodes", "parents"]);
  }
  const empty = run([], []);
  assert.equal(empty.size, 0);
  assert.equal(state.branchTopology.nodes.length, 0);
  assert.equal(state.branchTopology.edges.length, 0);
  assert.equal(run([], []), empty);
  assert.notEqual(state.branchTopology, firstSnapshot);
  assert.deepEqual([...first], firstEntries, "replacement never accumulates or mutates previously returned parents");
  assert.equal(builds(), 52);
});
