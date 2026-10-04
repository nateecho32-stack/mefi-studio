// Size and density, the stylesheet (renderer/size.css), read as text. The tokens every
// 0.5 panel sizes itself with are a contract other work is written against, so their
// names and their values for the three densities are pinned here; the miniature must
// take the same tokens from its own scope and never from the root; and the rules the
// app keeps everywhere (no text under 12 px, no scrollbar gutter, theme colours only)
// hold for this file too.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = (await readFile(new URL("../renderer/size.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const plain = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
// Every rule as { selectors, decls }, including those inside @media and @container.
const rules = [...plain.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selectors: selector.split(",").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean),
  decls: Object.fromEntries(body.split(";").map((part) => part.trim()).filter(Boolean).map((part) => { const at = part.indexOf(":"); return [part.slice(0, at).trim(), part.slice(at + 1).trim().replace(/\s+/g, " ")]; })),
  text: body,
}));
const ruleFor = (selector) => rules.find((rule) => rule.selectors.includes(selector));

const DENSITY = {
  comfortable: { "--d-row": "8px", "--d-gh": "12px", "--d-stp": "8px", "--d-seat": "9px", "--d-set": "10px", "--d-gap": "14px", "--d-lrow": "10px", "--d-pad": "14px", "--d-bub": "12px", "--d-top": "48px", "--d-tab": "38px", "--d-card": "12px", "--d-col": "12px" },
  compact: { "--d-row": "5px", "--d-gh": "8px", "--d-stp": "5px", "--d-seat": "6px", "--d-set": "7px", "--d-gap": "10px", "--d-lrow": "7px", "--d-pad": "11px", "--d-bub": "9px", "--d-top": "44px", "--d-tab": "34px", "--d-card": "9px", "--d-col": "9px" },
  spacious: { "--d-row": "11px", "--d-gh": "16px", "--d-stp": "11px", "--d-seat": "12px", "--d-set": "13px", "--d-gap": "20px", "--d-lrow": "13px", "--d-pad": "18px", "--d-bub": "15px", "--d-top": "52px", "--d-tab": "42px", "--d-card": "15px", "--d-col": "16px" },
};
const DETAIL = {
  titles: { "--dt-meta": "none", "--dt-prog": "none", "--dt-more": "none", "--dt-q": "none", "--dt-qf": "none" },
  status: { "--dt-meta": "block", "--dt-prog": "block", "--dt-more": "none", "--dt-q": "block", "--dt-qf": "flex" },
  all: { "--dt-meta": "block", "--dt-prog": "block", "--dt-more": "flex", "--dt-q": "block", "--dt-qf": "flex" },
};

test("the density tokens have their thirteen names and their values for each of the three densities", () => {
  for (const [level, tokens] of Object.entries(DENSITY)) {
    const rule = ruleFor(`.size-mini[data-mini-density="${level}"]`);
    assert.ok(rule, `${level}: a rule for the miniature`);
    assert.deepEqual(rule.decls, tokens, `${level}: exactly these tokens, with these values`);
    assert.ok(rule.selectors.includes(`html[data-layout="v2"][data-density="${level}"]`), `${level}: the same rule serves the window`);
  }
  assert.ok(ruleFor('html[data-layout="v2"]'), "the default");
  assert.ok(ruleFor(`.size-mini[data-mini-density="comfortable"]`).selectors.includes('html[data-layout="v2"]'), "comfortable is what a v2 window has before anything says otherwise");
  // A bigger density never has less room: each token grows compact -> comfortable -> spacious.
  for (const name of Object.keys(DENSITY.comfortable)) assert.ok(parseFloat(DENSITY.compact[name]) <= parseFloat(DENSITY.comfortable[name]) && parseFloat(DENSITY.comfortable[name]) <= parseFloat(DENSITY.spacious[name]), name);
});

test("the detail tokens say what a row or a card shows, as the display it takes", () => {
  for (const [level, tokens] of Object.entries(DETAIL)) {
    const rule = ruleFor(`.size-mini[data-mini-detail="${level}"]`);
    assert.ok(rule, level);
    assert.deepEqual(rule.decls, tokens, level);
    assert.ok(rule.selectors.includes(`html[data-layout="v2"][data-detail="${level}"]`), level);
  }
  assert.ok(ruleFor(`.size-mini[data-mini-detail="status"]`).selectors.includes('html[data-layout="v2"]'), "titles and status is the default");
});

test("the type ladder is max(12px, calc(Npx * var(--text-scale, 1))), for the window and for the miniature", () => {
  const ladder = rules.find((rule) => rule.selectors.includes("html[data-layout=\"v2\"]") && rule.selectors.includes(".size-mini") && "--f12" in rule.decls);
  assert.ok(ladder, "one rule declares it for both scopes, so each resolves --text-scale at home");
  const steps = { "--f12": 12, "--f125": 12.5, "--f13": 13, "--f135": 13.5, "--f14": 14, "--f15": 15, "--f16": 16, "--f18": 18, "--f20": 20, "--f22": 22 };
  assert.deepEqual(Object.keys(ladder.decls), Object.keys(steps));
  for (const [name, size] of Object.entries(steps)) assert.equal(ladder.decls[name], `max(12px, calc(${size}px * var(--text-scale, 1)))`, name);
  const scale = rules.find((rule) => rule.selectors.length === 1 && rule.selectors[0] === ".size-mini" && "--text-scale" in rule.decls);
  assert.equal(scale?.decls["--text-scale"], "var(--mini-text-scale, 1)", "the miniature's own text scale, not the root's");
});

test("the miniature takes its values from its own scope: only the token rules ever look at a scope attribute, and never the root's through it", () => {
  const scoped = rules.filter((rule) => rule.selectors.some((selector) => /data-(density|detail|mini-density|mini-detail)/.test(selector)));
  assert.ok(scoped.length >= 6);
  for (const rule of scoped) {
    const tokensOnly = Object.keys(rule.decls).every((name) => /^--(d|dt)-/.test(name));
    assert.ok(tokensOnly, `${rule.selectors[0]}: a scope attribute sets tokens and nothing else, so one set of rules reads them`);
    for (const selector of rule.selectors) assert.match(selector, /^(html\[data-layout="v2"\](\[data-(density|detail)="[a-z]+"\])?|\.size-mini\[data-mini-(density|detail)="[a-z]+"\])$/, selector);
  }
  for (const rule of rules) for (const selector of rule.selectors) if (/\.(sm-|size-mini)/.test(selector)) assert.doesNotMatch(selector, /html|:root|data-(density|detail)=/, `${selector} reads nothing the window has`);
});

test("everything keyed on the document is keyed on the 0.5 layout, so with it off nothing here matches the page", () => {
  for (const rule of rules) for (const selector of rule.selectors) if (/^(html|:root|body)/.test(selector)) assert.ok(selector.startsWith('html[data-layout="v2"]'), selector);
});

test("no text in it is under 12 px: every size is a step of the ladder or a length of 12 px or more", () => {
  const sizes = [];
  for (const rule of rules) for (const [name, value] of Object.entries(rule.decls)) {
    if (name === "font-size") sizes.push([rule.selectors[0], value]);
    if (name === "font") sizes.push([rule.selectors[0], /var\(--f\d+(?:, [\d.]+px)?\)|max\(12px,[^;]*?\)\)|[\d.]+px/.exec(value)?.[0] ?? value]);
  }
  assert.ok(sizes.length >= 30, `a stylesheet full of sizes (${sizes.length})`);
  for (const [selector, size] of sizes) {
    const step = /^var\(--f(\d+)(?:, ([\d.]+)px)?\)$/.exec(size);
    if (step) { assert.ok(["12", "125", "13", "135", "14", "15", "16", "18", "20", "22"].includes(step[1]), `${selector}: ${size} is a step of the ladder`); if (step[2]) assert.ok(parseFloat(step[2]) >= 12, `${selector}: its fallback ${size}`); continue; }
    if (/^max\(12px,/.test(size)) continue;
    const px = /^([\d.]+)px$/.exec(size);
    assert.ok(px && parseFloat(px[1]) >= 12, `${selector}: ${size}`);
  }
  assert.doesNotMatch(plain, /font(?:-size)?:[^;]*(?<![\d.])(?:[0-9]|1[01])(?:\.\d+)?px/, "no literal size under 12 px, in any declaration");
});

test("no scroller reserves width or shows a bar: one pane scrolls, by overflow auto, and nothing asks for a gutter", () => {
  assert.doesNotMatch(plain, /overflow(?:-[xy])?\s*:\s*scroll/);
  assert.doesNotMatch(plain, /scrollbar-(?:gutter|width|color)|::-webkit-scrollbar/);
  const scrollers = rules.filter((rule) => /overflow-y\s*:\s*auto|overflow\s*:\s*auto/.test(rule.text)).map((rule) => rule.selectors[0]);
  assert.deepEqual(scrollers, [".size-body"], "the page is the one thing that scrolls");
});

test("every colour is a theme token: no literal colour anywhere in it", () => {
  assert.doesNotMatch(plain, /#[0-9a-fA-F]{3,8}\b/, "no hex colour");
  assert.doesNotMatch(plain, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/, "no functional colour");
  assert.doesNotMatch(plain, /\b(?:white|black|red|green|blue|gray|grey|yellow|orange|purple)\b(?!-)/i, "no named colour");
  for (const match of plain.matchAll(/color-mix\(([^;]*)\)\s*[;})]/g)) assert.match(match[1], /var\(--[\w-]+\)|transparent/, `a mix of tokens: ${match[0].slice(0, 70)}`);
});

test("it does not touch the shell's geometry: no region variable is read raw or written", () => {
  assert.doesNotMatch(plain, /--shell-(?:rail-w|rail-open|local-h|list-w|inspector-w|tabs-h|status-h|x0|x1|y0|y1)/, "the regions are MefiNav.layout.set's and the free area's edges belong to the layers");
  const placed = (kind) => rules.filter((rule) => new RegExp(`(?:^|;)\\s*position\\s*:\\s*${kind}\\b`).test(rule.text)).map((rule) => rule.selectors.join(", "));
  assert.deepEqual(placed("fixed"), [], "nothing here pins itself to the window: a page is placed by .workspace-page");
  assert.deepEqual(placed("absolute"), [".size-ticks span"], "only the ticks under a slider sit by coordinates, inside their own box");
  assert.deepEqual(placed("sticky"), [".size-preview"]);
});

test("the page keeps the picture in view in one column, but not where that would leave no room for the controls", () => {
  const narrow = plain.match(/@container \(max-width: 720px\) \{([\s\S]*?)\n\}/);
  assert.ok(narrow, "a container query at the width the script measures (720)");
  assert.match(narrow[1], /grid-template-areas:\s*"preview" "intro" "controls"/, "the picture first");
  assert.ok(ruleFor(".size-preview").decls.position === "sticky", "kept in view");
  assert.match(plain, /@media \(max-height: 520px\) \{\s*\.size-preview \{ position: static; \}\s*\}/, "a short window does not keep it: nothing would be left to scroll");
  assert.equal(ruleFor(".size-body").decls["container-type"], "inline-size");
  assert.equal(ruleFor(".size-mini-fit").decls.zoom, "var(--mini-fit, 1)");
  assert.equal(ruleFor(".size-mini-z").decls.zoom, "var(--mini-zoom, 1)", "the interface scale is approximated with zoom until Apply");
  assert.equal(ruleFor(".size-mini-z").decls.width, "calc(760px / var(--mini-zoom, 1))", "so the window it draws keeps its own size");
});

test("the page is one centred column of at most 1080 px, and the shared header's Esc key cap on it is not under 12 px", () => {
  assert.equal(ruleFor(".size-wrap").decls["max-width"], "1080px", "a wide window does not stretch the controls and the picture apart");
  assert.equal(ruleFor(".size-wrap").decls.margin, "0 auto");
  assert.equal(ruleFor(".size-sheet .sheet-head .key").decls["font-size"], "var(--f12, 12px)", "the header's key cap is about 10 px elsewhere");
});

test("the picture is clipped to its frame, the ticks sit where the script puts them and the track fills up to the thumb", () => {
  assert.equal(ruleFor(".size-mini-host").decls.overflow, "hidden", "the frame keeps a zoomed picture inside its column");
  assert.equal(ruleFor(".size-mini-win").decls.overflow, "hidden", "and the window it draws keeps what does not fit");
  assert.equal(ruleFor(".size-ticks span").decls.left, "var(--at, 0)");
  assert.match(ruleFor('.size-row input[type="range"]').decls.background, /var\(--gold\) var\(--fill, 50%\),.* var\(--fill, 50%\)/);
  assert.equal(ruleFor(".size-seg").decls["flex-wrap"], "wrap", "a choice that does not fit one line takes a second, at large text in a narrow window");
});

test("what moves respects reduced motion: the one transition is on the shared token and is switched off", () => {
  const moving = [...plain.matchAll(/transition\s*:\s*([^;]+)/g)].map((match) => match[1].trim()).filter((value) => value !== "none");
  assert.equal(moving.length, 1, "one thing eases: the slider's thumb");
  assert.ok(moving.every((value) => /var\(--motion-[a-z]+\)/.test(value)));
  assert.match(plain, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none/);
  assert.doesNotMatch(plain, /\banimation\b|@keyframes/);
});

test("every class the stylesheet styles is one the script or the template builds", async () => {
  const script = await readFile(new URL("../renderer/size.js", import.meta.url), "utf8");
  const template = await readFile(new URL("../renderer/booklet.template.html", import.meta.url), "utf8");
  const classes = new Set([...plain.matchAll(/\.((?:sm|size)-[a-z-]+)/g)].map((match) => match[1]));
  assert.ok(classes.size > 60, `a whole page and a whole window's worth of classes (${classes.size})`);
  const built = new Set([...(script + template).matchAll(/[\w-]+/g)].map((match) => match[0]));
  // A row's dot takes its state from the sample (`sm-${row.dot}`): the state is a word in the script.
  const composed = (name) => script.includes("sm-${") && built.has(name.replace(/^sm-/, ""));
  for (const name of classes) assert.ok(built.has(name) || composed(name), `${name} is built by size.js or written in the template`);
});
