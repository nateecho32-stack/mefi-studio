// A brain map is the pipeline as data. It has to hold the loop the studio
// actually runs, refuse wiring that cannot mean anything, and never let an
// edit widen what a node may do without the map granting it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NODE_TYPES, PERMISSION_KEYS, GATES, MAX_NEST,
  catalog, makeNode, defaultMap, normalizeMap, requiredGrants,
  validateMap, compileMap, gatesFor, issuePolicyFor, summarize,
} from "../scripts/brains.cjs";

const codes = (result) => result.problems.map((problem) => problem.code);
const nodeOf = (map, type) => map.nodes.find((node) => node.type === type);

test("the shipped map is the pipeline, and it is clean", () => {
  const map = defaultMap();
  const order = map.nodes.map((node) => node.type);
  for (const stage of ["idea.planner", "check.user", "check.model", "analyze.scope", "plan.build", "brief.write",
    "assistant.review", "assistant.setup", "jev.classify", "model.pick", "work.dispatch", "verify.evidence"]) {
    assert.ok(order.includes(stage), `the map has ${stage}`);
  }
  const check = validateMap(map);
  assert.equal(check.errors, 0, check.problems.map((problem) => problem.text).join("; "));
  assert.equal(check.warnings, 0, check.problems.map((problem) => problem.text).join("; "));
  const compiled = compileMap(map);
  assert.equal(compiled.ok, true);
  assert.equal(compiled.order.length, map.nodes.length, "every node is ordered");
  assert.deepEqual(compiled.unordered, []);
  // Jev sits between the set-up and the model choice, in that order.
  const at = (type) => compiled.order.indexOf(nodeOf(map, type).id);
  assert.ok(at("assistant.setup") < at("jev.classify"));
  assert.ok(at("jev.classify") < at("model.pick"));
  assert.ok(at("model.pick") < at("work.dispatch"));
  assert.ok(at("assistant.review") < at("assistant.setup"));
});

test("the decision lane loops back without making the map unorderable", () => {
  const compiled = compileMap(defaultMap());
  assert.equal(compiled.feedback.length, 1, "one wire carries an answer into the next pass");
  assert.equal(compiled.ok, true);
});

test("a wire may only join ports that exist and can carry the same thing", () => {
  const map = normalizeMap(defaultMap());
  const jev = nodeOf(map, "jev.classify").id;
  const plan = nodeOf(map, "plan.build").id;
  const broken = normalizeMap({
    ...map,
    edges: [...map.edges,
      { id: "e_bad_port", from: { node: jev, port: "nope" }, to: { node: plan, port: "in" } },
      { id: "e_bad_type", from: { node: jev, port: "values" }, to: { node: plan, port: "in" } },
    ],
  });
  const problems = codes(validateMap(broken));
  assert.ok(problems.includes("bad-port"));
  assert.ok(problems.includes("type-mismatch"));
});

test("a node cannot do more than the map grants it", () => {
  const map = normalizeMap({ ...defaultMap(), grants: ["read-project"] });
  const check = validateMap(map);
  assert.equal(check.ok, false);
  const ungranted = check.problems.filter((problem) => problem.code === "ungranted");
  assert.ok(ungranted.length > 0);
  assert.ok(ungranted.every((problem) => problem.permission && PERMISSION_KEYS.includes(problem.permission)));
  assert.ok(ungranted.every((problem) => problem.fix.startsWith("Grant ")));
  // Granting exactly what the nodes need clears it, and nothing more.
  const fixed = normalizeMap({ ...map, grants: requiredGrants(map) });
  assert.equal(validateMap(fixed).ok, true);
});

test("a required input with nothing wired into it is an error naming the port", () => {
  const map = normalizeMap(defaultMap());
  const jev = nodeOf(map, "jev.classify").id;
  const cut = normalizeMap({ ...map, edges: map.edges.filter((edge) => edge.to.node !== jev) });
  const problem = validateMap(cut).problems.find((item) => item.code === "missing-input");
  assert.ok(problem);
  assert.match(problem.text, /Jev question/);
});

test("nested brains may not call themselves, or ring back round", () => {
  const inner = normalizeMap({ id: "inner", name: "Inner", grants: [], nodes: [makeNode("brain.call", { id: "n_call", config: { map: "outer" } })], edges: [] });
  const outer = normalizeMap({ id: "outer", name: "Outer", grants: [], nodes: [makeNode("brain.call", { id: "n_call", config: { map: "inner" } })], edges: [] });
  assert.ok(codes(validateMap(outer, { maps: [inner, outer] })).includes("recursive"));
  const self = normalizeMap({ id: "self", name: "Self", grants: [], nodes: [makeNode("brain.call", { id: "n_call", config: { map: "self" } })], edges: [] });
  assert.ok(codes(validateMap(self, { maps: [self] })).includes("self-call"));
  const missing = normalizeMap({ id: "m", name: "M", grants: [], nodes: [makeNode("brain.call", { id: "n_call", config: { map: "gone" } })], edges: [] });
  assert.ok(codes(validateMap(missing, { maps: [] })).includes("missing-map"));
  const empty = normalizeMap({ id: "e", name: "E", grants: [], nodes: [makeNode("brain.call", { id: "n_call" })], edges: [] });
  assert.ok(codes(validateMap(empty)).includes("no-map"));
  assert.ok(MAX_NEST >= 2);
});

test("only one of a singleton node, and unknown types survive as errors", () => {
  const twice = normalizeMap({
    id: "t", name: "T", grants: ["create-task"],
    nodes: [makeNode("user.request", { id: "a" }), makeNode("user.request", { id: "b" })], edges: [],
  });
  assert.ok(codes(validateMap(twice)).includes("duplicate"));
  const alien = normalizeMap({ id: "x", name: "X", nodes: [{ id: "n1", type: "from.the.future" }], edges: [] });
  assert.equal(alien.nodes.length, 1, "it is kept so the map can be opened and fixed");
  assert.ok(codes(validateMap(alien)).includes("unknown-type"));
});

test("saving bounds everything a map can carry", () => {
  const map = normalizeMap({
    id: "bad id!", name: "x".repeat(400), nodes: [
      { id: "n1", type: "ask.user", x: 99999, y: -99999, title: "y".repeat(200), config: { maxOpenAsks: 900, expireHours: -3 } },
      { id: "n1", type: "ask.user" }, // a duplicate id is dropped, not merged
      { id: "bad id!", type: "ask.user" },
    ],
    edges: [{ from: { node: "n1", port: "ask" }, to: { node: "gone", port: "x" } }],
    grants: ["message-user", "root-access"],
  });
  assert.ok(/^map_/.test(map.id), "an unusable id is replaced rather than kept");
  assert.equal(map.name.length, 80);
  assert.equal(map.nodes.length, 1);
  assert.equal(map.nodes[0].title.length, 60);
  assert.equal(map.nodes[0].x, 4000);
  assert.equal(map.nodes[0].y, -4000);
  assert.equal(map.nodes[0].config.maxOpenAsks, 20);
  assert.equal(map.nodes[0].config.expireHours, 1);
  assert.deepEqual(map.grants, ["message-user"]);
  assert.equal(map.edges.length, 0, "a wire to a node that is not there is dropped");
});

test("a saved map cannot automate away a grant or a risk", () => {
  const map = normalizeMap({
    id: "sneaky", name: "Sneaky", grants: ["message-user"],
    nodes: [makeNode("issue.triage", { id: "n_t", config: { auto: ["permission", "risk", "blocked"], autoRetryLimit: 99 } })],
    edges: [],
  });
  assert.deepEqual(map.nodes[0].config.auto, ["blocked"]);
  assert.equal(map.nodes[0].config.autoRetryLimit, 5);
  const policy = issuePolicyFor(map);
  assert.deepEqual(policy.auto, ["blocked"]);
});

test("the gates a map moves are exactly the switches it speaks to", () => {
  const full = gatesFor(defaultMap());
  assert.deepEqual(full, { approveBeforeBuild: true, briefing: true, jev: true, modelChoice: "auto", dispatch: true, parallel: 4 });
  const map = normalizeMap(defaultMap());
  const lean = normalizeMap({ ...map, nodes: map.nodes.filter((node) => !["check.user", "jev.classify"].includes(node.type)) });
  const gates = gatesFor(lean);
  assert.equal(gates.approveBeforeBuild, false, "no approval node means work is not held");
  assert.equal(gates.jev, false, "no Jev node means Jev routing is off");
  assert.equal(gates.dispatch, true);
  // An empty map speaks to nothing, so activating it may not move a switch.
  assert.deepEqual(gatesFor({ id: "e", name: "E", nodes: [], edges: [] }),
    { approveBeforeBuild: null, briefing: null, jev: null, modelChoice: null, dispatch: null, parallel: null });
  for (const gate of Object.values(GATES)) assert.ok(NODE_TYPES.some((type) => type.type === gate.node), `${gate.node} exists`);
});

test("a map with no triage or ask node says so instead of using the defaults", () => {
  const map = normalizeMap(defaultMap());
  const quiet = normalizeMap({ ...map, nodes: map.nodes.filter((node) => !["issue.triage", "ask.user"].includes(node.type)) });
  const policy = issuePolicyFor(quiet);
  assert.equal(policy.triage, false);
  assert.equal(policy.asks, false);
  const loud = issuePolicyFor(map);
  assert.equal(loud.triage, true);
  assert.equal(loud.asks, true);
  assert.equal(loud.perRun, 3);
});

test("the catalog tells the editor what each part can and cannot do", () => {
  const parts = catalog();
  assert.equal(parts.nodes.length, NODE_TYPES.length);
  for (const node of parts.nodes) {
    assert.ok(node.summary, `${node.type} has a summary`);
    assert.ok(node.can.length, `${node.type} says what it can do`);
    assert.ok(node.cannot.length, `${node.type} says what it cannot do`);
    assert.ok(["host", "map", "draft"].includes(node.runs), `${node.type} says where it runs`);
    assert.ok(node.hostNote, `${node.type} says what activating it does`);
    for (const key of node.permissions) assert.ok(PERMISSION_KEYS.includes(key), `${node.type}: ${key} is a real permission`);
    for (const group of [node.inputs, node.outputs]) {
      for (const port of group) assert.ok(port.kinds.length, `${node.type}.${port.id} carries something`);
    }
    for (const setting of node.settings ?? []) {
      assert.ok(setting.label && setting.help, `${node.type}.${setting.key} is explained`);
      assert.ok(["boolean", "number", "enum", "text", "kinds", "map"].includes(setting.type));
      if (setting.type === "enum") assert.ok(setting.options.includes(setting.default));
    }
  }
  assert.ok(parts.permissions.every((permission) => permission.label && permission.detail));
  assert.ok(parts.issueKinds.some((kind) => kind.alwaysAsk), "the editor can show which decisions stay yours");
});

test("a summary is enough to pick a map from a list", () => {
  const summary = summarize(defaultMap());
  assert.equal(summary.ok, true);
  assert.equal(summary.builtIn, true);
  assert.equal(summary.nodes, 18);
  assert.ok(summary.live >= 18, "no node in the shipped map is inert");
  assert.equal(summary.errors, 0);
});

test("a summary judges another-brain parts against the maps it is given", () => {
  const inner = normalizeMap({ id: "inner", name: "Inner", grants: ["create-task"], nodes: [makeNode("user.request", { id: "n_req" })], edges: [] });
  const calling = (target) => normalizeMap({
    id: "caller", name: "Caller", grants: ["create-task"],
    nodes: [makeNode("user.request", { id: "n_req" }), makeNode("brain.call", { id: "n_call", config: { map: target } })],
    edges: [{ id: "e_in", from: { node: "n_req", port: "request" }, to: { node: "n_call", port: "in" } }],
  });
  const caller = calling("inner");
  const maps = [inner, caller];
  const listed = summarize(caller, { maps });
  assert.equal(listed.ok, true, "a call to a saved map is not a missing map");
  assert.equal(listed.errors, 0);
  assert.equal(listed.errors, validateMap(caller, { maps }).errors, "the switcher agrees with the editor");
  // Without the maps it cannot know, and a map that really is gone still counts.
  assert.equal(summarize(caller).errors, 1);
  const errorCodes = (result) => result.problems.filter((problem) => problem.level === "error").map((problem) => problem.code);
  assert.deepEqual(errorCodes(validateMap(caller)), ["missing-map"]);
  const orphan = calling("gone");
  assert.equal(summarize(orphan, { maps: [inner, orphan] }).errors, 1);
  assert.ok(codes(validateMap(orphan, { maps: [inner, orphan] })).includes("missing-map"));
});
