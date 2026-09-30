// Guard tests for two things scripts/sync.mjs must not get wrong about history:
// a branch built on gh-pages is the public site's work (it never merges into
// the default branch, so it is not "work to bring in"), and a shallow clone can
// hold a local main that shares no history with GitHub's in what it fetched
// (a cloud session's clone did: "90 commits not pushed" was false). Throwaway
// repositories stand in for GitHub and the PCs; nothing touches the network.
//
// Run: node --test tests/sync_lineage.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { atRisk, describe, inspect, pending, runGit, sync } from "../scripts/sync.mjs";

async function run(cwd, ...args) {
  const out = await runGit(cwd, args);
  assert.ok(out.ok, `git ${args.join(" ")}: ${out.stderr}`);
  return out.stdout;
}

async function configure(cwd) {
  for (const [key, value] of [["user.name", "Sync Fixture"], ["user.email", "sync@fixture.invalid"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) await run(cwd, "config", key, value);
}

async function commit(cwd, name) {
  writeFileSync(path.join(cwd, name), `${name}\n`);
  await run(cwd, "add", name);
  await run(cwd, "commit", "-q", "-m", `Add ${name}`);
}

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "mefi-lineage-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));
  const hub = path.join(root, "hub.git");
  const first = path.join(root, "pc1");
  const second = path.join(root, "pc2");
  await run(root, "init", "-q", "--bare", "-b", "main", hub);
  await run(root, "init", "-q", "-b", "main", first);
  await configure(first);
  await commit(first, "README.md");
  await run(first, "remote", "add", "origin", hub);
  await run(first, "push", "-q", "-u", "origin", "main");
  await run(root, "clone", "-q", "-c", "core.autocrlf=false", hub, second);
  await configure(second);
  return { root, hub, first, second };
}

test("a branch built on gh-pages is site work: named apart, never counted as work to bring into main", async (t) => {
  const { first, second } = await fixture(t);
  await run(first, "checkout", "-q", "--orphan", "gh-pages");
  await run(first, "rm", "-rfq", ".");
  await commit(first, "index.html");
  await run(first, "push", "-q", "origin", "gh-pages");
  await run(first, "checkout", "-q", "-b", "wip/site-x");
  await commit(first, "a.css");
  await commit(first, "b.css");
  await run(first, "push", "-q", "origin", "wip/site-x");

  const look = await sync(second, { pull: false, push: false });
  assert.deepEqual(look.state.remoteBranches, [], "the site branch is not a branch to merge into main");
  assert.deepEqual(look.state.siteBranches, [{ name: "wip/site-x", commits: 2 }]);
  const note = look.pending.find((item) => item.kind === "site-branch");
  assert.match(note.text, /^Site branch wip\/site-x on GitHub: 2 commits not on gh-pages yet\. It never merges into main; publish the site separately\.$/);
  assert.equal(look.risk, 0, "a site branch on GitHub puts nothing at risk");
  assert.equal(look.headline, "This PC matches GitHub main.", "a note about the site never says work is missing");
  assert.doesNotMatch(describe(look, { hook: true }), /Before moving to another PC/);

  // A branch built on main is still work to bring in, and still says so.
  await run(first, "checkout", "-q", "main");
  await run(first, "checkout", "-q", "-b", "wip/feature");
  await commit(first, "feature.txt");
  await run(first, "push", "-q", "origin", "wip/feature");
  const again = await sync(second, { pull: false, push: false });
  assert.deepEqual(again.state.remoteBranches, [{ name: "wip/feature", commits: 1 }]);
  assert.deepEqual(again.state.siteBranches, [{ name: "wip/site-x", commits: 2 }]);
  assert.equal(again.headline, "Some work on this PC is not on GitHub yet.");
});

test("a site branch with nothing new on it is not reported", async (t) => {
  const { first, second } = await fixture(t);
  await run(first, "checkout", "-q", "--orphan", "gh-pages");
  await run(first, "rm", "-rfq", ".");
  await commit(first, "index.html");
  await run(first, "push", "-q", "origin", "gh-pages");
  await run(first, "push", "-q", "origin", "gh-pages:refs/heads/wip/site-same");
  const look = await sync(second, { pull: false, push: false });
  assert.deepEqual(look.state.siteBranches, []);
  assert.deepEqual(look.state.remoteBranches, []);
});

test("a shallow clone whose local main is outside its history is not compared, and a deepening fetch connects them", async (t) => {
  const { root, hub, first } = await fixture(t);
  for (const name of ["b.txt", "c.txt", "d.txt"]) await commit(first, name);
  await run(first, "push", "-q", "origin", "main");
  const [, older] = (await run(first, "rev-list", "--reverse", "main")).split(/\r?\n/);
  await run(hub, "config", "uploadpack.allowAnySHA1InWant", "true");

  // What the cloud session had: a shallow origin/main, and a local main left
  // over from an earlier, separate fetch of an older commit.
  const shallow = path.join(root, "shallow");
  await run(root, "clone", "-q", "--depth", "1", "-c", "core.autocrlf=false", pathToFileURL(hub).href, shallow);
  await configure(shallow);
  await run(shallow, "checkout", "-q", "--detach");
  await run(shallow, "fetch", "-q", "--depth=1", "origin", older);
  await run(shallow, "update-ref", "refs/heads/main", older);

  const before = await inspect(shallow);
  assert.equal(before.shallow, true);
  assert.equal(before.unrelated, true);
  assert.equal(before.ahead, 0, "no count is invented for histories that were not compared");
  assert.equal(before.behind, 0);
  const notes = pending(before);
  assert.ok(notes.some((item) => item.kind === "unrelated" && /shallow clone/.test(item.text) && /not compared/.test(item.text)));
  assert.deepEqual(atRisk(notes).filter((item) => item.kind === "unpushed"), [], "nothing is reported as unpushed");

  const deepened = await sync(shallow, { pull: false, push: false });
  assert.equal(deepened.state.unrelated, false, "the fetch went back far enough to connect the two mains");
  assert.equal(deepened.state.ahead, 0);
  assert.equal(deepened.state.behind, 2);
  assert.equal(deepened.headline, "GitHub has 2 commits this PC has not pulled yet.");
});

test("separate histories in a full clone are still counted: that is real unpushed work", async (t) => {
  const { second } = await fixture(t);
  await run(second, "checkout", "-q", "--orphan", "solo");
  await commit(second, "solo.txt");
  await run(second, "branch", "-f", "main", "solo");
  const look = await inspect(second);
  assert.equal(look.shallow, false);
  assert.equal(look.unrelated, false);
  assert.equal(look.ahead, 1);
  assert.equal(look.behind, 1);
  assert.ok(pending(look).some((item) => item.kind === "unpushed" && item.count === 1));
});
