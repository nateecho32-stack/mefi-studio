import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// v0.4.4 shipped an apply helper that a detached PowerShell (no console)
// dropped without running its script, so an in-app update downloaded the
// build, quit Studio and installed nothing. The fix launches the helper
// through cmd's `start`, which gives it a hidden console of its own. The
// first live in-app update after the fix is 0.4.5 to 0.4.6, so the launch is
// pinned here: nothing else fails if someone "simplifies" it back.
test("the update helper is launched through start, verbatim, detached and unreferenced", async () => {
  const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const at = main.indexOf("const helperLine = [");
  assert.ok(at > 0, "the apply path builds its helper line");
  const block = main.slice(at, main.indexOf("app.exit(0);", at));
  assert.match(block, /\[\s*"start",\s*'""',\s*"powershell\.exe"/, "start, an empty window title, then powershell.exe");
  assert.match(block, /"-WindowStyle", "Hidden", "-File", prepared\.scriptPath/, "the staged script runs hidden with -File");
  assert.match(block, /\["\/d", "\/s", "\/c", `"\$\{helperLine\}"`\]/, "cmd receives the whole line quoted once");
  assert.match(block, /detached: true/, "the helper outlives Studio");
  assert.match(block, /windowsVerbatimArguments: true/, "cmd's own quoting is not re-escaped");
  assert.match(block, /helper\.unref\(\)/, "Studio does not wait for it");
  assert.ok(block.indexOf("helper.unref()") < block.indexOf("app.releaseSingleInstanceLock()"), "the helper is started before the single-instance lock is released");
  assert.doesNotMatch(block, /spawn\("powershell\.exe"/, "never a bare detached PowerShell again");
});
