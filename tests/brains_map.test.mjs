// A brain map is the pipeline as data. It has to hold the loop the studio
// actually runs, refuse wiring that cannot mean anything, and never let an
// edit widen what a node may do without the map granting it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  NODE_TYPES, PERMISSION_KEYS, GATES, MAX_NEST, MAX_PARALLEL,
  catalog, makeNode, defaultMap, normalizeMap, requiredGrants,
  validateMap, compileMap, gatesFor, issuePolicyFor, partActivity, summarize,
} from "../scripts/brains.cjs";
import issues from "../scripts/agent-issues.cjs";

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
  assert.deepEqual(full, { approveBeforeBuild: true, briefing: true, jev: true, modelChoice: "auto", dispatch: true, parallel: 3 });
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

// ---- the decision settings the host reads --------------------------------------

const settingOf = (type, key) => NODE_TYPES.find((item) => item.type === type).settings.find((setting) => setting.key === key);
const wire = (id, from, fromPort, to, toPort) => ({ id, from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const withConfig = (type, config) => {
  const map = normalizeMap(defaultMap());
  const node = nodeOf(map, type);
  node.config = { ...node.config, ...config };
  return normalizeMap(map);
};

test("Repeat questions and Follow-ups per chain are real settings with safe defaults", () => {
  const repeat = settingOf("issue.triage", "repeatAsks");
  assert.equal(repeat.type, "enum");
  assert.equal(repeat.label, "Repeat questions");
  assert.deepEqual(repeat.options, ["fold", "ask"]);
  assert.equal(repeat.default, "fold");
  assert.match(repeat.help, /already asked on another card/);
  const depth = settingOf("answer.apply", "splitDepth");
  assert.equal(depth.type, "number");
  assert.equal(depth.label, "Follow-ups per chain");
  assert.deepEqual([depth.default, depth.min, depth.max], [3, 0, 5]);
  assert.match(depth.help, /0 turns Split off/);

  const shipped = issuePolicyFor(defaultMap());
  assert.equal(shipped.splitDepth, 3);
  assert.equal(shipped.repeatAsks, "fold");
  assert.equal(shipped.announce, true);
  // Every field the policy had before is still there.
  for (const key of ["auto", "autoRetryLimit", "maxOpenAsks", "triage", "asks", "perRun", "fromFailures", "expireHours"]) assert.ok(key in shipped, key);

  assert.equal(issuePolicyFor(withConfig("answer.apply", { splitDepth: 0 })).splitDepth, 0, "0 turns Split off");
  assert.equal(issuePolicyFor(withConfig("answer.apply", { splitDepth: 9 })).splitDepth, 5);
  assert.equal(issuePolicyFor(withConfig("answer.apply", { splitDepth: "" })).splitDepth, 3, "a cleared field is not zero");
  assert.equal(issuePolicyFor(withConfig("answer.apply", { announce: false })).announce, false);
  assert.equal(issuePolicyFor(withConfig("issue.triage", { repeatAsks: "ask" })).repeatAsks, "ask");
  assert.equal(issuePolicyFor(withConfig("issue.triage", { repeatAsks: "sometimes" })).repeatAsks, "fold");

  // Without the parts: the documented defaults, and nothing announced.
  const bare = normalizeMap(defaultMap());
  const none = issuePolicyFor(normalizeMap({ ...bare, nodes: bare.nodes.filter((node) => !["answer.apply", "issue.triage"].includes(node.type)) }));
  assert.equal(none.splitDepth, 3);
  assert.equal(none.repeatAsks, "fold");
  assert.equal(none.announce, false);
});

test("Workers at once is the build worker limit, bounded by the studio's cap", () => {
  const parallel = settingOf("work.dispatch", "parallel");
  assert.equal(MAX_PARALLEL, 3);
  assert.deepEqual([parallel.default, parallel.min, parallel.max], [3, 1, MAX_PARALLEL]);
  assert.match(parallel.help, /never runs more than 3/);
  assert.equal(GATES.parallel.setting, "autopilot.parallel", "not the assistant's roster width");
  assert.equal(GATES.parallel.node, "work.dispatch");
  // A map saved by an older build asked for 4 (or more); it is held to the cap.
  assert.equal(gatesFor(withConfig("work.dispatch", { parallel: 8 })).parallel, 3);
  assert.equal(gatesFor(withConfig("work.dispatch", { parallel: 2 })).parallel, 2);
});

test("a decision lane held in another brain is the lane an issue meets", () => {
  const laneGrants = ["read-project", "message-user", "create-task", "close-task"];
  const lane = normalizeMap({
    id: "lane", name: "Lane", grants: laneGrants,
    nodes: [makeNode("issue.intake", { id: "i" }), makeNode("issue.triage", { id: "t" }), makeNode("ask.user", { id: "a" }),
      makeNode("answer.apply", { id: "p", config: { splitDepth: 1 } })],
    edges: [wire("e1", "i", "issue", "t", "issue"), wire("e2", "t", "ask", "a", "ask"), wire("e3", "a", "answer", "p", "answer")],
  });
  const outer = normalizeMap({
    id: "outer", name: "Outer", grants: ["read-project"],
    nodes: [makeNode("issue.intake", { id: "i" }), makeNode("brain.call", { id: "c", config: { map: "lane" } })],
    edges: [wire("e1", "i", "issue", "c", "in")],
  });
  const maps = [lane, outer];
  const policy = issuePolicyFor(outer, { maps });
  assert.equal(policy.triage, true);
  assert.equal(policy.asks, true, "permission and risk questions still reach the owner");
  assert.equal(policy.splitDepth, 1, "the inner apply part's settings are the ones read");
  assert.equal(compileMap(outer, { maps }).issuePolicy.asks, true);
  // Without the store's maps nothing can be resolved — what main.cjs used to see.
  assert.equal(issuePolicyFor(outer).asks, false);

  // Only a brain Agent issues actually feeds counts.
  const aside = normalizeMap({
    id: "aside", name: "Aside", grants: ["read-project", "create-task"],
    nodes: [makeNode("issue.intake", { id: "i" }), makeNode("user.request", { id: "u" }), makeNode("brain.call", { id: "c", config: { map: "lane" } })],
    edges: [wire("e1", "u", "request", "c", "in")],
  });
  assert.equal(issuePolicyFor(aside, { maps: [lane, aside] }).triage, false);

  // Two maps that call each other are walked once each, and end.
  const ping = normalizeMap({ id: "ping", name: "Ping", nodes: [makeNode("issue.intake", { id: "i" }), makeNode("brain.call", { id: "c", config: { map: "pong" } })], edges: [wire("e1", "i", "issue", "c", "in")] });
  const pong = normalizeMap({ id: "pong", name: "Pong", nodes: [makeNode("brain.call", { id: "c", config: { map: "ping" } })], edges: [] });
  const ring = issuePolicyFor(ping, { maps: [ping, pong] });
  assert.deepEqual([ring.triage, ring.asks], [false, false]);

  // As deep as nesting may go, and no deeper.
  const chain = (depth) => {
    const list = [normalizeMap({ ...lane, id: `m${depth}` })];
    for (let level = depth - 1; level >= 0; level -= 1) {
      list.push(normalizeMap({ id: `m${level}`, name: `M${level}`, nodes: [makeNode("issue.intake", { id: "i" }), makeNode("brain.call", { id: "c", config: { map: `m${level + 1}` } })], edges: [wire("e1", "i", "issue", "c", "in")] }));
    }
    return issuePolicyFor(list.at(-1), { maps: list });
  };
  assert.equal(chain(MAX_NEST).asks, true);
  assert.equal(chain(MAX_NEST + 1).asks, false);
});

test("a map that starts workers but gives their questions nowhere to go says so", () => {
  const map = normalizeMap(defaultMap());
  const quiet = normalizeMap({ ...map, nodes: map.nodes.filter((node) => !["issue.triage", "ask.user"].includes(node.type)) });
  const warning = validateMap(quiet).problems.find((problem) => problem.code === "no-decision-lane");
  assert.ok(warning);
  assert.equal(warning.level, "warn");
  assert.equal(warning.nodeId, nodeOf(quiet, "work.dispatch").id);
  assert.match(warning.text, /Permission and risk questions would only be logged and would never reach you/);
  const noAsk = normalizeMap({ ...map, nodes: map.nodes.filter((node) => node.type !== "ask.user") });
  assert.match(validateMap(noAsk).problems.find((problem) => problem.code === "no-decision-lane").text, /no Ask you part/);
  // A map with no workers has nobody to ask on behalf of.
  const planning = normalizeMap({ ...quiet, nodes: quiet.nodes.filter((node) => node.type !== "work.dispatch") });
  assert.ok(!codes(validateMap(planning)).includes("no-decision-lane"));
  assert.ok(!codes(validateMap(map)).includes("no-decision-lane"));
});

test("only the wire that closes a loop is feedback; the rest keep their order", () => {
  const ring = normalizeMap({
    id: "ring", name: "Ring", grants: ["read-project", "message-user", "create-task", "close-task"],
    nodes: [makeNode("issue.intake", { id: "i" }), makeNode("issue.triage", { id: "t" }), makeNode("answer.apply", { id: "p" })],
    edges: [wire("e1", "i", "issue", "t", "issue"), wire("e2", "t", "answered", "p", "answer"), wire("e3", "p", "request", "i", "run")],
  });
  const compiled = compileMap(ring);
  assert.deepEqual(compiled.feedback, ["e3"], "not every wire in the ring");
  assert.deepEqual(compiled.order, ["i", "t", "p"]);
  assert.deepEqual(compiled.unordered, []);
  assert.equal(compileMap(defaultMap()).feedback.length, 1, "the shipped map's one declared feedback wire");
});

test("two wires never share an id, however they were saved", () => {
  const nodes = [makeNode("issue.intake", { id: "i" }), makeNode("issue.triage", { id: "t" }), makeNode("ask.user", { id: "a" }), makeNode("answer.apply", { id: "p" })];
  const map = normalizeMap({
    id: "dup", name: "Dup", nodes,
    edges: [
      wire("same", "i", "issue", "t", "issue"),
      wire("same", "t", "ask", "a", "ask"),
      wire("e_2", "a", "answer", "p", "answer"),
      { from: { node: "t", port: "answered" }, to: { node: "p", port: "answer" } },
    ],
  });
  assert.deepEqual(map.edges.map((edge) => edge.id), ["same", "e_2", "e_3", "e_4"]);
  assert.deepEqual(normalizeMap(map).edges.map((edge) => edge.id), ["same", "e_2", "e_3", "e_4"], "and a second pass keeps them");
});

test("Settle by itself keeps only kinds the assistant has an answer for", () => {
  const map = normalizeMap({ id: "k", name: "K", nodes: [makeNode("issue.triage", { id: "t", config: { auto: ["scope", "conflict", "blocked", "missing", "blocked", "permission", "nonsense"] } })], edges: [] });
  assert.deepEqual(map.nodes[0].config.auto, ["blocked"]);
  for (const kind of settingOf("issue.triage", "auto").default) assert.ok(issues.AUTO_ANSWERABLE.has(kind), kind);
});

test("only the settings the studio reads are marked wired", () => {
  const wired = NODE_TYPES.flatMap((type) => (type.settings ?? []).filter((setting) => setting.wired === true).map((setting) => `${type.type}.${setting.key}`));
  assert.deepEqual(wired.sort(), [
    "answer.apply.announce", "answer.apply.splitDepth", "ask.user.expireHours", "brain.call.map",
    "issue.intake.fromFailures", "issue.intake.perRun", "issue.triage.auto", "issue.triage.autoRetryLimit", "issue.triage.repeatAsks",
    "model.pick.mode", "work.dispatch.parallel",
  ]);
  assert.notEqual(settingOf("ask.user", "maxOpenAsks").wired, true, "open cards at once is not enforced");
  assert.ok(NODE_TYPES.every((type) => type.model?.wired !== true), "nothing reads a part's model block yet");
  // A note that says "Live" belongs to a part something really reads.
  for (const type of NODE_TYPES.filter((item) => /^Live/.test(item.hostNote))) {
    assert.ok((type.settings ?? []).some((setting) => setting.wired === true), `${type.type} claims Live`);
  }
  assert.ok(catalog().nodes.find((type) => type.type === "work.dispatch").settings.find((setting) => setting.key === "parallel").wired, "the catalog carries the mark to the editor");
});

// ---- live activity ----------------------------------------------------------------

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const option = (id, action, recommended = false) => ({ id, recommended, action: { kind: "issue", action } });
const scopeOptions = (recommend = "narrow") => [option("narrow", "narrow", recommend === "narrow"), option("split", "split", recommend === "split"), option("hold", "hold")];

function activityFixture() {
  const questions = [
    { id: "q1", at: NOW - 1 * HOUR, source: "issue", status: "answered", context: { issueKind: "scope" }, options: scopeOptions(), answer: { at: NOW - 0.8 * HOUR, optionId: "split" } },
    { id: "q2", at: NOW - 2 * HOUR, source: "issue", status: "answered", context: { issueKind: "scope" }, options: scopeOptions(), answer: { at: NOW - 1.5 * HOUR, optionId: "narrow", error: "This follow-up chain is 3 deep" } },
    // Asked before the window, answered inside it.
    { id: "q3", at: NOW - 30 * HOUR, source: "issue", status: "answered", context: { issueKind: "scope" }, options: scopeOptions("split"), answer: { at: NOW - 2 * HOUR, optionId: "split" } },
    { id: "q4", at: NOW - 3 * HOUR, source: "issue", status: "open", context: { issueKind: "permission" }, options: [] },
    // Ran out 12 hours ago (asked 60 hours ago, 48-hour expiry), and one long gone.
    { id: "q5", at: NOW - 60 * HOUR, source: "issue", status: "expired", context: { issueKind: "missing" }, options: [] },
    { id: "q6", at: NOW - 100 * HOUR, source: "issue", status: "expired", context: { issueKind: "missing" }, options: [] },
    { id: "q7", at: NOW - 1 * HOUR, source: "chat", status: "answered", options: [], answer: { at: NOW, optionId: "x" } },
    { id: "q8", at: NOW - 5 * HOUR, source: "issue", status: "dismissed", context: { issueKind: "conflict" }, options: scopeOptions(), answer: { at: NOW - 4 * HOUR, optionId: "hold" } },
  ];
  const tasks = [{
    id: "task_a",
    decisions: [
      { at: NOW - 1 * HOUR, kind: "verify", choice: "retry", text: "the assistant settled this: verify on attempt 1 of 2" },
      { at: NOW - 2 * HOUR, kind: "scope", choice: "split", text: "already answered on another card (q_1)" },
      { at: NOW - 1 * HOUR, kind: "scope", choice: "split", text: null },
      { at: NOW - 30 * HOUR, kind: "verify", choice: "retry", text: "the assistant settled this: long ago" },
    ],
    logs: [
      { at: NOW - 1 * HOUR, kind: "status", text: "verified — 2 recorded check(s) passed" },
      { at: NOW - 2 * HOUR, kind: "status", text: "unverified — outstanding obligations remain · retry 1/3" },
      { at: NOW - 3 * HOUR, kind: "status", text: "unverified — no evidence" },
      { at: NOW - 40 * HOUR, kind: "status", text: "verified — long ago" },
      { at: NOW - 1 * HOUR, kind: "status", text: "run finished (sentinel seen) — awaiting verification" },
    ],
  }];
  const executorRows = [
    { at: NOW - 1 * HOUR, event: "start" }, { at: NOW - 2 * HOUR, event: "start" }, { at: NOW - 30 * HOUR, event: "start" },
    { at: NOW - 1 * HOUR, event: "finish", ok: true }, { at: NOW - 2 * HOUR, event: "finish", ok: false },
    { at: NOW - 1 * HOUR, event: "release", reason: "Machine busy (111 MB available)" },
    { at: NOW - 2 * HOUR, event: "release", reason: "Machine busy (90 MB available)" },
    { at: NOW - 3 * HOUR, event: "release", reason: "Studio update waiting for current builds to finish" },
  ];
  return { questions, tasks, executorRows };
}

test("part activity counts the last day of the decision lane, dispatch and verification", () => {
  const { parts, windowMs, since } = partActivity({ ...activityFixture(), now: NOW });
  assert.equal(windowMs, 24 * HOUR);
  assert.equal(since, NOW - 24 * HOUR);
  assert.deepEqual(Object.keys(parts).sort(), ["answer.apply", "ask.user", "issue.intake", "issue.triage", "verify.evidence", "work.dispatch"]);

  const intake = parts["issue.intake"];
  assert.equal(intake.raised, 6);
  assert.deepEqual(intake.byKind, { scope: 3, permission: 1, conflict: 1, verify: 1 });
  assert.deepEqual(intake.headline, { label: "raised", count: 6 });

  const triage = parts["issue.triage"];
  assert.deepEqual([triage.settled, triage.asked, triage.folded], [1, 4, 1]);
  assert.ok(triage.lines.includes("1 settled by the assistant"));
  assert.ok(triage.lines.includes("1 folded into an earlier answer"));

  const ask = parts["ask.user"];
  assert.deepEqual(ask.headline, { label: "asked", count: 4 });
  assert.deepEqual([ask.open, ask.answered, ask.dismissed, ask.expired], [1, 3, 1, 1]);
  assert.deepEqual([ask.recommendedTaken, ask.recommendedOffered], [2, 4]);
  assert.ok(ask.lines.includes("Recommended option taken 2 of 4"));

  const apply = parts["answer.apply"];
  assert.deepEqual(apply.headline, { label: "split", count: 2 });
  assert.deepEqual(apply.byVerb, { split: 2, narrow: 1, hold: 1 });
  assert.equal(apply.notApplied, 1, "an answer the host refused is counted");

  const dispatch = parts["work.dispatch"];
  assert.deepEqual([dispatch.starts, dispatch.finishes, dispatch.failed, dispatch.releases], [2, 2, 1, 3]);
  assert.deepEqual(dispatch.topRelease, { reason: "Machine busy", count: 2 }, "live numbers do not split one cause");
  assert.match(dispatch.lines.at(-1), /3 released — most often: Machine busy \(2\)/);

  assert.deepEqual([parts["verify.evidence"].verified, parts["verify.evidence"].unverified], [1, 2]);
});

test("part activity reads no clock and dates an expired card by the map's expiry", () => {
  assert.deepEqual(partActivity({ ...activityFixture() }).parts, {}, "no now, no counts");
  const fixture = activityFixture();
  // With a 12-hour expiry the card asked 60 hours ago ran out two days ago.
  assert.equal(partActivity({ ...fixture, now: NOW, expireHours: 12 }).parts["ask.user"].expired, 0);
  assert.equal(partActivity({ ...fixture, now: NOW, expireHours: 48 }).parts["ask.user"].expired, 1);
  // A wider window takes in the older rows.
  assert.equal(partActivity({ ...fixture, now: NOW, windowMs: 48 * HOUR }).parts["work.dispatch"].starts, 3);
  const empty = partActivity({ now: NOW });
  assert.deepEqual(empty.parts["answer.apply"].headline, { label: "applied", count: 0 });
  assert.equal(empty.parts["work.dispatch"].topRelease, null);
});
