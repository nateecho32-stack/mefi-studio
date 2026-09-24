// The Command view's visual layer: backdrop scenes that follow the colour
// theme (or an explicit override), the speech bubbles agents wear while they
// work, the foreman's hand-out packet, the per-role glyph painter the rail and
// the Command view share, and the Done tab's plain Clear (the absorb flight
// belongs to the nodes, not the tab). Sections of idle.js and tree3d.js are
// evaluated in a vm with a recording canvas, so no Electron or real DOM is
// needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const idle = await readFile(new URL("../renderer/idle.js", import.meta.url), "utf8");
const tree = await readFile(new URL("../renderer/tree3d.js", import.meta.url), "utf8");
const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../renderer/styles.css", import.meta.url), "utf8");

function section(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing section ${start}`);
  return source.slice(a, b);
}
// `const` bindings of an evaluated section live in the context's lexical
// scope, not on the context object: read them by name inside the context.
const read = (env, name) => vm.runInContext(name, env);
const plain = (value) => JSON.parse(JSON.stringify(value));

const hexToRgb = (hex) => {
  const value = String(hex).replace("#", "");
  const int = parseInt(value.length === 3 ? value.split("").map((char) => char + char).join("") : value, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
};
const rgb = (triple) => `rgb(${triple.join(",")})`;
const rgba = (triple, alpha) => `rgba(${triple.join(",")},${alpha})`;
const NODE_RGB = { session: [236, 229, 216], warm: [230, 201, 141], done: [104, 236, 164], pending: [138, 128, 108], dust: [157, 183, 255], live: [87, 255, 154], assistant: [230, 201, 141], amber: [255, 212, 121] };

// A canvas context that records every call and answers the few reads the
// painters make (text metrics, gradients); property writes are accepted.
function recordingContext() {
  const calls = [];
  const noop = () => {};
  return new Proxy({}, {
    get(_target, name) {
      if (name === "calls") return calls;
      if (name === "measureText") return (text) => ({ width: String(text).length * 6 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop: noop });
      if (typeof name === "string") return (...args) => { calls.push([name, ...args]); };
      return undefined;
    },
    set() { return true; },
  });
}

function speechFixture({ bubbles = true } = {}) {
  let now = 100000;
  const stores = new Map();
  const state = { bubbles, speech: new Map(), speechRects: [], hoverSpeech: null, deferred: [], backdrop: "follow", themeKey: "aurora", nodes: [], pulses: [] };
  const env = vm.createContext({
    state, Math, String, Array, JSON, RegExp, Number, Boolean, console,
    Date: class extends Date { static now() { return now; } },
    el: {},
    writeStore: (key, value) => stores.set(key, value),
    readStore: (key) => stores.get(key) ?? null,
    assistantNode: () => state.nodes.find((node) => node.kind === "assistant") ?? null,
    agentHex: () => "#8fd0ff",
  });
  vm.runInContext(section(idle, "  // Backdrop scenes: the sky behind", "  const ROTATE_SPEED"), env);
  vm.runInContext(section(idle, "  // ---------- speech bubbles, deferred effects ----------", "  // ---------- graph helpers ----------"), env);
  return { env, state, stores, tick: (ms) => { now += ms; return now; }, now: () => now };
}

test("the backdrop follows the colour theme unless an override is saved", () => {
  const { env, state, stores } = speechFixture();
  assert.equal(env.activeBackdrop(), "aurora");
  state.themeKey = "ember";
  assert.equal(env.activeBackdrop(), "embers");
  state.themeKey = "midnight";
  assert.equal(env.activeBackdrop(), "deepspace");
  state.themeKey = "something-new";
  assert.equal(env.activeBackdrop(), "dust", "an unknown theme still gets a sky");
  assert.equal(env.setBackdrop("grid"), "grid");
  assert.equal(stores.get("mefiStudio.cmdBackdrop"), "grid", "the override is remembered");
  state.themeKey = "aurora";
  assert.equal(env.activeBackdrop(), "grid", "an override beats the theme");
  assert.equal(env.setBackdrop("bogus"), "aurora", "an unknown key falls back to following the theme");
  assert.equal(state.backdrop, "follow");
  const backdrops = plain(read(env, "BACKDROPS"));
  for (const scene of Object.values(plain(read(env, "THEME_BACKDROP")))) assert.ok(backdrops[scene], `theme scene ${scene} is a real backdrop`);
  assert.deepEqual(plain(read(env, "BACKDROP_ORDER")).sort(), Object.keys(backdrops).sort(), "the picker lists every scene once");
});

test("the Void collection's themes each follow their own sky, and the rail draws its node styles without per-frame paints", () => {
  const { env, state } = speechFixture();
  const backdrops = plain(read(env, "BACKDROPS"));
  for (const [theme, scene] of Object.entries({ void: "deepspace", eclipse: "dust", abyss: "fireflies", dusk: "grid" })) {
    assert.equal(plain(read(env, "THEME_BACKDROP"))[theme], scene);
    assert.ok(backdrops[scene], `${theme} maps to a real backdrop`);
    state.themeKey = theme;
    assert.equal(env.activeBackdrop(), scene);
  }
  const branches = section(tree, 'nodeStyle === "singularity"', 'nodeStyle === "glass"');
  for (const style of ["singularity", "prism", "sigil"]) assert.ok(branches.includes(`nodeStyle === "${style}"`), `the tree rail draws ${style}`);
  for (const allocation of ["createRadialGradient", "createLinearGradient", "Array.from", ".filter(", ".map("]) assert.ok(!branches.includes(allocation), `the rail's premium branches avoid ${allocation} per node`);
});

// The rail's Void branches, evaluated with the helpers they close over. Each
// call paints one node the way tree3d.js's frame loop does.
function railPainter() {
  const pieces = section(tree, "  // The Void collection's node styles (gated in music.js)", "  function colorOf(node) {");
  const chain = section(tree, '      } else if (nodeStyle === "singularity") {', '      } else if (nodeStyle === "glass") {');
  const window = { MefiMusic: { themePalette: () => ({ canvas: { accent2: "#36d1ff" } }) } };
  return new Function("window", "COLORS", `
    let ctx = null;
    ${pieces}
    return {
      shapes: VOID_SHAPES,
      paint(target, nodeStyle, { p = { x: 50, y: 50 }, radius = 8, color = "#b9b0ff", working = false, selected = false, isAgent = false, time = 1000 } = {}) {
        ctx = target; const visibility = 1;
        if (false) {
        ${chain}
        }
      },
    };
  `)(window, { active: "#c9a86a" });
}

test("the rail's Void styles reuse their paints frame to frame and cut the Command view's shapes", () => {
  const rail = railPainter();
  assert.ok(tree.includes("voidShapes: VOID_SHAPES"), "the tree hands its Void shapes to the Command view");
  for (const copy of ["const PRISM_RIM", "const SIGIL_MARKS", "function tracePoints(", "function tracePolygon("]) {
    assert.ok(!idle.includes(copy) && !tree.includes(copy), `no second copy of ${copy} survives`);
  }
  assert.ok(Object.isFrozen(rail.shapes), "the shared shapes cannot be edited by either painter");
  for (const style of ["singularity", "prism", "sigil"]) {
    const counts = { gradients: 0, lineTo: 0 };
    const target = new Proxy({}, {
      get(_target, name) {
        if (name === "createRadialGradient" || name === "createConicGradient" || name === "createLinearGradient") return () => { counts.gradients += 1; return { addColorStop() {} }; };
        if (name === "lineTo") return () => { counts.lineTo += 1; };
        return typeof name === "string" ? () => {} : undefined;
      },
      set() { return true; },
    });
    for (const [time, working] of [[1000, true], [1016, true], [1032, false], [1048, false]]) rail.paint(target, style, { radius: 12, working, time });
    const settled = counts.gradients;
    for (const [time, working] of [[1064, true], [1080, false], [1096, true]]) rail.paint(target, style, { radius: 12, working, time, p: { x: 90, y: 20 } });
    assert.equal(counts.gradients, settled, `${style} builds its paints once and reuses them on later frames`);
    if (style !== "singularity") assert.ok(counts.lineTo > 0, `${style} traces the shared shapes`);
  }
});

test("speech bubbles: one per node, repeats refresh, a cap, expiry, and the pointer holds one up", () => {
  const { env, state, tick, now } = speechFixture();
  const agent = { id: "__agent__:watcher", kind: "agent", role: "watcher" };
  const first = env.say(agent, "scanning the sessions");
  assert.equal(state.speech.size, 1);
  tick(500);
  const again = env.say(agent, "scanning the sessions");
  assert.equal(again, first, "the same remark only refreshes the clock");
  assert.equal(first.at, now());
  const changed = env.say(agent, "found 3 stale sessions", { kind: "send" });
  assert.notEqual(changed, first, "a new remark replaces the bubble");
  assert.equal(state.speech.size, 1);
  assert.equal(state.speech.get(agent.id).kind, "send");
  const SPEECH_MAX = read(env, "SPEECH_MAX"), SPEECH_TTL = read(env, "SPEECH_TTL");
  for (let index = 0; index < 9; index += 1) { tick(10); env.say({ id: `node:${index}` }, `remark ${index}`); }
  assert.equal(state.speech.size, SPEECH_MAX, "the oldest bubbles yield to the cap");
  assert.equal(state.speech.has(agent.id), false, "the agent's older bubble was the one to go");
  tick(SPEECH_TTL + 1);
  env.stepSpeech(now());
  assert.equal(state.speech.size, 0, "bubbles expire on the frame clock");
  env.say(agent, "hover me");
  state.hoverSpeech = agent.id;
  tick(SPEECH_TTL * 3);
  env.stepSpeech(now());
  assert.equal(state.speech.has(agent.id), true, "a bubble under the pointer stays up");
  state.hoverSpeech = null;
  tick(SPEECH_TTL * 3);
  env.stepSpeech(now());
  assert.equal(state.speech.size, 0);
  env.say(agent, "later", { delay: 300 });
  assert.equal(state.speech.size, 0);
  assert.equal(state.deferred.length, 1, "a delayed remark waits on the deferred queue");
  env.stepDeferred(now() + 100);
  assert.equal(state.speech.size, 0, "not before its time");
  env.stepDeferred(now() + 300);
  assert.equal(state.speech.get(agent.id)?.text, "later");
  assert.equal(state.deferred.length, 0);
});

test("speech bubbles stay silent when the switch is off", () => {
  const { env, state, stores } = speechFixture({ bubbles: false });
  assert.equal(env.say({ id: "x" }, "hello"), null);
  assert.equal(state.speech.size, 0);
  assert.equal(env.setBubbles(true), true);
  assert.equal(stores.get("mefiStudio.cmdBubbles"), "1");
  env.say({ id: "x" }, "hello");
  assert.equal(state.speech.size, 1);
  env.setBubbles(false);
  assert.equal(state.speech.size, 0, "turning bubbles off clears what was up");
});

test("agentRemark drops the role prefix the host puts on every line", () => {
  const { env } = speechFixture();
  assert.equal(env.agentRemark('watcher · scanned "Swamp biome"', "watcher"), 'scanned "Swamp biome"');
  assert.equal(env.agentRemark("auditor done · 3 findings · 1.2 s", "auditor"), "3 findings · 1.2 s");
  assert.equal(env.agentRemark("cluster-planner running · planning the focused task", "cluster-planner"), "planning the focused task");
  assert.equal(env.agentRemark("nothing to strip", "keeper"), "nothing to strip");
  assert.equal(env.agentRemark("x".repeat(400), null).length, 160, "remarks are bounded");
});

test("speechLines wraps a remark to two lines and clips the second", () => {
  const { env } = speechFixture();
  const ctx = recordingContext();
  assert.deepEqual(plain(env.speechLines(ctx, "short", 120)), ["short"]);
  const lines = env.speechLines(ctx, "one two three four five six seven eight nine", 60);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"), "the clipped tail says so");
  for (const line of lines) assert.ok(ctx.measureText(line).width <= 60, `${line} fits the width`);
});

test("a builder starting is the foreman handing work out, said on both ends", () => {
  const { env, state, now } = speechFixture();
  const hub = { id: "__assistant__", kind: "assistant" };
  const foreman = { id: "__agent__:foreman", kind: "agent", role: "foreman" };
  const builder = { id: "builder:t1", kind: "agent", role: "builder", builder: true, job: { title: 'Work on "Swamp biome rename"' } };
  state.nodes = [hub, foreman, builder];
  env.announceHandout(builder);
  assert.equal(state.pulses.length, 1);
  assert.equal(state.pulses[0].from, foreman);
  assert.equal(state.pulses[0].to, builder);
  assert.equal(state.pulses[0].packet, true, "a hand-out carries cargo");
  assert.equal(state.speech.get(foreman.id)?.kind, "send");
  assert.match(state.speech.get(foreman.id)?.text, /^handed out "Swamp biome rename"/);
  assert.equal(state.speech.has(builder.id), false, "the builder answers once the packet lands");
  env.stepDeferred(now() + 900);
  assert.equal(state.speech.get(builder.id)?.kind, "receive");
  state.nodes = [hub, builder];
  state.pulses = [];
  env.announceHandout(builder);
  assert.equal(state.pulses[0].from, hub, "with no foreman on the ring the hub hands out");
});

test("the Done tab has no absorb of its own: Clear is a plain host call and the rows never fly", () => {
  const doneTab = section(idle, "  // Clear: the host wipes the finish rows", "  // The Ask cards:");
  for (const gone of ["absorbing", "--absorb-dx", "hubSwellAt", "assistantAbsorbDoneLog", "recordAbsorbed", "absorbTarget"]) {
    assert.ok(!idle.includes(gone), `idle.js no longer carries ${gone}`);
  }
  assert.ok(doneTab.includes("assistantClearDoneLog"), "Clear reaches the host");
  assert.ok(!doneTab.includes("state.pulses.push"), "no packets leave the Done tab");
  assert.ok(!styles.includes("done-absorb") && !styles.includes("absorb-pull"), "the Done-tab flight styles are gone");
  assert.ok(template.includes('id="cmd-done-clear"') && !template.includes("cmd-done-absorb"), "the template offers Clear, not Absorb");
  // The node absorb is untouched: finished work still collapses into its host.
  for (const kept of ["function markAbsorb(id)", "function finalizeAbsorb(id, fx)", "NODE_ABSORB_MS"]) assert.ok(idle.includes(kept), `idle.js keeps ${kept}`);
});

test("every agent role has its own glyph and the painter draws it", () => {
  const env = vm.createContext({ Math, String, Number, parseInt });
  vm.runInContext(section(tree, "  const AGENT_COLORS = {", "  // HSL -> #rrggbb"), env);
  vm.runInContext(section(tree, "  const AGENT_GLYPHS = {", "  const AGENT_RING = 34;"), env);
  const roles = Object.keys(plain(read(env, "AGENT_COLORS")));
  assert.ok(roles.length >= 15);
  const kinds = new Set();
  for (const role of roles) {
    const kind = env.agentGlyphKind(role);
    kinds.add(kind);
    if (role !== "thinker") assert.notEqual(kind, "spark", `${role} has a glyph of its own`);
    const ctx = recordingContext();
    env.agentGlyph(ctx, role, 10, 10, 6, "#0b1016");
    const names = ctx.calls.map(([name]) => name);
    assert.ok(names.includes("save") && names.includes("restore"), `${role} leaves the context as it found it`);
    assert.ok(names.some((name) => ["moveTo", "arc", "rect", "lineTo"].includes(name)), `${role} draws a shape`);
  }
  assert.equal(kinds.size, roles.length, "no two roles share a glyph");
  assert.equal(env.agentGlyphKind("brand-new-role"), "spark");
  assert.equal(env.glyphInk("#ffd27f"), "#0b1016", "dark ink on a bright body");
  assert.equal(env.glyphInk("#1a2030"), "#f3f6fa", "light ink on a dim body");
  assert.equal(env.glyphInk("nope"), "#0b1016");
});

test("every backdrop scene paints, in motion and in the still frame", () => {
  const { env, state } = speechFixture();
  const ctx = recordingContext();
  Object.assign(env, {
    el: { width: 1280, height: 800, ctx },
    NODE_RGB, rgb, rgba, hexToRgb,
    project: () => ({ x: 640, y: 400, k: 1, depth: 500 }),
    STAR_LAYERS: [{ count: 52, seed: 11.3, spin: 0.012, tempo: 3400, size: 0.7, alpha: 0.22 }, { count: 18, seed: 47.7, spin: 0.03, tempo: 2500, size: 1, alpha: 0.28 }],
  });
  state.canvasPalette = { background: "#050d13", accent: "#71cbb7" };
  state.angle = 0.3;
  vm.runInContext(section(idle, "  // ---------- backdrop scenes ----------", "  function drawFrame(time) {"), env);
  const bands = { bass: 0.1, mid: 0.1, treble: 0.1 };
  for (const scene of plain(read(env, "BACKDROP_ORDER")).filter((key) => key !== "follow")) {
    state.backdrop = scene;
    const before = ctx.calls.length;
    env.drawBackdrop(ctx, 5000, false, 0.2, bands, 0);
    const fills = ctx.calls.slice(before).filter(([name]) => name === "fillRect" || name === "fill").length;
    assert.ok(fills >= 3, `${scene} paints (${fills} fills)`);
    assert.equal(ctx.calls.slice(before)[0][0], "clearRect", `${scene} starts from a clear canvas`);
    env.drawBackdrop(ctx, 5000, true, 0, { bass: 0, mid: 0, treble: 0 }, 0);
  }
  state.backdrop = "follow";
  state.themeKey = "violet";
  assert.equal(env.activeBackdrop(), "nebula");
});

test("the HUD, the stylesheet and the public API carry the new controls", () => {
  for (const id of ["idle-backdrop", "idle-bubbles", "idle-chat-absorbed", "idle-chat-absorbed-list"]) assert.ok(template.includes(`id="${id}"`), `template has #${id}`);
  for (const selector of ['.sw[data-sw="speech"]', '.sw[data-sw="packet"]', '.sw[data-sw="trail"]', ".absorbed-row", "#idle-hud .feed-absorbed"]) assert.ok(styles.includes(selector), `styles have ${selector}`);
  for (const marker of ["setBackdrop,", "setBubbles,", "backdropStatus:", "speechStatus:", "absorbedStatus:", '{ key: "speech"', '{ key: "packet"', '{ key: "trail"', "drawAgentDress(ctx, node, p, radius, tint, time, still)", "drawHubDress(ctx, node, p, radius, tint, time, still)", "drawSpeech(projected)", "drawBackdrop(ctx, time, still, energy, musicBands, musicBeat)"]) {
    assert.ok(idle.includes(marker), `idle.js carries ${marker}`);
  }
  for (const marker of ["agentGlyph,", "agentGlyphKind,", "glyphInk,", 'event.kind === "intel"', "pulse.packet"]) assert.ok(tree.includes(marker), `tree3d.js carries ${marker}`);
});

// ---------- callouts and focus ----------
const rectsOverlap = (rect, other) => rect.x < other.x + other.w && rect.x + rect.w > other.x && rect.y < other.y + other.h && rect.y + rect.h > other.y;

function calloutFixture({ nodes = [], area = { x: 0, y: 0, w: 1200, h: 800 } } = {}) {
  let now = 50000;
  const stores = new Map();
  const calls = [];
  const state = {
    nodes, speech: new Map(), callouts: new Map(), calloutRects: [], hoverCallout: null, selected: null, focus: null, focusRestore: null, focusIds: null,
    labels: "auto", cardStyle: "auto", assistant: { rosterRunning: 2, rosterQueued: 1 }, orbit: "paused", view: "3d", zoom: 1,
    camera: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }, settleUntil: 0, canvasPalette: null, allTasks: [],
  };
  const env = vm.createContext({
    state, calls, Math, String, Array, Number, Boolean, Map, Set, JSON, console,
    Date: class extends Date { static now() { return now; } },
    window: { MefiTree: { assistantSummary: () => ({ sublabel: "5 working" }) } },
    el: { far: { classList: { toggle(name, on) { calls.push(["far", name, on]); } } }, farCtx: {} },
    NODE_RGB, rgb, rgba, hexToRgb,
    measure: (_ctx, _font, text) => String(text).length * 6,
    blocked: (rect, list) => list.some((other) => rectsOverlap(rect, other)),
    overlaps: rectsOverlap,
    nodeLabelBlocker: (projected) => (surface, self) => projected.some(({ node, p }) => node !== self && p && p.x >= surface.x - (node._pr ?? 4) && p.x <= surface.x + surface.w + (node._pr ?? 4) && p.y >= surface.y - (node._pr ?? 4) && p.y <= surface.y + surface.h + (node._pr ?? 4)),
    hudRects: () => [], usableArea: () => area, noMotion: () => false,
    emphasis: () => 1, colorOf: () => [230, 201, 141], agentRgb: () => [143, 208, 255], agentHex: () => "#8fd0ff",
    todosOf: (id) => nodes.filter((node) => node.kind === "todo" && node.sessionId === id),
    childrenOf: (id) => nodes.filter((node) => (node.kind === "todo" && node.sessionId === id) || (node.kind === "task" && node.anchorSessionId === id)),
    assistantNode: () => nodes.find((node) => node.kind === "assistant") ?? null,
    agoLabel: () => "3m ago",
    selectNode: (node) => { state.selected = node ? { id: node.id, kind: node.kind, node } : null; calls.push(["select", node?.id ?? null]); },
    setCamMode: (mode) => { state.camMode = mode; },
    focusOn: (node) => { state.camera.tx = -node.x; state.camera.ty = -node.y; state.camera.tz = -node.z; },
    setZoom: (value) => { state.zoom = value; state.zoomTarget = null; },
    glideZoom: (value) => { state.zoomTarget = value; },
    autoFit: () => { calls.push(["autoFit"]); },
    setOrbit: (mode) => { state.orbit = mode === "auto" || mode === true ? "auto" : "paused"; calls.push(["orbit", state.orbit]); },
    writeStore: (key, value) => stores.set(key, value), readStore: (key) => stores.get(key) ?? null,
  });
  vm.runInContext(section(idle, "  // Backdrop scenes: the sky behind", "  const ROTATE_SPEED"), env);
  vm.runInContext(section(idle, "  // ---------- speech bubbles, deferred effects ----------", "  // ---------- graph helpers ----------"), env);
  vm.runInContext(section(idle, "  // ---------- callouts: leader, top bar, title row, thought bubble ----------", "  function drawFrame(time) {"), env);
  return { env, state, calls, stores, tick: (ms) => { now += ms; return now; }, now: () => now };
}

test("a callout's leader climbs at seventy degrees into a horizontal top bar on the chosen side", () => {
  const { env } = calloutFixture();
  const node = { id: "task:a", kind: "task", _pr: 10 };
  const size = { w: 160, title: "t", lines: [], bubbleH: 0 };
  const angle = read(env, "CALLOUT_ANGLE");
  for (const [side, vert] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    const layout = env.calloutLayout(node, { x: 300, y: 400 }, { side, vert, length: 74 }, size);
    const slope = Math.abs((layout.ey - layout.sy) / (layout.ex - layout.sx));
    assert.ok(Math.abs(slope - Math.tan(angle)) < 1e-9, `leader slope is tan(70°) for side ${side}, vert ${vert}`);
    assert.equal(Math.sign(layout.ex - layout.sx), side, "the leader leaves toward the chosen side");
    assert.equal(Math.sign(layout.ey - layout.sy), vert, "and up or down as asked");
    assert.equal(layout.rect.x, side > 0 ? layout.ex : layout.ex - size.w, "the bar starts where the leader ends and runs outward");
    assert.equal(layout.rect.y + read(env, "CALLOUT_TITLE_H") + 3, layout.ey, "the title row sits just above the bar");
    assert.equal(layout.bubble, null, "no thoughts, no bubble");
  }
  const bubbled = env.calloutLayout(node, { x: 300, y: 400 }, { side: 1, vert: -1, length: 74 }, { ...size, bubbleH: 37 });
  assert.equal(bubbled.bubble.y, bubbled.ey + 4, "the bubble hangs below the bar");
});

test("placement routes around orbs and cards, holds a blocked spot for a beat, then steps aside", () => {
  const { env, state, tick, now } = calloutFixture();
  const node = { id: "task:a", kind: "task", _pr: 8 };
  const obstacle = { id: "s", kind: "session", _pr: 6 };
  const projected = [{ node, p: { x: 300, y: 400, k: 1 } }, { node: obstacle, p: { x: 312, y: 372, k: 1 } }];
  const size = { w: 150, title: "t", lines: [], bubbleH: 0 };
  const hits = env.nodeLabelBlocker(projected);
  const area = env.usableArea();
  const first = env.placeCallout(node, projected[0].p, size, projected, [], [], hits, area, now());
  assert.ok(first, "a clean candidate exists");
  assert.ok(!(first.side === 1 && first.vert === -1), "the up-right leader would run through the orb, so another side wins");
  assert.equal(state.callouts.get("task:a").blockedSince, null);
  const chosen = { side: first.side, vert: first.vert, length: first.length };
  const again = env.placeCallout(node, projected[0].p, size, projected, [], [], hits, area, tick(16));
  assert.deepEqual({ side: again.side, vert: again.vert, length: again.length }, chosen, "a clean placement is kept from frame to frame");
  const everything = [{ x: -5000, y: -5000, w: 10000, h: 10000 }];
  const held = env.placeCallout(node, projected[0].p, size, projected, everything, [], hits, area, tick(16));
  assert.deepEqual({ side: held.side, vert: held.vert, length: held.length }, chosen, "a spot that just got blocked is held");
  const gone = env.placeCallout(node, projected[0].p, size, projected, everything, [], hits, area, tick(400));
  assert.equal(gone, null, "past the hold the card steps aside instead of overlapping");
  const dirty = env.placeCallout(node, projected[0].p, size, projected, everything, [], hits, area, tick(16), true);
  assert.ok(dirty, "the card the user is on may take the least-bad spot");
  const stranger = { id: "task:b", kind: "task", _pr: 8 };
  assert.equal(env.placeCallout(stranger, { x: 600, y: 300 }, size, projected, everything, [], hits, area, now()), null, "a new card with nowhere clean to go does not appear");
});

test("callout content carries the number, the mark and the done/left counts, and detail only when rich", () => {
  const todos = [
    { id: "s1:0", kind: "todo", sessionId: "s1", state: "done" },
    { id: "s1:1", kind: "todo", sessionId: "s1", state: "done" },
    { id: "s1:2", kind: "todo", sessionId: "s1", state: "pending" },
  ];
  const session = { id: "s1", kind: "session", label: "Swamp biome rename", ordinal: "S1", agent: "opencode", model: "deepseek", updated: 1, state: "active" };
  const task = { id: "task:t", kind: "task", label: "Retune", ordinal: "T2", task: { status: "awaiting_verification", prompt: "Do the thing carefully" }, _workLabel: "Verifying" };
  const running = { id: "task:r", kind: "task", label: "Wire", ordinal: "T1", task: { status: "active" }, _workLabel: "Running", progress: 0.55 };
  const hub = { id: "__assistant__", kind: "assistant", label: "Assistant" };
  const agent = { id: "__agent__:watcher", kind: "agent", role: "watcher", status: "running", text: 'watcher · scanned "Swamp"', targetNode: session };
  const { env, state } = calloutFixture({ nodes: [session, ...todos, task, running, hub, agent] });
  const quiet = env.calloutContent(session);
  assert.equal(quiet.number, "S1");
  assert.equal(quiet.counts, "2 done · 1 left");
  assert.equal(quiet.mark, "live");
  assert.equal(quiet.lines.length, 1, "the agent on it speaks even at rest");
  assert.match(quiet.lines[0].text, /^watcher · scanned/);
  todos[2].state = "done";
  assert.equal(env.calloutContent(session).mark, "check", "all todos done earns the check");
  const verifying = env.calloutContent(task);
  assert.equal(verifying.number, "T2");
  assert.equal(verifying.counts, "verifying");
  assert.equal(verifying.mark, "verify");
  assert.equal(verifying.lines.length, 0, "a prompt is detail: not at rest");
  assert.equal(env.calloutContent(task, { rich: true }).lines[0].text, "Do the thing carefully");
  assert.equal(env.calloutContent(running).counts, "55%");
  const hubCard = env.calloutContent(hub);
  assert.equal(hubCard.title, "Assistant");
  assert.equal(hubCard.counts, "2 working · 1 queued");
  assert.equal(hubCard.mark, "hub");
  assert.equal(hubCard.number, null);
  assert.equal(env.calloutContent(hub, { rich: true }).lines[0].text, "5 working");
  state.speech.set("task:r", { text: "on it: wiring", kind: "receive" });
  assert.deepEqual(plain(env.calloutContent(running).lines[0]), { text: "on it: wiring", kind: "receive" }, "a bubble the node is showing becomes the card's thought");
});

test("every relationship gets its own line style and the active path marches", () => {
  const env = vm.createContext({ Boolean });
  vm.runInContext(section(idle, "  // One look per relationship", "  function drawGraphConnectionsImpl("), env);
  const a = (kind) => ({ node: { kind } });
  assert.equal(env.edgeStyleFor({}, a("root"), a("assistant")).double, true, "the hub link is doubled");
  assert.equal(env.edgeStyleFor({ assistant: true }, a("session"), a("agent")).kind, "hub");
  const task = env.edgeStyleFor({ task: true }, a("session"), a("task"), { active: true });
  assert.deepEqual(plain(task.dash), [2, 4]);
  assert.equal(task.march, true);
  assert.equal(env.edgeStyleFor({}, a("session"), a("task")).march, false);
  const done = env.edgeStyleFor({}, a("session"), { node: { kind: "todo", state: "done" } });
  assert.equal(done.kind, "todo"); assert.equal(done.alpha, 0.3);
  assert.deepEqual(plain(env.edgeStyleFor({}, a("root"), a("folded")).dash), [1, 5]);
  assert.equal(env.edgeStyleFor({}, a("root"), a("session")).kind, "session");
});

test("focus closes in by kind, turns the tree slowly, and lets go of the orbit it borrowed", () => {
  const session = { id: "s1", kind: "session", x: 100, y: 0, z: 40 };
  const todo = { id: "s1:0", kind: "todo", sessionId: "s1", x: 120, y: 30, z: 40 };
  const task = { id: "task:t", kind: "task", anchorSessionId: "s1", x: 200, y: 0, z: 0 };
  const hub = { id: "__assistant__", kind: "assistant", x: 0, y: -110, z: 0 };
  const root = { id: "__root__", kind: "root", x: 0, y: -40, z: 0 };
  const watcher = { id: "__agent__:watcher", kind: "agent", role: "watcher", targetNode: session, x: 0, y: 0, z: 0 };
  const builder = { id: "builder:t", kind: "agent", role: "builder", builder: true, hostId: "task:t", x: 0, y: 0, z: 0 };
  const idleAgent = { id: "__agent__:keeper", kind: "agent", role: "keeper", x: 0, y: 0, z: 0 };
  const { env, state, calls } = calloutFixture({ nodes: [session, todo, task, hub, root, watcher, builder, idleAgent] });
  assert.equal(env.enterFocus(task), true);
  assert.equal(state.focus.id, "task:t");
  assert.equal(state.zoomTarget, 2.4, "a task is framed close, as a glide the frame loop eases toward rather than a snap");
  assert.equal(state.zoom, 1, "the scale itself does not move on the click");
  assert.equal(state.orbit, "auto", "focus turns the tree even though Orbit was paused");
  assert.deepEqual(plain(state.focusRestore), { orbit: "paused" });
  assert.equal(state.selected.id, "task:t");
  assert.deepEqual(plain(state.camera).tx, -200, "the camera centres the node");
  assert.deepEqual([...env.focusSetFor(task)].sort(), ["builder:t", "s1", "task:t"], "a task keeps its anchor and its builder sharp");
  env.enterFocus(session);
  assert.equal(state.zoomTarget, 1.7, "a parent is framed wider so its children stay in view");
  assert.deepEqual([...env.focusSetFor(session)].sort(), ["__agent__:watcher", "builder:t", "s1", "s1:0", "task:t"], "a session keeps its todos, its anchored tasks and every agent on any of them");
  assert.deepEqual([...env.focusSetFor(hub)].sort(), ["__agent__:keeper", "__agent__:watcher", "__assistant__", "__root__"], "the hub keeps its crew and the root");
  assert.deepEqual([...env.focusSetFor(watcher)].sort(), ["__agent__:watcher", "__assistant__", "s1"], "an agent keeps the hub and the node it works on");
  assert.deepEqual([...env.splitIds()].sort(), ["__agent__:watcher", "builder:t", "s1", "s1:0", "task:t"]);
  state.hoverCallout = "__assistant__";
  assert.ok(env.splitIds().has("__root__"), "a hovered card joins the sharp set");
  env.syncFarLayer(env.splitIds());
  assert.deepEqual(calls.filter(([kind]) => kind === "far").slice(-2), [["far", "focused", true], ["far", "soft", false]]);
  assert.equal(env.exitFocus(), true);
  assert.equal(state.focus, null);
  assert.equal(state.orbit, "paused", "the borrowed orbit goes back");
  assert.equal(state.focusRestore, null);
  assert.equal(env.exitFocus(), false);
  state.hoverCallout = null;
  assert.equal(env.splitIds(), null, "nothing focused or hovered means nothing goes to the far layer");
});

test("letting go of a node brings the whole tree back into view", () => {
  // Empty canvas, Esc and the card's close button all release the node:
  // the selection and focus clear, the pan glides back to the origin and the
  // zoom glides to the fitted frame. With nothing held, a stray click on the
  // canvas leaves the camera where the user put it.
  const task = { id: "task:t", kind: "task", x: 200, y: 30, z: -40 };
  const { env, state, calls } = calloutFixture({ nodes: [task] });
  state.zoom = 1.3;
  state.camera.tx = -50; state.camera.ty = -20; state.camera.tz = 10;
  assert.equal(env.releaseNode(), false, "nothing to let go of");
  assert.deepEqual([state.camera.tx, state.camera.ty, state.camera.tz, state.zoomTarget ?? null], [-50, -20, 10, null], "a stray click keeps the user's camera");
  assert.ok(!calls.some(([kind]) => kind === "autoFit"), "no refit without a release");
  env.enterFocus(task);
  assert.deepEqual([state.camera.tx, state.camera.ty, state.camera.tz], [-200, -30, 40], "focus centres the node");
  assert.equal(state.zoomTarget, 2.4);
  assert.equal(env.releaseNode(), true);
  assert.equal(state.selected, null);
  assert.equal(state.focus, null);
  assert.deepEqual([state.camera.tx, state.camera.ty, state.camera.tz], [0, 0, 0], "the pan glides back to the origin");
  assert.equal(state.zoomTarget, 1, "the zoom glides back to the fitted frame");
  assert.ok(calls.some(([kind]) => kind === "autoFit"), "the fit is recomputed for the current window");
  assert.equal(state.orbit, "paused", "the borrowed orbit still goes back");
  const idleSrc = idle;
  for (const marker of ["else releaseNode();", "close.addEventListener(\"click\", () => releaseNode());", "if (state.focus || state.selected) {\n      releaseNode();"]) {
    assert.ok(idleSrc.replace(/\r\n/g, "\n").includes(marker), `idle.js carries ${marker}`);
  }
});

test("the orbit drifts slowly behind a focused node, where a plain selection would hold it", () => {
  // enterFocus switches Orbit to auto (and exitFocus puts the old setting
  // back), so while focused the tree turns at the drift rate even though a
  // selection alone would freeze it. A pause pressed during focus still wins.
  const state = { focus: { id: "task:t" }, view: "3d", orbit: "auto", selected: { id: "task:t" }, settleUntil: 0, ambientZen: false, camMode: "free", panning: null, rotating: null, query: "", reactive: false };
  const env = vm.createContext({ state, Date, Math, ORBIT_BASE: 0.003, ORBIT_ENERGY: 0.001, FOCUS_DRIFT: 0.55, noMotion: () => false });
  vm.runInContext(section(idle, "  function orbitTarget(", "  function computeBranch("), env);
  assert.ok(Math.abs(env.orbitTarget(0) - 0.003 * 0.55) < 1e-12, "focused: the slow drift");
  state.orbit = "paused";
  assert.equal(env.orbitTarget(0), 0, "a pause pressed during focus still holds");
  state.orbit = "auto"; state.focus = null;
  assert.equal(env.orbitTarget(0), 0, "a plain selection still holds the orbit");
  state.selected = null;
  assert.ok(env.orbitTarget(0) > 0.003 * 0.55, "without focus the normal orbit rate applies");
});

test("drawCallouts paints cards for the tree's work, keeps them apart, and makes them clickable", () => {
  const nodes = [
    { id: "__assistant__", kind: "assistant", label: "Assistant", _px: 600, _py: 200, _pr: 15, x: 0, y: -110, z: 0 },
    { id: "s1", kind: "session", label: "Swamp biome rename", ordinal: "S1", _px: 420, _py: 420, _pr: 11, x: 0, y: 0, z: 0 },
    { id: "s1:0", kind: "todo", sessionId: "s1", state: "done", _px: 440, _py: 470, _pr: 4, x: 0, y: 0, z: 0 },
    { id: "task:t", kind: "task", label: "Retune the dungeon theme pass", ordinal: "T1", task: { status: "active" }, _workLabel: "Running", _px: 780, _py: 460, _pr: 12, x: 0, y: 0, z: 0 },
    { id: "__agent__:watcher", kind: "agent", role: "watcher", status: "running", text: "watcher · scanning", _px: 500, _py: 300, _pr: 10, x: 0, y: 0, z: 0 },
    { id: "__agent__:keeper", kind: "agent", role: "keeper", status: "idle", text: "", _px: 650, _py: 260, _pr: 10, x: 0, y: 0, z: 0 },
  ];
  const { env, state } = calloutFixture({ nodes });
  const projected = nodes.map((node) => ({ node, p: { x: node._px, y: node._py, k: 1 } }));
  const near = recordingContext(), far = recordingContext();
  env.drawCallouts(projected, { near, far, focusIds: null });
  const cards = nodes.filter((node) => node._callout);
  assert.deepEqual(cards.map((node) => node.id).sort(), ["__agent__:watcher", "__assistant__", "s1", "task:t"], "sessions, tasks, the hub and working agents get cards; todos and idle agents do not");
  for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) assert.equal(rectsOverlap(cards[i]._callout.rect, cards[j]._callout.rect), false, `${cards[i].id} and ${cards[j].id} do not overlap`);
  assert.equal(state.calloutRects.length, cards.length);
  assert.ok(cards.every((node) => node._cardRect && node._cardRect.w > 100), "every card reports its rect for the debug API");
  assert.ok(near.calls.some(([name]) => name === "fillText"), "titles are painted on the near layer");
  assert.equal(far.calls.length, 0, "with nothing focused the far layer stays untouched");
  const task = nodes[3];
  const centre = { x: task._callout.rect.x + task._callout.rect.w / 2, y: task._callout.rect.y + task._callout.rect.h / 2 };
  assert.equal(env.calloutAt(centre.x, centre.y), task, "the card is its node's click target");
  const midLeader = { x: (task._callout.sx + task._callout.ex) / 2, y: (task._callout.sy + task._callout.ey) / 2 };
  assert.equal(env.calloutAt(midLeader.x, midLeader.y), task, "so is its leader");
  assert.equal(env.calloutAt(5, 5), null);
  state.hoverCallout = "task:t";
  state.focusIds = env.splitIds();
  const lifted = recordingContext(), dim = recordingContext();
  env.drawCallouts(projected, { near: lifted, far: dim, focusIds: state.focusIds });
  assert.ok(lifted.calls.some(([name]) => name === "scale"), "the hovered card lifts");
  assert.ok(dim.calls.some(([name]) => name === "fillText"), "cards outside the hovered branch move to the far layer");
});

test("the far layer, the card style control and the focus API are wired", () => {
  assert.ok(template.includes('id="idle-layer-far"'), "the far canvas sits behind the Command canvas");
  assert.ok(template.indexOf('id="idle-layer-far"') < template.indexOf('id="idle-layer"'), "and is earlier in the DOM, so it paints beneath");
  assert.ok(template.includes('id="idle-card-style"'));
  for (const selector of ["#idle-layer-far.focused", "#idle-layer-far.soft", '.sw[data-sw="callout"]']) assert.ok(styles.includes(selector), `styles have ${selector}`);
  assert.match(styles, /#idle-layer \{[^}]*background: transparent/, "the near canvas is transparent so the far one shows through");
  for (const marker of ["enterFocus:", "exitFocus,", "setCardStyle,", "focusStatus:", "calloutStatus:", "drawCallouts(projected, { near: ctx, far, focusIds, dt })", "drawBackdrop(far, time, still, energy, musicBands, musicBeat)", "const hit = nodeAt(x, y) ?? calloutAt(x, y);", "if (node) enterFocus(node);"]) assert.ok(idle.includes(marker), `idle.js carries ${marker}`);
  assert.ok(tree.includes("assistant: edge.assistant === true"), "the rail's snapshot says which edge is the hub link");
});

test("a click glides the zoom with the camera instead of snapping it", () => {
  // Snapping the scale first threw the clicked node outward from the centre
  // (off-screen for an edge node) before the pan brought it back. The focus
  // zoom is now a target the frame loop eases toward at the camera's rate.
  const state = { zoom: 1, zoomTarget: null };
  let reduced = false;
  const env = vm.createContext({ state, Math, noMotion: () => reduced });
  vm.runInContext(section(idle, "  function setZoom(", "  function fitAll()"), env);
  env.glideZoom(2.4);
  assert.equal(state.zoom, 1, "the scale does not move on the click itself");
  assert.equal(state.zoomTarget, 2.4, "the frame loop is handed the target");
  env.glideZoom(9);
  assert.equal(state.zoomTarget, 2.6, "clamped like any zoom");
  env.setZoom(1.2);
  assert.equal(state.zoomTarget, null, "a wheel tick, a fit or a restore ends the glide");
  reduced = true;
  env.glideZoom(1.7);
  assert.deepEqual([state.zoom, state.zoomTarget], [1.7, null], "reduced motion lands at once, like the camera");
  for (const marker of [
    "glideZoom(FOCUS_ZOOM[node.kind] ?? 1.9)",
    "if (zoom) glideZoom(Math.max(state.zoomTarget ?? state.zoom, zoom))",
    "state.zoom = Math.exp(smoothDamp(Math.log(state.zoom), Math.log(state.zoomTarget), camVel, \"zoom\", CAMERA_SMOOTH, dt));",
    "const cameraEase = perSec(CAMERA_EASE, dt);",
    "state.cameraMoving = !still && (flightPx > 8 || centerFlight > 8 || (state.zoomTarget != null",
    "const frame = state.graphFrame ?? area;",
    "const centerFlight = stepCenter(graphArea, still, cameraEase);",
  ]) assert.ok(idle.includes(marker), "idle.js carries " + marker);
});

test("cards hold their spots while the camera is in flight, then settle with the usual hold", () => {
  const { env, state, tick, now } = calloutFixture();
  const node = { id: "task:a", kind: "task", _pr: 8 };
  const projected = [{ node, p: { x: 300, y: 400, k: 1 } }];
  const size = { w: 150, title: "t", lines: [], bubbleH: 0 };
  const hits = env.nodeLabelBlocker(projected);
  const area = env.usableArea();
  const first = env.placeCallout(node, projected[0].p, size, projected, [], [], hits, area, now());
  const chosen = { side: first.side, vert: first.vert, length: first.length };
  const everything = [{ x: -5000, y: -5000, w: 10000, h: 10000 }];
  state.cameraMoving = true;
  for (let frame = 0; frame < 40; frame += 1) {
    const held = env.placeCallout(node, projected[0].p, size, projected, everything, [], hits, area, tick(33));
    assert.deepEqual({ side: held.side, vert: held.vert, length: held.length }, chosen, "in flight the card keeps its spot however long the glide takes");
  }
  assert.equal(state.callouts.get("task:a").blockedSince, null, "the flight does not run down the hold");
  const stranger = { id: "task:b", kind: "task", _pr: 8 };
  assert.ok(env.placeCallout(stranger, { x: 600, y: 300 }, size, projected, [], [], hits, area, now()), "a card without a spot yet is still placed mid-flight");
  state.cameraMoving = false;
  const settled = env.placeCallout(node, projected[0].p, size, projected, everything, [], hits, area, tick(16));
  assert.deepEqual({ side: settled.side, vert: settled.vert, length: settled.length }, chosen, "landed: a fresh hold starts");
  assert.equal(env.placeCallout(node, projected[0].p, size, projected, everything, [], hits, area, tick(400)), null, "past it the card steps aside as before");
});

test("the frame gate tolerates vsync jitter so a two-tick frame is never skipped", () => {
  const drawn = [];
  const env = vm.createContext({ state: { active: true }, document: { hidden: false, body: { dataset: {} } }, pickerHeld: () => false, drawFrame: (time) => drawn.push(time), requestAnimationFrame: () => 1, console });
  vm.runInContext(section(idle, "  // Animation state belongs", "  function drawFrame("), env);
  env.frame(100); env.frame(116.7); env.frame(132.9); env.frame(149.6); env.frame(166.3);
  assert.deepEqual(drawn, [100, 132.9, 166.3], "a 32.9 ms tick (33.3 with jitter) draws instead of costing a 50 ms hitch");
});

test("the gate draws at the display's rate while the camera moves, and only while frames stay cheap", () => {
  const drawn = [];
  const state = { active: true, motionHot: true, frameCost: 4 };
  const env = vm.createContext({ state, document: { hidden: false, body: { dataset: {} } }, pickerHeld: () => false, drawFrame: (time) => drawn.push(time), requestAnimationFrame: () => 1, console });
  vm.runInContext(section(idle, "  // Animation state belongs", "  function drawFrame("), env);
  for (const time of [100, 116.7, 133.4, 150.1]) env.frame(time);
  assert.deepEqual(drawn, [100, 116.7, 133.4, 150.1], "a glide draws every 60 Hz tick");
  drawn.length = 0;
  state.frameCost = 12;
  for (const time of [166.8, 183.5, 200.2]) env.frame(time);
  assert.deepEqual(drawn, [183.5], "frames that cost too much fall back to 30 fps even mid-glide");
  drawn.length = 0;
  state.frameCost = 4;
  state.motionHot = false;
  for (const time of [216.9, 233.6, 250.3]) env.frame(time);
  assert.deepEqual(drawn, [216.9, 250.3], "at rest the tree draws at 30 fps");
});

test("a scene that stays still drops to ten frames a second, and any wake restores the ambient pace at once", () => {
  const drawn = [];
  const state = { active: true, motionHot: false, frameCost: 4, calmFrames: 0 };
  const env = vm.createContext({ state, document: { hidden: false, body: { dataset: {} } }, pickerHeld: () => false, drawFrame: (time) => drawn.push(time), requestAnimationFrame: () => 1, console });
  vm.runInContext(section(idle, "  // Animation state belongs", "  function drawFrame("), env);
  const REST_AFTER_FRAMES = read(env, "REST_AFTER_FRAMES");
  state.calmFrames = REST_AFTER_FRAMES - 1;
  for (const time of [100, 116.7, 133.4]) env.frame(time);
  assert.deepEqual(drawn, [100, 133.4], "until enough calm frames have passed, the ambient 30 fps holds");
  drawn.length = 0;
  state.calmFrames = REST_AFTER_FRAMES;
  for (let tick = 1; tick <= 12; tick += 1) env.frame(133.4 + tick * 16.7);
  assert.deepEqual(drawn.map((time) => Math.round(time * 10) / 10), [233.6, 333.8], "at rest a frame comes every six 60 Hz ticks");
  drawn.length = 0;
  env.wakeFrames();
  assert.equal(state.calmFrames, 0);
  env.frame(350.5);
  env.frame(367.2);
  assert.deepEqual(drawn, [367.2], "a wake lets the next frame through at the ambient gate");
  state.calmFrames = REST_AFTER_FRAMES;
  state.motionHot = true;
  drawn.length = 0;
  for (const time of [383.9, 400.6]) env.frame(time);
  assert.deepEqual(drawn, [383.9, 400.6], "moving the camera is never held to the rest pace");
});

test("only a scene with nothing moving but a slow sky counts as at rest", () => {
  let now = 500000, scene = "aurora";
  const calm = () => ({
    active: true, motionHot: false, cameraMoving: false, panning: null, rotating: null, morph: null, lifeHot: false, farHold: null,
    zoomTarget: null, fitTarget: null, pulses: [], particles: [], agentTrails: new Map(), speech: new Map(), deferred: [], doneHold: new Map(),
    orbitVel: 0, reactive: false, camMode: "orbit", fx: new Map([["task:a", { bornAt: now - 5000, absorbAt: null }]]), cardLift: new Map([["task:a", 0], ["s1", 1]]),
  });
  const state = calm();
  const env = vm.createContext({ state, Date: class extends Date { static now() { return now; } }, activeBackdrop: () => scene, NODE_GROW_MS: 650, document: { hidden: false, body: { dataset: {} } }, console });
  vm.runInContext(section(idle, "  // Animation state belongs", "  function drawFrame("), env);
  const nodes = () => [{ node: { id: "s1", kind: "session", _lift: 0 } }, { node: { id: "task:a", kind: "task", _lift: 1 } }, { node: { id: "__assistant__", kind: "assistant", _lift: 1 } }];
  const atRest = (projected = nodes(), running = new Set(), still = false, audio = false) => env.sceneAtRest(projected, running, still, audio);
  assert.equal(atRest(), true, "a paused tree under a slow sky rests");
  const moving = [
    ["a pulse in flight", () => { state.pulses.push({}); }],
    ["a speck of dust", () => { state.particles.push({}); }],
    ["the orbit still turning", () => { state.orbitVel = 0.002; }],
    ["a camera glide", () => { state.motionHot = true; }],
    ["a zoom glide", () => { state.zoomTarget = 1.4; }],
    ["a refit", () => { state.fitTarget = 0.9; }],
    ["a speech bubble", () => { state.speech.set("s1", {}); }],
    ["a node growing in", () => { state.fx.get("task:a").bornAt = now - 100; }],
    ["a node flying home", () => { state.fx.get("task:a").absorbAt = now - 100; }],
    ["a card easing its lift", () => { state.cardLift.set("task:a", 0.4); }, [{ node: { id: "task:a", kind: "task", _lift: 1, _callout: {} } }]],
    ["a finished node waiting for its read", () => { state.doneHold.set("task:a", {}); }],
    ["live sound", () => { state.reactive = true; state.localAudio = {}; }],
    ["a fast sky", () => { scene = "embers"; }],
  ];
  for (const [label, change, projected] of moving) {
    Object.assign(state, calm());
    scene = "aurora";
    change();
    assert.equal(atRest(projected), false, `${label} keeps the ambient pace`);
  }
  Object.assign(state, calm());
  scene = "aurora";
  state.cardLift.set("gone", 0.4);
  assert.equal(atRest(), true, "a card no longer drawn cannot hold the pace up with a stale lift");
  Object.assign(state, calm());
  assert.equal(atRest(nodes(), new Set(["task:a"])), false, "running work keeps the ambient pace");
  assert.equal(atRest([...nodes(), { node: { id: "__agent__:watcher", kind: "agent" } }]), false, "an agent keeps the ambient pace");
  assert.equal(atRest([{ node: { id: "t", kind: "todo", _workLabel: "Running" } }]), false, "a running step keeps the ambient pace");
  assert.equal(atRest([{ node: { id: "s1", kind: "session", _lift: 0.5 } }]), false, "an orb easing forward keeps the ambient pace");
  assert.equal(atRest(nodes(), new Set(), false, true), false, "an audio-linked frame keeps the ambient pace");
  scene = "fireflies";
  assert.equal(atRest(nodes(), new Set(), true), true, "with motion off every sky is still");
  for (const quiet of ["minimal", "grid", "nebula", "aurora", "bokeh"]) { scene = quiet; assert.equal(atRest(), true, `${quiet} drifts slowly enough to rest`); }
  for (const busy of ["dust", "deepspace", "embers", "fireflies"]) { scene = busy; assert.equal(atRest(), false, `${busy} keeps the ambient pace`); }
  for (const marker of [
    "state.calmFrames = sceneAtRest(projected, runningIds, still, audioLinked) ? (state.calmFrames ?? 0) + 1 : 0;",
    "state.calmFrames = 0; // a rebuild can change anything on screen",
    'for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "keyup", "focusin", "resize"]) window.addEventListener(type, wakeFrames, { capture: true, passive: true });',
  ]) assert.ok(idle.includes(marker), `idle.js carries ${marker}`);
});

test("a floating panel carves the clear rectangle without re-seeding the tree, and the projection centre glides after it", () => {
  // The selection card opens on every click. Before, its rectangle keyed the
  // persisted layout and set the projection centre, so a click re-seeded
  // every anchor and shifted the whole scene at once.
  const frame = { x: 300, y: 150, w: 800, h: 600 };
  const state = { tasks: [], view: "2d", graphFrame: { ...frame } };
  const project = (world) => ({ x: 700 + world.x, y: 450 + world.y, depth: 800, k: 1 });
  const env = vm.createContext({ state, project, unprojectForLayout: (p, world) => ({ x: p.x - 700, y: p.y - 450, z: world.z }), Map, Set, Number, Math, String });
  vm.runInContext(section(idle, "  function graphLayoutSeeds(", "  function hexToRgb("), env);
  const nodes = [{ id: "task:a", kind: "task", x: 0, y: 0, z: 1 }, { id: "task:b", kind: "task", x: 2, y: 4, z: 2 }, { id: "session", kind: "session", x: -40, y: -40, z: 0 }];
  const run = (area) => {
    const projected = nodes.map((node) => ({ node, p: project(node) }));
    env.layoutProjectedGraph(projected, area, "free");
    return new Map(projected.map(({ node, p }) => [node.id, [p.x, p.y]]));
  };
  const before = run(frame);
  const layout = state.screenLayout;
  const carved = run({ x: 300, y: 150, w: 480, h: 600 }); // a 300px card on the right, with its margins
  assert.equal(state.screenLayout, layout, "the same frame keeps the same persisted layout");
  for (const [id, point] of before) assert.deepEqual(carved.get(id), point, id + " keeps its anchor when the card opens");
  state.graphFrame = { x: 300, y: 150, w: 700, h: 600 };
  run(state.graphFrame);
  assert.notEqual(state.screenLayout, layout, "a change of frame (window, rails, feeds) still re-seeds");

  // The centre: eased in the user's camera, snapped for the overview, a new
  // frame, or reduced motion.
  const cam = { camMode: "free", graphFrame: { ...frame }, center: null };
  const centre = vm.createContext({ state: cam, Math, CAMERA_EASE: 0.045, usableArea: () => frame });
  vm.runInContext(section(idle, "  function stepCenter(", "  function project("), centre);
  assert.equal(centre.stepCenter(frame, false), 0);
  assert.deepEqual([centre.centerX(), centre.centerY()], [700, 450]);
  const smaller = { x: 300, y: 150, w: 480, h: 600 };
  const left = centre.stepCenter(smaller, false);
  assert.ok(left > 100 && centre.centerX() > 540 && centre.centerX() < 700, "the centre starts gliding toward the carved rectangle: " + centre.centerX());
  for (let frameCount = 0; frameCount < 400; frameCount += 1) centre.stepCenter(smaller, false);
  assert.equal(centre.centerX(), 540, "and lands on it");
  cam.camMode = "orbit";
  assert.equal(centre.stepCenter(frame, false), 0);
  assert.equal(centre.centerX(), 700, "the overview camera snaps");
  cam.camMode = "free";
  assert.equal(centre.stepCenter(smaller, true), 0);
  assert.equal(centre.centerX(), 540, "reduced motion snaps");
  cam.graphFrame = { x: 0, y: 0, w: 1400, h: 900 };
  centre.stepCenter({ x: 0, y: 0, w: 1400, h: 900 }, false);
  assert.equal(centre.centerX(), 700, "a new frame snaps");
});

test("verifying cards rank behind live sessions for the card budget; running work stays ahead", () => {
  const { env } = calloutFixture();
  const verifying = { id: "task:v", kind: "task", _workLabel: "Verifying", task: { status: "awaiting_verification" } };
  const running = { id: "task:r", kind: "task", _workLabel: "Running", task: { status: "active" } };
  const next = { id: "task:n", kind: "task", _workLabel: "Next", task: { status: "open" } };
  const session = { id: "s1", kind: "session", state: "active" };
  const plain = { id: "task:p", kind: "task", task: { status: "open" } };
  const rank = (node) => env.calloutPriority(node, null, new Set());
  assert.ok(rank(running) < rank(session) && rank(next) < rank(session), "live and up-next work outranks sessions");
  assert.ok(rank(verifying) > rank(session), "a verifying card yields to the sessions being read");
  assert.ok(rank(verifying) < rank(plain), "but still ranks ahead of an idle task");
});

test("the Orbit switch and the camera mode the owner picks survive a restart; focus, wheel and drag steps do not", () => {
  const stores = new Map(), toasts = [];
  const state = { orbit: "paused", focusRestore: null, camMode: "orbit", camera: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 }, follow: null, followReadAt: 0, followZoomTarget: null, orbitVel: 0, zoom: 1 };
  const env = vm.createContext({
    state, CAM_MODES: ["orbit", "follow", "free"],
    writeStore: (key, value) => stores.set(key, value),
    syncViewControls() {}, renderHint() {}, applyCamMode() {}, setZoom: (value) => { state.zoom = value; },
    window: { MefiToast: (text) => toasts.push(text) },
  });
  vm.runInContext(section(idle, "  function setOrbit(", "  // Camera autopilot."), env);
  vm.runInContext(section(idle, "  function setCamMode(", "  function setLabels("), env);
  const source = idle.replace(/\r\n/g, "\n");
  assert.ok(source.includes('orbit: readStore("mefiStudio.cmdOrbit") === "auto" ? "auto" : "paused",'), "a launch starts from the saved Orbit switch");
  assert.ok(source.includes('camMode: CAM_MODES.includes(readStore("mefiStudio.cmdCam"))'), "and from the saved camera mode");

  env.setOrbit();
  assert.equal(state.orbit, "auto");
  assert.equal(stores.get("mefiStudio.cmdOrbit"), "auto", "Space or the Spin button is saved");
  assert.deepEqual(toasts, ["spin resumed"], "the toolbar calls it Spin; Overview is the camera mode");
  // Focus borrows the orbit quietly; that loan is never saved.
  env.setOrbit(false, { quiet: true });
  assert.equal(stores.get("mefiStudio.cmdOrbit"), "auto");
  state.orbit = "auto"; state.focusRestore = { orbit: "auto" };
  env.setOrbit();
  assert.equal(stores.get("mefiStudio.cmdOrbit"), "paused", "a pause pressed while focused is the owner's choice");
  assert.equal(state.focusRestore.orbit, "paused", "and leaving the focused node keeps it");

  env.setCamMode("follow");
  assert.equal(stores.get("mefiStudio.cmdCam"), "follow");
  env.userZoom(1.3);
  assert.equal(state.camMode, "free", "a wheel zoom still hands the camera to the owner for this visit");
  assert.equal(state.zoom, 1.3);
  assert.equal(stores.get("mefiStudio.cmdCam"), "follow", "but the next launch starts from the mode they picked");
  env.setCamMode("orbit", { quiet: true });
  assert.equal(stores.get("mefiStudio.cmdCam"), "orbit", "Fit is an explicit choice of the orbit camera");
  env.setCamMode("free");
  assert.equal(stores.get("mefiStudio.cmdCam"), "free", "an explicit free camera is saved like any other pick");
  assert.ok(!source.includes('setCamMode("free", { quiet: true })'), "every incidental step into free is marked transient");
});
