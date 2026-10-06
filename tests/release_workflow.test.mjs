// The rules a release run keeps (.github/workflows/release.yml): a tag push
// publishes the Electron build until the bridge release is out, nothing is
// signed or published before the packaged app has opened once, signing waits
// for the SignPath variables, and the hosted gate is npm test's own legs
// without the real-window suites. A workflow cannot run here, so its text is
// read: Node has no YAML parser, and these are rules, not formatting.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testLegs } from "../scripts/run-all-tests.mjs";

const read = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

// Each step as { name, uses, if, run, text }: the job's steps sit at six
// spaces, their keys at eight, and a `run: |` block below them at ten.
function parseSteps(workflow) {
  const start = workflow.indexOf("\n    steps:\n");
  assert.ok(start >= 0, "the release job lists its steps");
  return workflow.slice(start).split("\n      - ").slice(1).map((chunk) => {
    const lines = `        ${chunk}`.split("\n");
    const step = { text: chunk };
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^ {8}([a-z-]+):(?: (.*))?$/.exec(lines[index]);
      if (!match) continue;
      let value = match[2] ?? "";
      if (value === "|") {
        const block = [];
        while (index + 1 < lines.length && (lines[index + 1].startsWith(" ".repeat(10)) || !lines[index + 1].trim())) block.push(lines[(index += 1)].slice(10));
        value = block.join("\n").trim();
      }
      step[match[1]] = value;
    }
    step.label = step.name ?? step.uses;
    return step;
  });
}

const workflow = await read(".github/workflows/release.yml");
const steps = parseSteps(workflow);
const at = (predicate, what) => {
  const index = steps.findIndex(predicate);
  assert.ok(index >= 0, `release.yml has a step that ${what}`);
  return index;
};
const packaging = steps.filter((step) => step.run?.includes("scripts/package-release.mjs"));

test("a tag push publishes the Electron build; the Rust host only when a run is started by hand with host: tauri", () => {
  assert.match(workflow, /^ {2}push:\n {4}tags: \["v\*"\]$/m);
  assert.match(workflow, /^ {6}host:\n(?: {8}.*\n)*? {8}options: \["electron", "tauri"\]\n {8}default: "electron"$/m);
  const resolve = steps[0];
  assert.equal(resolve.id, "version", "the version and host are resolved first: the checkout builds from them");
  assert.match(resolve.text, /^ {10}TAG_HOST: electron$/m, "tags stay on Electron until the bridge release has reached installed copies");
  assert.ok(resolve.run.includes(`$packageHost = if ("\${{ github.event_name }}" -eq "workflow_dispatch") { "\${{ inputs.host }}" } else { $env:TAG_HOST }`));
  assert.ok(resolve.run.includes(`if ($packageHost -notin @("electron", "tauri")) { throw "unknown host: $packageHost" }`));
  assert.equal(packaging.length, 2, "one build, one zip-and-publish");
  for (const step of packaging) assert.ok(step.run.includes(`--host "\${{ steps.version.outputs.host }}"`), `${step.label} names the host, so a tauri run never publishes under the Electron asset name`);
  const build = steps.indexOf(packaging[0]);
  const rust = steps.filter((step) => /dtolnay\/rust-toolchain|Swatinem\/rust-cache|rust-host\.mjs release-build/.test(step.text));
  assert.equal(rust.length, 3);
  for (const step of rust) {
    assert.equal(step.if, "steps.version.outputs.host == 'tauri'", `${step.label} runs only for a host build`);
    assert.ok(steps.indexOf(step) < build, `${step.label} comes before the portable build that ships it`);
  }
});

test("a run started by hand builds the tag it names, not the branch it was started from", () => {
  const checkout = steps[at((step) => step.uses === "actions/checkout@v4", "checks the source out")];
  assert.match(checkout.text, /^ {10}ref: \$\{\{ github\.event_name == 'workflow_dispatch' && format\('refs\/tags\/\{0\}', steps\.version\.outputs\.value\) \|\| github\.ref \}\}$/m);
});

test("nothing is signed or published before the packaged app has opened once", async () => {
  const publishing = packaging.filter((step) => step.run.includes("--publish"));
  assert.equal(publishing.length, 1);
  const publish = steps.indexOf(publishing[0]);
  assert.equal(publish, steps.length - 1, "publishing is the last step");
  assert.ok(publishing[0].run.includes("--skip-build"), "the zip is made from the folder that was smoke-launched (and signed), not a new build");
  const build = steps.indexOf(packaging.find((step) => !step.run.includes("--publish")));
  const smoke = at((step) => step.run?.includes(`"--smoke"`), "smoke-launches the packaged app");
  const signing = steps.map((step, index) => (step.if === "env.SIGN == 'true'" ? index : -1)).filter((index) => index >= 0);
  assert.ok(build < smoke, "the smoke launch opens the build this run made");
  assert.ok(signing.length > 0 && signing.every((index) => smoke < index && index < publish), "signing sits between the smoke launch and publishing");
  const { run, text } = steps[smoke];
  assert.match(text, /^ {8}timeout-minutes: \d+$/m, "a smoke launch that hangs fails the run instead of holding it");
  assert.ok(run.includes("--user-data-dir=") && run.includes("$env:MEFI_STUDIO_USER_DATA = $userData"), "both hosts get a scratch profile: Electron from --user-data-dir, the Rust host from MEFI_STUDIO_USER_DATA");
  assert.ok(run.includes(`Select-String -LiteralPath $log, "$log.err" -Pattern '^\\[smoke\\] \\{' -Quiet`), "the result line is looked for on stdout and stderr: the Rust host relays the engine's output on its stderr");
  assert.ok(run.includes("if ($run.ExitCode -ne 0)"));
  const main = await read("main.cjs");
  assert.ok(main.includes("console.log(`[smoke] ${JSON.stringify(result)}`);"), "main.cjs prints the result line the step looks for");
});

test("signing stays off until the SignPath variables are set", () => {
  assert.match(workflow, /^ {6}SIGN: \$\{\{ vars\.SIGNPATH_ORGANIZATION_ID != '' \}\}$/m);
  const signing = steps.filter((step) => /signpath|SIGNPATH|unsigned-executable/i.test(step.text));
  assert.equal(signing.length, 3, "upload, sign, put the signed executable in place");
  for (const step of signing) assert.equal(step.if, "env.SIGN == 'true'", `${step.label} waits for the SignPath variables`);
  const holders = steps.filter((step) => step.text.includes("secrets."));
  assert.deepEqual(holders.map((step) => step.label), ["Sign with SignPath"], "the SignPath token reaches only the signing step");
  assert.equal(holders[0].if, "env.SIGN == 'true'");
});

test("the hosted gate is npm test's own legs without the Electron suites, and a tag push runs the full gate", async () => {
  assert.match(workflow, /^ {6}GATE: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.gate \|\| 'full' \}\}$/m);
  assert.match(workflow, /^ {6}gate:\n(?: {8}.*\n)*? {8}options: \[full, hosted\]\n {8}default: full$/m);
  const fetch = at((step) => step.run === "node node_modules/electron/install.js", "fetches the Electron binary");
  const check = steps[at((step) => step.run === "npm run check", "runs npm run check")];
  assert.equal(check.if, undefined, "npm run check runs for every gate");
  const full = at((step) => step.run === "npm test", "runs npm test");
  assert.equal(steps[full].if, "env.GATE == 'full'");
  assert.ok(fetch < full, "the binary is in place first, so the full gate runs the real-window suites ci.yml skips");
  const hosted = steps.filter((step) => step.if === "env.GATE == 'hosted'").map((step) => step.run.replace(/"/g, ""));
  const [nodeSuites, ...otherLegs] = testLegs({ command: "python", args: [] });
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["test:fast"], `node ${nodeSuites.args.join(" ")} --fast`, "test:fast is npm test's Node stage without the Electron suites");
  const node = (leg) => (leg.command === "python" ? "python" : "node");
  assert.deepEqual(hosted, ["npm run audit", "npm run test:fast", ...otherLegs.map((leg) => [node(leg), ...leg.args].join(" "))]);
  assert.ok(steps.every((step, index) => !step.if?.includes("env.GATE") || index < steps.indexOf(packaging[0])), "every gate runs before anything is built");
});

test("ci.yml builds the beta artifact but never publishes a release or pushes a tag", async () => {
  const ci = await read(".github/workflows/ci.yml");
  assert.match(ci, /^ {2}push:\n {4}branches: \["\*\*"\]$/m);
  assert.doesNotMatch(ci, /^ {4}tags:/m);
  for (const forbidden of ["--publish", "gh release", "git tag", "git push"]) assert.ok(!ci.includes(forbidden), `ci.yml never runs ${forbidden}`);
});
