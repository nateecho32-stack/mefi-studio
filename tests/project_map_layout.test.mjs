import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ window: {} });
vm.runInContext(await readFile(new URL("../renderer/project-map-view.js", import.meta.url), "utf8"), context);
const layout = (rows, links) => JSON.parse(JSON.stringify(context.window.MefiProjectMap.relationshipLayout(rows, links)));
const systems = ["engine", "world", "player", "sound", "tools"].map(id => ({ id, name: id, active: 0 }));
const links = [{ a: "engine", b: "world", label: "Changed together" }, { a: "engine", b: "player", label: "Changed together" }, { a: "world", b: "player", label: "Changed together" }];

test("relationship layout places connected systems by topology and keeps undiscovered systems separate", () => {
  const result = layout(systems, links);
  assert.equal(result.nodes.length, 5);
  assert.equal(result.edges.length, 3);
  const byId = new Map(result.nodes.map(node => [node.row.id, node]));
  assert.ok(byId.get("engine").x < byId.get("world").x);
  assert.ok(byId.get("sound").y > Math.max(...["engine", "world", "player"].map(id => byId.get(id).y)));
  assert.ok(result.regions.some(region => region.name === "Connections still to discover"));
  for (const node of result.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x >= 108 && node.x + 108 <= result.bounds.w);
    assert.ok(node.y >= 44 && node.y + 44 <= result.bounds.h);
  }
});

test("activity updates and input ordering preserve the map's world positions", () => {
  const positions = result => result.nodes.map(node => [node.row.id, node.x, node.y]);
  assert.deepEqual(positions(layout(systems, links)), positions(layout([...systems].reverse().map(row => ({ ...row, active: 5, hot: 99 })), [...links].reverse())));
});

test("filtered maps omit dangling and self edges while cyclic links stay finite", () => {
  const result = layout(systems.slice(0, 3), [...links, { a: "engine", b: "engine" }, { a: "engine", b: "missing" }]);
  assert.equal(result.edges.length, 3);
  assert.equal(result.nodes.length, 3);
  assert.equal(new Set(result.nodes.map(row => row.row.id)).size, 3);
  assert.ok(result.bounds.w > 0 && result.bounds.h > 0);
  assert.equal(layout([], links).nodes.length, 0);
});
