// The Fleet's geometry (renderer/fleet-layout.js): pods as columns of seat
// cards, orthogonal wires in lanes of their own, the camera maths and the
// tidy tree. Pure, so it is checked on the numbers, not on a picture.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../renderer/fleet-layout.js", import.meta.url), "utf8");
const window = {};
vm.runInNewContext(source, { window });
// Results are copied out of the vm's realm, or strict deep equality sees other prototypes.
const plain = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const raw = window.MefiFleetLayout;
const L = {
  SIZE: plain(raw.SIZE), ZOOM: plain(raw.ZOOM), neighbor: raw.neighbor,
  layoutPods: (...args) => plain(raw.layoutPods(...args)),
  fit: (...args) => plain(raw.fit(...args)),
  zoomAt: (...args) => plain(raw.zoomAt(...args)),
  constrain: (...args) => plain(raw.constrain(...args)),
  tidyTree: (...args) => plain(raw.tidyTree(...args)),
  simplify: (points) => plain(raw.simplify(points)),
  assignLanes: (...args) => { const out = raw.assignLanes(...args); return { count: out.count, laneOf: Object.fromEntries(out.laneOf) }; },
};

const pod = (id, ...seats) => ({ id, label: id[0].toUpperCase() + id.slice(1), seats: seats.map((seatId) => ({ id: seatId })) });
const team = () => [pod("lead", "lead", "foreman"), pod("build", "builder-1", "builder-2", "builder-3"), pod("check", "overseer", "desk"), pod("keep", "watcher")];
const edge = (from, to, kind = "handoff", count = 1) => ({ from, to, kind, count, lastAt: 1 });
const segments = (points) => points.slice(1).map((point, index) => [points[index], point]);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// A segment passes through a card when its span crosses the card's interior.
function crosses([[x1, y1], [x2, y2]], rect) {
  if (x1 === x2) return x1 > rect.x && x1 < rect.x + rect.w && Math.max(y1, y2) > rect.y && Math.min(y1, y2) < rect.y + rect.h;
  return y1 > rect.y && y1 < rect.y + rect.h && Math.max(x1, x2) > rect.x && Math.min(x1, x2) < rect.x + rect.w;
}

const busy = () => [
  edge("foreman", "builder-1", "dispatch"), edge("foreman", "builder-2", "dispatch"), edge("foreman", "builder-3", "dispatch"),
  edge("builder-1", "builder-2", "handoff"), edge("builder-1", "overseer", "verify"), edge("builder-2", "overseer", "verify"),
  edge("overseer", "builder-1", "rework"), edge("builder-3", "desk", "desk"), edge("desk", "you", "escalate"),
  edge("lead", "overseer", "mail"), edge("overseer", "lead", "mail"), edge("watcher", "foreman", "mail"), edge("foreman", "watcher", "mail"),
  edge("builder-3", "builder-1", "report"), edge("desk", "builder-3", "desk"),
];

test("pods are columns left to right, seats stack in rows, and nothing overlaps", () => {
  const layout = L.layoutPods({ pods: team(), edges: busy() });
  assert.deepEqual(layout.pods.map((item) => item.id), ["lead", "build", "check", "keep", "you"]);
  for (let index = 1; index < layout.pods.length; index += 1) assert.ok(layout.pods[index].x >= layout.pods[index - 1].x + layout.pods[index - 1].w + L.SIZE.gutterMin - 1, "a gutter between columns");
  assert.deepEqual(layout.seats.filter((item) => item.pod === "build").map((item) => item.id), ["builder-1", "builder-2", "builder-3"]);
  const build = layout.seats.filter((item) => item.pod === "build");
  assert.ok(build[1].y - build[0].y >= layout.size.seatH, "rows do not overlap");
  for (const [index, a] of layout.seats.entries()) for (const b of layout.seats.slice(index + 1)) assert.equal(overlaps(a, b), false, `${a.id} and ${b.id}`);
  for (const item of layout.seats) {
    const owner = layout.pods.find((entry) => entry.id === item.pod);
    assert.ok(item.x >= owner.x && item.x + item.w <= owner.x + owner.w && item.y >= owner.y && item.y + item.h <= owner.y + owner.h, `${item.id} sits inside its pod`);
    assert.ok(item.x + item.w <= layout.bounds.w && item.y + item.h <= layout.bounds.h, "and inside the bounds");
  }
});

test("a pod with no seats is left out, and You appears only when something is wired to you", () => {
  const plain = L.layoutPods({ pods: [...team(), pod("empty")], edges: [edge("foreman", "builder-1")] });
  assert.deepEqual(plain.pods.map((item) => item.id), ["lead", "build", "check", "keep"]);
  assert.deepEqual(L.layoutPods({ pods: team(), edges: [edge("desk", "you", "escalate")] }).pods.at(-1).seats, ["you"]);
  assert.deepEqual(L.layoutPods({ pods: [], edges: [] }).pods, []);
  assert.deepEqual(L.layoutPods(null).seats, []);
  assert.equal(L.layoutPods({ pods: team(), edges: [edge("nobody", "builder-1"), edge("foreman", "foreman"), { from: "x" }] }).wires.length, 0, "wires to seats that are not there are dropped");
});

test("every wire is a polyline of horizontal and vertical segments that starts and ends on a seat edge", () => {
  const layout = L.layoutPods({ pods: team(), edges: busy() });
  const seat = new Map(layout.seats.map((item) => [item.id, item]));
  assert.equal(layout.wires.length, busy().length);
  for (const wire of layout.wires) {
    for (const [a, b] of segments(wire.points)) assert.ok(a[0] === b[0] || a[1] === b[1], `${wire.id} has a diagonal`);
    const [from, to] = wire.id.split(">").map((id) => seat.get(id));
    const start = wire.points[0];
    const end = wire.points.at(-1);
    assert.ok(start[1] >= from.y && start[1] <= from.y + from.h && (start[0] === from.x || start[0] === from.x + from.w), `${wire.id} leaves the edge of ${from.id}`);
    assert.ok(end[1] >= to.y && end[1] <= to.y + to.h && (end[0] === to.x || end[0] === to.x + to.w), `${wire.id} arrives at the edge of ${to.id}`);
    assert.ok(wire.points.length >= 2 && Number.isFinite(wire.label.x) && Number.isFinite(wire.label.y));
  }
});

test("forward wires leave on the right and arrive on the left; backward ones the other way; skips use a rail", () => {
  const layout = L.layoutPods({ pods: team(), edges: [edge("builder-1", "overseer", "verify"), edge("overseer", "builder-1", "rework"), edge("lead", "overseer", "mail"), edge("overseer", "lead", "mail"), edge("builder-1", "builder-2", "handoff")] });
  const wire = (id) => layout.wires.find((item) => item.id === id);
  const seat = (id) => layout.seats.find((item) => item.id === id);
  const podsTop = Math.min(...layout.pods.map((item) => item.y));
  const podsBottom = Math.max(...layout.pods.map((item) => item.y + item.h));
  const forward = wire("builder-1>overseer");
  assert.equal(forward.points[0][0], seat("builder-1").x + seat("builder-1").w, "leaves on the right");
  assert.equal(forward.points.at(-1)[0], seat("overseer").x, "arrives on the left");
  const back = wire("overseer>builder-1");
  assert.equal(back.points[0][0], seat("overseer").x, "a backward wire leaves on the left");
  assert.equal(back.points.at(-1)[0], seat("builder-1").x + seat("builder-1").w, "and arrives on the right");
  assert.ok(Math.min(...wire("lead>overseer").points.map((point) => point[1])) < podsTop, "a forward skip runs over the top of the pods");
  assert.ok(Math.max(...wire("overseer>lead").points.map((point) => point[1])) > podsBottom, "a backward skip runs under them");
  const same = wire("builder-1>builder-2");
  assert.equal(same.points[0][0], seat("builder-1").x + seat("builder-1").w);
  assert.equal(same.points.at(-1)[0], seat("builder-2").x + seat("builder-2").w, "within a pod both ends are on the right");
});

test("no wire runs through a seat card or a pod title, and no two wires share a line", () => {
  const layout = L.layoutPods({ pods: team(), edges: busy() });
  for (const wire of layout.wires) {
    const [from, to] = wire.id.split(">");
    for (const item of layout.seats) for (const line of segments(wire.points)) assert.equal(crosses(line, item), false, `${wire.id} crosses ${item.id}`);
    // Not through the pod titles either: the strip above each pod's first seat.
    for (const owner of layout.pods) for (const line of segments(wire.points)) assert.equal(crosses(line, { x: owner.x, y: owner.y, w: owner.w, h: L.SIZE.podHead }), false, `${wire.id} crosses the ${owner.id} title`);
    assert.notEqual(from, to);
  }
  // Vertical runs on one x, and horizontal runs on one y that are not at a seat height, never overlap between two wires.
  const seatHeights = new Set(layout.seats.map((item) => item.y + item.h / 2));
  const runs = [];
  for (const wire of layout.wires) for (const [a, b] of segments(wire.points)) {
    if (a[0] === b[0]) runs.push({ wire: wire.id, axis: "v", at: a[0], from: Math.min(a[1], b[1]), to: Math.max(a[1], b[1]) });
    else if (!seatHeights.has(a[1])) runs.push({ wire: wire.id, axis: "h", at: a[1], from: Math.min(a[0], b[0]), to: Math.max(a[0], b[0]) });
  }
  for (const [index, a] of runs.entries()) for (const b of runs.slice(index + 1)) {
    if (a.wire === b.wire || a.axis !== b.axis || a.at !== b.at) continue;
    assert.ok(a.to <= b.from || b.to <= a.from, `${a.wire} and ${b.wire} share the ${a.axis === "v" ? "vertical" : "horizontal"} line ${a.at}`);
  }
});

test("wires between the same two seats become one wire that carries every reason", () => {
  const layout = L.layoutPods({ pods: team(), edges: [edge("builder-1", "overseer", "verify", 2), edge("builder-1", "overseer", "rework", 1), edge("builder-1", "overseer", "mail", 4)] });
  assert.equal(layout.wires.length, 1);
  assert.deepEqual(layout.wires[0].kinds, ["rework", "verify", "mail"], "strongest reason first");
  assert.equal(layout.wires[0].kind, "rework");
  assert.equal(layout.wires[0].count, 7);
});

test("the same input gives the same picture, whatever order the wires arrive in", () => {
  const forward = L.layoutPods({ pods: team(), edges: busy() });
  const shuffled = L.layoutPods({ pods: team(), edges: [...busy()].reverse() });
  const byId = (layout) => Object.fromEntries(layout.wires.map((wire) => [wire.id, wire.points]));
  assert.deepEqual(byId(shuffled), byId(forward));
  assert.deepEqual(shuffled.pods, forward.pods);
  assert.deepEqual(shuffled.bounds, forward.bounds);
  assert.deepEqual(L.layoutPods({ pods: team(), edges: busy() }), forward);
});

test("wires that overlap in height get lanes of their own, and ones that cannot meet share a lane", () => {
  const spread = L.assignLanes([{ key: "a", start: 0, end: 100 }, { key: "b", start: 50, end: 150 }, { key: "c", start: 200, end: 300 }], 4);
  assert.deepEqual(spread, { count: 2, laneOf: { a: 0, b: 1, c: 0 } });
  const touching = L.assignLanes([{ key: "a", start: 0, end: 100 }, { key: "b", start: 102, end: 150 }], 4);
  assert.equal(touching.count, 2, "the gap keeps neighbours apart");
  assert.deepEqual(L.assignLanes([], 4), { count: 0, laneOf: {} });
  const layout = L.layoutPods({ pods: team(), edges: [edge("foreman", "builder-2"), edge("lead", "builder-3"), edge("builder-1", "builder-3")] });
  const xs = layout.wires.map((wire) => wire.points.find((point, index) => index > 0 && point[0] !== wire.points[0][0])?.[0]);
  assert.equal(new Set(xs).size, 3, "three wires that overlap in height use three lanes of the gutter");
});

test("arrow keys go to the neighbouring seat: up and down in the pod, left and right to the closest height", () => {
  const layout = L.layoutPods({ pods: team(), edges: busy() });
  assert.equal(L.neighbor(layout, "builder-2", "up"), "builder-1");
  assert.equal(L.neighbor(layout, "builder-2", "down"), "builder-3");
  assert.equal(L.neighbor(layout, "builder-1", "up"), null);
  assert.equal(L.neighbor(layout, "builder-3", "down"), null);
  assert.equal(L.neighbor(layout, "foreman", "right"), "builder-2", "the second lead seat is level with the second build seat");
  assert.equal(L.neighbor(layout, "lead", "right"), "builder-1", "and the first with the first");
  assert.equal(L.neighbor(layout, "builder-3", "right"), "desk");
  assert.equal(L.neighbor(layout, "builder-3", "left"), "foreman");
  assert.equal(L.neighbor(layout, "lead", "left"), null);
  assert.equal(L.neighbor(layout, "watcher", "right"), "you");
  assert.equal(L.neighbor(layout, "ghost", "right"), null);
});

test("fit centres the picture and never zooms past 125%; zoomAt keeps the point under the pointer", () => {
  const viewport = { w: 800, h: 500 };
  const small = L.fit({ w: 200, h: 100 }, viewport);
  assert.equal(small.k, 1.25);
  assert.deepEqual({ x: small.x, y: small.y }, { x: 275, y: 188 });
  const wide = L.fit({ w: 2000, h: 400 }, viewport);
  assert.ok(wide.k < 0.4 && wide.k >= 0.3);
  assert.equal(L.fit({ w: 4000, h: 4000 }, viewport).k, 0.3, "and never below 30%");
  const zoomed = L.zoomAt({ k: 1, x: 10, y: 20 }, 2, 110, 120);
  assert.deepEqual(zoomed, { k: 2, x: -90, y: -80 }, "the point under (110,120) stays at (110,120)");
  assert.equal(L.zoomAt({ k: 1.9, x: 0, y: 0 }, 3, 0, 0).k, 2, "the zoom stops at 200%");
  assert.deepEqual(L.constrain({ k: 1, x: -5000, y: 9000 }, { w: 400, h: 300 }, viewport), { k: 1, x: -320, y: 420 }, "some of the picture stays in view");
  assert.deepEqual(L.constrain({ k: 1, x: 100, y: 100 }, { w: 400, h: 300 }, viewport), { k: 1, x: 100, y: 100 }, "a picture already in view is left alone");
});

test("the tidy tree stacks leaves in rows, centres parents on their children and puts depth in columns", () => {
  const tree = L.tidyTree({ id: "project", label: "Mefi Studio", kind: "project", children: [
    { id: "pod:build", label: "Build", kind: "pod", children: [{ id: "builder-1", kind: "seat", status: "working", children: [{ id: "task_a", kind: "task" }] }, { id: "builder-2", kind: "seat" }] },
    { id: "pod:check", label: "Check", kind: "pod", children: [{ id: "overseer", kind: "seat" }] },
  ] });
  const node = (id) => tree.nodes.find((item) => item.id === id);
  assert.deepEqual(tree.nodes.map((item) => item.depth), [0, 1, 1, 2, 2, 2, 3]);
  assert.deepEqual([node("task_a").y, node("builder-2").y, node("overseer").y], [0, 34, 68]);
  assert.equal(node("builder-1").y, 0, "a parent with one child sits level with it");
  assert.equal(node("pod:build").y, 17, "and with two, between them");
  assert.equal(node("project").y, (17 + 68) / 2);
  assert.equal(node("task_a").x, 3 * 190);
  assert.equal(node("builder-1").status, "working");
  assert.deepEqual(tree.links.map((item) => `${item.from}>${item.to}`).sort(), ["builder-1>task_a", "pod:build>builder-1", "pod:build>builder-2", "pod:check>overseer", "project>pod:build", "project>pod:check"]);
  assert.deepEqual(tree.bounds, { w: 4 * 190, h: 3 * 34 });
  assert.deepEqual(L.tidyTree(null), { nodes: [], links: [], bounds: { w: 190, h: 34 } });
  assert.deepEqual(L.simplify([[0, 0], [0, 0], [0, 5], [0, 9], [4, 9], [8, 9], [8, 12]]), [[0, 0], [0, 9], [8, 9], [8, 12]]);
});
