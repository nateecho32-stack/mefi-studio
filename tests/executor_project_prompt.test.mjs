import test from "node:test";
import assert from "node:assert/strict";
import { executorHost } from "./fixtures/host_executor.mjs";

const task = (prompt) => ({
  id: "new-project", title: "Build a small browser game", prompt,
  status: "open", createdAt: 1, files: ["index.html"],
});

test("a dispatched fresh-project brief keeps optional Git out of owner decisions and remaining work", async () => {
  const h = executorHost({ tasks: [task("Build the game and run the focused checks. No commit is requested.")] });
  h.wake(); await h.pump();
  assert.equal(h.starts.length, 1, "a project without a Git observation can still launch its worker");
  const prompt = h.starts[0].child.prompt;
  assert.match(prompt, /Work in the project folder at the current directory/);
  assert.match(prompt, /Determine whether the project is a Git working tree before applying Git instructions/);
  assert.match(prompt, /If no Git working tree exists and neither the task nor project instructions require a commit, finish and verify normally/);
  assert.match(prompt, /do not initialize Git or create follow-up work just to satisfy this generic guidance/);
  assert.match(prompt, /Missing Git alone is then informational: mention it only in the ordinary result summary, never in MEFI_ASK, remaining: or owner:/);
  assert.match(prompt, /No commit is requested/, "the task's own requested scope still reaches the worker");
  assert.match(prompt, /leave a root index.html or a working package preview\/dev\/start script for Studio Preview/);
  assert.match(prompt, /Studio owns the preview server separately/);
  assert.match(prompt, /Do not launch a long-running foreground or background preview server from a builder tool/);
});

test("explicit commit tasks retain their obligation and the shared-index safeguards", async () => {
  for (const gitStage of [null, ""]) {
    const h = executorHost({ gitStage, tasks: [task("Implement the game and commit the completed files as the final deliverable.")] });
    h.wake(); await h.pump();
    assert.equal(h.starts.length, 1);
    const prompt = h.starts[0].child.prompt;
    assert.match(prompt, /commit the completed files as the final deliverable/);
    assert.match(prompt, /Preserve any commit requirement in the task or project instructions/);
    assert.match(prompt, /If a commit is explicitly required, retain that obligation and report any actual blocker/);
    assert.match(prompt, /git commit -m <msg> -- <your files>/);
    assert.match(prompt, /never `git add` followed by a plain `git commit`, `git commit -a`, or `git add -A`/);
  }
});
